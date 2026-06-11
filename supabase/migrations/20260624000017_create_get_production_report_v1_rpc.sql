-- 20260624000017_create_get_production_report_v1_rpc.sql
-- S40 — Production Report. Gate reports.inventory.read.
-- Source: production_records (reverted_at IS NULL).
-- NOTE: production_date is TIMESTAMPTZ (NOT DATE as the plan assumed —
-- DEV-S40-A2-02) → bucketed via business_config.timezone like the other reports.
-- value = quantity_produced × products.cost_price (CURRENT cost, not historical —
-- documented limitation, recipe-version costing is out of scope here).

CREATE OR REPLACE FUNCTION public.get_production_report_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start      DATE;
  v_end        DATE;
  v_tz         TEXT;
  v_summary    JSONB;
  v_by_product JSONB;
  v_by_day     JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH runs AS (
    SELECT pr.product_id,
           ((pr.production_date AT TIME ZONE v_tz))::date AS day,
           pr.quantity_produced,
           pr.quantity_waste,
           (pr.quantity_produced * COALESCE(p.cost_price, 0))::NUMERIC(14,2) AS value,
           p.name AS product_name
      FROM production_records pr
      JOIN products p ON p.id = pr.product_id
     WHERE pr.reverted_at IS NULL
       AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  )
  SELECT
    jsonb_build_object(
      'runs',           COUNT(*),
      'total_produced', COALESCE(SUM(quantity_produced), 0),
      'total_waste',    COALESCE(SUM(quantity_waste), 0),
      'total_value',    COALESCE(SUM(value), 0)
    )
  INTO v_summary
  FROM runs;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'product_id',   t.product_id,
      'product_name', t.product_name,
      'qty_produced', t.qty_produced,
      'qty_waste',    t.qty_waste,
      'value',        t.value,
      'runs',         t.runs
    ) ORDER BY t.value DESC
  ), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT product_id,
           MAX(product_name)                          AS product_name,
           SUM(quantity_produced)                     AS qty_produced,
           SUM(quantity_waste)                        AS qty_waste,
           SUM(value)::NUMERIC(14,2)                  AS value,
           COUNT(*)::INT                              AS runs
      FROM (
        SELECT pr.product_id,
               p.name AS product_name,
               pr.quantity_produced,
               pr.quantity_waste,
               (pr.quantity_produced * COALESCE(p.cost_price, 0))::NUMERIC(14,2) AS value
          FROM production_records pr
          JOIN products p ON p.id = pr.product_id
         WHERE pr.reverted_at IS NULL
           AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
      ) x
     GROUP BY product_id
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',         t.day,
      'qty_produced', t.qty_produced,
      'qty_waste',    t.qty_waste,
      'value',        t.value
    ) ORDER BY t.day
  ), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT ((pr.production_date AT TIME ZONE v_tz))::date AS day,
           SUM(pr.quantity_produced)                       AS qty_produced,
           SUM(pr.quantity_waste)                          AS qty_waste,
           SUM(pr.quantity_produced * COALESCE(p.cost_price, 0))::NUMERIC(14,2) AS value
      FROM production_records pr
      JOIN products p ON p.id = pr.product_id
     WHERE pr.reverted_at IS NULL
       AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'period',     jsonb_build_object('start', v_start, 'end', v_end),
    'summary',    v_summary,
    'by_product', v_by_product,
    'by_day',     v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_production_report_v1(TEXT, TEXT) IS
  'S40 — production runs aggregated by product and day. value = qty_produced × current '
  'products.cost_price (not historical). Gate reports.inventory.read.';

REVOKE ALL ON FUNCTION public.get_production_report_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_production_report_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_production_report_v1(TEXT, TEXT) TO authenticated;
