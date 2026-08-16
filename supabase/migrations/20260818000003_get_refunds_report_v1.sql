-- 20260818000003_get_refunds_report_v1.sql
--
-- Rapport « Refunds & Voids » (famille Sales) — l'argent qui ressort. Répond à
-- la question : « combien d'argent ressort par les annulations, qui le
-- déclenche, sur quoi, et pourquoi ? » (conception validée par Mamat le
-- 2026-08-16). Le module n'avait AUCUNE vue remboursements : get_sales_* les
-- ignore, get_staff_performance_v1 ne compte que par staff.
--
-- TROIS FLUX, JAMAIS CONFONDUS :
--   * VOID (`refunds.is_full_void`) — commande entière remboursée ;
--   * REMBOURSEMENT PARTIEL — une partie des lignes (refund_lines) ;
--   * LIGNE ANNULÉE AVANT PAIEMENT (`order_items.is_cancelled`) — aucune
--     sortie d'argent : friction en caisse, servie À CÔTÉ, jamais additionnée
--     au remboursé.
--
-- PÉRIMÈTRE — miroir du périmètre ventes canonique (get_sales_by_product_v1) :
-- refunds joints à leur commande, hors import historique et hors commandes
-- contenant un produit de test — sans quoi le taux de remboursement
-- (remboursé ÷ CA brut) comparerait deux périmètres différents. Jour métier
-- sur refunds.created_at (resp. order_items.cancelled_at) via
-- business_config.timezone.
--
-- MOTIFS — `refunds.reason` est un champ LIBRE : regroupé ici par famille de
-- mots-clés (fr/en/id, insensible à la casse ; arbitrage Mamat 2026-08-16).
-- Chaque événement sort avec sa raison BRUTE ET sa famille : la table peut
-- toujours recouper la ventilation.
--
-- Les événements sont renvoyés EN ENTIER (pas de pagination : un remboursement
-- est un événement rare, le clamp 366 j borne le volume) — les ventilations
-- par jour, par motif et par méthode se recalculent côté client depuis ces
-- lignes et ne peuvent pas diverger de la table. Seul le CA brut (dénominateur
-- du taux) est calculé ici : il ne se dérive pas des événements.

