-- S53 P1.4 — single flag-aware sale-stock deduction helper.
-- Owns: stock_movements ledger + products.current_stock + display_stock/display_movements
-- isolation + sufficiency guard. Called once per resolved terminal product by the sale RPCs.
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(
  p_product_id     uuid,
  p_quantity       numeric,
  p_reference_id   uuid,
  p_created_by     uuid,
  p_reason         text,
  p_movement_type  movement_type DEFAULT 'sale',
  p_reference_type text          DEFAULT 'orders',
  p_unit           text          DEFAULT NULL,
  p_allow_negative boolean       DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_display boolean;
  v_current    numeric;
  v_unit       text;
  v_name       text;
  v_disp_qty   numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid sale quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, current_stock, COALESCE(p_unit, unit, 'pcs'), name
    INTO v_is_display, v_current, v_unit, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  -- Sufficiency guard (skipped when negative stock is allowed).
  IF v_is_display THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    IF NOT p_allow_negative AND COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0);
    END IF;
  ELSE
    IF NOT p_allow_negative AND COALESCE(v_current, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_current, 0);
    END IF;
  END IF;

  -- Ledger (append-only). stock_movements.reference_type stays plural 'orders'.
  -- reason is intentionally omitted here: stock_movements has no reason on the sale family
  -- (chk_stock_movements_reason_required allows NULL for sale/sale_void), matching the
  -- pre-refactor raw inserts. p_reason is used only for the display_movements ledger below.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, -p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  -- Display isolation. display_movements.reference_type is the historical singular 'order'
  -- (read by BO MovementHistoryDrawer.tsx:100). Do NOT unify to 'orders'.
  -- movement_type is a DISTINCT enum here (display_movement_type) — cast via text.
  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type::text::display_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock_v1 first', p_product_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM authenticated;
