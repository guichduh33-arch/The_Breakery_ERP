-- ADR-016 (conséquences 2 et 5) + ADR-008 D1.
--
-- 1. `recipe_bom_full_v1` → `_v2` : l'affichage de la nomenclature adopte la
--    règle de descente d'ADR-016. Un semi-fini suivi en stock devient une ligne
--    d'ingrédient terminale, valorisée à son propre coût, au lieu d'être
--    décomposé en ses matières.
--
--    Hors périmètre, acté : le CALCUL du coût de revient
--    (`recompute_recipe_cost` / le walk de coût) n'est pas touché — il continue
--    de se construire depuis les recettes. L'écart entre les deux méthodes sera
--    mesuré puis tranché séparément.
--
-- 2. `upsert_recipe_v1` → `_v2` : garde d'unité d'ADR-008 D1, précisée par
--    ADR-016 conséquence 5. L'unité identique n'est pas exigée ; ce qui est
--    fermé, c'est la conversion IMPOSSIBLE, jusqu'ici absorbée en silence.
--
-- Corps construits sur `pg_get_functiondef`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. recipe_bom_full_v1 → v2
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recipe_bom_full_v2(p_product_id uuid, p_max_depth integer DEFAULT 5)
 RETURNS TABLE(material_id uuid, material_name text, material_unit text, recipe_unit text, qty_per_unit numeric, current_stock numeric, cost_price numeric, qty_in_base numeric, line_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity::NUMERIC      AS qty,
           r.unit          AS line_unit,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path,
           COALESCE(m.track_inventory, TRUE) AS is_stocked
      FROM recipes r
      JOIN products m ON m.id = r.material_id
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT w.root_id,
           r.material_id,
           (w.qty * r.quantity::NUMERIC),
           r.unit,
           w.depth + 1,
           w.path || r.material_id,
           COALESCE(m.track_inventory, TRUE)
      FROM walk w
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
      JOIN products m ON m.id = r.material_id
     WHERE w.depth < p_max_depth
       AND w.is_stocked = FALSE
       AND NOT (r.material_id = ANY(w.path))
  ),
  leaves AS (
    SELECT w.material_id,
           SUM(w.qty)        AS qty_agg,
           MIN(w.line_unit)  AS recipe_unit
      FROM walk w
     WHERE w.is_stocked = TRUE
        OR NOT EXISTS (
             SELECT 1 FROM recipes c
              WHERE c.product_id = w.material_id
                AND c.is_active = TRUE
                AND c.deleted_at IS NULL
           )
     GROUP BY w.material_id
  )
  SELECT l.material_id,
         p.name,
         p.unit,
         l.recipe_unit,
         l.qty_agg,
         p.current_stock,
         p.cost_price,
         public._try_convert_quantity(l.qty_agg, l.recipe_unit, p.unit) AS qty_in_base,
         public._try_convert_quantity(l.qty_agg, l.recipe_unit, p.unit) * COALESCE(p.cost_price, 0) AS line_cost
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. upsert_recipe_v1 → v2
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_recipe_v2(
  p_product_id         uuid,
  p_material_id        uuid,
  p_quantity           numeric,
  p_unit               text,
  p_notes              text    DEFAULT NULL::text,
  p_is_baker_percentage boolean DEFAULT false,
  p_baker_percentage   numeric DEFAULT NULL::numeric
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_recipe_id     UUID;
  v_baker_pct     NUMERIC;
  v_material_unit TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL OR p_material_id IS NULL THEN
    RAISE EXCEPTION 'product_id_and_material_id_required' USING ERRCODE='P0001';
  END IF;

  IF p_product_id = p_material_id THEN
    RAISE EXCEPTION 'material_must_differ_from_product' USING ERRCODE='P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;

  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE='P0001';
  END IF;

  IF p_is_baker_percentage = TRUE AND p_baker_percentage IS NULL THEN
    RAISE EXCEPTION 'baker_percentage_required' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT unit INTO v_material_unit
    FROM products WHERE id = p_material_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_not_found' USING ERRCODE='P0002';
  END IF;

  -- ADR-008 D1, precise par ADR-016 consequence 5 : l'unite de la ligne doit
  -- etre CONVERTIBLE vers l'unite de stockage de l'article. L'unite identique
  -- n'est pas exigee. Ce qui est ferme, c'est la conversion impossible (des
  -- grammes vers un article compte a la piece), jusqu'ici absorbee en silence :
  -- _try_convert_quantity reprend alors la quantite brute.
  IF p_unit IS DISTINCT FROM v_material_unit THEN
    BEGIN
      PERFORM convert_quantity(1::numeric, p_unit, v_material_unit);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'unit_not_convertible' USING ERRCODE='P0001',
        DETAIL = format('%s -> %s', p_unit, v_material_unit),
        HINT   = 'la ligne doit etre saisie dans une unite convertible vers l''unite de stockage de l''article';
    END;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_baker_pct := CASE WHEN p_is_baker_percentage THEN p_baker_percentage ELSE NULL END;

  SELECT id INTO v_recipe_id FROM recipes
    WHERE product_id = p_product_id
      AND material_id = p_material_id
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_recipe_id IS NOT NULL THEN
    UPDATE recipes
      SET quantity            = p_quantity,
          unit                = p_unit,
          notes               = p_notes,
          is_baker_percentage = p_is_baker_percentage,
          baker_percentage    = v_baker_pct,
          updated_at          = now()
      WHERE id = v_recipe_id;
  ELSE
    INSERT INTO recipes (
      product_id, material_id, quantity, unit, notes,
      is_active, is_baker_percentage, baker_percentage
    )
      VALUES (
        p_product_id, p_material_id, p_quantity, p_unit, p_notes,
        TRUE, p_is_baker_percentage, v_baker_pct
      )
      RETURNING id INTO v_recipe_id;
  END IF;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'recipe.upsert', 'recipes', v_recipe_id,
    jsonb_build_object(
      'product_id',          p_product_id,
      'material_id',         p_material_id,
      'quantity',            p_quantity,
      'unit',                p_unit,
      'material_unit',       v_material_unit,
      'is_baker_percentage', p_is_baker_percentage,
      'baker_percentage',    v_baker_pct
    ),
    v_profile
  );

  RETURN v_recipe_id;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DROP des versions remplacées (même migration)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.recipe_bom_full_v1(uuid, integer);
DROP FUNCTION IF EXISTS public.upsert_recipe_v1(uuid, uuid, numeric, text, text, boolean, numeric);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Grants — paire REVOKE complète (anon hérite EXECUTE via PUBLIC)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.recipe_bom_full_v2(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recipe_bom_full_v2(uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.recipe_bom_full_v2(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_recipe_v2(uuid, uuid, numeric, text, text, boolean, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_recipe_v2(uuid, uuid, numeric, text, text, boolean, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.upsert_recipe_v2(uuid, uuid, numeric, text, text, boolean, numeric) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.recipe_bom_full_v2(uuid, integer)
  IS 'ADR-016: un semi-fini suivi en stock est une ligne terminale valorisee a son propre cout, pas un noeud a deplier.';
COMMENT ON FUNCTION public.upsert_recipe_v2(uuid, uuid, numeric, text, text, boolean, numeric)
  IS 'ADR-008 D1 / ADR-016: refuse une unite de ligne non convertible vers l''unite de stockage de l''article.';
