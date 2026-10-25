-- Corps live ; conversions cohérentes et fermeture des appelants versionnés.
CREATE OR REPLACE FUNCTION public._record_order_item_waste_v2(p_order_item_id uuid, p_order_id uuid, p_product_id uuid, p_combo_components jsonb, p_waste_qty numeric, p_reason text, p_created_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_type text;
  v_track        boolean;
  v_deduct       boolean;
  v_comp         jsonb;
  v_comp_qty     numeric;
  v_cons         RECORD;
BEGIN
  IF p_waste_qty IS NULL OR p_waste_qty <= 0 THEN
    RETURN;
  END IF;

  SELECT product_type, track_inventory, deduct_stock
    INTO v_product_type, v_track, v_deduct
    FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF v_product_type = 'combo' THEN
    -- Miroir v18 (A) : composants routés produit par produit, qty par unité
    -- de combo × qty perdue.
    FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(p_combo_components, '[]'::jsonb)) LOOP
      v_comp_qty := (v_comp->>'quantity')::numeric * p_waste_qty;
      PERFORM _record_cancel_waste_stock_v1(
        (v_comp->>'product_id')::uuid, v_comp_qty, p_reason,
        p_order_id, p_order_item_id, p_created_by);
    END LOOP;
  ELSIF v_track THEN
    -- Miroir v18 (B) : ligne trackée simple (vitrine gérée dans le helper).
    PERFORM _record_cancel_waste_stock_v1(
      p_product_id, p_waste_qty, p_reason,
      p_order_id, p_order_item_id, p_created_by);
  ELSIF v_deduct THEN
    -- Miroir v18 (C) : cascade recette, unité passée explicitement.
    FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(p_product_id, p_waste_qty) LOOP
      PERFORM _record_cancel_waste_stock_v1(
        v_cons.product_id, v_cons.qty_base, p_reason,
        p_order_id, p_order_item_id, p_created_by, v_cons.unit);
    END LOOP;
  END IF;
  -- (track_inventory=false AND deduct_stock=false) → aucune déduction.
END;
$function$
;
REVOKE ALL ON FUNCTION public._record_order_item_waste_v2(p_order_item_id uuid, p_order_id uuid, p_product_id uuid, p_combo_components jsonb, p_waste_qty numeric, p_reason text, p_created_by uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._record_order_item_waste_v2(p_order_item_id uuid, p_order_id uuid, p_product_id uuid, p_combo_components jsonb, p_waste_qty numeric, p_reason text, p_created_by uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public._record_order_item_waste_v1(p_order_item_id uuid, p_order_id uuid, p_product_id uuid, p_combo_components jsonb, p_waste_qty numeric, p_reason text, p_created_by uuid);
