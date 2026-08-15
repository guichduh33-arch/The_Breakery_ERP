-- 20260815000004_get_sales_by_product_v1.sql
--
-- Rapport « Sales by Product » (famille Sales) — le détail des produits vendus.
-- Le back-office n'avait aucune vue produit côté ventes : `get_sales_by_category_v3`
-- s'arrête à la catégorie, et `get_gross_margin_by_product_v1` porte la marge sous
-- la gate `reports.financial.read`. Le CA par produit est une question de vente,
-- pas de comptabilité — d'où une RPC propre sous `reports.sales.read`.
--
-- PÉRIMÈTRE — repris de `get_pos_top_products_v1`, qui porte la définition
-- canonique de « produit vendu » dans ce projet. Deux écrans qui comptent le
-- même produit doivent afficher le même chiffre :
--   * commandes `paid` ou `completed` (ADR-009 déc. 4), non annulées ;
--   * import historique exclu ;
--   * commande ENTIÈRE exclue si l'une de ses lignes pointe un produit de test ;
--   * lignes annulées et cadeaux promo exclus ;
--   * fenêtre en JOUR MÉTIER (business_config.timezone, défaut Asia/Makassar),
--     sur COALESCE(paid_at, created_at).
--
-- UN SEUL ÉCART, voulu et ventilé — le même que `get_product_performance_v1` :
-- `get_pos_top_products_v1` exclut `order_type = 'b2b'`. Un rapport qui ferait
-- pareil montrerait mort un produit vendu surtout en gros. On compte donc tout,
-- et on rend le détail par canal : la part comptoir reste lisible à côté du
-- total, donc l'écart avec le rapport POS « Top products » s'explique de lui-même.
--
-- DEUX FAITS DE SCHÉMA QUI COMMANDENT LA LECTURE, vérifiés dans le corps des RPC
-- du money-path (complete_order_with_payment_v25, fire_counter_order_v1) :
--   1. `order_items.line_total` est DÉJÀ NET de `order_items.discount_amount`
--      (`v_line_total := v_srv_line_subtotal - v_line_discount`). `revenue` est
--      donc un net, et `discount` est ce qui a été consenti par-dessus.
--   2. `orders.discount_amount` (remise au niveau COMMANDE, autorisée par PIN) et
--      `orders.promotion_total` ne sont JAMAIS ventilés sur les lignes
--      (`v_total := v_post_promo - v_redemption_amount - p_discount_amount`).
--      Ils ne sont attribuables à aucun produit. Les taire ferait passer la
--      colonne « remises » pour le total des remises : ils sortent donc dans
--      `summary.unattributed`, à côté et jamais dedans.
--
-- RÉSERVE CONNUE, héritée du périmètre canonique : un produit vendu comme
-- composant d'un combo n'a pas de ligne `order_items` propre (il vit dans
-- `combo_components`) et n'est donc pas compté ici. Diverger sur ce point
-- désalignerait cette RPC du rapport Top products ; c'est un sujet à trancher
-- pour les deux à la fois, pas ici.
--
-- SECONDE RÉSERVE : un remboursement partiel n'a pas de granularité par ligne
-- (`refund_order` rembourse au prorata du `line_total`), donc `revenue` n'en est
-- pas déduit. Même réserve que get_gross_margin_by_product_v1.
--
-- `name` est le nom COURANT du produit (`products.name`), pas le
-- `name_snapshot` de la ligne : c'est ce vers quoi pointe le drill-down produit,
-- et deux orthographes du même produit ne doivent pas faire deux lignes. Le nom
-- vendu reste lisible ligne par ligne dans get_product_sales_lines_v1.

