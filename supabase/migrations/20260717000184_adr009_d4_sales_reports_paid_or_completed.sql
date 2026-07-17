-- 20260717000184_adr009_d4_sales_reports_paid_or_completed.sql
-- ADR-009 déc. 4 — la transition paid→completed arrive (migration _189) : tout
-- lecteur filtrant `status = 'paid'` doit d'abord être élargi à
-- `status IN ('paid','completed')`, sinon les commandes terminées disparaissent
-- des rapports. Lot 1/3 des lecteurs : rapports ventes.
--
-- Corps copiés du LIVE (pg_get_functiondef, 2026-07-17) — seul changement par
-- fonction : le filtre de statut. ACLs répliquées à l'identique
-- (authenticated + service_role, cf. proacl live).

-- ─── get_sales_by_hour_v3 (ex v2) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_hour_v3(p_date date)
 RETURNS TABLE(hour integer, total numeric, order_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cfg AS (SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz FROM business_config WHERE id = 1),
  bucketed AS (
    SELECT EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::INT AS hour, o.total
    FROM orders o
    WHERE o.status IN ('paid', 'completed') AND o.paid_at IS NOT NULL AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date = p_date
  ),
  rolled AS (SELECT b.hour, SUM(b.total)::DECIMAL(14,2) AS total, COUNT(*)::INT AS order_count FROM bucketed b GROUP BY b.hour),
  hours AS (SELECT generate_series(0, 23) AS hour)
  SELECT hours.hour, COALESCE(rolled.total, 0::DECIMAL(14,2)) AS total, COALESCE(rolled.order_count, 0) AS order_count
  FROM hours LEFT JOIN rolled USING (hour) ORDER BY hours.hour;
END; $function$;

DROP FUNCTION public.get_sales_by_hour_v2(date);

REVOKE EXECUTE ON FUNCTION public.get_sales_by_hour_v3(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_hour_v3(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_hour_v3(date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_by_hour_v3(date) IS
  'Ventes par heure (fuseau business_config). v3 = v2 + statuts paid|completed (ADR-009 déc. 4).';

-- ─── get_sales_by_category_v2 (ex v1) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_category_v2(p_date_start date, p_date_end date)
 RETURNS TABLE(category_id uuid, category_name text, total numeric, qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    c.id                                   AS category_id,
    c.name                                 AS category_name,
    COALESCE(SUM(oi.line_total), 0)::DECIMAL(14,2) AS total,
    COALESCE(SUM(oi.quantity),  0)::DECIMAL(12,3)  AS qty
  FROM order_items oi
  JOIN orders     o ON o.id = oi.order_id
  JOIN products   p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  WHERE o.status IN ('paid', 'completed')
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND oi.is_cancelled = false
    AND oi.is_promo_gift = false
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY c.id, c.name
  ORDER BY total DESC;
$function$;

DROP FUNCTION public.get_sales_by_category_v1(date, date);

REVOKE EXECUTE ON FUNCTION public.get_sales_by_category_v2(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_category_v2(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v2(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_by_category_v2(date, date) IS
  'Ventes par catégorie. v2 = v1 + statuts paid|completed (ADR-009 déc. 4).';

-- ─── get_sales_by_staff_v2 (ex v1) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_staff_v2(p_date_start date, p_date_end date)
 RETURNS TABLE(staff_id uuid, staff_name text, total numeric, order_count integer, avg_basket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  FROM orders o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE o.status IN ('paid', 'completed')
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
$function$;

DROP FUNCTION public.get_sales_by_staff_v1(date, date);

REVOKE EXECUTE ON FUNCTION public.get_sales_by_staff_v2(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_staff_v2(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v2(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_by_staff_v2(date, date) IS
  'Ventes par vendeur. v2 = v1 + statuts paid|completed (ADR-009 déc. 4).';
