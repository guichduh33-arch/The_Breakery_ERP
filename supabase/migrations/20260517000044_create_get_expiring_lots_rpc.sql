-- 20260517000044_create_get_expiring_lots_rpc.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : get_expiring_lots_v1 RPC.
--
-- Read-side RPC powering :
--   - BO `/backoffice/inventory/expiring` page (full list + filters).
--   - BO sidebar `ExpiringLotsBadge` (count only, p_count_only=true).
--   - POS optional grey-out hint (rare — POS calls `useStockLots` directly).
--
-- Window default = 24h (D15 reference). Caller can widen for nightly cron
-- pre-flight reports or narrow to 1h for last-call alerts.
--
-- Returns ALL active lots whose `expires_at <= now() + p_hours_ahead * 1h`,
-- INCLUDING those whose expires_at is already in the past but haven't been
-- cron-flipped yet. The UI tags them "expired (pending sweep)" so operators
-- act on them before the auto-waste cron runs.

CREATE OR REPLACE FUNCTION get_expiring_lots_v1(
  p_hours_ahead INT     DEFAULT 24,
  p_product_id  UUID    DEFAULT NULL,
  p_limit       INT     DEFAULT 100,
  p_offset      INT     DEFAULT 0
) RETURNS TABLE (
  id           UUID,
  product_id   UUID,
  product_sku  TEXT,
  product_name TEXT,
  location_id  UUID,
  location_name TEXT,
  quantity     DECIMAL(10,3),
  unit         TEXT,
  expires_at   TIMESTAMPTZ,
  received_at  TIMESTAMPTZ,
  batch_number TEXT,
  status       TEXT,
  hours_remaining NUMERIC,
  total_count  BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
STABLE
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_threshold TIMESTAMPTZ;
  v_total     BIGINT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_hours_ahead IS NULL OR p_hours_ahead < 0 THEN
    RAISE EXCEPTION 'hours_ahead_must_be_nonnegative' USING ERRCODE='P0001';
  END IF;

  v_threshold := now() + (p_hours_ahead * INTERVAL '1 hour');

  -- Pre-count for pagination — same WHERE clause as the main select.
  SELECT COUNT(*) INTO v_total
    FROM stock_lots sl
    WHERE sl.status = 'active'
      AND sl.expires_at <= v_threshold
      AND (p_product_id IS NULL OR sl.product_id = p_product_id);

  RETURN QUERY
    SELECT
      sl.id,
      sl.product_id,
      p.sku,
      p.name,
      sl.location_id,
      loc.name AS location_name,
      sl.quantity,
      sl.unit,
      sl.expires_at,
      sl.received_at,
      sl.batch_number,
      sl.status,
      ROUND(EXTRACT(EPOCH FROM (sl.expires_at - now()))::NUMERIC / 3600, 2) AS hours_remaining,
      v_total AS total_count
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN stock_locations loc ON loc.id = sl.location_id
    WHERE sl.status = 'active'
      AND sl.expires_at <= v_threshold
      AND (p_product_id IS NULL OR sl.product_id = p_product_id)
    ORDER BY sl.expires_at ASC, sl.received_at ASC, sl.id ASC
    LIMIT p_limit
    OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION get_expiring_lots_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION get_expiring_lots_v1 FROM anon;

COMMENT ON FUNCTION get_expiring_lots_v1 IS
  'Session 13 — F1. Read RPC for expiring-lots dashboard. Returns active lots '
  'whose expires_at falls within the next p_hours_ahead hours (default 24). '
  'Includes already-expired but not-yet-swept lots. Gated by inventory.read.';
