-- 20260630000020_create_set_product_base_unit_v1_rpc.sql
-- Lets a product's base/stock unit (products.unit) be changed from the Units tab.
-- update_product_v1 deliberately excludes `unit` from its allowlist because the
-- base unit is the reference for every recorded quantity & cost; this dedicated
-- RPC changes it ONLY when nothing would be silently reinterpreted.
--
-- Guard: refuse unless current_stock = 0 AND there are no stock_movements AND no
-- display_stock — otherwise switching e.g. cup → lt would reinterpret the stored
-- number and per-unit cost. Alternative units and unit contexts were defined
-- relative to the OLD base, so they are reset (soft-deleted / removed) for the
-- user to redefine against the new base. cost_price is converted when a global
-- unit conversion exists (else left as-is and flagged).

CREATE OR REPLACE FUNCTION public.set_product_base_unit_v1(
  p_product_id UUID,
  p_new_unit   TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_old_unit       TEXT;
  v_stock          NUMERIC;
  v_cost           NUMERIC;
  v_movements      INT;
  v_display        NUMERIC;
  v_new            TEXT := btrim(p_new_unit);
  v_factor         NUMERIC;
  v_cost_converted BOOLEAN := FALSE;
  v_new_cost       NUMERIC;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.units.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = '22023';
  END IF;

  SELECT unit, COALESCE(current_stock, 0), cost_price
    INTO v_old_unit, v_stock, v_cost
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_old_unit IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_new = v_old_unit THEN
    RAISE EXCEPTION 'unit_unchanged' USING ERRCODE = 'P0001';
  END IF;

  -- Safety guard: nothing recorded against the old unit may exist.
  SELECT count(*)            INTO v_movements FROM stock_movements WHERE product_id = p_product_id;
  SELECT COALESCE(SUM(quantity), 0) INTO v_display FROM display_stock   WHERE product_id = p_product_id;
  IF v_stock <> 0 OR v_movements > 0 OR v_display <> 0 THEN
    RAISE EXCEPTION 'base_unit_change_requires_zero_stock'
      USING ERRCODE = 'P0001',
            DETAIL  = format('stock=%s movements=%s display=%s', v_stock, v_movements, v_display),
            HINT    = 'Zero out stock and ensure no stock movements before changing the base unit.';
  END IF;

  -- Convert cost_price when a global conversion old→new exists; otherwise leave it.
  -- cost per new unit = cost per old unit × (old units per 1 new unit).
  IF v_cost IS NOT NULL AND v_cost <> 0 THEN
    BEGIN
      v_factor   := public.convert_quantity(1, v_new, v_old_unit);
      v_new_cost := v_cost * v_factor;
      v_cost_converted := TRUE;
    EXCEPTION WHEN OTHERS THEN
      v_cost_converted := FALSE;
    END;
  END IF;

  UPDATE products
     SET unit       = v_new,
         cost_price = CASE WHEN v_cost_converted THEN v_new_cost ELSE cost_price END,
         updated_at = now()
   WHERE id = p_product_id;

  -- Reset units defined against the old base.
  UPDATE product_unit_alternatives
     SET deleted_at = now(), updated_at = now()
   WHERE product_id = p_product_id AND deleted_at IS NULL;
  DELETE FROM product_unit_contexts WHERE product_id = p_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'product.base_unit_changed', 'product', p_product_id,
          jsonb_build_object('from', v_old_unit, 'to', v_new,
                             'cost_price_converted', v_cost_converted));

  RETURN jsonb_build_object(
    'product_id',            p_product_id,
    'old_unit',             v_old_unit,
    'new_unit',             v_new,
    'cost_price_converted', v_cost_converted
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.set_product_base_unit_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_product_base_unit_v1(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_product_base_unit_v1(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.set_product_base_unit_v1(UUID, TEXT) IS
  '2026-06-17: change products.unit (base/stock unit) safely. Gated products.units.update. '
  'Refuses when current_stock<>0 OR any stock_movements OR display_stock exist '
  '(base_unit_change_requires_zero_stock). Resets alternative units & contexts; '
  'converts cost_price when a global unit conversion exists (flag cost_price_converted).';
