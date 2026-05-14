-- 20260517000045_pg_cron_mark_expired_lots.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : hourly pg_cron job.
--
-- Sweeps stock_lots hourly, flipping past-expiry lots `status='active' →
-- 'expired'`. For each newly-expired lot with `quantity > 0`, INSERTs an
-- auto-waste `stock_movements` row via `waste_stock_v1` so the ledger
-- reflects the implicit waste (never as an UPDATE — always a new row).
--
-- INVARIANT (D15) : the cron UPDATEs `stock_lots` (licit — that table is
-- mutable). It does NOT UPDATE `stock_movements` rows ; it inserts a new
-- waste row via the standard wrapper. Pinned by pgTAP T_F1_NO_LOT_ID_UPDATE
-- and T_F1_NO_TRIGGER_INVARIANT.
--
-- The function is SECURITY DEFINER and owned by postgres so pg_cron (which
-- runs as the cron role) can invoke it. Permissions are NOT granted to
-- authenticated — operators trigger via the dedicated admin RPC if needed.

-- Idempotent extension load. pg_cron lives in the `extensions` schema in
-- Supabase. If we're running in a context without pg_cron (Edge tests on
-- Windows), the CREATE EXTENSION call is wrapped in a DO block that swallows
-- the missing-extension error so the migration still applies cleanly.
DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN feature_not_supported OR insufficient_privilege OR undefined_file THEN
  RAISE NOTICE 'pg_cron not available in this environment — skipping job scheduling.';
END $do$;

-- ──────────────────────────────────────────────────────────────────────────────
-- mark_expired_lots_hourly() — the sweep function itself.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_expired_lots_hourly()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flipped_count INT := 0;
  v_wasted_count  INT := 0;
  v_lot RECORD;
BEGIN
  -- Sweep : find all active lots whose expires_at has passed AND haven't
  -- been flipped yet. Lock each in turn so concurrent workers don't double-flip.
  FOR v_lot IN
    SELECT id, product_id, quantity, unit
      FROM stock_lots
      WHERE status = 'active'
        AND expires_at < now()
      FOR UPDATE SKIP LOCKED
  LOOP
    -- Flip status. Quantity stays as-is — the waste row will reflect the loss.
    UPDATE stock_lots
      SET status = 'expired', updated_at = now()
      WHERE id = v_lot.id;
    v_flipped_count := v_flipped_count + 1;

    -- If the lot had remaining stock, emit a waste row (single new INSERT in
    -- stock_movements via the wrapper — never an UPDATE on existing rows).
    IF v_lot.quantity > 0 THEN
      -- We call record_stock_movement_v1 directly here (we're running as
      -- postgres, the owner) with movement_type='waste'. We do NOT call the
      -- public waste_stock_v1 wrapper — it expects auth.uid() which is NULL
      -- in a cron context. Per CLAUDE.md the primitive is internal-only, and
      -- this cron lives in the same SECURITY DEFINER bucket.
      PERFORM record_stock_movement_v1(
        p_product_id      => v_lot.product_id,
        p_movement_type   => 'waste'::movement_type,
        p_quantity        => -v_lot.quantity,
        p_reason          => 'auto-expired lot ' || v_lot.id::text,
        p_unit_cost       => NULL,
        p_supplier_id     => NULL,
        p_idempotency_key => NULL,
        p_unit            => v_lot.unit,
        p_from_section_id => NULL,
        p_to_section_id   => NULL,
        p_metadata        => jsonb_build_object(
          'source',   'mark_expired_lots_hourly',
          'lot_id',   v_lot.id,
          'reason',   'expiry'
        )
      );
      v_wasted_count := v_wasted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'flipped_to_expired', v_flipped_count,
    'auto_wasted_rows',   v_wasted_count,
    'ran_at',             now()
  );
END $$;

REVOKE EXECUTE ON FUNCTION mark_expired_lots_hourly() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_expired_lots_hourly() FROM authenticated;
REVOKE EXECUTE ON FUNCTION mark_expired_lots_hourly() FROM anon;

COMMENT ON FUNCTION mark_expired_lots_hourly IS
  'Session 13 — F1. SECURITY DEFINER. Hourly pg_cron sweep : flips '
  'stock_lots.status=active→expired AND emits a new waste stock_movements row '
  'for each lot with remaining quantity. UPDATEs only stock_lots (licit), '
  'never stock_movements (preserves append-only).';

-- ──────────────────────────────────────────────────────────────────────────────
-- Schedule the job — only if pg_cron is loaded.
-- ──────────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  v_extension_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_extension_exists;

  IF NOT v_extension_exists THEN
    RAISE NOTICE 'pg_cron extension not present — mark_expired_lots_hourly will need manual scheduling.';
    RETURN;
  END IF;

  -- Unschedule any prior version (idempotent re-apply).
  PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'mark_expired_lots_hourly';

  -- Run every hour at minute 7 to avoid clustering with other jobs at :00.
  PERFORM cron.schedule(
    'mark_expired_lots_hourly',
    '7 * * * *',
    $cron$SELECT public.mark_expired_lots_hourly()$cron$
  );
END $do$;
