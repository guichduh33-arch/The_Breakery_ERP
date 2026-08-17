-- 20260818000008_get_sales_by_origin_v1.sql
--
-- Rapport « Ventes par origine — P / T1 / T2 / BO » (famille Sales). Répond
-- à : « d'où viennent mes ventes — comptoir, tablettes salle, back-office —
-- et l'équilibre bouge-t-il ? » (maquette + arbitrages validés par Mamat le
-- 2026-08-17).
--
-- L'ORIGINE EST DANS LE NUMÉRO (numérotation source-codée du 2026-08-16,
-- migrations 20260816000001..004) : order_number = <code><DDMMYYYY><NNN>,
-- code validé `^(P|T[0-9]+|BO)$` à la création. Les commandes B2B sortent en
-- BO (create_b2b_order pose le code en dur) — l'arbitrage « B2B compté dans
-- Back-office » est donc structurel, pas un regroupement de rapport.
--
-- PRÉ-NUMÉROTATION EXCLUE (arbitrage Mamat) : une commande dont le numéro ne
-- porte pas le format source-codé (#0042, SEE…, B2B-…) n'entre PAS — pas de
-- bucket « Historique ». Le rapport ne dit rien d'avant le 2026-08-16, et son
-- total peut donc différer des autres rapports de ventes sur toute période à
-- cheval : c'est le périmètre choisi, la page l'affiche en réserve.
--
-- PARSING : `^(BO|P|T[0-9])` — les codes tablette vivants tiennent sur UN
-- chiffre (réglage terminal T1/T2). Un code T à deux chiffres (T10+) serait
-- ambigu avec la date qui suit : si ce parc existe un jour, bump _v2 avec un
-- séparateur dans la numérotation. Le groupement est DYNAMIQUE (un T3 sort
-- tout seul) ; by_day est servi en format long {date, origin, …}, la page
-- pivote.
--
-- PÉRIMÈTRE ventes canonique : paid|completed, non annulées, hors import
-- historique, hors commandes contenant un produit de test ; jour métier sur
-- COALESCE(paid_at, created_at) ; clamp 366 jours ; fenêtre précédente de
-- même longueur pour les deltas. discount_total = remise commande + promos +
-- points brûlés (les leviers portés par la commande — le détail par levier
-- vit dans Discounts & Loyalty).

CREATE OR REPLACE FUNCTION public.get_sales_by_origin_v1(
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
    SELECT
      o.id, o.total,
      COALESCE(o.discount_amount, 0) + COALESCE(o.promotion_total, 0)
        + COALESCE(o.loyalty_redemption_amount, 0) AS discount_total,
      (regexp_match(o.order_number, '^(BO|P|T[0-9])'))[1] AS origin,
      ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      -- Numérotation source-codée uniquement (arbitrage : pré-numérotation exclue).
      AND o.order_number ~ '^(BO|P|T[0-9])[0-9]{11,}$'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  prev AS (SELECT * FROM scoped WHERE bd <  v_start)
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'total_revenue',      COALESCE((SELECT SUM(total)  FROM cur), 0),
      'total_orders',       (SELECT COUNT(*) FROM cur),
      'total_revenue_prev', COALESCE((SELECT SUM(total)  FROM prev), 0),
      'total_orders_prev',  (SELECT COUNT(*) FROM prev)
    ),
    'by_origin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'origin',         bo.origin,
        'orders',         bo.orders,
        'revenue',        bo.revenue,
        'avg_ticket',     bo.avg_ticket,
        'discount_total', bo.discount_total,
        'revenue_prev',   COALESCE(pv.revenue, 0),
        'orders_prev',    COALESCE(pv.orders, 0)
      ) ORDER BY bo.revenue DESC)
      FROM (
        SELECT origin, COUNT(*) AS orders, SUM(total) AS revenue,
               ROUND(AVG(total), 0) AS avg_ticket,
               SUM(discount_total) AS discount_total
        FROM cur GROUP BY origin
      ) bo
      LEFT JOIN (
        SELECT origin, COUNT(*) AS orders, SUM(total) AS revenue
        FROM prev GROUP BY origin
      ) pv ON pv.origin = bo.origin
    ), '[]'::jsonb),
    -- Format LONG {date, origin, revenue, orders} — la page pivote. Un jour
    -- sans vente n'émet rien : le zéro-fill est un travail d'affichage.
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',    d.bd,
        'origin',  d.origin,
        'revenue', d.revenue,
        'orders',  d.orders
      ) ORDER BY d.bd ASC, d.origin ASC)
      FROM (
        SELECT bd, origin, SUM(total) AS revenue, COUNT(*) AS orders
        FROM cur GROUP BY bd, origin
      ) d
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_sales_by_origin_v1(date, date) IS
  'Ventes par origine de commande (P comptoir / T1-T2 tablettes / BO back-'
  'office, B2B structurellement en BO) — l''origine est lue dans le numéro '
  'source-codé <code><DDMMYYYY><NNN> (2026-08-16). Pré-numérotation EXCLUE '
  '(arbitrage) : le rapport ne dit rien d''avant le cutover. Périmètre ventes '
  'canonique, jour métier, clamp 366 j, fenêtre précédente pour les deltas. '
  'by_day en format long, groupement d''origine dynamique. Gate '
  'reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_sales_by_origin_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_origin_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_origin_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
