-- 20260624000018_create_get_production_efficiency_v1_rpc.sql
-- S40 — Production Efficiency. Gate reports.inventory.read.
-- yield_variance_pct is a GENERATED column storing a RATIO ((actual-expected)/expected),
-- not a percentage despite its name (DEV-S40-A2-03) → exposed ×100 here so the
-- report's *_pct fields are true percentages.
-- waste_rate_pct = waste / (produced + waste) × 100.
-- worst = MIN (most negative variance). AVG/MIN ignore NULL variances natively.

CREATE OR REPLACE FUNCTION public.get_production_efficiency_v1(
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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'product_id',             t.product_id,
      'product_name',           t.product_name,
      'runs',                   t.runs,
      'avg_yield_variance_pct', t.avg_yield_variance_pct,
      'worst_variance_pct',     t.worst_variance_pct,
      'waste_rate_pct',         t.waste_rate_pct,
      'has_variance_reasons',   t.has_variance_reasons
    ) ORDER BY t.waste_rate_pct DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT pr.product_id,
           MAX(p.name)                                            AS product_name,
           COUNT(*)::INT                                          AS runs,
           ROUND(AVG(pr.yield_variance_pct) * 100, 2)             AS avg_yield_variance_pct,
           ROUND(MIN(pr.yield_variance_pct) * 100, 2)             AS worst_variance_pct,
           ROUND(SUM(pr.quantity_waste)
                 / NULLIF(SUM(pr.quantity_produced + pr.quantity_waste), 0) * 100, 2)
                                                                  AS waste_rate_pct,
           BOOL_OR(pr.yield_variance_reason IS NOT NULL)          AS has_variance_reasons
      FROM production_records pr
      JOIN products p ON p.id = pr.product_id
     WHERE pr.reverted_at IS NULL
       AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY pr.product_id
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',                   t.day,
      'avg_yield_variance_pct', t.avg_yield_variance_pct,
      'waste_rate_pct',         t.waste_rate_pct
    ) ORDER BY t.day
  ), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT ((pr.production_date AT TIME ZONE v_tz))::date        AS day,
           ROUND(AVG(pr.yield_variance_pct) * 100, 2)            AS avg_yield_variance_pct,
           ROUND(SUM(pr.quantity_waste)
                 / NULLIF(SUM(pr.quantity_produced + pr.quantity_waste), 0) * 100, 2)
                                                                 AS waste_rate_pct
      FROM production_records pr
     WHERE pr.reverted_at IS NULL
       AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'period',     jsonb_build_object('start', v_start, 'end', v_end),
    'by_product', v_by_product,
    'by_day',     v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_production_efficiency_v1(TEXT, TEXT) IS
  'S40 — per-product yield variance (DB ratio exposed ×100 as pct) + waste rate. '
  'worst = MIN (most negative). Gate reports.inventory.read.';

REVOKE ALL ON FUNCTION public.get_production_efficiency_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_production_efficiency_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_production_efficiency_v1(TEXT, TEXT) TO authenticated;
