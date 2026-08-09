-- 20260809000001_get_product_performance_v1.sql
--
-- La fiche produit affichait « Units sold 0 / Conversion 0% / Revenue — » en
-- dur : trois valeurs jamais branchées, que le distill du 2026-08-09 a retirées
-- plutôt que de laisser passer un zéro codé pour un relevé. Cette RPC est ce qui
-- les fait revenir sur du vrai.
--
-- Pourquoi une RPC neuve et pas get_product_dashboard_v2 : celle-là somme les
-- mouvements de stock `sale` ET `production_out` sous le nom `units_sold` (donc
-- « sorti », pas « vendu »), n'expose aucun revenu produit, ne compte aucune
-- commande, et est gatée `inventory.read` quand la fiche produit l'est sur
-- `products.read`. Elle reste la source du stock ; celle-ci porte les ventes.
--
-- PÉRIMÈTRE — repris à l'identique de get_pos_top_products_v1, qui porte la
-- définition canonique de « produit vendu » dans ce projet. Deux écrans qui
-- comptent le même produit doivent afficher le même chiffre :
--   * commandes `paid` ou `completed` (ADR-009 déc. 4) ;
--   * import historique exclu ;
--   * commande entière exclue si l'une de ses lignes pointe un produit de test ;
--   * lignes annulées et cadeaux promo exclus ;
--   * fenêtre en JOUR MÉTIER (business_config.timezone, défaut Asia/Makassar).
--
-- UN SEUL ÉCART, voulu et ventilé : get_pos_top_products_v1 exclut
-- `order_type = 'b2b'`. Une fiche produit qui ferait pareil montrerait mort un
-- produit vendu surtout en gros. On compte donc tout, et on rend le détail par
-- canal — la part comptoir reste lisible à côté du total, donc l'écart avec le
-- rapport Top products s'explique de lui-même.
--
-- RÉSERVE CONNUE, héritée du périmètre canonique : un produit vendu comme
-- composant d'un combo n'a pas de ligne `order_items` propre (il vit dans
-- `combo_components`) et n'est donc pas compté ici. Diverger sur ce point
-- désalignerait cette RPC du rapport Top products ; c'est un sujet à trancher
-- pour les deux à la fois, pas ici.
--
-- Gate `reports.sales.read` (ADMIN, MANAGER, SUPER_ADMIN) et non `products.read`
-- (qui inclut CASHIER et waiter) : le chiffre d'affaires d'un produit est une
-- donnée de gestion, et c'est déjà la permission qui garde la même donnée dans
-- le rapport Top products. Côté écran, la carte se dégrade en « restricted ».

CREATE OR REPLACE FUNCTION public.get_product_performance_v1(
  p_product_id uuid,
  p_days       integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_days   integer;
  v_from   date;
  v_to     date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = 'P0001';
  END IF;

  v_days := GREATEST(COALESCE(p_days, 30), 1);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Fenêtre bornée sur le jour métier, fin incluse : 30 jours = aujourd'hui et
  -- les 29 précédents, pas 31 dates.
  v_to   := (now() AT TIME ZONE v_tz)::date;
  v_from := v_to - (v_days - 1);

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b') AS is_b2b
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_from AND v_to
  ),
  lines AS (
    SELECT
      s.id AS order_id,
      s.is_b2b,
      oi.quantity,
      oi.line_total
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  per_channel AS (
    SELECT
      is_b2b,
      COALESCE(SUM(quantity), 0)   AS units,
      COALESCE(SUM(line_total), 0) AS revenue,
      COUNT(DISTINCT order_id)     AS orders_with
    FROM lines
    GROUP BY is_b2b
  ),
  -- Dénominateur de la conversion : toutes les commandes du périmètre, pas
  -- seulement celles qui contiennent le produit.
  denom AS (
    SELECT
      COUNT(*)                             AS orders_all,
      COUNT(*) FILTER (WHERE NOT is_b2b)   AS orders_counter,
      COUNT(*) FILTER (WHERE is_b2b)       AS orders_b2b
    FROM scoped
  ),
  agg AS (
    SELECT
      COALESCE((SELECT SUM(units)       FROM per_channel), 0)                    AS t_units,
      COALESCE((SELECT SUM(revenue)     FROM per_channel), 0)                    AS t_rev,
      COALESCE((SELECT SUM(orders_with) FROM per_channel), 0)                    AS t_orders,
      COALESCE((SELECT units       FROM per_channel WHERE NOT is_b2b), 0)        AS c_units,
      COALESCE((SELECT revenue     FROM per_channel WHERE NOT is_b2b), 0)        AS c_rev,
      COALESCE((SELECT orders_with FROM per_channel WHERE NOT is_b2b), 0)        AS c_orders,
      COALESCE((SELECT units       FROM per_channel WHERE is_b2b), 0)            AS b_units,
      COALESCE((SELECT revenue     FROM per_channel WHERE is_b2b), 0)            AS b_rev,
      COALESCE((SELECT orders_with FROM per_channel WHERE is_b2b), 0)            AS b_orders,
      d.orders_all, d.orders_counter, d.orders_b2b
    FROM denom d
  )
  SELECT jsonb_build_object(
    'product_id',   p_product_id,
    'window_days',  v_days,
    'from_date',    v_from,
    'to_date',      v_to,
    'timezone',     v_tz,
    'generated_at', now(),
    'total', jsonb_build_object(
      'units_sold',          a.t_units,
      'revenue',             a.t_rev,
      'orders_with_product', a.t_orders,
      'orders_total',        a.orders_all,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.t_orders / NULLIF(a.orders_all, 0), 2), 0)
    ),
    'counter', jsonb_build_object(
      'units_sold',          a.c_units,
      'revenue',             a.c_rev,
      'orders_with_product', a.c_orders,
      'orders_total',        a.orders_counter,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.c_orders / NULLIF(a.orders_counter, 0), 2), 0)
    ),
    'b2b', jsonb_build_object(
      'units_sold',          a.b_units,
      'revenue',             a.b_rev,
      'orders_with_product', a.b_orders,
      'orders_total',        a.orders_b2b,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.b_orders / NULLIF(a.orders_b2b, 0), 2), 0)
    )
  )
  INTO v_result
  FROM agg a;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_product_performance_v1(uuid, integer) IS
  'Ventes d''un produit sur une fenêtre de jours métier, ventilées comptoir/B2B. '
  'Périmètre identique à get_pos_top_products_v1 (paid|completed, hors import '
  'historique, hors commandes contenant un produit de test, hors lignes annulées '
  'et cadeaux promo), à l''exclusion b2b près qui est ici comptée et ventilée. '
  'Ne compte pas un produit vendu comme composant de combo. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_product_performance_v1(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_performance_v1(uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_product_performance_v1(uuid, integer) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
