-- 20260818000011_get_sales_by_table_v1.sql
--
-- Rapport « Ventes par table » (famille Sales). Répond à : « quelles tables
-- travaillent, lesquelles dorment — et le patio vaut-il ses couverts ? »
-- (maquette + arbitrages validés par Mamat le 2026-08-17 : heatmap en NOMBRE
-- DE COMMANDES — pas en CA — ; une commande dine-in SANS table est un cas
-- « non autorisé » métier → EXCLUE du rapport. Écart signalé le 2026-08-17 :
-- la base dev porte 19/21 dine_in sans table — le POS le permet encore,
-- sujet POS traité à part).
--
-- PÉRIMÈTRE : ventes canoniques (paid|completed, non annulées, hors import
-- historique, hors produits de test), order_type = dine_in, table_number
-- renseigné. La table se joint par NOM (order.table_number est le libellé
-- POS) en LEFT JOIN : une commande sur une table renommée/supprimée reste
-- visible, seats à NULL — jamais de ventes perdues par une jointure.
--
-- LA HEATMAP : by_table_dow sert commandes ET CA par (table × jour ISO 1-7) ;
-- l'affichage retenu est le NOMBRE de commandes (arbitrage), le CA reste
-- servi pour le tooltip.

CREATE OR REPLACE FUNCTION public.get_sales_by_table_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
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
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT.
  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total, o.table_number,
           ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND o.order_type = 'dine_in'
      -- Arbitrage : une dine-in sans table est un cas non autorisé — exclue.
      AND NULLIF(o.table_number, '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  prev AS (SELECT * FROM scoped WHERE bd <  v_start),
  active_tables AS (
    SELECT name, seats FROM restaurant_tables
    WHERE deleted_at IS NULL AND is_active
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       COALESCE((SELECT SUM(total) FROM cur), 0),
      'revenue_prev',  COALESCE((SELECT SUM(total) FROM prev), 0),
      'orders',        (SELECT COUNT(*) FROM cur),
      'orders_prev',   (SELECT COUNT(*) FROM prev),
      'tables_used',   (SELECT COUNT(DISTINCT table_number) FROM cur),
      'active_tables', (SELECT COUNT(*) FROM active_tables),
      'active_seats',  COALESCE((SELECT SUM(seats) FROM active_tables), 0)
    ),
    'by_table', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table_number', bt.table_number,
        'seats',        bt.seats,
        'orders',       bt.orders,
        'revenue',      bt.revenue,
        'avg_ticket',   bt.avg_ticket,
        'revenue_prev', COALESCE(pv.revenue, 0)
      ) ORDER BY bt.revenue DESC)
      FROM (
        SELECT c.table_number, at_.seats,
               COUNT(*)               AS orders,
               SUM(c.total)           AS revenue,
               ROUND(AVG(c.total), 0) AS avg_ticket
        FROM cur c
        LEFT JOIN active_tables at_ ON at_.name = c.table_number
        GROUP BY c.table_number, at_.seats
      ) bt
      LEFT JOIN (
        SELECT table_number, SUM(total) AS revenue
        FROM prev GROUP BY table_number
      ) pv ON pv.table_number = bt.table_number
    ), '[]'::jsonb),
    -- Heatmap table × jour ISO (1 = lundi … 7 = dimanche). Les deux mesures
    -- sont servies ; l'affichage retenu est ORDERS (arbitrage 2026-08-17).
    'by_table_dow', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table_number', d.table_number,
        'dow',          d.dow,
        'orders',       d.orders,
        'revenue',      d.revenue
      ) ORDER BY d.table_number ASC, d.dow ASC)
      FROM (
        SELECT table_number,
               EXTRACT(ISODOW FROM bd)::int AS dow,
               COUNT(*)     AS orders,
               SUM(total)   AS revenue
        FROM cur
        GROUP BY table_number, EXTRACT(ISODOW FROM bd)
      ) d
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_sales_by_table_v1(date, date) IS
  'Ventes par table de salle — dine-in canoniques AVEC table (une dine-in '
  'sans table est un cas non autorisé, exclue — arbitrage 2026-08-17). '
  'Jointure par nom en LEFT JOIN (une table renommée ne perd pas ses ventes), '
  'heatmap table × jour ISO servie en commandes ET CA (affichage retenu : '
  'commandes), fenêtre précédente pour les deltas. Clamp 366 j. Gate '
  'reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_sales_by_table_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_table_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_table_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
