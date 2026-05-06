-- 20260509000006_get_customer_product_price_rpc.sql
-- Session 7 / migration 6 : price resolution RPC

CREATE FUNCTION get_customer_product_price(
  p_product_id  UUID,
  p_customer_id UUID DEFAULT NULL
) RETURNS DECIMAL(12,2)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_product      products;
  v_category_id  UUID;
  v_modifier     price_modifier_type;
  v_discount_pct DECIMAL(5,2);
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN v_product.retail_price;
  END IF;

  SELECT category_id INTO v_category_id FROM customers WHERE id = p_customer_id;
  IF v_category_id IS NULL THEN
    SELECT id INTO v_category_id
      FROM customer_categories
      WHERE is_default = true AND deleted_at IS NULL;
  END IF;

  SELECT price_modifier_type, discount_percentage
    INTO v_modifier, v_discount_pct
    FROM customer_categories
    WHERE id = v_category_id;

  RETURN CASE v_modifier
    WHEN 'retail'              THEN v_product.retail_price
    WHEN 'wholesale'           THEN COALESCE(v_product.wholesale_price, v_product.retail_price)
    WHEN 'discount_percentage' THEN round_idr(v_product.retail_price * (1 - v_discount_pct / 100))
    WHEN 'custom'              THEN COALESCE(
                                     (SELECT price FROM product_category_prices
                                       WHERE product_id = p_product_id
                                         AND customer_category_id = v_category_id),
                                     v_product.retail_price
                                   )
  END;
END $$;
