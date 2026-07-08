-- 20260710000138_create_customer_product_price_rpcs.sql
-- S69 Volet B — write RPCs for per-customer negotiated prices. Gated on customer_prices.manage.

CREATE FUNCTION upsert_customer_product_price_v1(
  p_customer_id uuid, p_product_id uuid, p_price numeric
) RETURNS customer_product_prices
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row customer_product_prices;
BEGIN
  IF NOT has_permission(v_uid, 'customer_prices.manage') THEN
    RAISE EXCEPTION 'permission_denied: customer_prices.manage' USING ERRCODE = 'P0003';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO customer_product_prices(customer_id, product_id, price)
  VALUES (p_customer_id, p_product_id, p_price)
  ON CONFLICT (customer_id, product_id) DO UPDATE SET price = EXCLUDED.price
  RETURNING * INTO v_row;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_price.upserted', 'customers', p_customer_id,
          jsonb_build_object('product_id', p_product_id, 'price', p_price));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_customer_product_price_v1(p_customer_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID;
BEGIN
  IF NOT has_permission(v_uid, 'customer_prices.manage') THEN
    RAISE EXCEPTION 'permission_denied: customer_prices.manage' USING ERRCODE = 'P0003';
  END IF;
  DELETE FROM customer_product_prices WHERE customer_id = p_customer_id AND product_id = p_product_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_price.deleted', 'customers', p_customer_id,
          jsonb_build_object('product_id', p_product_id));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'upsert_customer_product_price_v1(uuid,uuid,numeric)',
    'delete_customer_product_price_v1(uuid,uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
