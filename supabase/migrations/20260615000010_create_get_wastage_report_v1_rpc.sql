-- 20260615000010_create_get_wastage_report_v1_rpc.sql
-- S30 Wave 1.A.1 — Wastage & Spoilage report.
-- DEV-S30-1.A-01: stock_lots.expired_at does not exist — uses expires_at for spoilage date.
-- DEV-S30-1.A-03: stock_lots.status is text (no enum) — plain string comparison.
CREATE OR REPLACE FUNCTION get_wastage_report_v1(p_date_start TEXT, p_date_end TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_start      TIMESTAMPTZ := (p_date_start || 'T00:00:00Z')::timestamptz;
  v_end        TIMESTAMPTZ := (p_date_end   || 'T23:59:59Z')::timestamptz;
  v_summary    JSONB;
  v_by_product JSONB;
  v_lines      JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  -- Summary
  WITH waste_rows AS (
    SELECT
      'manual_waste'::text AS type,
      ABS(sm.quantity) AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at BETWEEN v_start AND v_end
  ),
  spoilage_rows AS (
    -- DEV-S30-1.A-01: no expired_at col — use expires_at as spoilage date
    SELECT
      'spoilage'::text AS type,
      sl.quantity      AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at BETWEEN v_start AND v_end
  ),
  all_rows AS (SELECT * FROM waste_rows UNION ALL SELECT * FROM spoilage_rows)
  SELECT jsonb_build_object(
    'total_manual_waste_qty',   COALESCE(SUM(qty)   FILTER (WHERE type = 'manual_waste'), 0),
    'total_manual_waste_value', COALESCE(SUM(value) FILTER (WHERE type = 'manual_waste'), 0),
    'total_spoilage_qty',       COALESCE(SUM(qty)   FILTER (WHERE type = 'spoilage'), 0),
    'total_spoilage_value',     COALESCE(SUM(value) FILTER (WHERE type = 'spoilage'), 0),
    'total_qty',                COALESCE(SUM(qty), 0),
    'total_value',              COALESCE(SUM(value), 0),
    'line_count',               COUNT(*)
  )
  INTO v_summary
  FROM all_rows;

  -- By-product breakdown
  WITH waste_rows AS (
    SELECT sm.product_id,
      ABS(sm.quantity) AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value,
      'manual_waste'::text AS type
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at BETWEEN v_start AND v_end
  ),
  spoilage_rows AS (
    SELECT sl.product_id,
      sl.quantity AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value,
      'spoilage'::text AS type
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at BETWEEN v_start AND v_end
  ),
  all_rows AS (SELECT * FROM waste_rows UNION ALL SELECT * FROM spoilage_rows)
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY (row_to_json(t)->>'total_value')::numeric DESC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT
      ar.product_id,
      (SELECT p.name FROM products p WHERE p.id = ar.product_id) AS product_name,
      COALESCE(SUM(ar.qty)   FILTER (WHERE ar.type = 'manual_waste'), 0) AS manual_waste_qty,
      COALESCE(SUM(ar.value) FILTER (WHERE ar.type = 'manual_waste'), 0) AS manual_waste_value,
      COALESCE(SUM(ar.qty)   FILTER (WHERE ar.type = 'spoilage'), 0)     AS spoilage_qty,
      COALESCE(SUM(ar.value) FILTER (WHERE ar.type = 'spoilage'), 0)     AS spoilage_value,
      SUM(ar.qty)   AS total_qty,
      SUM(ar.value) AS total_value
    FROM all_rows ar
    GROUP BY ar.product_id
  ) t;

  -- Detail lines (LIMIT 500)
  WITH waste_lines AS (
    SELECT
      sm.id::text          AS id,
      sm.product_id,
      p.name               AS product_name,
      'manual_waste'::text AS type,
      ABS(sm.quantity)     AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value,
      sm.lot_id::text      AS lot_id,
      NULL::text           AS lot_batch_number,
      sm.reason            AS reason,
      sm.created_by        AS created_by,
      sm.created_at        AS created_at
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at BETWEEN v_start AND v_end
  ),
  spoilage_lines AS (
    -- DEV-S30-1.A-01: using expires_at as created_at proxy for spoilage rows
    SELECT
      sl.id::text        AS id,
      sl.product_id,
      p.name             AS product_name,
      'spoilage'::text   AS type,
      sl.quantity        AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value,
      sl.id::text        AS lot_id,
      sl.batch_number    AS lot_batch_number,
      'expired'::text    AS reason,
      NULL::uuid         AS created_by,
      sl.expires_at      AS created_at
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at BETWEEN v_start AND v_end
  ),
  all_lines AS (SELECT * FROM waste_lines UNION ALL SELECT * FROM spoilage_lines)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               al.id,
    'product_id',       al.product_id,
    'product_name',     al.product_name,
    'type',             al.type,
    'qty',              al.qty,
    'value',            al.value,
    'lot_id',           al.lot_id,
    'lot_batch_number', al.lot_batch_number,
    'reason',           al.reason,
    'created_by_name',  up.full_name,
    'created_at',       al.created_at
  ) ORDER BY al.created_at DESC), '[]'::jsonb)
  INTO v_lines
  FROM (SELECT * FROM all_lines ORDER BY created_at DESC LIMIT 500) al
  LEFT JOIN user_profiles up ON up.id = al.created_by;

  RETURN jsonb_build_object(
    'period',     jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary',    v_summary,
    'by_product', v_by_product,
    'lines',      v_lines
  );
END;
$$;

COMMENT ON FUNCTION get_wastage_report_v1(TEXT, TEXT) IS
  'S30 : Wastage & Spoilage — aggregates stock_movements waste + stock_lots expired (uses expires_at, no expired_at col).';
