-- 20261111000002_sales_by_staff_filters.sql
-- S3-22, étape 2 : le rapport « Sales by Staff » reçoit le socle de filtres.
--
-- Une famille bumpée, corps repris du live (pg_get_functiondef, 2026-11-11) :
--   * get_sales_by_staff v5 -> v6 : nouvel argument `p_filters jsonb`.
--
-- Clés reconnues de `p_filters`, toutes optionnelles (absente, null ou chaîne
-- vide = pas de filtre ; une clé inconnue est ignorée). Prédicats IDENTIQUES à
-- ceux de la famille get_sales_by_product :
--   * order_type     : o.order_type::text = valeur
--   * payment_method : la commande porte au moins un règlement de ce moyen
--   * table_number   : o.table_number = valeur (égalité stricte)
--
-- Rien d'autre ne change : gate, jour métier, exclusion des annulées, tri et
-- colonnes rendues. Sans filtre, le résultat est celui de v5.

CREATE FUNCTION public.get_sales_by_staff_v6(
  p_date_start date,
  p_date_end date,
  p_filters jsonb DEFAULT '{}'::jsonb
)
 RETURNS TABLE(staff_id uuid, staff_name text, total numeric, order_count integer, avg_basket numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Filtres optionnels : NULL = pas de filtre (clé absente, null ou chaîne vide).
  v_f_order_type     text := NULLIF(p_filters->>'order_type', '');
  v_f_payment_method text := NULLIF(p_filters->>'payment_method', '');
  v_f_table_number   text := NULLIF(p_filters->>'table_number', '');
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    o.served_by                            AS staff_id,
    up.full_name                           AS staff_name,
    SUM(o.total)::DECIMAL(14,2)            AS total,
    COUNT(*)::INT                          AS order_count,
    (SUM(o.total) / NULLIF(COUNT(*), 0))::DECIMAL(14,2) AS avg_basket
  FROM reporting_private.recognized_sales_v2 o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE TRUE
    AND o.recognized_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
    AND (v_f_order_type IS NULL OR o.order_type::text = v_f_order_type)
    AND (v_f_payment_method IS NULL OR EXISTS (
      SELECT 1 FROM reporting_private.closed_order_payments_v1 op
      WHERE op.order_id = o.id AND op.method::text = v_f_payment_method
    ))
    AND (v_f_table_number IS NULL OR o.table_number = v_f_table_number)
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
END;
$function$;

COMMENT ON FUNCTION public.get_sales_by_staff_v6(date, date, jsonb) IS
  'S3-22: v5 + optional p_filters (order_type, payment_method, table_number), same predicates as get_sales_by_product. Columns unchanged. Gate reports.sales.read.';

REVOKE ALL ON FUNCTION public.get_sales_by_staff_v6(date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v6(date, date, jsonb) TO authenticated, service_role;
DROP FUNCTION public.get_sales_by_staff_v5(date, date);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
