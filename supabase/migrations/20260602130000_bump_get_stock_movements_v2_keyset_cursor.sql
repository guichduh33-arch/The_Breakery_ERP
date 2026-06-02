-- 20260602130000_bump_get_stock_movements_v2_keyset_cursor.sql
-- M9(a) fix (audit 2026-06-01 §Medium) — keyset tiebreaker on the report cursor.
--
-- Problem: get_stock_movements_v1 (6-arg, S30, RETURNS jsonb) paginates on
-- `created_at` ALONE (p_cursor TIMESTAMPTZ, predicate `created_at < p_cursor`,
-- next_cursor = created_at of the N+1th row). On an equality cluster (a single
-- complete_order_with_payment inserting many stock_movements in one tx → same
-- created_at), the strict `<` boundary silently DROPS or DUPLICATES rows across
-- page edges.
--
-- Fix: bump to get_stock_movements_v2 with a COMPOSITE keyset cursor `(created_at, id)`.
-- The cursor is an opaque TEXT token "<created_at>|<id>"; the predicate uses a row
-- comparison `(created_at, id) < (cursor_ts, cursor_id)` with ORDER BY
-- `created_at DESC, id DESC`. Stable, no drop/dupe regardless of timestamp ties.
--
-- The bare-TIMESTAMPTZ → TEXT cursor is a signature change, so this is a v2 bump
-- (CLAUDE.md monotonic RPC versioning). The 8-arg S13 overload
-- get_stock_movements_v1(uuid,uuid,...) RETURNS TABLE is UNTOUCHED — it already
-- keysets on (created_at, id) via p_cursor + p_cursor_id and feeds a different
-- consumer (useStockMovementsFeed). Dropping the buggy 6-arg also removes the
-- overload ambiguity flagged in DEV-S30-1.A-04.

CREATE OR REPLACE FUNCTION get_stock_movements_v2(
  p_start          TEXT,
  p_end            TEXT,
  p_product_id     UUID DEFAULT NULL,
  p_movement_type  TEXT DEFAULT NULL,
  p_limit          INT  DEFAULT 50,
  p_cursor         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_clamp     INT := LEAST(GREATEST(p_limit, 1), 200);
  v_cursor_ts TIMESTAMPTZ := NULL;
  v_cursor_id UUID := NULL;
  v_lines     JSONB;
  v_last_cur  TEXT;
  v_has_next  BOOLEAN;
  v_next      TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  -- Decode the composite cursor token "<created_at>|<id>".
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  END IF;

  -- Fetch v_clamp + 1 rows (keyset) to detect the next page in one pass.
  WITH filtered AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name                 AS product_name,
      sm.movement_type::text AS movement_type,
      sm.quantity,
      sm.unit_cost,
      sm.lot_id,
      sm.reference_type,
      sm.reference_id,
      sm.created_by,
      sm.created_at,
      ROW_NUMBER() OVER (ORDER BY sm.created_at DESC, sm.id DESC) AS rn
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.created_at BETWEEN v_start AND v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (v_cursor_ts     IS NULL OR (sm.created_at, sm.id) < (v_cursor_ts, v_cursor_id))
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              f.id,
        'product_id',      f.product_id,
        'product_name',    f.product_name,
        'movement_type',   f.movement_type,
        'quantity',        f.quantity,
        'unit_cost',       f.unit_cost,
        'value',           ABS(f.quantity) * COALESCE(f.unit_cost, 0),
        'lot_id',          f.lot_id,
        'reference_type',  f.reference_type,
        'reference_id',    f.reference_id,
        'created_by_name', up.full_name,
        'created_at',      f.created_at
      ) ORDER BY f.created_at DESC, f.id DESC)
      FILTER (WHERE f.rn <= v_clamp),
      '[]'::jsonb
    ),
    -- Cursor = keyset of the LAST EMITTED row (rn = v_clamp), emitted only when a
    -- sentinel (rn = v_clamp + 1) proves another page exists. Using the sentinel's
    -- own keyset would skip it on the next page's strict `<` boundary.
    MAX(CASE WHEN f.rn = v_clamp
             THEN f.created_at::text || '|' || f.id::text END),
    bool_or(f.rn = v_clamp + 1)
  INTO v_lines, v_last_cur, v_has_next
  FROM filtered f
  LEFT JOIN user_profiles up ON up.id = f.created_by;

  v_next := CASE WHEN COALESCE(v_has_next, FALSE) THEN v_last_cur ELSE NULL END;

  RETURN jsonb_build_object(
    'lines',       v_lines,
    'next_cursor', v_next
  );
END;
$$;

-- REVOKE pair (S25 canonique) — authenticated/service_role keep their direct grant.
REVOKE EXECUTE ON FUNCTION get_stock_movements_v2(TEXT, TEXT, UUID, TEXT, INT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Drop the buggy 6-arg v1 (replaced). Leaves the 8-arg S13 RETURNS TABLE overload intact.
DROP FUNCTION IF EXISTS get_stock_movements_v1(TEXT, TEXT, UUID, TEXT, INT, TIMESTAMPTZ);

COMMENT ON FUNCTION get_stock_movements_v2(TEXT, TEXT, UUID, TEXT, INT, TEXT) IS
  'M9(a) : Stock Movement history — keyset cursor (created_at, id) via opaque TEXT token. Replaces the 6-arg v1 (created_at-only cursor, dropped). Gate reports.inventory.read.';
