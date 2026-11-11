-- 20261111000007_combo_sales_filters.sql
-- S3-22, étape 2, troisième lot : le rapport « Combo Sales » reçoit le socle
-- de filtres.
--
-- Une famille bumpée, corps repris du live (pg_get_functiondef, 2026-11-11) :
--   * get_combo_sales v4 -> v5 : nouvel argument `p_filters jsonb`.
--
-- Clés reconnues de `p_filters`, toutes optionnelles (absente, null ou chaîne
-- vide = pas de filtre ; une clé inconnue est ignorée). Prédicats IDENTIQUES à
-- ceux des familles get_sales_by_product, get_sales_by_category,
-- get_sales_by_staff, get_sales_by_origin et get_sales_by_customer :
--   * order_type     : o.order_type::text = valeur
--   * payment_method : la commande porte au moins un règlement de ce moyen
--   * table_number   : o.table_number = valeur (égalité stricte)
--
-- Les filtres s'appliquent au CTE `scoped`, donc à TOUT ce qui en dérive : les
-- lignes de combo, les commandes de la période (chiffre brut, ticket moyen
-- avec et sans combo) et la période précédente. Le ticket « sans combo » reste
-- donc comparé à portée égale. Rien d'autre ne change : gate, jour métier,
-- exclusions, colonnes rendues. Sans filtre, le résultat est celui de v4.

CREATE FUNCTION public.get_combo_sales_v5(
  p_start_date date,
  p_end_date date,
  p_filters jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
  -- Filtres optionnels : NULL = pas de filtre (clé absente, null ou chaîne vide).
  v_f_order_type     text := NULLIF(p_filters->>'order_type', '');
  v_f_payment_method text := NULLIF(p_filters->>'payment_method', '');
  v_f_table_number   text := NULLIF(p_filters->>'table_number', '');
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total,
           ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
      AND (v_f_order_type IS NULL OR o.order_type::text = v_f_order_type)
      AND (v_f_payment_method IS NULL OR EXISTS (
        SELECT 1 FROM reporting_private.closed_order_payments_v1 op
        WHERE op.order_id = o.id AND op.method::text = v_f_payment_method
      ))
      AND (v_f_table_number IS NULL OR o.table_number = v_f_table_number)
  ),
  combo_lines AS (
    SELECT oi.id, oi.order_id, oi.product_id, oi.name_snapshot, oi.quantity,
           oi.line_total, oi.combo_components, oi.created_at, s.bd
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.combo_components IS NOT NULL
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  cur_orders  AS (SELECT * FROM scoped      WHERE bd BETWEEN v_start AND v_end),
  cur_lines   AS (SELECT * FROM combo_lines WHERE bd BETWEEN v_start AND v_end),
  prev_lines  AS (SELECT * FROM combo_lines WHERE bd <  v_start),
  with_combo  AS (SELECT DISTINCT order_id FROM cur_lines),
  tickets AS (
    SELECT
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NOT NULL), 0) AS avg_with,
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NULL), 0)     AS avg_without
    FROM cur_orders o
    LEFT JOIN with_combo w ON w.order_id = o.id
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'combo_revenue',      COALESCE((SELECT SUM(line_total) FROM cur_lines), 0),
      'combo_revenue_prev', COALESCE((SELECT SUM(line_total) FROM prev_lines), 0),
      'combo_qty',          COALESCE((SELECT SUM(quantity) FROM cur_lines), 0),
      'combo_qty_prev',     COALESCE((SELECT SUM(quantity) FROM prev_lines), 0),
      'combo_orders',       (SELECT COUNT(*) FROM with_combo),
      'gross_sales',        COALESCE((SELECT SUM(total) FROM cur_orders), 0),
      'avg_ticket_with',    (SELECT avg_with FROM tickets),
      'avg_ticket_without', (SELECT avg_without FROM tickets)
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.bd, 'revenue', d.revenue, 'qty', d.qty
      ) ORDER BY d.bd ASC)
      FROM (
        SELECT bd, SUM(line_total) AS revenue, SUM(quantity) AS qty
        FROM cur_lines GROUP BY bd
      ) d
    ), '[]'::jsonb),
    'by_combo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', bc.product_id,
        'name',       bc.name,
        'qty',        bc.qty,
        'revenue',    bc.revenue,
        'avg_price',  bc.avg_price
      ) ORDER BY bc.revenue DESC)
      FROM (
        SELECT product_id,
               (ARRAY_AGG(name_snapshot ORDER BY created_at DESC))[1] AS name,
               SUM(quantity)   AS qty,
               SUM(line_total) AS revenue,
               ROUND(SUM(line_total) / NULLIF(SUM(quantity), 0), 0) AS avg_price
        FROM cur_lines
        GROUP BY product_id
      ) bc
    ), '[]'::jsonb),
    'component_picks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', cp.product_id,
        'name',       cp.name,
        'qty',        cp.qty
      ) ORDER BY cp.qty DESC)
      FROM (
        SELECT (comp->>'product_id')::uuid AS product_id,
               COALESCE(MAX(p.name), 'deleted') AS name,
               SUM(COALESCE((comp->>'quantity')::numeric, 1) * cl.quantity) AS qty
        FROM cur_lines cl
        CROSS JOIN LATERAL jsonb_array_elements(cl.combo_components) comp
        LEFT JOIN products p ON p.id = (comp->>'product_id')::uuid
        GROUP BY (comp->>'product_id')::uuid
      ) cp
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_combo_sales_v5(date, date, jsonb) IS
  'S3-22: v4 + optional p_filters (order_type, payment_method, table_number), same predicates as get_sales_by_product, applied to every derived figure and to the previous period. Output unchanged. Gate reports.sales.read.';

REVOKE ALL ON FUNCTION public.get_combo_sales_v5(date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_combo_sales_v5(date, date, jsonb) TO authenticated, service_role;
DROP FUNCTION public.get_combo_sales_v4(date, date);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