CREATE OR REPLACE FUNCTION public.get_sales_by_product_v1(
  p_start_date  date,
  p_end_date    date,
  p_category_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz      text;
  v_start   date;
  v_end     date;
  v_result  jsonb;
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

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT, la fin demandée est
  -- ce que le lecteur regarde.
  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b')          AS is_b2b,
      COALESCE(o.discount_amount, 0)  AS order_discount,
      COALESCE(o.promotion_total, 0)  AS promotion_total
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
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.order_id,
      oi.product_id,
      p.name                             AS product_name,
      p.category_id                      AS category_id,
      COALESCE(c.name, 'Uncategorized')  AS category_name,
      s.is_b2b,
      oi.quantity,
      oi.line_total,
      COALESCE(oi.discount_amount, 0)                                        AS discount_amount
    FROM order_items oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  tot AS (
    SELECT
      COALESCE(SUM(line_total), 0)      AS revenue,
      COALESCE(SUM(quantity), 0)        AS qty,
      COALESCE(SUM(discount_amount), 0) AS discount,
      COUNT(*)                          AS line_count,
      COUNT(DISTINCT order_id)          AS order_count,
      COUNT(DISTINCT product_id)        AS product_count,
      COALESCE(SUM(line_total) FILTER (WHERE NOT is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE NOT is_b2b), 0) AS counter_qty,
      COALESCE(SUM(line_total) FILTER (WHERE is_b2b), 0)     AS b2b_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE is_b2b), 0)     AS b2b_qty
    FROM lines
  ),
  -- Non attribuable à un produit : la remise de COMMANDE et le total promo ne
  -- sont pas ventilés sur les lignes. Bornés aux commandes qui portent au moins
  -- une ligne retenue, sans quoi une commande entièrement filtrée par la
  -- catégorie ferait entrer sa remise dans un total qu'elle ne concerne plus.
  unattributed AS (
    SELECT
      COALESCE(SUM(s.order_discount), 0)  AS order_discount,
      COALESCE(SUM(s.promotion_total), 0) AS promotion_total
    FROM scoped s
    WHERE EXISTS (SELECT 1 FROM lines l WHERE l.order_id = s.id)
  ),
  per_product AS (
    SELECT
      -- product_name / category_* viennent du JOIN products et sont constants
      -- pour un product_id : ils entrent dans le GROUP BY plutôt que sous un
      -- agrégat qui laisserait croire qu'ils varient.
      l.product_id,
      l.product_name                                         AS name,
      l.category_id                                          AS category_id,
      l.category_name                                        AS category_name,
      SUM(l.quantity)                                        AS qty,
      SUM(l.line_total)                                      AS revenue,
      SUM(l.discount_amount)                                 AS discount,
      COUNT(DISTINCT l.order_id)                             AS order_count,
      COALESCE(SUM(l.quantity)   FILTER (WHERE NOT l.is_b2b), 0) AS counter_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE NOT l.is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(l.quantity)   FILTER (WHERE l.is_b2b), 0)     AS b2b_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE l.is_b2b), 0)     AS b2b_revenue
    FROM lines l
    GROUP BY l.product_id, l.product_name, l.category_id, l.category_name
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       t.revenue,
      'qty',           t.qty,
      'discount',      t.discount,
      'lines',         t.line_count,
      'orders',        t.order_count,
      'products',      t.product_count,
      'avg_price',     COALESCE(ROUND(t.revenue / NULLIF(t.qty, 0), 2), 0),
      'counter', jsonb_build_object('qty', t.counter_qty, 'revenue', t.counter_revenue),
      'b2b',     jsonb_build_object('qty', t.b2b_qty,     'revenue', t.b2b_revenue),
      -- Remises non ventilables sur un produit — à côté du total, jamais dedans.
      'unattributed', jsonb_build_object(
        'order_discount',  u.order_discount,
        'promotion_total', u.promotion_total
      )
    ),
    'by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',    pp.product_id,
          'name',          pp.name,
          'category_id',   pp.category_id,
          'category_name', pp.category_name,
          'qty',           pp.qty,
          'revenue',       pp.revenue,
          'discount',      pp.discount,
          'order_count',   pp.order_count,
          'avg_price',     COALESCE(ROUND(pp.revenue / NULLIF(pp.qty, 0), 2), 0),
          'share_pct',     COALESCE(ROUND(100 * pp.revenue / NULLIF(t.revenue, 0), 2), 0),
          'counter',       jsonb_build_object('qty', pp.counter_qty, 'revenue', pp.counter_revenue),
          'b2b',           jsonb_build_object('qty', pp.b2b_qty,     'revenue', pp.b2b_revenue)
        ) ORDER BY pp.revenue DESC, pp.name ASC
      ) FROM per_product pp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, unattributed u;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_sales_by_product_v1(date, date, uuid) IS
  'Ventes par produit sur une plage de jours métier — qty, CA net, remise de ligne, '
  'part et ventilation comptoir/B2B. Périmètre identique à get_pos_top_products_v1 '
  '(paid|completed non annulées, hors import historique, hors commandes contenant un '
  'produit de test, hors lignes annulées et cadeaux promo), à l''exclusion b2b près '
  'qui est ici comptée et ventilée. revenue = SUM(order_items.line_total), DÉJÀ net de '
  'la remise de ligne ; la remise de COMMANDE et le total promo ne sont ventilables sur '
  'aucun produit et sortent dans summary.unattributed. Ne compte pas un produit vendu '
  'comme composant de combo. Remboursements partiels non déduits (pas de granularité '
  'ligne). Clamp 366 jours. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_sales_by_product_v1(date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_product_v1(date, date, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_product_v1(date, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
