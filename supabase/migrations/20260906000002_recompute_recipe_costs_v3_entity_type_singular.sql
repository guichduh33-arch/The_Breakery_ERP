-- Audit lot 1, P1 sécurité n°4 et n°5 — deux défauts, une seule paire de bumps.
--
-- (a) `entity_type` : les deux RPC écrivent 'products' (PLURIEL) dans audit_logs,
--     alors que l'onglet History d'un produit filtre sur 'product' (SINGULIER,
--     apps/backoffice/src/features/products/hooks/useProductAuditLog.ts). Un
--     recalcul de coût n'apparaît donc JAMAIS dans l'écran prévu pour répondre à
--     « pourquoi ma marge a bougé ». Valeur canonique arbitrée par Mamat le
--     2026-09-06 : 'product' au singulier. Les lignes historiques sont reprises
--     par 20260906000005.
--
-- (b) gate fail-open : `IF v_uid IS NOT NULL AND NOT has_permission(...)` laisse
--     passer un appelant sans acteur. Le grant à `authenticated` est RÉSIDUEL —
--     aucun appelant applicatif (relevé apps/ + packages/ le 2026-09-06), le seul
--     appelant vivant est le cron `recompute-recipe-costs-daily`, qui tourne en
--     postgres. On ferme donc l'ACL à service_role, et la branche `IS NOT NULL`
--     redevient le chemin machine assumé, pas une porte ouverte.
--
-- Corps repris de `pg_get_functiondef` live (v2), pas des fichiers d'origine.

-- ---------------------------------------------------------------- unitaire

CREATE OR REPLACE FUNCTION public.recompute_recipe_cost_v3(
  p_product_id uuid,
  p_max_plausible numeric DEFAULT 5000000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid       UUID := auth.uid();
  v_has_lines BOOLEAN;
  v_old       NUMERIC;
  v_walk      JSONB;
  v_new       NUMERIC;
BEGIN
  IF v_uid IS NOT NULL AND NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM recipes r
     WHERE r.product_id = p_product_id AND r.is_active AND r.deleted_at IS NULL
  ) INTO v_has_lines;

  IF NOT v_has_lines THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false, 'reason', 'no_recipe');
  END IF;

  SELECT cost_price INTO v_old FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false, 'reason', 'not_found');
  END IF;

  BEGIN
    v_walk := _calculate_recipe_cost_walk(p_product_id, 5, 1, ARRAY[]::UUID[]);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'walk_error', 'detail', SQLERRM);
  END;
  v_new := ROUND(COALESCE((v_walk->>'cost_per_unit')::NUMERIC, 0), 2);

  IF v_new <= 0 THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'zero_cost', 'new_cost', v_new);
  END IF;
  IF v_new > p_max_plausible THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'implausible_cost', 'new_cost', v_new, 'old_cost', v_old);
  END IF;
  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'unchanged', 'new_cost', v_new);
  END IF;

  UPDATE products SET cost_price = v_new, updated_at = now() WHERE id = p_product_id;

  BEGIN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'product.cost_recomputed', 'product', p_product_id,
            jsonb_build_object('old_cost', v_old, 'new_cost', v_new, 'source', 'recipe_cost_walk'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_recipe_cost_v3: audit failed for %: %', p_product_id, SQLERRM;
  END;

  RETURN jsonb_build_object('product_id', p_product_id, 'applied', true,
                            'old_cost', v_old, 'new_cost', v_new);
END $$;

-- ------------------------------------------------------------------- bulk

CREATE OR REPLACE FUNCTION public.recompute_all_recipe_costs_v3(
  p_max_plausible numeric DEFAULT 5000000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid          UUID := auth.uid();
  v_now          TIMESTAMPTZ := now();
  v_prod         RECORD;
  v_res          JSONB;
  v_checked      INT := 0;
  v_updated      INT := 0;
  v_zero         INT := 0;
  v_unchanged    INT := 0;
  v_errors       INT := 0;
  v_implausible  JSONB := '[]'::JSONB;
BEGIN
  IF v_uid IS NOT NULL AND NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  FOR v_prod IN
    SELECT p.id, p.name, p.sku
      FROM products p
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM recipes r
                    WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL)
     ORDER BY p.name
  LOOP
    v_checked := v_checked + 1;
    v_res := public.recompute_recipe_cost_v3(v_prod.id, p_max_plausible);

    IF (v_res->>'applied')::BOOLEAN THEN
      v_updated := v_updated + 1;
    ELSIF (v_res->>'reason') = 'zero_cost' THEN
      v_zero := v_zero + 1;
    ELSIF (v_res->>'reason') = 'unchanged' THEN
      v_unchanged := v_unchanged + 1;
    ELSIF (v_res->>'reason') = 'implausible_cost' THEN
      v_implausible := v_implausible || jsonb_build_object(
        'product_id', v_prod.id, 'name', v_prod.name, 'sku', v_prod.sku,
        'computed_cost', (v_res->>'new_cost')::NUMERIC);
    ELSIF (v_res->>'reason') = 'walk_error' THEN
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  v_res := jsonb_build_object(
    'checked',            v_checked,
    'updated',            v_updated,
    'unchanged',          v_unchanged,
    'skipped_zero_cost',  v_zero,
    'walk_errors',        v_errors,
    'implausible_count',  jsonb_array_length(v_implausible),
    'implausible',        v_implausible,
    'ran_at',             v_now
  );

  BEGIN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'product.costs_recomputed_bulk', 'product', NULL,
            v_res - 'implausible');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_all_recipe_costs_v3: audit failed: %', SQLERRM;
  END;

  RETURN v_res;
END $$;

-- ------------------------------------------------------- ACL machine-only

REVOKE EXECUTE ON FUNCTION public.recompute_recipe_cost_v3(uuid, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_all_recipe_costs_v3(numeric)
  FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recompute_recipe_cost_v3(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_recipe_costs_v3(numeric) TO service_role;

COMMENT ON FUNCTION public.recompute_recipe_cost_v3(uuid, numeric) IS
  'Machine-only depuis 2026-09-06 : cron recompute-recipe-costs-daily et service_role. Le gate has_permission est fail-open sur acteur NULL — c est l ACL qui verrouille. Ne pas re-grant a authenticated sans inverser le gate en fail-closed.';
COMMENT ON FUNCTION public.recompute_all_recipe_costs_v3(numeric) IS
  'Machine-only depuis 2026-09-06 : cron recompute-recipe-costs-daily. Meme reserve de gate que la v3 unitaire.';

-- ----------------------------------------------- cron avant DROP de la v2

SELECT cron.unschedule('recompute-recipe-costs-daily');
SELECT cron.schedule(
  'recompute-recipe-costs-daily',
  '15 2 * * *',
  'SELECT public.recompute_all_recipe_costs_v3();'
);

DROP FUNCTION IF EXISTS public.recompute_all_recipe_costs_v2(numeric);
DROP FUNCTION IF EXISTS public.recompute_recipe_cost_v2(uuid, numeric);
