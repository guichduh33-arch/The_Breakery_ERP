-- 20260630000023_recompute_recipe_costs.sql
-- Manufactured products (those with an active recipe) never had products.cost_price
-- populated: _calculate_recipe_cost_walk only fed the recipe_versions snapshot,
-- never the products row. Result: ~95 recipe products showed cost 0 → "—" in the
-- products list Cost column (and broke their margins / costing / P&L).
--
-- This migration adds a recompute path that writes the cost-walk result back into
-- products.cost_price (a protected column — direct UPDATE is revoked from
-- authenticated, but these SECURITY DEFINER functions run as the postgres owner):
--   * recompute_recipe_cost_v1(p_product_id)    — one product.
--   * recompute_all_recipe_costs_v1()           — every recipe product (backfill + cron).
--
-- A plausibility guard skips products whose computed cost is absurd (a known
-- data issue: a recipe line whose unit can't convert to the component's stock
-- unit falls back to the raw quantity in _calculate_recipe_cost_walk, inflating
-- the cost ~1000×). Those are reported, not stored, so margins/P&L aren't poisoned.
--
-- Kept fresh by a nightly pg_cron job (mirrors recompute-recipe-margins-daily).
-- Deliberately NOT a per-row trigger on recipes: the catalog import bulk-inserts
-- recipe rows, and a per-row recursive cost walk would cripple imports.

-- ── Single product ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_recipe_cost_v1(
  p_product_id    UUID,
  p_max_plausible NUMERIC DEFAULT 5000000
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_has_lines BOOLEAN;
  v_old       NUMERIC;
  v_walk      JSONB;
  v_new       NUMERIC;
BEGIN
  -- Manual callers need the cost-correction permission; the cron / service
  -- context (auth.uid() IS NULL) is allowed through.
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
    VALUES (v_uid, 'product.cost_recomputed', 'products', p_product_id,
            jsonb_build_object('old_cost', v_old, 'new_cost', v_new, 'source', 'recipe_cost_walk'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_recipe_cost_v1: audit failed for %: %', p_product_id, SQLERRM;
  END;

  RETURN jsonb_build_object('product_id', p_product_id, 'applied', true,
                            'old_cost', v_old, 'new_cost', v_new);
END $$;

-- ── All recipe products (backfill + cron) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_all_recipe_costs_v1(
  p_max_plausible NUMERIC DEFAULT 5000000
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    v_res := public.recompute_recipe_cost_v1(v_prod.id, p_max_plausible);

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
    VALUES (v_uid, 'product.costs_recomputed_bulk', 'products', NULL,
            v_res - 'implausible');  -- keep the audit row small
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_all_recipe_costs_v1: audit failed: %', SQLERRM;
  END;

  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.recompute_recipe_cost_v1(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_recipe_cost_v1(UUID, NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.recompute_recipe_cost_v1(UUID, NUMERIC) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.recompute_all_recipe_costs_v1(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_all_recipe_costs_v1(NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.recompute_all_recipe_costs_v1(NUMERIC) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.recompute_recipe_cost_v1(UUID, NUMERIC) IS
  'inventory.cost_correction (cron/service exempt). Recomputes ONE product''s '
  'cost_price from _calculate_recipe_cost_walk and stores it (SECURITY DEFINER '
  'bypasses the cost_price column REVOKE). Skips no-recipe / zero / unchanged / '
  'implausible (> p_max_plausible, from non-convertible recipe units). Audits changes.';
COMMENT ON FUNCTION public.recompute_all_recipe_costs_v1(NUMERIC) IS
  'inventory.cost_correction (cron/service exempt). Recomputes cost_price for every '
  'product with an active recipe. Returns a summary incl. the implausible-cost list '
  '(recipes whose units do not convert — fix the data, then re-run). Nightly via cron.';

-- ── Nightly cron (mirrors recompute-recipe-margins-daily) ───────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('recompute-recipe-costs-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

SELECT cron.schedule(
  'recompute-recipe-costs-daily',
  '15 2 * * *',  -- 02:15 UTC daily, just after the margins job
  $cron$SELECT public.recompute_all_recipe_costs_v1();$cron$
);
