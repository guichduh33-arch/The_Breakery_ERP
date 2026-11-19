-- S3-20 — Refondre le rapport des achats par article.
--
-- get_purchase_items_v2 remplace la v1 (corps live relu le 2026-11-20) :
--  · un agrégat PAR ARTICLE calculé serveur, sur TOUTES les lignes de la
--    période (la v1 plafonnait à 1 000 lignes et sommait ce plafond) ;
--  · des totaux non tronqués, une comparaison à la période précédente de même
--    longueur, et une dépense par jour pour le graphique ;
--  · trois filtres de plus : catégorie, article, statut du bon ;
--  · les fournisseurs comptés par identifiant (la page les comptait par nom).
-- Inchangé : la permission `reports.inventory.read`, la date du bon
-- (`order_date`) comme date de la ligne, l'exclusion des brouillons et des bons
-- annulés, la borne de 366 jours, la valeur d'une ligne (`subtotal`).
--
-- La quantité d'un article est sommée dans son unité de BASE
-- (quantité × facteur), parce qu'un même article peut s'acheter en sacs et en
-- kilos : la v1 additionnait des unités différentes. Le coût unitaire moyen est
-- donc la valeur divisée par cette quantité de base.
--
-- get_purchase_item_lines_v1 : les lignes d'achat d'UN article, paginées, pour
-- la descente depuis la vue par article. La date de réception affichée est
-- `purchase_orders.received_date`, posée quand le bon est entièrement reçu.
--
-- Seul appelant de la v1 : le crochet usePurchaseItems du back-office, basculé
-- dans le même lot. Le test s40_reports.test.sql est basculé aussi.

CREATE FUNCTION public.get_purchase_items_v2(
  p_date_start  text,
  p_date_end    text,
  p_supplier_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_product_id  uuid DEFAULT NULL,
  p_status      text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start      DATE;
  v_end        DATE;
  v_prev_start DATE;
  v_prev_end   DATE;
  v_summary    JSONB;
  v_items      JSONB;
  v_trend      JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'partial', 'received') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;

  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  -- Une seule requête : une fonction STABLE n'écrit pas, pas même une table
  -- temporaire. Les lignes des deux périodes sont lues une fois (CTE `l`).
  WITH l AS (
    SELECT
      CASE WHEN po.order_date >= v_start THEN 'current' ELSE 'previous' END AS period,
      po.id AS po_id, po.supplier_id, poi.product_id, po.order_date, po.received_date,
      poi.quantity * COALESCE(poi.unit_factor_to_base, 1) AS base_qty,
      poi.unit AS line_unit,
      COALESCE(poi.subtotal, 0) AS value
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN products p ON p.id = poi.product_id
    WHERE po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_prev_start AND v_end
      AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_product_id  IS NULL OR poi.product_id = p_product_id)
      AND (p_status      IS NULL OR po.status = p_status)
  ),
  summary AS (
    SELECT jsonb_build_object(
      'line_count',           COUNT(*) FILTER (WHERE period = 'current'),
      'total_value',          COALESCE(SUM(value) FILTER (WHERE period = 'current'), 0),
      'po_count',             COUNT(DISTINCT po_id) FILTER (WHERE period = 'current'),
      'supplier_count',       COUNT(DISTINCT supplier_id) FILTER (WHERE period = 'current'),
      'product_count',        COUNT(DISTINCT product_id) FILTER (WHERE period = 'current'),
      'previous_total_value', COALESCE(SUM(value) FILTER (WHERE period = 'previous'), 0)
    ) AS j
    FROM l
  ),
  cur AS (
    SELECT
      l.product_id,
      SUM(l.value)                       AS value,
      SUM(l.base_qty)                    AS base_qty,
      COUNT(*)                           AS line_count,
      COUNT(DISTINCT l.po_id)            AS po_count,
      COUNT(DISTINCT l.supplier_id)      AS supplier_count,
      MAX(l.order_date)                  AS last_order_date,
      MAX(l.received_date)               AS last_received_date,
      CASE WHEN COUNT(DISTINCT l.line_unit) = 1 THEN MIN(l.line_unit) END AS purchase_unit
    FROM l
    WHERE l.period = 'current'
    GROUP BY l.product_id
  ),
  prev AS (
    SELECT product_id, SUM(value) AS value
    FROM l WHERE period = 'previous'
    GROUP BY product_id
  ),
  tot AS (SELECT NULLIF(SUM(value), 0) AS total FROM cur),
  items AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id',         c.product_id,
      'product_name',       p.name,
      'sku',                p.sku,
      'category_id',        p.category_id,
      'category_name',      cat.name,
      'base_unit',          p.unit,
      'purchase_unit',      c.purchase_unit,
      'base_quantity',      c.base_qty,
      'value',              c.value,
      'share_pct',          CASE WHEN t.total IS NULL THEN 0 ELSE round(c.value / t.total * 100, 2) END,
      -- 4 décimales : une unité de base petite (le gramme) coûte souvent moins
      -- d'une roupie ; l'écran arrondit à l'affichage.
      'avg_unit_cost',      CASE WHEN c.base_qty > 0 THEN round(c.value / c.base_qty, 4) END,
      'line_count',         c.line_count,
      'po_count',           c.po_count,
      'supplier_count',     c.supplier_count,
      'last_order_date',    c.last_order_date,
      'last_received_date', c.last_received_date,
      'previous_value',     COALESCE(pv.value, 0)
    ) ORDER BY c.value DESC, p.name), '[]'::jsonb) AS j
  FROM cur c
  JOIN products p ON p.id = c.product_id
  LEFT JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN prev pv ON pv.product_id = c.product_id
  CROSS JOIN tot t
  ),
  -- Dépense par jour de la période, le jour homologue de la période précédente
  -- en regard (même rang dans la fenêtre).
  by_day AS (
    SELECT order_date, period, SUM(value) AS value FROM l GROUP BY order_date, period
  ),
  -- Série d'entiers et non d'horodatages : le jour ne dépend pas du fuseau de
  -- la session.
  days AS (
    SELECT v_start + k AS day, k AS rk
    FROM generate_series(0, v_end - v_start) k
  ),
  trend AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date',           dy.day,
        'value',          COALESCE(c.value, 0),
        'previous_value', COALESCE(pr.value, 0)
      ) ORDER BY dy.day), '[]'::jsonb) AS j
    FROM days dy
    LEFT JOIN by_day c  ON c.period = 'current'  AND c.order_date = dy.day
    LEFT JOIN by_day pr ON pr.period = 'previous' AND pr.order_date = v_prev_start + dy.rk
  )
  SELECT summary.j, items.j, trend.j
    INTO v_summary, v_items, v_trend
    FROM summary, items, trend;

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'previous', jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'summary',  v_summary,
    'items',    v_items,
    'trend',    v_trend
  );
