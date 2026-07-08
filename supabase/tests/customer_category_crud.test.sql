-- supabase/tests/customer_category_crud.test.sql
-- S69 Volet A — pgTAP suite for customer_categories CRUD RPCs.
-- Auth pattern mirrors product_category_crud.test.sql: an ADMIN identity
-- (EMP000) is set via request.jwt.claims so auth.uid()/has_permission resolve.
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- Seed an ADMIN identity for the whole transaction (has customer_categories.*).
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- create: happy path
SELECT lives_ok(
  $$SELECT create_customer_category_v1('Hotels','hotels','custom',0,1.0,true,'#fff','crown',false)$$,
  'create custom category');
SELECT is((SELECT price_modifier_type::text FROM customer_categories WHERE slug='hotels'),
  'custom', 'modifier persisted');

-- create: duplicate slug
SELECT throws_ok(
  $$SELECT create_customer_category_v1('Dup','hotels','retail',0,1.0,true,null,null,false)$$,
  'P0001', NULL, 'duplicate slug rejected');

-- create: discount out of bounds
SELECT throws_ok(
  $$SELECT create_customer_category_v1('BadPct','badpct','discount_percentage',150,1.0,true,null,null,false)$$,
  'P0001', NULL, 'discount > 100 rejected');

-- create with is_default=true unsets previous default
SELECT create_customer_category_v1('NewDefault','newdef','retail',0,1.0,true,null,null,true);
SELECT is((SELECT count(*)::int FROM customer_categories WHERE is_default AND deleted_at IS NULL),
  1, 'exactly one default after switch');

-- update: rename
SELECT lives_ok(
  $$SELECT update_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'),'Hotels Group','hotels','custom',0,1.0,true,null,null,false)$$,
  'update name');
SELECT is((SELECT name FROM customer_categories WHERE slug='hotels'),
  'Hotels Group', 'name updated');

-- update: unknown id
SELECT throws_ok(
  $$SELECT update_customer_category_v1(gen_random_uuid(),'X','x','retail',0,1.0,true,null,null,false)$$,
  'P0002', NULL, 'update unknown -> category_not_found');

-- delete: default protected
SELECT throws_ok(
  $$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE is_default AND deleted_at IS NULL LIMIT 1))$$,
  'P0001', NULL, 'cannot delete default');

-- delete: in use
UPDATE customers SET category_id = (SELECT id FROM customer_categories WHERE slug='hotels')
  WHERE id = (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1);
SELECT throws_ok(
  $$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$,
  'P0001', NULL, 'category_in_use blocks delete');

-- delete: free category soft-deletes
UPDATE customers SET category_id = NULL WHERE category_id = (SELECT id FROM customer_categories WHERE slug='hotels');
SELECT lives_ok(
  $$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$,
  'delete unused category');
SELECT isnt((SELECT deleted_at FROM customer_categories WHERE slug='hotels'), NULL, 'soft-deleted');

-- delete: idempotent (re-delete is a no-op)
SELECT lives_ok(
  $$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$,
  're-delete is no-op');

-- ACL: anon cannot execute
SELECT is(has_function_privilege('anon',
  'create_customer_category_v1(text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)','EXECUTE'),
  false, 'anon cannot create');

SELECT * FROM finish();
ROLLBACK;
