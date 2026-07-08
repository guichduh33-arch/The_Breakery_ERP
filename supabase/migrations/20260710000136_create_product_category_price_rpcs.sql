-- 20260710000136_create_product_category_price_rpcs.sql
-- S69 Volet A — write RPCs for category-level product price overrides.
-- Gated on customer_categories.update (overrides belong to the category).

CREATE FUNCTION upsert_product_category_price_v1(
  p_category_id uuid, p_product_id uuid, p_price numeric
) RETURNS product_category_prices
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row product_category_prices;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_categories WHERE id = p_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO product_category_prices(product_id, customer_category_id, price)
  VALUES (p_product_id, p_category_id, p_price)
  ON CONFLICT (product_id, customer_category_id) DO UPDATE SET price = EXCLUDED.price
  RETURNING * INTO v_row;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'product_category_price.upserted', 'customer_categories', p_category_id,
          jsonb_build_object('product_id', p_product_id, 'price', p_price));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_product_category_price_v1(p_category_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  DELETE FROM product_category_prices WHERE product_id = p_product_id AND customer_category_id = p_category_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'product_category_price.deleted', 'customer_categories', p_category_id,
          jsonb_build_object('product_id', p_product_id));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'upsert_product_category_price_v1(uuid,uuid,numeric)',
    'delete_product_category_price_v1(uuid,uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
