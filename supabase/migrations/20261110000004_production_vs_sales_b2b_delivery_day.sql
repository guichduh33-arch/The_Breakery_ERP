-- S3-19 : le B2B compte au jour de sa LIVRAISON, payé ou à crédit.
-- La v1 ne comptait que les commandes B2B reconnues (payées). En production,
-- plus de la moitié des commandes B2B sont à crédit : elles manquaient.
-- Règle de Mamat (2026-11-10) : une commande B2B compte le jour où elle est
-- livrée. Non livrée = non comptée. Le comptoir ne change pas.
-- Appliquée sur dev le 2026-11-10 (version cloud 20261110193643).

DROP FUNCTION public.get_production_vs_sales_v1(date, date, uuid, uuid);

CREATE FUNCTION public.get_production_vs_sales_v2(
  p_start_date  date,
  p_end_date    date,
  p_category_id uuid DEFAULT NULL,
  p_product_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_start  date;
  v_end    date;
  v_result jsonb;
  -- Décision 4 : le périmètre est une liste fermée de slugs de catégories.
  v_scope  CONSTANT text[] := ARRAY[
    'classic-breads', 'sourdough-breads', 'classic-viennoiserie',
    'others-viennoiserie', 'savouries', 'individual-pastries', 'buns', 'bagel'
  ];
BEGIN
  -- Garde : même enchaînement que l'état de stock réservé au propriétaire.
  PERFORM public.assert_stock_owner_v1();

  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 91);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  PERFORM public.assert_business_days_visible_v2(v_start, v_end);

  WITH scope AS (
    -- Les mêmes filtres pour les trois sources : tout passe par ce périmètre.
    SELECT p.id AS product_id, p.name AS product_name,
           c.id AS category_id, c.name AS category_name
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE c.slug = ANY (v_scope)
      AND c.deleted_at IS NULL
      AND p.is_test = false
      AND (p_category_id IS NULL OR c.id = p_category_id)
      AND (p_product_id  IS NULL OR p.id = p_product_id)
  ),
  produced AS (
    SELECT ((pr.production_date AT TIME ZONE v_tz))::date AS day,
           pr.product_id,
           SUM(pr.quantity_produced) AS produced
    FROM production_records pr
    JOIN scope s ON s.product_id = pr.product_id
    WHERE pr.reverted_at IS NULL
      AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
    GROUP BY 1, 2
  ),
  sales_orders AS (
    -- Comptoir : même définition que le rapport des ventes par produit, jour
    -- de reconnaissance. Le B2B en est écarté : il a sa propre branche.
    SELECT o.id,
           false AS is_b2b,
           ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS day
    FROM reporting_private.recognized_sales_v2 o
    WHERE o.order_type <> 'b2b'
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
    UNION ALL
    -- B2B : toute commande LIVRÉE, payée ou non, au jour de sa livraison.
    SELECT o.id,
           true AS is_b2b,
           ((o.b2b_delivered_at AT TIME ZONE v_tz))::date AS day
    FROM reporting_private.closed_pos_orders_v1 o
    WHERE o.order_type = 'b2b'
      AND o.b2b_delivered_at IS NOT NULL
      AND o.voided_at IS NULL
      AND o.status <> 'voided'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((o.b2b_delivered_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  sold AS (
    SELECT so.day,
           oi.product_id,
           COALESCE(SUM(oi.quantity) FILTER (WHERE NOT so.is_b2b), 0) AS sold_counter,
           COALESCE(SUM(oi.quantity) FILTER (WHERE so.is_b2b), 0)     AS sold_b2b
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sales_orders so ON so.id = oi.order_id
    JOIN scope s ON s.product_id = oi.product_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
    GROUP BY 1, 2
  ),
  wasted AS (
    -- Décision 3 : uniquement le mouvement né d'une déclaration approuvée.
    SELECT ((sm.created_at AT TIME ZONE v_tz))::date AS day,
           sm.product_id,
           SUM(ABS(sm.quantity)) AS wasted
    FROM stock_movements sm
    JOIN scope s ON s.product_id = sm.product_id
    JOIN stock_declarations d ON d.id = sm.reference_id
    WHERE sm.movement_type = 'waste'
      AND sm.reference_type = 'stock_declaration'
      AND d.status = 'approved'
      AND d.operation IN ('waste', 'display_waste')
      AND ((sm.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
    GROUP BY 1, 2
  ),
  cells AS (
    -- Une cellule par (jour, article) ; toutes les ventilations en dérivent,
    -- ce qui garantit que leurs sommes se referment.
    SELECT u.day, u.product_id,
           SUM(u.produced)     AS produced,
           SUM(u.sold_counter) AS sold_counter,
           SUM(u.sold_b2b)     AS sold_b2b,
           SUM(u.wasted)       AS wasted
    FROM (
      SELECT day, product_id, produced, 0::numeric AS sold_counter,
             0::numeric AS sold_b2b, 0::numeric AS wasted FROM produced
      UNION ALL
      SELECT day, product_id, 0, sold_counter, sold_b2b, 0 FROM sold
      UNION ALL
      SELECT day, product_id, 0, 0, 0, wasted FROM wasted
    ) u
    GROUP BY u.day, u.product_id
    HAVING SUM(u.produced) <> 0 OR SUM(u.sold_counter) <> 0
        OR SUM(u.sold_b2b) <> 0 OR SUM(u.wasted) <> 0
  ),
  named AS (
    SELECT c.*, s.product_name, s.category_id, s.category_name,
           c.sold_counter + c.sold_b2b                          AS sold_total,
           c.produced - c.sold_counter - c.sold_b2b - c.wasted  AS gap
    FROM cells c
    JOIN scope s ON s.product_id = c.product_id
  ),
  tot AS (
    SELECT COALESCE(SUM(produced), 0)     AS produced,
           COALESCE(SUM(sold_counter), 0) AS sold_counter,
           COALESCE(SUM(sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(sold_total), 0)   AS sold_total,
           COALESCE(SUM(wasted), 0)       AS wasted,
           COALESCE(SUM(gap), 0)          AS gap
    FROM named
  ),
  per_day AS (
    SELECT g.day::date AS day,
           COALESCE(SUM(n.produced), 0)     AS produced,
           COALESCE(SUM(n.sold_counter), 0) AS sold_counter,
           COALESCE(SUM(n.sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(n.sold_total), 0)   AS sold_total,
           COALESCE(SUM(n.wasted), 0)       AS wasted,
           COALESCE(SUM(n.gap), 0)          AS gap
    FROM generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(day)
    LEFT JOIN named n ON n.day = g.day::date
    GROUP BY g.day
  ),
  per_category AS (
    SELECT category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(wasted) AS wasted, SUM(gap) AS gap
    FROM named
    GROUP BY category_id, category_name
  ),
  per_product AS (
    SELECT product_id, product_name, category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(wasted) AS wasted, SUM(gap) AS gap
    FROM named
    GROUP BY product_id, product_name, category_id, category_name
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                       ORDER BY c.name ASC, c.id ASC)
      FROM categories c
      WHERE c.slug = ANY (v_scope) AND c.deleted_at IS NULL
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'produced',         t.produced,
      'sold_counter',     t.sold_counter,
      'sold_b2b',         t.sold_b2b,
      'sold_total',       t.sold_total,
      'wasted',           t.wasted,
      'gap',              t.gap,
      'sell_through_pct', CASE WHEN t.produced = 0 THEN NULL
                               ELSE ROUND(100 * t.sold_total / t.produced, 1) END
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',         d.day,
        'produced',     d.produced,
        'sold_counter', d.sold_counter,
        'sold_b2b',     d.sold_b2b,
        'sold_total',   d.sold_total,
        'wasted',       d.wasted,
        'gap',          d.gap
      ) ORDER BY d.day ASC)
      FROM per_day d
    ), '[]'::jsonb),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id',      pc.category_id,
        'category_name',    pc.category_name,
        'produced',         pc.produced,
        'sold_counter',     pc.sold_counter,
        'sold_b2b',         pc.sold_b2b,
        'sold_total',       pc.sold_total,
        'wasted',           pc.wasted,
        'gap',              pc.gap,
        'sell_through_pct', CASE WHEN pc.produced = 0 THEN NULL
                                 ELSE ROUND(100 * pc.sold_total / pc.produced, 1) END
      ) ORDER BY pc.category_name ASC, pc.category_id ASC)
      FROM per_category pc
    ), '[]'::jsonb),
    'by_product', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',       pp.product_id,
        'product_name',     pp.product_name,
        'category_id',      pp.category_id,
        'category_name',    pp.category_name,
        'produced',         pp.produced,
        'sold_counter',     pp.sold_counter,
        'sold_b2b',         pp.sold_b2b,
        'sold_total',       pp.sold_total,
        'wasted',           pp.wasted,
        'gap',              pp.gap,
        'sell_through_pct', CASE WHEN pp.produced = 0 THEN NULL
                                 ELSE ROUND(100 * pp.sold_total / pp.produced, 1) END
      ) ORDER BY pp.gap DESC, pp.product_name ASC, pp.product_id ASC)
      FROM per_product pp
    ), '[]'::jsonb),
    'by_day_product', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',         n.day,
        'product_id',   n.product_id,
        'produced',     n.produced,
        'sold_counter', n.sold_counter,
        'sold_b2b',     n.sold_b2b,
        'sold_total',   n.sold_total,
        'wasted',       n.wasted,
        'gap',          n.gap
      ) ORDER BY n.day ASC, n.product_name ASC, n.product_id ASC)
      FROM named n
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_vs_sales_v2(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_vs_sales_v2(date, date, uuid, uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_production_vs_sales_v2(date, date, uuid, uuid) IS
  'S3-19 : production enregistrée contre ventes (comptoir au jour de reconnaissance, B2B au jour de livraison, payé ou non) et pertes approuvées, par jour, article et catégorie. Lecture seule, quantités uniquement, propriétaire seul. Fenêtre bornée à 92 jours.';
