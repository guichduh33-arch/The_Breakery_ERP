-- Audit produits : fixture isolée, aucune modification conservée après ROLLBACK.
BEGIN;
SELECT plan(12);

DO $fixture$
DECLARE
  v_auth uuid := gen_random_uuid();
  v_profile uuid := gen_random_uuid();
  v_category jsonb;
  v_product jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_auth);
  INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
    VALUES (v_profile, v_auth, 'SUPER_ADMIN', 'Product audit fixture', 'AUD-' || v_profile::text, true, crypt(gen_random_uuid()::text, gen_salt('bf')));
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  v_category := create_category_v2(jsonb_build_object('name', 'Audit ' || v_profile::text));
  v_product := create_product_v3(jsonb_build_object(
    'name', 'Audit product', 'sku', 'AUD-' || v_profile::text,
    'category_id', v_category->>'id', 'retail_price', 12000,
    'image_url', 'https://example.test/product.png', 'description', 'Description',
    'wholesale_price', 10000, 'target_gross_margin_pct', 65, 'default_shelf_life_hours', 24));
  PERFORM set_config('test.product_id', v_product->'product'->>'id', true);
  PERFORM set_config('test.profile_id', v_profile::text, true);
END $fixture$;

SELECT lives_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"name":"Renamed"}'), 'name can be updated');
SELECT is((SELECT image_url FROM products WHERE id=current_setting('test.product_id')::uuid), 'https://example.test/product.png', 'omitted image stays unchanged');
SELECT lives_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"image_url":null,"description":null,"wholesale_price":null,"target_gross_margin_pct":null,"default_shelf_life_hours":null}'), 'optional fields can be cleared');
SELECT ok((SELECT image_url IS NULL AND description IS NULL AND wholesale_price IS NULL AND target_gross_margin_pct IS NULL AND default_shelf_life_hours IS NULL FROM products WHERE id=current_setting('test.product_id')::uuid), 'explicit null is persisted for every optional field');
SELECT is((SELECT retail_price FROM products WHERE id=current_setting('test.product_id')::uuid), 12000::numeric, 'omitted price stays unchanged');
SELECT throws_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"name":"  "}'), '22023', 'missing_required_fields', 'blank name is rejected');
SELECT throws_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"sku":null}'), '22023', 'missing_required_fields', 'null SKU is rejected');
SELECT throws_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"retail_price":-1}'), '22023', 'invalid_retail_price', 'negative price is rejected');
SELECT throws_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"retail_price":"NaN"}'), '22023', 'invalid_retail_price', 'nonfinite price is rejected');
SELECT ok(NOT has_function_privilege('anon', 'public.update_product_v4(uuid,jsonb)', 'EXECUTE'), 'anonymous callers cannot execute the RPC');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=current_setting('test.product_id')::uuid AND action='product.update' AND actor_id=current_setting('test.profile_id')::uuid), 'update retains the profile audit actor');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(format('SELECT update_product_v4(%L, %L)', current_setting('test.product_id'), '{"name":"Forbidden"}'), '42501', 'permission_denied', 'missing identity is rejected');
SELECT * FROM finish();
ROLLBACK;