CREATE OR REPLACE FUNCTION public.get_refunds_report_v1(
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
      r.id, r.refund_number, r.order_id, o.order_number,
      r.created_at, r.total, r.tax_refunded, r.reason,
      r.refunded_by, r.authorized_by, r.is_full_void,
      ((r.created_at AT TIME ZONE v_tz))::date AS business_date,
      CASE
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(saisie|erreur|wrong|mistake|input|salah)%'          THEN 'input_error'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(qualit|defect|defaut|défaut|stale|burnt|rusak|basi)%' THEN 'quality'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(double|duplicate|dobel)%'                            THEN 'duplicate'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(avis|chang|mind|batal)%'                             THEN 'customer_change'
        ELSE 'other'
      END AS reason_family
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE business_date >= v_start),
  prev AS (SELECT * FROM scoped WHERE business_date <  v_start),
  -- CA BRUT — périmètre ventes canonique, remboursements NON déduits (c'est le
  -- dénominateur du taux, pas un chiffre d'affaires net).
  sales AS (
    SELECT
      COALESCE(SUM(o.total) FILTER (WHERE bd BETWEEN v_start AND v_end), 0)      AS gross,
      COALESCE(SUM(o.total) FILTER (WHERE bd BETWEEN v_prev_start AND v_prev_end), 0) AS gross_prev
    FROM (
      SELECT o.total,
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
    ) o
  ),
  -- Lignes annulées AVANT PAIEMENT — friction, aucune sortie d'argent.
  cl AS (
    SELECT
      oi.product_id,
      p.name AS product_name,
      COALESCE(oi.line_total, 0) AS value,
      oi.cancelled_reason,
      oi.cancelled_by
    FROM order_items oi
    JOIN orders   o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE oi.is_cancelled = true
      AND oi.cancelled_at IS NOT NULL
      AND o.is_historical_import = false
      AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  cl_prod AS (
    SELECT
      product_id,
      product_name,
      COUNT(*)                                            AS line_count,
      COALESCE(SUM(value), 0)                             AS value,
      mode() WITHIN GROUP (ORDER BY cancelled_reason)     AS top_reason,
      mode() WITHIN GROUP (ORDER BY cancelled_by::text)   AS top_cashier_id
    FROM cl
    GROUP BY product_id, product_name
  ),
  tot AS (
    SELECT
      COALESCE(SUM(total), 0)                                     AS refunded,
      COUNT(*)                                                    AS refund_count,
      COUNT(*)          FILTER (WHERE is_full_void)               AS void_count,
      COALESCE(SUM(total) FILTER (WHERE is_full_void), 0)         AS void_amount,
      COUNT(*)          FILTER (WHERE NOT is_full_void)           AS partial_count,
      COALESCE(SUM(total) FILTER (WHERE NOT is_full_void), 0)     AS partial_amount,
      COALESCE(SUM(tax_refunded), 0)                              AS tax_refunded
    FROM cur
  ),
  tot_prev AS (
    SELECT COALESCE(SUM(total), 0) AS refunded FROM prev
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'refunded',         t.refunded,
      'refunded_prev',    tp.refunded,
      'refund_count',     t.refund_count,
      'void_count',       t.void_count,
      'void_amount',      t.void_amount,
      'partial_count',    t.partial_count,
      'partial_amount',   t.partial_amount,
      'tax_refunded',     t.tax_refunded,
      'gross_sales',      s.gross,
      'gross_sales_prev', s.gross_prev,
      'cancelled', jsonb_build_object(
        'lines', (SELECT COUNT(*) FROM cl),
        'value', (SELECT COALESCE(SUM(value), 0) FROM cl)
      )
    ),
    'events', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',            c.id,
          'refund_number', c.refund_number,
          'order_id',      c.order_id,
          'order_number',  c.order_number,
          'created_at',    c.created_at,
          'business_date', c.business_date,
          'is_full_void',  c.is_full_void,
          'reason',        c.reason,
          'reason_family', c.reason_family,
          'tax_refunded',  c.tax_refunded,
          'total',         c.total,
          'refunded_by',   jsonb_build_object('id', c.refunded_by,   'name', up1.full_name),
          'authorized_by', jsonb_build_object('id', c.authorized_by, 'name', up2.full_name),
          'payments', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('method', rp.method, 'amount', rp.amount)
              ORDER BY rp.amount DESC
            ) FROM refund_payments rp WHERE rp.refund_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.total DESC, c.created_at DESC
      )
      FROM cur c
      LEFT JOIN user_profiles up1 ON up1.id = c.refunded_by
      LEFT JOIN user_profiles up2 ON up2.id = c.authorized_by
    ), '[]'::jsonb),
    'cancelled_by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',  g.product_id,
          'name',        g.product_name,
          'line_count',  g.line_count,
          'value',       g.value,
          'top_reason',  g.top_reason,
          'top_cashier', jsonb_build_object(
            'id',   g.top_cashier_id,
            'name', up.full_name,
            'count', (SELECT COUNT(*) FROM cl c2
                      WHERE c2.product_id = g.product_id
                        AND c2.cancelled_by::text = g.top_cashier_id)
          )
        ) ORDER BY g.value DESC, g.product_name ASC
      )
      FROM cl_prod g
      LEFT JOIN user_profiles up ON up.id::text = g.top_cashier_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, tot_prev tp, sales s;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_refunds_report_v1(date, date) IS
  'Remboursements & voids sur une plage de jours métier — événements complets '
  '(raison brute + famille de motif fr/en/id, double signature, méthodes de '
  'remboursement), synthèse void/partiel, CA brut (dénominateur du taux, '
  'périmètre ventes canonique : paid|completed non annulées, hors import '
  'historique et produits de test), lignes annulées avant paiement servies à '
  'part (aucune sortie d''argent). Ventilations jour/motif/méthode recalculées '
  'côté client depuis les événements. Clamp 366 jours. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_refunds_report_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_refunds_report_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_refunds_report_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
