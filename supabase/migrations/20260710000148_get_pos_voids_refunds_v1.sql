-- Reports POS refonte (Lot C) — reporting serveur des annulations et remises.
-- Source unique partagee avec le BO. Deux blocs, lecture pure, aucune ecriture :
--   * reversals : annulations post-paiement (table refunds — voids is_full_void=true
--     vs refunds partiels is_full_void=false) + annulations de ligne pre-paiement
--     (order_items.is_cancelled). Motif / operateur / autorisant / horodatage +
--     distinction avant/apres cuisine (sent_to_kitchen_at).
--   * discounts : remises appliquees (orders.discount_*) par type et par operateur
--     autorisant (discount_authorized_by). Un « comp » = remise 100 % (percentage>=100).
-- Perimetre IDENTIQUE a l'Overview (Lot A) : hors B2B, hors imports historiques,
-- hors toute commande touchant un produit de test. Fenetre WITA sur le timestamp
-- metier propre a chaque flux (refund.created_at / item.cancelled_at / order.paid_at).
-- Gate reports.sales.read (miroir de la route POS). Money-path NON touche.

CREATE OR REPLACE FUNCTION public.get_pos_voids_refunds_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH
  -- Annulations post-paiement (voids pleins + refunds partiels), scopees comme l'Overview.
  rev AS (
    SELECT r.id, r.is_full_void, r.total, r.tax_refunded, r.reason,
           r.refunded_by, r.authorized_by,
           (o.sent_to_kitchen_at IS NOT NULL) AS after_kitchen
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((r.created_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  -- Annulations de ligne pre-paiement (peuvent survenir avant ou apres l'envoi cuisine).
  cancels AS (
    SELECT oi.id, oi.cancelled_reason AS reason, oi.cancelled_by,
           (oi.sent_to_kitchen_at IS NOT NULL) AS after_kitchen
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.is_cancelled = true
      AND oi.cancelled_at IS NOT NULL
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi2 JOIN products p ON p.id = oi2.product_id
        WHERE oi2.order_id = o.id AND p.is_test = true
      )
      AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  -- Remises appliquees, scopees comme l'Overview (paid+completed), fenetre sur paid_at.
  disc AS (
    SELECT o.id, o.discount_type, o.discount_value, o.discount_amount,
           o.discount_authorized_by,
           (o.discount_type = 'percentage' AND o.discount_value >= 100) AS is_comp
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND COALESCE(o.discount_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'reversals', jsonb_build_object(
      'voids', (
        SELECT jsonb_build_object(
          'count',                COUNT(*),
          'amount',               COALESCE(SUM(total), 0),
          'tax_refunded',         COALESCE(SUM(tax_refunded), 0),
          'after_kitchen_count',  COUNT(*) FILTER (WHERE after_kitchen),
          'before_kitchen_count', COUNT(*) FILTER (WHERE NOT after_kitchen)
        ) FROM rev WHERE is_full_void
      ),
      'refunds', (
        SELECT jsonb_build_object(
          'count',        COUNT(*),
          'amount',       COALESCE(SUM(total), 0),
          'tax_refunded', COALESCE(SUM(tax_refunded), 0)
        ) FROM rev WHERE NOT is_full_void
      ),
      'item_cancellations', (
        SELECT jsonb_build_object(
          'count',                COUNT(*),
          'after_kitchen_count',  COUNT(*) FILTER (WHERE after_kitchen),
          'before_kitchen_count', COUNT(*) FILTER (WHERE NOT after_kitchen)
        ) FROM cancels
      ),
      'by_reason', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC, x.reason) FROM (
          SELECT COALESCE(NULLIF(TRIM(reason), ''), '(no reason)') AS reason,
                 COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
          FROM rev GROUP BY 1
        ) x
      ), '[]'::jsonb),
      'by_operator', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT rev.refunded_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(rev.total), 0) AS amount
          FROM rev LEFT JOIN user_profiles up ON up.id = rev.refunded_by
          GROUP BY rev.refunded_by, up.full_name
        ) x
      ), '[]'::jsonb),
      'by_authorizer', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT rev.authorized_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(rev.total), 0) AS amount
          FROM rev LEFT JOIN user_profiles up ON up.id = rev.authorized_by
          GROUP BY rev.authorized_by, up.full_name
        ) x
      ), '[]'::jsonb)
    ),
    'discounts', jsonb_build_object(
      'total_amount', (SELECT COALESCE(SUM(discount_amount), 0) FROM disc),
      'order_count',  (SELECT COUNT(*) FROM disc),
      'comp_count',   (SELECT COUNT(*) FILTER (WHERE is_comp) FROM disc),
      'by_type', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT discount_type AS type, COUNT(*) AS count,
                 COALESCE(SUM(discount_amount), 0) AS amount
          FROM disc GROUP BY discount_type
        ) x
      ), '[]'::jsonb),
      'by_operator', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT disc.discount_authorized_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(disc.discount_amount), 0) AS amount
          FROM disc LEFT JOIN user_profiles up ON up.id = disc.discount_authorized_by
          GROUP BY disc.discount_authorized_by, up.full_name
        ) x
      ), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_voids_refunds_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_voids_refunds_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_voids_refunds_v1(date, date) IS
  'POS reports Lot C — voids/refunds (refunds table) + item cancellations + discounts by type/operator over a WITA date range; reason/operator/authorizer + before/after kitchen; excludes B2B, historical imports, test-product orders; gated reports.sales.read. Read-only.';
