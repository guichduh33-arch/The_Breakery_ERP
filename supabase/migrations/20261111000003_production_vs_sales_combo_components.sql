-- S3-19 : les articles servis dans un combo comptent comme vendus dans le
-- rapport Production vs Sales (décision de Mamat, 2026-11-11).
--
-- Constat : un combo vendu est UNE ligne de vente, celle du combo ; ses
-- articles vivent dans `order_items.combo_components`. Le rapport ne lisait
-- que les lignes : un croissant servi dans un combo était produit, jamais
-- vendu, et gonflait le « non expliqué ».
--
-- Règles :
--  * Quantité vendue d'un composant = quantité de la ligne du combo × quantité
--    du composant. Elle entre dans la colonne de la commande (comptoir ou B2B),
--    au même jour que la ligne.
--  * Mêmes exclusions que les lignes propres : ligne annulée, cadeau promo,
--    commande annulée, import historique, produit test. Le composant doit être
--    dans le périmètre des catégories du rapport.
--  * Quantités seulement : aucune recette n'est attribuée au composant (elle
--    reste sur le combo).
--  * Nouvelle clé d'information `sold_in_combo`, aux cinq niveaux de la
--    réponse : la part de `sold_total` servie en combo. Elle est DÉJÀ comprise
--    dans `sold_counter` / `sold_b2b`, elle ne s'y ajoute pas.
--
-- Rien d'autre ne change : gardes, périmètre, B2B au jour de livraison, pertes,
-- restes, non expliqué.
--
-- Corps de départ : pg_get_functiondef de get_production_vs_sales_v3 (dev,
-- 2026-11-11), transformé par substitutions comptées.

DROP FUNCTION public.get_production_vs_sales_v3(date, date, uuid, uuid);

