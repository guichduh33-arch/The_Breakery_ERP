-- 20260815000005_get_product_sales_lines_v1.sql
--
-- Le drill-down de « Sales by Product » : les LIGNES de vente d'un produit sur
-- la période — heure de vente, n° de commande, client, quantité, prix, remise.
-- C'est ce qui rend la ligne agrégée remontable jusqu'à l'opération qui l'a
-- produite (principe produit n° 3).
--
-- LE PÉRIMÈTRE EST STRICTEMENT CELUI DE get_sales_by_product_v1 — même filtre de
-- statut, même exclusion d'import historique, de produit de test, de ligne
-- annulée et de cadeau promo, même fenêtre en jour métier, B2B compté. Toute
-- divergence ferait que la somme des lignes ne refermerait pas le total du
-- produit, et le lecteur n'aurait aucun moyen de savoir laquelle des deux vues
-- ment. Les deux corps se lisent ensemble : ne toucher l'un qu'en touchant
-- l'autre.
--
-- Pagination keyset (pattern get_stock_movements_v2) : ordre antichronologique
-- `(sold_at DESC, id DESC)`, curseur porté par un token TEXT `"<sold_at>|<id>"`.
-- Un OFFSET sauterait ou dupliquerait des lignes dès qu'une vente tombe pendant
-- la lecture — sur un journal d'argent, ce n'est pas une approximation
-- acceptable.
--
-- `totals` porte le jeu COMPLET, pas la page : un pied qui ne totaliserait que
-- les cent lignes chargées se lirait comme le total du produit.
--
-- `name_snapshot` est servi tel quel — c'est le nom SOUS LEQUEL le produit a été
-- vendu ce jour-là. Il peut différer du nom courant que porte la vue agrégée ;
-- c'est un fait, pas une incohérence.

CREATE OR REPLACE FUNCTION public.get_product_sales_lines_v1(
  p_product_id uuid,
  p_start_date date,
  p_end_date   date,
  p_limit      integer DEFAULT 100,
  p_cursor     text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz        text;
  v_start     date;
  v_end       date;
  v_limit     integer;
  v_cur_ts    timestamptz := NULL;
  v_cur_id    uuid        := NULL;
  v_sep       integer;
  v_rows      jsonb;
  v_totals    jsonb;
  v_count     integer;
  v_next      text        := NULL;
  v_result    jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  -- Curseur `"<timestamptz>|<uuid>"`. Un token malformé est un bug d'appelant,
  -- pas une entrée utilisateur à deviner : on refuse au lieu de servir la
  -- première page en silence, ce qui ferait boucler le défilement infini.
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_sep := position('|' IN p_cursor);
    IF v_sep < 2 THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_cur_ts := substring(p_cursor FROM 1 FOR v_sep - 1)::timestamptz;
      v_cur_id := substring(p_cursor FROM v_sep + 1)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.served_by,
      (o.order_type = 'b2b')             AS is_b2b,
      COALESCE(o.paid_at, o.created_at)  AS sold_at
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
      oi.id,
      s.sold_at,
      s.id            AS order_id,
      s.order_number,
      s.customer_id,
      cu.name         AS customer_name,
      s.is_b2b,
      up.full_name    AS served_by_name,
      oi.name_snapshot,
      oi.quantity,
      oi.unit_price,
      COALESCE(oi.modifiers_total, 0)  AS modifiers_total,
      COALESCE(oi.discount_amount, 0)  AS discount_amount,
      oi.discount_reason,
      oi.line_total
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    LEFT JOIN customers     cu ON cu.id = s.customer_id
    LEFT JOIN user_profiles up ON up.id = s.served_by
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  page AS (
    SELECT *
    FROM lines
    WHERE v_cur_ts IS NULL
       OR (sold_at, id) < (v_cur_ts, v_cur_id)
    ORDER BY sold_at DESC, id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',              pg.id,
        'sold_at',         pg.sold_at,
        'order_id',        pg.order_id,
        'order_number',    pg.order_number,
        'customer_id',     pg.customer_id,
        'customer_name',   pg.customer_name,
        'channel',         CASE WHEN pg.is_b2b THEN 'b2b' ELSE 'counter' END,
        'served_by_name',  pg.served_by_name,
        'name_snapshot',   pg.name_snapshot,
        'quantity',        pg.quantity,
        'unit_price',      pg.unit_price,
        'modifiers_total', pg.modifiers_total,
        'discount_amount', pg.discount_amount,
        'discount_reason', pg.discount_reason,
        'line_total',      pg.line_total
      ) ORDER BY pg.sold_at DESC, pg.id DESC
    ), '[]'::jsonb),
    COUNT(*)::int
  INTO v_rows, v_count
  FROM page pg;

  -- Totaux du JEU COMPLET, recalculés sur le même périmètre : un pied de page
  -- qui ne totaliserait que la page mentirait sur le produit.
  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b') AS is_b2b
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
    SELECT oi.order_id, oi.quantity, oi.line_total,
           COALESCE(oi.discount_amount, 0) AS discount_amount, s.is_b2b
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  )
  SELECT jsonb_build_object(
    'lines',         COUNT(*),
    'orders',        COUNT(DISTINCT order_id),
    'qty',           COALESCE(SUM(quantity), 0),
    'revenue',       COALESCE(SUM(line_total), 0),
    'discount',      COALESCE(SUM(discount_amount), 0),
    'counter_qty',   COALESCE(SUM(quantity) FILTER (WHERE NOT is_b2b), 0),
    'b2b_qty',       COALESCE(SUM(quantity) FILTER (WHERE is_b2b), 0)
  )
  INTO v_totals
  FROM lines;

  -- Le curseur se prend sur la DERNIÈRE ligne rendue. Une page pleine ne prouve
  -- pas qu'il en reste ; c'est l'appel suivant qui le dit, et il rendra `[]`.
  IF v_count = v_limit THEN
    SELECT (r->>'sold_at') || '|' || (r->>'id')
      INTO v_next
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(r, ord)
     WHERE ord = v_count;
  END IF;

  v_result := jsonb_build_object(
    'product_id',   p_product_id,
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'lines',        v_rows,
    'totals',       v_totals,
    'next_cursor',  v_next,
    'has_more',     v_next IS NOT NULL
  );

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_product_sales_lines_v1(uuid, date, date, integer, text) IS
  'Lignes de vente d''un produit (drill-down de get_sales_by_product_v1) : heure de '
  'vente, n° de commande, client, canal, qty, prix unitaire, remise de ligne, total. '
  'Périmètre STRICTEMENT identique à get_sales_by_product_v1 — toute divergence '
  'empêcherait la somme des lignes de refermer le total du produit. Pagination keyset '
  'antichronologique (sold_at, id), curseur TEXT "<sold_at>|<id>", limite bornée à 500. '
  '`totals` porte le jeu complet, pas la page. Clamp 366 jours. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_product_sales_lines_v1(uuid, date, date, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_sales_lines_v1(uuid, date, date, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_product_sales_lines_v1(uuid, date, date, integer, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