END;
$function$;

CREATE FUNCTION public.get_purchase_item_lines_v1(
  p_date_start  text,
  p_date_end    text,
  p_product_id  uuid,
  p_supplier_id uuid DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start  DATE;
  v_end    DATE;
  v_limit  INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total  INT;
  v_lines  JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = '22023';
  END IF;
  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'partial', 'received') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;

  WITH matching AS (
    SELECT po.id AS po_id, po.po_number, po.order_date, po.received_date,
           po.supplier_id, s.name AS supplier_name, poi.id AS line_id,
           poi.quantity, poi.unit, poi.received_quantity, poi.unit_cost,
           poi.subtotal, po.status
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE poi.product_id = p_product_id
      AND po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
      AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
      AND (p_status      IS NULL OR po.status = p_status)
  ),
  page AS (
    SELECT * FROM matching
    ORDER BY order_date DESC, po_number DESC, line_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT (SELECT COUNT(*) FROM matching)::INT,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'po_id',             po_id,
           'po_number',         po_number,
           'order_date',        order_date,
           'received_date',     received_date,
           'supplier_id',       supplier_id,
           'supplier_name',     supplier_name,
           'quantity',          quantity,
           'unit',              unit,
           'received_quantity', received_quantity,
           'unit_cost',         unit_cost,
           'subtotal',          subtotal,
           'status',            status
         ) ORDER BY order_date DESC, po_number DESC, line_id) FROM page), '[]'::jsonb)
  INTO v_total, v_lines;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'limit',       v_limit,
    'offset',      v_offset,
    'lines',       v_lines
  );
END;
$function$;

DROP FUNCTION public.get_purchase_items_v1(text, text, uuid);

REVOKE ALL ON FUNCTION public.get_purchase_items_v2(text, text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_purchase_items_v2(text, text, uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_items_v2(text, text, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_items_v2(text, text, uuid, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_purchase_item_lines_v1(text, text, uuid, uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_purchase_item_lines_v1(text, text, uuid, uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_item_lines_v1(text, text, uuid, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_item_lines_v1(text, text, uuid, uuid, text, integer, integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
