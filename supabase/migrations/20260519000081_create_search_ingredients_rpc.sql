-- 20260519000081_create_search_ingredients_rpc.sql
-- Session 15 / Phase 3.A - IngredientPicker support : search_ingredients_v1 RPC.
--
-- Decision D8 (Spec 2026-05-15) : keyword + kind-filtered product search to
-- back the IngredientPicker autocomplete. Returns rows shaped for the picker :
--   { product_id, sku, name, unit, cost_price, current_stock,
--     kind ('raw'|'sub_recipe'|'semi_finished'), has_recipe BOOLEAN }
--
-- `p_kind` :
--   'raw'           -> products WITHOUT an active recipe (terminal ingredients).
--   'sub_recipe'    -> products WITH an active recipe (matches view_recipe_products).
--   'semi_finished' -> products whose recipe itself uses sub-recipes (nesting
--                      depth >= 2). No `is_semi_finished` flag exists on
--                      products/categories (verified Phase 3.A) so we fall
--                      back to "recipe-of-recipe" detection per spec.
--   'all'           -> no kind filter.
--
-- Match : case-insensitive ILIKE on name OR sku (no pg_trgm fuzzy in v1 ;
-- the extension is installed but operator class indexes don't exist on
-- products.name/sku yet -- defer ranking refinement to Phase 3.A iteration).
-- Ordering : exact-match-first (name = query OR sku = query), then prefix
-- (starts-with query), then ILIKE (substring), then alpha by name.
-- Limit : cap to 100 hard ; default 20.
--
-- STABLE SECURITY DEFINER. Gated by `inventory.read`.
-- Grant EXECUTE to authenticated. Revoke from anon.

CREATE OR REPLACE FUNCTION search_ingredients_v1(
  p_query TEXT DEFAULT '',
  p_kind  TEXT DEFAULT 'all',
  p_limit INT  DEFAULT 20
) RETURNS TABLE (
  product_id    UUID,
  sku           TEXT,
  name          TEXT,
  unit          TEXT,
  cost_price    NUMERIC,
  current_stock NUMERIC,
  kind          TEXT,
  has_recipe    BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_query     TEXT := COALESCE(trim(p_query), '');
  v_kind      TEXT := COALESCE(p_kind, 'all');
  v_limit     INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_like      TEXT;
  v_prefix    TEXT;
  v_lower_q   TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF v_kind NOT IN ('raw', 'semi_finished', 'sub_recipe', 'all') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'P0001',
      DETAIL = 'p_kind must be one of: raw, semi_finished, sub_recipe, all.';
  END IF;

  v_lower_q := lower(v_query);
  v_like    := '%' || v_lower_q || '%';
  v_prefix  := v_lower_q || '%';

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id            AS product_id,
      p.sku           AS sku,
      p.name          AS name,
      p.unit          AS unit,
      p.cost_price    AS cost_price,
      p.current_stock AS current_stock,
      EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.product_id = p.id
           AND r.is_active = TRUE
           AND r.deleted_at IS NULL
      ) AS has_recipe,
      -- semi_finished : product has a recipe AND at least one of its
      -- materials is itself a recipe (i.e. recipe nesting depth >= 2).
      EXISTS (
        SELECT 1
          FROM recipes r1
          JOIN recipes r2 ON r2.product_id = r1.material_id
                         AND r2.is_active = TRUE
                         AND r2.deleted_at IS NULL
         WHERE r1.product_id = p.id
           AND r1.is_active = TRUE
           AND r1.deleted_at IS NULL
      ) AS is_semi
    FROM products p
    WHERE p.is_active = TRUE
      AND p.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN b.is_semi          THEN 'semi_finished'
        WHEN b.has_recipe       THEN 'sub_recipe'
        ELSE                         'raw'
      END AS kind
    FROM base b
  ),
  filtered AS (
    SELECT *
      FROM classified c
     WHERE (v_kind = 'all' OR c.kind = v_kind)
       AND (
         v_query = ''
         OR lower(c.name) LIKE v_like
         OR lower(c.sku)  LIKE v_like
       )
  ),
  ranked AS (
    SELECT
      f.*,
      CASE
        WHEN v_query = ''                       THEN 4
        WHEN lower(f.name) = v_lower_q
          OR lower(f.sku)  = v_lower_q          THEN 0
        WHEN lower(f.name) LIKE v_prefix
          OR lower(f.sku)  LIKE v_prefix        THEN 1
        WHEN lower(f.name) LIKE v_like          THEN 2
        ELSE                                         3
      END AS rank
    FROM filtered f
  )
  SELECT
    r.product_id, r.sku, r.name, r.unit, r.cost_price, r.current_stock,
    r.kind, r.has_recipe
  FROM ranked r
  ORDER BY r.rank ASC, r.name ASC
  LIMIT v_limit;
END $$;

GRANT EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) FROM anon, PUBLIC;

COMMENT ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) IS
  'Session 15 - Phase 3.A. Keyword + kind-filtered product search for IngredientPicker. '
  'p_kind in (raw, semi_finished, sub_recipe, all) ; raw = no active recipe ; '
  'sub_recipe = has active recipe ; semi_finished = recipe nesting depth >= 2. '
  'Search ILIKE on name OR sku, exact-then-prefix-then-substring ranked, limit capped at 100. '
  'STABLE SECURITY DEFINER, gated by inventory.read.';
