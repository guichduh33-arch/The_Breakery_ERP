-- 20260818000005_get_discounts_loyalty_v1.sql
--
-- Rapport « Discounts & Loyalty » (famille Sales) — l'argent consenti. Répond
-- à : « combien de marge je consens, par quel levier, autorisé par qui — et la
-- fidélité émet-elle plus qu'elle ne brûle ? » (conception validée par Mamat
-- le 2026-08-17). Frontière assumée : le ROI des promotions (lift,
-- redemptions) vit dans Marketing › Promo ROI — cette page dit le COÛT.
--
-- QUATRE LEVIERS, UNE SEULE SOMME (arbitrage Mamat : un seul rapport) :
--   * remise de LIGNE  — order_items.discount_amount (line_total en est DÉJÀ
--     net) ; lignes annulées et cadeaux promo exclus, comme le périmètre
--     canonique des ventes ;
--   * remise de COMMANDE — orders.discount_amount, autorisée par PIN : chaque
--     événement sort avec son motif et son autorisateur (l'œil anti-abus) ;
--   * PROMOTIONS — orders.promotion_total, ventilées par promotion via
--     promotion_applications (description SNAPSHOTÉE : lisible même promo
--     supprimée) ;
--   * POINTS BRÛLÉS — orders.loyalty_redemption_amount : le montant RÉELLEMENT
--     décompté à l'encaissement, pricé serveur au moment de la vente — jamais
--     points × constante. L'ÉMISSION ne coûte rien à l'émission (arbitrage
--     Mamat) : elle sort en POINTS (ledger) et le passif PROJETÉ se calcule
--     côté client avec REDEMPTION_RATE (packages/domain/loyalty/constants.ts).
--   Le prix négocié B2B n'est PAS une remise (pricing) : il n'entre pas ici
--   (arbitrage Mamat) — orders.discount_amount B2B resterait compté s'il
--   existait, c'est bien une remise.
--
-- POINTS — source = LEDGER loyalty_transactions, split par SIGNE (points > 0
-- émis, < 0 brûlés) : robuste aux `adjust`/`refund`, qui sont du flux de
-- points réel. Écart assumé avec redemption_value (qui vient des commandes) :
-- un ajustement manuel bouge les points sans bouger un encaissement.
--
-- PÉRIMÈTRE — ventes canoniques (paid|completed, non annulées, hors import
-- historique, hors commandes contenant un produit de test), jour métier sur
-- COALESCE(paid_at, created_at) ; ledger daté sur created_at. Le TOTAL
-- consenti, le taux et les parts se recalculent CÔTÉ CLIENT depuis summary et
-- by_day — la bande ne peut pas diverger des ventilations.

CREATE OR REPLACE FUNCTION public.get_discounts_loyalty_v1(
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
      o.id, o.order_number, o.total,
      COALESCE(o.discount_amount, 0)            AS order_discount,
      o.discount_reason,
      o.discount_authorized_by,
      COALESCE(o.promotion_total, 0)            AS promotion,
      COALESCE(o.loyalty_redemption_amount, 0)  AS redemption_value,
      ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  -- Remises de LIGNE — mêmes exclusions que le périmètre canonique.
  line_disc AS (
    SELECT s.bd, COALESCE(SUM(oi.discount_amount), 0) AS amount
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND COALESCE(oi.discount_amount, 0) > 0
    GROUP BY s.bd
  ),
  ledger AS (
    SELECT
      ((lt.created_at AT TIME ZONE v_tz))::date AS bd,
      COALESCE(SUM(lt.points) FILTER (WHERE lt.points > 0), 0)  AS points_issued,
      COALESCE(SUM(-lt.points) FILTER (WHERE lt.points < 0), 0) AS points_burned
    FROM loyalty_transactions lt
    WHERE ((lt.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  -- Borné à la fenêtre COURANTE : line_disc couvre aussi la précédente (pour
  -- le prev), un FULL JOIN non borné injecterait ses jours dans by_day.
  line_cur AS (SELECT * FROM line_disc WHERE bd BETWEEN v_start AND v_end),
  by_day AS (
    SELECT
      COALESCE(o.bd, l.bd, ld.bd) AS bd,
      COALESCE(o.order_discount, 0)    AS order_discount,
      COALESCE(o.promotion, 0)         AS promotion,
      COALESCE(o.redemption_value, 0)  AS redemption_value,
      COALESCE(ld.amount, 0)           AS line_discount,
      COALESCE(l.points_issued, 0)     AS points_issued,
      COALESCE(l.points_burned, 0)     AS points_burned
    FROM (
      SELECT bd, SUM(order_discount) AS order_discount, SUM(promotion) AS promotion,
             SUM(redemption_value) AS redemption_value
      FROM cur GROUP BY bd
    ) o
    FULL OUTER JOIN ledger   l  ON l.bd  = o.bd
    FULL OUTER JOIN line_cur ld ON ld.bd = COALESCE(o.bd, l.bd)
  ),
  tot AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM line_disc WHERE bd BETWEEN v_start AND v_end), 0) AS line_discount,
      COALESCE((SELECT SUM(order_discount)   FROM cur), 0) AS order_discount,
      COALESCE((SELECT SUM(promotion)        FROM cur), 0) AS promotion,
      COALESCE((SELECT SUM(redemption_value) FROM cur), 0) AS redemption_value,
      COALESCE((SELECT COUNT(*) FROM cur WHERE order_discount > 0), 0)                    AS pin_count,
      COALESCE((SELECT SUM(total) FROM cur), 0)                                           AS gross_sales,
      COALESCE((SELECT SUM(points_issued) FROM ledger), 0)                                AS points_issued,
      COALESCE((SELECT SUM(points_burned) FROM ledger), 0)                                AS points_burned
  ),
  tot_prev AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM line_disc WHERE bd < v_start), 0)                 AS line_discount,
      COALESCE((SELECT SUM(order_discount)   FROM scoped WHERE bd < v_start), 0)          AS order_discount,
      COALESCE((SELECT SUM(promotion)        FROM scoped WHERE bd < v_start), 0)          AS promotion,
      COALESCE((SELECT SUM(redemption_value) FROM scoped WHERE bd < v_start), 0)          AS redemption_value,
      COALESCE((SELECT SUM(total) FROM scoped WHERE bd < v_start), 0)                     AS gross_sales
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'line_discount',         t.line_discount,
      'order_discount',        t.order_discount,
      'promotion',             t.promotion,
      'redemption_value',      t.redemption_value,
      'line_discount_prev',    tp.line_discount,
      'order_discount_prev',   tp.order_discount,
      'promotion_prev',        tp.promotion,
      'redemption_value_prev', tp.redemption_value,
      'gross_sales',           t.gross_sales,
      'gross_sales_prev',      tp.gross_sales,
      'pin_count',             t.pin_count,
      'points_issued',         t.points_issued,
      'points_burned',         t.points_burned
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date',             d.bd,
          'line_discount',    d.line_discount,
          'order_discount',   d.order_discount,
          'promotion',        d.promotion,
          'redemption_value', d.redemption_value,
          'points_issued',    d.points_issued,
          'points_burned',    d.points_burned
        ) ORDER BY d.bd ASC
      ) FROM by_day d
    ), '[]'::jsonb),
    'pin_discounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'order_id',      c.id,
          'order_number',  c.order_number,
          'business_date', c.bd,
          'reason',        c.discount_reason,
          'amount',        c.order_discount,
          'authorized_by', jsonb_build_object('id', c.discount_authorized_by, 'name', up.full_name)
        ) ORDER BY c.order_discount DESC, c.bd DESC
      )
      FROM cur c
      LEFT JOIN user_profiles up ON up.id = c.discount_authorized_by
      WHERE c.order_discount > 0
    ), '[]'::jsonb),
    'by_promotion', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'promotion_id', bp.promotion_id,
          'description',  bp.description,
          'applications', bp.applications,
          'amount',       bp.amount
        ) ORDER BY bp.amount DESC
      )
      FROM (
        SELECT
          pa.promotion_id,
          -- Snapshot le plus récent : lisible même si la promo est supprimée.
          (ARRAY_AGG(pa.description ORDER BY pa.created_at DESC))[1] AS description,
          COUNT(*)                    AS applications,
          COALESCE(SUM(pa.amount), 0) AS amount
        FROM promotion_applications pa
        JOIN cur c ON c.id = pa.order_id
        GROUP BY pa.promotion_id
      ) bp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, tot_prev tp;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_discounts_loyalty_v1(date, date) IS
  'L''argent consenti sur une plage de jours métier — quatre leviers : remises de '
  'ligne (hors lignes annulées et cadeaux promo), remises de commande PIN (chaque '
  'événement avec motif + autorisateur), promotions (ventilées par promo, '
  'description snapshotée), points brûlés (orders.loyalty_redemption_amount — le '
  'montant réellement décompté, jamais points × constante). Flux de points depuis '
  'le ledger loyalty_transactions, split par signe (robuste aux adjust/refund). '
  'Total consenti, taux et parts recalculés côté client depuis summary/by_day. '
  'Périmètre ventes canonique. Clamp 366 jours. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_discounts_loyalty_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_discounts_loyalty_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_discounts_loyalty_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
