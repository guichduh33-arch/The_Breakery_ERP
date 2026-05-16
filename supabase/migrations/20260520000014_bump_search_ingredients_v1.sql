-- 20260520000014_bump_search_ingredients_v1.sql
-- Session 16 / Phase 2.A — Use products.is_semi_finished flag instead of
-- nested EXISTS detection ; add trigram similarity() to the rank tier set.
--
-- Signature stable (TEXT, TEXT, INT). RPC behavior changes :
--   - `semi_finished` classification now reads `p.is_semi_finished` (D4).
--   - Rank tier 2 now also accepts SKU substring matches (was name-only in S15).
--   - Rank tier 2 (substring ILIKE) now also accepts trigram matches
--     `similarity(name, q) >= 0.3` OR `similarity(sku, q) >= 0.3`, ordered
--     by max(similarity_name, similarity_sku) DESC within the tier.
--
-- Exact (rank 0) and prefix (rank 1) tiers are unchanged — they always win
-- over similarity matches (D6).

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
  v_uid     UUID := auth.uid();
  v_query   TEXT := COALESCE(trim(p_query), '');
  v_kind    TEXT := COALESCE(p_kind, 'all');
  v_limit   INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_like    TEXT;
  v_prefix  TEXT;
  v_lower_q TEXT;
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
      p.id              AS product_id,
      p.sku             AS sku,
      p.name            AS name,
      p.unit            AS unit,
      p.cost_price      AS cost_price,
      p.current_stock   AS current_stock,
      p.is_semi_finished AS is_semi,
      EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.product_id = p.id
           AND r.is_active = TRUE
           AND r.deleted_at IS NULL
      ) AS has_recipe
    FROM products p
    WHERE p.is_active = TRUE
      AND p.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN b.is_semi    THEN 'semi_finished'
        WHEN b.has_recipe THEN 'sub_recipe'
        ELSE                   'raw'
      END AS kind
    FROM base b
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN v_query = ''                                 THEN 0.0
        ELSE GREATEST(
          similarity(c.name, v_query),
          similarity(c.sku,  v_query)
        )
      END AS sim_score
    FROM classified c
  ),
  filtered AS (
    SELECT *
      FROM scored s
     WHERE (v_kind = 'all' OR s.kind = v_kind)
       AND (
         v_query = ''
         OR lower(s.name) LIKE v_like
         OR lower(s.sku)  LIKE v_like
         OR s.sim_score >= 0.3
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
        WHEN lower(f.name) LIKE v_like
          OR lower(f.sku)  LIKE v_like          THEN 2
        ELSE                                         3
      END AS rank
    FROM filtered f
  )
  SELECT
    r.product_id, r.sku, r.name, r.unit, r.cost_price, r.current_stock,
    r.kind, r.has_recipe
  FROM ranked r
  ORDER BY r.rank ASC, r.sim_score DESC, r.name ASC
  LIMIT v_limit;
END $$;

GRANT EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) FROM anon, PUBLIC;

COMMENT ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) IS
  'Session 16 - Phase 2.A. Keyword + kind-filtered product search for IngredientPicker. '
  'p_kind in (raw, semi_finished, sub_recipe, all). Reads products.is_semi_finished flag '
  '(maintained by tr_recipes_recompute_is_semi_finished). Match : ILIKE substring OR '
  'pg_trgm similarity() >= 0.3. Rank tiers : exact > prefix > substring/trigram > '
  'untyped. Within each tier, similarity DESC then name ASC. STABLE SECURITY DEFINER, '
  'gated by inventory.read.';
