-- ADR-007 décision 6 — le drapeau is_test devient posable depuis l'interface.
--
-- is_test est lu par les 8 RPCs de reporting (exclusion des données de test)
-- mais n'était posable qu'en SQL manuel. Nouvelle RPC dédiée, réservée
-- ADMIN/SUPER_ADMIN via la permission products.test_flag.update (nouveau
-- code, seedé ici). Hors allowlist update_product_v2 à dessein : le flag ne
-- doit pas être posable par un MANAGER titulaire de products.update.

-- 1. Permission (pattern seed_perm_products_variants _005926).
INSERT INTO permissions (code, module, action, description) VALUES
  ('products.test_flag.update', 'products', 'update',
   'Flag/unflag a product as test data (excluded from reports)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'products.test_flag.update'
  FROM (VALUES ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
ON CONFLICT DO NOTHING;

-- 2. RPC.
CREATE FUNCTION public.set_product_is_test_v1(p_product_id UUID, p_is_test BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id CONSTANT UUID := auth.uid();
  v_row products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.test_flag.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE products
     SET is_test = p_is_test, updated_at = now()
   WHERE id = p_product_id AND deleted_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'product.set_test_flag', 'product', p_product_id,
            jsonb_build_object('is_test', p_is_test),
            jsonb_build_object('sku', v_row.sku));

  RETURN jsonb_build_object('product_id', p_product_id, 'is_test', v_row.is_test);
END $function$;

-- 3. REVOKE trio (anon defense-in-depth) + grant aux appelants légitimes.
REVOKE EXECUTE ON FUNCTION public.set_product_is_test_v1(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_product_is_test_v1(UUID, BOOLEAN) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_product_is_test_v1(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_is_test_v1(UUID, BOOLEAN) TO service_role;
