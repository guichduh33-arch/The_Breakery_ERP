-- ADR-010 (D3/D4) — socle du verrou items envoyés en cuisine.
--
-- 1) Élargit le CHECK de scope des nonces d'autorisation ('discount' seul →
--    + 'order_item_edit') : le flux d'édition d'un item verrouillé transporte
--    l'autorisation manager par le même véhicule single-use/60 s que le
--    discount (table discount_authorizations, service-role only).
-- 2) _record_cancel_waste_stock_v1 : écriture waste display-aware rattachée à
--    la commande (reference_type 'order_cancel', reference_id = order_id,
--    metadata.order_item_id). Pas de garde de suffisance : la cuisine a
--    réellement consommé, le ledger dit la vérité (stock négatif possible).
--    unit_cost laissé NULL — tr_stock_movement_je valorise au cost_price
--    produit (circuit JE waste existant, ADR-004).
-- 3) _record_order_item_waste_v1 : explosion flag-aware d'une ligne, miroir
--    exact de la déduction vente (complete_order_with_payment_v18) —
--    combo → composants ; track_inventory → produit fini (vitrine
--    double-déduite) ; deduct_stock → ingrédients de recette via
--    _resolve_recipe_consumption_v1 ; sinon aucune déduction (la déclaration
--    vit dans audit_logs). Les ingrédients de modifiers ne sont PAS explosés
--    (hors périmètre ADR-010 D4 — texte : recette ou produit fini).

ALTER TABLE public.discount_authorizations
  DROP CONSTRAINT discount_authorizations_scope_check;
ALTER TABLE public.discount_authorizations
  ADD CONSTRAINT discount_authorizations_scope_check
  CHECK (scope IN ('discount', 'order_item_edit'));

CREATE OR REPLACE FUNCTION public._record_cancel_waste_stock_v1(
  p_product_id    uuid,
  p_quantity      numeric,
  p_reason        text,
  p_order_id      uuid,
  p_order_item_id uuid,
  p_created_by    uuid,
  p_unit          text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_display boolean;
  v_unit       text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid waste quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, COALESCE(p_unit, unit, 'pcs')
    INTO v_is_display, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason,
    reference_type, reference_id, created_by, metadata
  ) VALUES (
    p_product_id, 'waste', -p_quantity, v_unit, p_reason,
    'order_cancel', p_order_id, p_created_by,
    jsonb_build_object('order_item_id', p_order_item_id)
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, 'waste', -p_quantity, p_reason, 'order_cancel', p_order_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock_v1 first', p_product_id;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._record_order_item_waste_v1(
  p_order_item_id    uuid,
  p_order_id         uuid,
  p_product_id       uuid,
  p_combo_components jsonb,
  p_waste_qty        numeric,
  p_reason           text,
  p_created_by       uuid
) RETURNS void
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
    FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(p_product_id, p_waste_qty) LOOP
      PERFORM _record_cancel_waste_stock_v1(
        v_cons.product_id, v_cons.qty_base, p_reason,
        p_order_id, p_order_item_id, p_created_by, v_cons.unit);
    END LOOP;
  END IF;
  -- (track_inventory=false AND deduct_stock=false) → aucune déduction.
END;
$function$;

-- Helpers internes : jamais callables client (parité _record_sale_stock_v1).
REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._record_order_item_waste_v1(uuid, uuid, uuid, jsonb, numeric, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._record_order_item_waste_v1(uuid, uuid, uuid, jsonb, numeric, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._record_order_item_waste_v1(uuid, uuid, uuid, jsonb, numeric, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._record_order_item_waste_v1(uuid, uuid, uuid, jsonb, numeric, text, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
