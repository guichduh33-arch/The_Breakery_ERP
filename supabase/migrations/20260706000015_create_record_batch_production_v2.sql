-- 20260706000015_create_record_batch_production_v2.sql
--
-- record_batch_production_v2 — adds an optional, backdatable production_date.
--
-- Why a wrapper (not a clone): record_batch_production_v1 already orchestrates
-- the whole atomic batch (recipe cascade, insufficient-stock rollback, lots,
-- stock_movements, journal entries, audit_log, idempotency). Re-implementing
-- that body to change one column would be hundreds of lines of duplicated,
-- correctness-critical SQL kept in sync forever. Instead v2:
--   1. validates + extracts p_batch->>'production_date'
--   2. delegates to v1 (unchanged, monotonic versioning preserved)
--   3. patches ONLY production_records.production_date for the resulting batch
--
-- IMPORTANT — ledger stays real-time: we deliberately do NOT backdate the
-- stock_movements / journal_entries / created_at. Those keep now() so the
-- inventory ledger and (fiscal-guarded) accounting periods are never rewritten.
-- `production_date` is the "when it was actually produced" field used by the
-- production page's date navigator / KPIs / reporting. This matches the product
-- decision: entry timestamp faithful, production date may be retroactive.
--
-- v1 is left intact. Anon defense-in-depth: REVOKE from PUBLIC + anon, GRANT to
-- authenticated + service_role (mirrors v1).

CREATE OR REPLACE FUNCTION public.record_batch_production_v2(
  p_batch jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             UUID := auth.uid();
  v_production_date TIMESTAMPTZ;
  v_result          JSONB;
  v_batch_id        UUID;
  v_patched         INT := 0;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Optional backdated production date. Empty string / missing key => NULL =>
  -- v1's default (now()) is kept untouched.
  IF (p_batch ? 'production_date')
     AND NULLIF(p_batch->>'production_date', '') IS NOT NULL THEN
    BEGIN
      v_production_date := (p_batch->>'production_date')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_production_date' USING ERRCODE='P0001',
        HINT = 'production_date must be an ISO-8601 timestamp';
    END;
  END IF;

  -- Delegate the atomic batch to v1 (extra p_batch keys are ignored by v1).
  v_result := record_batch_production_v1(p_batch, p_items);

  IF v_production_date IS NOT NULL THEN
    v_batch_id := (v_result->>'batch_id')::uuid;
    UPDATE production_records
       SET production_date = v_production_date,
           updated_at      = now()
     WHERE batch_id = v_batch_id;
    GET DIAGNOSTICS v_patched = ROW_COUNT;
  END IF;

  RETURN v_result
    || jsonb_build_object(
         'production_date',         v_production_date,
         'production_date_patched', v_patched
       );
END $function$;

REVOKE EXECUTE ON FUNCTION public.record_batch_production_v2(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_batch_production_v2(jsonb, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_batch_production_v2(jsonb, jsonb) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.record_batch_production_v2(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.record_batch_production_v2(jsonb, jsonb) IS
  'Atomic batch production (wraps v1) with optional backdatable production_date. Ledger/JE stay now(); only production_records.production_date is patched.';
