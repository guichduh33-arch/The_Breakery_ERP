-- Refuse recipe edits whose computed cost exceeds the hard safety bound.
-- The enclosing transaction rolls back the recipe edit and its snapshot.
CREATE OR REPLACE FUNCTION public._snapshot_recipe_and_refresh_cost(p_product_id uuid, p_change_note text, p_profile uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_version uuid;
  v_cost numeric;
  v_old numeric;
  v_previous text := current_setting('breakery.recipe_cost_refresh', true);
BEGIN
  SELECT cost_price INTO v_old FROM public.products
    WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_version := public._snapshot_recipe_version(p_product_id, p_change_note, p_profile);
  SELECT (snapshot->>'product_cost_at_version')::numeric INTO v_cost
    FROM public.recipe_versions WHERE id = v_version;
  IF EXISTS (SELECT 1 FROM public.recipes WHERE product_id = p_product_id AND is_active AND deleted_at IS NULL) THEN
    IF v_cost IS NULL OR v_cost < 0 OR v_cost > 5000000 OR v_cost = 'NaN'::numeric THEN
      RAISE EXCEPTION 'recipe_cost_out_of_range' USING ERRCODE = '22003';
    END IF;
    IF v_old IS DISTINCT FROM v_cost THEN
      PERFORM set_config('breakery.recipe_cost_refresh', 'on', true);
      UPDATE public.products SET cost_price = v_cost, updated_at = now() WHERE id = p_product_id;
      PERFORM set_config('breakery.recipe_cost_refresh', coalesce(v_previous, ''), true);
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (p_profile, 'product.cost_recomputed', 'product', p_product_id,
          jsonb_build_object('old_cost', v_old, 'new_cost', v_cost, 'source', 'recipe_edit',
            'recipe_version_id', v_version));
    END IF;
  END IF;
  PERFORM public._refresh_recipe_margin(p_product_id, v_cost);
  RETURN v_version;
END $function$;

COMMENT ON FUNCTION public._snapshot_recipe_and_refresh_cost(uuid, text, uuid)
IS 'Refresh recipe cost and reject out-of-range recipe edits atomically.';
