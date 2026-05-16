-- Session 15 / Phase 5.C — Recursive view of resolved allergens per product.
--
-- For each product, return the UNION of :
--   1. its own `products.allergens` (self-declared)
--   2. the allergens of every leaf material reachable via the `recipes`
--      cascade (sub-recipes included).
--
-- Depth-limited to 5 hops (consistent with the anti-cycle trigger in
-- migration 20260519000001 + spec §D14). Recipes with cycles are blocked at
-- INSERT time so the walk is safe.
--
-- Cardinality of `products` is < 200 in The Breakery context, so an on-the-fly
-- recursive CTE is cheap. No materialized view, no trigger maintenance —
-- always in phase with `products.allergens` + `recipes`.
--
-- RLS — view inherits from underlying tables (products + recipes). Granted
-- SELECT to authenticated; effective access still gated by inventory.read.
--
-- Spec ref: docs/workplan/specs/2026-05-15-session-15-spec.md §D14.

CREATE OR REPLACE VIEW public.view_product_allergens_resolved AS
WITH RECURSIVE
  -- Walk the recipe graph from each product down to its leaf materials.
  -- depth=0 -> the product itself (carries its own allergens).
  -- depth=N -> every material reached by following recipes N hops.
  graph (root_product_id, current_id, depth) AS (
    -- Seed : one row per product, pointing at itself.
    SELECT
      p.id AS root_product_id,
      p.id AS current_id,
      0    AS depth
    FROM public.products p
    WHERE p.deleted_at IS NULL

    UNION ALL

    -- Recurse : follow active recipe rows from current_id (as product)
    -- to its materials. Cap at depth 5 to mirror the anti-cycle bound.
    SELECT
      g.root_product_id,
      r.material_id AS current_id,
      g.depth + 1   AS depth
    FROM graph g
    JOIN public.recipes r
      ON r.product_id = g.current_id
     AND r.is_active = TRUE
     AND r.deleted_at IS NULL
    WHERE g.depth < 5
  )
SELECT
  g.root_product_id                                                 AS product_id,
  COALESCE(
    array_agg(DISTINCT a ORDER BY a) FILTER (WHERE a IS NOT NULL),
    '{}'::allergen_type[]
  )                                                                 AS allergens
FROM graph g
JOIN public.products p
  ON p.id = g.current_id
LEFT JOIN LATERAL unnest(p.allergens) AS a ON TRUE
GROUP BY g.root_product_id;

COMMENT ON VIEW public.view_product_allergens_resolved IS
  'Recursive resolution of allergens for each product : own + propagated via recipes cascade (depth <= 5). See Session 15 Phase 5.C, decision D14.';

GRANT SELECT ON public.view_product_allergens_resolved TO authenticated;
