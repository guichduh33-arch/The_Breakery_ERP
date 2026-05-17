-- 20260521000013_create_tr_update_product_cost_on_purchase.sql
-- Session 17 / Phase 1.C — Auto-update products.cost_price via WAC on
-- purchase stock_movements. Fires AFTER INSERT, reads products.current_stock
-- + cost_price BEFORE record_stock_movement_v1's downstream UPDATE products
-- SET current_stock = v_new (D5). Triggers tr_snapshot_on_product_cost_change
-- transitively when cost_price actually changes.

CREATE OR REPLACE FUNCTION tr_update_product_cost_on_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_stock NUMERIC;
  v_old_cost  NUMERIC;
  v_new_cost  NUMERIC(14,2);
BEGIN
  -- D7 guards
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RETURN NULL;
  END IF;
  IF NEW.unit_cost IS NULL OR NEW.unit_cost <= 0 THEN
    RETURN NULL;
  END IF;

  -- Read pre-movement state (current_stock not yet updated by RPC).
  SELECT current_stock, cost_price INTO v_old_stock, v_old_cost
    FROM products WHERE id = NEW.product_id;

  IF v_old_stock IS NULL OR v_old_stock <= 0 OR v_old_cost IS NULL OR v_old_cost <= 0 THEN
    -- First receipt / stock-empty state : seed from unit_cost.
    v_new_cost := round(NEW.unit_cost::NUMERIC, 2);
  ELSE
    v_new_cost := round(
      ((v_old_stock * v_old_cost) + (NEW.quantity * NEW.unit_cost))
        / (v_old_stock + NEW.quantity),
      2
    );
  END IF;

  UPDATE products
    SET cost_price = v_new_cost, updated_at = now()
   WHERE id = NEW.product_id
     AND cost_price IS DISTINCT FROM v_new_cost;

  RETURN NULL;
END $$;

CREATE TRIGGER tr_update_product_cost_on_purchase
AFTER INSERT ON stock_movements
FOR EACH ROW
WHEN (NEW.movement_type = 'purchase')
EXECUTE FUNCTION tr_update_product_cost_on_purchase();

COMMENT ON FUNCTION tr_update_product_cost_on_purchase() IS
  'Session 17 / Phase 1.C. WAC auto-update of products.cost_price on '
  'purchase stock_movements. new_cost = round((old_stock * old_cost + qty * '
  'unit_cost) / (old_stock + qty), 2). First receipt or stock-empty seeds '
  'from unit_cost. Skip when quantity <= 0 or unit_cost <= 0.';