CREATE FUNCTION public.get_production_vs_sales_v4(
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
    -- Les mêmes filtres pour toutes les sources : tout passe par ce périmètre.
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
  sold_units AS (
    -- La ligne propre de l'article.
    SELECT so.day, so.is_b2b, s.product_id, oi.quantity AS qty, false AS in_combo
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sales_orders so ON so.id = oi.order_id
    JOIN scope s ON s.product_id = oi.product_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
    UNION ALL
    -- L'article servi comme composant d'un combo (décision de Mamat,
    -- 2026-11-11) : il a quitté la vitrine, il compte comme vendu. Quantité =
    -- quantité de la ligne du combo × quantité du composant. Le rapprochement
    -- se fait sur le texte de l'identifiant : un composant mal formé ne casse
    -- pas le rapport, il n'est simplement pas compté.
    SELECT so.day, so.is_b2b, s.product_id,
           oi.quantity * COALESCE(NULLIF(e.value->>'quantity', '')::numeric, 1) AS qty,
           true AS in_combo
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sales_orders so ON so.id = oi.order_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(oi.combo_components) = 'array'
           THEN oi.combo_components ELSE '[]'::jsonb END
    ) AS e(value)
    JOIN scope s ON s.product_id::text = e.value->>'product_id'
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  sold AS (
    SELECT u.day,
           u.product_id,
           COALESCE(SUM(u.qty) FILTER (WHERE NOT u.is_b2b), 0) AS sold_counter,
           COALESCE(SUM(u.qty) FILTER (WHERE u.is_b2b), 0)     AS sold_b2b,
           -- Information : la part des deux colonnes ci-dessus servie en combo.
           COALESCE(SUM(u.qty) FILTER (WHERE u.in_combo), 0)   AS sold_in_combo
    FROM sold_units u
    GROUP BY 1, 2
  ),
  closing_waste_day AS (
    -- Jour métier de la clôture de vitrine qui a saisi la perte (une perte
    -- reprise par une révision corrigée appartient au même jour).
    SELECT i.waste_declaration_id AS declaration_id, MIN(c.business_day) AS day
    FROM display_day_closing_items i
    JOIN display_day_closings c ON c.id = i.closing_id
    WHERE i.waste_declaration_id IS NOT NULL
    GROUP BY i.waste_declaration_id
  ),
  wasted AS (
    -- Décision 3 : uniquement le mouvement né d'une déclaration approuvée.
    SELECT w.day, w.product_id, SUM(w.qty) AS wasted
    FROM (
      SELECT COALESCE(cw.day, ((sm.created_at AT TIME ZONE v_tz))::date) AS day,
             sm.product_id,
             ABS(sm.quantity) AS qty
      FROM stock_movements sm
      JOIN scope s ON s.product_id = sm.product_id
      JOIN stock_declarations d ON d.id = sm.reference_id
      LEFT JOIN closing_waste_day cw ON cw.declaration_id = d.id
      WHERE sm.movement_type = 'waste'
        AND sm.reference_type = 'stock_declaration'
        AND d.status = 'approved'
        AND d.operation IN ('waste', 'display_waste')
    ) w
    WHERE w.day BETWEEN v_start AND v_end
    GROUP BY 1, 2
  ),
  closings AS (
    -- Dernière révision de chaque jour métier, de la veille du début à la fin.
    SELECT DISTINCT ON (c.business_day) c.id, c.business_day
    FROM display_day_closings c
    WHERE c.business_day BETWEEN v_start - 1 AND v_end
    ORDER BY c.business_day, c.revision DESC
  ),
  counted AS (
    SELECT cl.business_day AS day, i.product_id, i.remaining_qty
    FROM closings cl
    JOIN display_day_closing_items i ON i.closing_id = cl.id
    JOIN scope s ON s.product_id = i.product_id
  ),
  cells AS (
    -- Une cellule par (jour, article) ; toutes les ventilations en dérivent,
    -- ce qui garantit que leurs sommes se referment.
    SELECT u.day, u.product_id,
           SUM(u.produced)     AS produced,
           SUM(u.sold_counter) AS sold_counter,
           SUM(u.sold_b2b)     AS sold_b2b,
           SUM(u.sold_in_combo) AS sold_in_combo,
           SUM(u.wasted)       AS wasted
    FROM (
      SELECT day, product_id, produced, 0::numeric AS sold_counter,
             0::numeric AS sold_b2b, 0::numeric AS sold_in_combo,
             0::numeric AS wasted FROM produced
      UNION ALL
      SELECT day, product_id, 0, sold_counter, sold_b2b, sold_in_combo, 0 FROM sold
      UNION ALL
      SELECT day, product_id, 0, 0, 0, 0, wasted FROM wasted
      UNION ALL
      -- Un reste déclaré ouvre une cellule le soir même et le lendemain.
      SELECT day, product_id, 0, 0, 0, 0, 0 FROM counted WHERE day >= v_start
      UNION ALL
      SELECT day + 1, product_id, 0, 0, 0, 0, 0 FROM counted WHERE day + 1 <= v_end
    ) u
    GROUP BY u.day, u.product_id
  ),
  balanced AS (
    SELECT c.*,
           o.remaining_qty AS opening,
           k.remaining_qty AS closing,
           (o.remaining_qty IS NOT NULL AND k.remaining_qty IS NOT NULL) AS known
    FROM cells c
    LEFT JOIN counted o ON o.day = c.day - 1 AND o.product_id = c.product_id
    LEFT JOIN counted k ON k.day = c.day     AND k.product_id = c.product_id
  ),
  named AS (
    SELECT b.day, b.product_id, b.produced, b.sold_counter, b.sold_b2b,
           b.sold_in_combo, b.wasted,
           b.opening, b.closing,
           s.product_name, s.category_id, s.category_name,
           b.sold_counter + b.sold_b2b                          AS sold_total,
           b.produced - b.sold_counter - b.sold_b2b - b.wasted  AS gap,
           CASE WHEN b.known
                THEN b.opening + b.produced - b.sold_counter - b.sold_b2b - b.wasted - b.closing
           END                                                  AS unexplained
    FROM balanced b
    JOIN scope s ON s.product_id = b.product_id
    -- Une cellule sans aucun mouvement ni reste non nul n'apporte rien.
    WHERE b.produced <> 0 OR b.sold_counter <> 0 OR b.sold_b2b <> 0 OR b.wasted <> 0
       OR COALESCE(b.opening, 0) <> 0 OR COALESCE(b.closing, 0) <> 0
  ),
  tot AS (
    SELECT COALESCE(SUM(produced), 0)     AS produced,
           COALESCE(SUM(sold_counter), 0) AS sold_counter,
           COALESCE(SUM(sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(sold_total), 0)   AS sold_total,
           COALESCE(SUM(sold_in_combo), 0) AS sold_in_combo,
           COALESCE(SUM(wasted), 0)       AS wasted,
           COALESCE(SUM(gap), 0)          AS gap,
           COALESCE(SUM(opening), 0)      AS opening,
           COALESCE(SUM(closing), 0)      AS closing,
           SUM(unexplained)               AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
    FROM named
  ),
  per_day AS (
    SELECT g.day::date AS day,
           COALESCE(SUM(n.produced), 0)     AS produced,
           COALESCE(SUM(n.sold_counter), 0) AS sold_counter,
           COALESCE(SUM(n.sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(n.sold_total), 0)   AS sold_total,
           COALESCE(SUM(n.sold_in_combo), 0) AS sold_in_combo,
           COALESCE(SUM(n.wasted), 0)       AS wasted,
           COALESCE(SUM(n.gap), 0)          AS gap,
           COALESCE(SUM(n.opening), 0)      AS opening,
           COALESCE(SUM(n.closing), 0)      AS closing,
           SUM(n.unexplained)               AS unexplained,
           COUNT(n.day) FILTER (WHERE n.unexplained IS NULL) AS unknown_cells,
           EXISTS (SELECT 1 FROM closings cl WHERE cl.business_day = g.day::date) AS has_closing
    FROM generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(day)
    LEFT JOIN named n ON n.day = g.day::date
    GROUP BY g.day
  ),
  per_category AS (
    SELECT category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(sold_in_combo) AS sold_in_combo,
           SUM(wasted) AS wasted, SUM(gap) AS gap,
           COALESCE(SUM(opening), 0) AS opening, COALESCE(SUM(closing), 0) AS closing,
           SUM(unexplained) AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
    FROM named
    GROUP BY category_id, category_name
  ),
  per_product AS (
    SELECT product_id, product_name, category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(sold_in_combo) AS sold_in_combo,
           SUM(wasted) AS wasted, SUM(gap) AS gap,
           COALESCE(SUM(opening), 0) AS opening, COALESCE(SUM(closing), 0) AS closing,
           SUM(unexplained) AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
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
      'sold_in_combo',    t.sold_in_combo,
      'wasted',           t.wasted,
      'gap',              t.gap,
      'opening',          t.opening,
      'closing',          t.closing,
      'unexplained',      t.unexplained,
      'unknown_cells',    t.unknown_cells,
      'sell_through_pct', CASE WHEN t.produced = 0 THEN NULL
                               ELSE ROUND(100 * t.sold_total / t.produced, 1) END
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',          d.day,
        'produced',      d.produced,
        'sold_counter',  d.sold_counter,
        'sold_b2b',      d.sold_b2b,
        'sold_total',    d.sold_total,
        'sold_in_combo', d.sold_in_combo,
        'wasted',        d.wasted,
        'gap',           d.gap,
        'opening',       d.opening,
        'closing',       d.closing,
        'unexplained',   d.unexplained,
        'unknown_cells', d.unknown_cells,
        'has_closing',   d.has_closing
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
        'sold_in_combo',    pc.sold_in_combo,
        'wasted',           pc.wasted,
        'gap',              pc.gap,
        'opening',          pc.opening,
        'closing',          pc.closing,
        'unexplained',      pc.unexplained,
        'unknown_cells',    pc.unknown_cells,
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
        'sold_in_combo',    pp.sold_in_combo,
        'wasted',           pp.wasted,
        'gap',              pp.gap,
        'opening',          pp.opening,
        'closing',          pp.closing,
        'unexplained',      pp.unexplained,
        'unknown_cells',    pp.unknown_cells,
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
        'sold_in_combo', n.sold_in_combo,
        'wasted',       n.wasted,
        'gap',          n.gap,
        'opening',      n.opening,
        'closing',      n.closing,
        'unexplained',  n.unexplained
      ) ORDER BY n.day ASC, n.product_name ASC, n.product_id ASC)
      FROM named n
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_vs_sales_v4(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_vs_sales_v4(date, date, uuid, uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_production_vs_sales_v4(date, date, uuid, uuid) IS
  'S3-19 : bilan production contre ventes par jour, article et catégorie — reste de la veille + produit − vendu (comptoir au jour de reconnaissance, B2B au jour de livraison ; articles servis en combo compris, clé sold_in_combo) − pertes approuvées − reste du soir = non expliqué. Reste = dernière révision de la clôture de vitrine ; inconnu = NULL. Lecture seule, quantités uniquement, propriétaire seul. Fenêtre bornée à 92 jours.';
