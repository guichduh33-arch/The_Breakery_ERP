-- supabase/tests/create_tablet_order_v4_table_guard.test.sql
-- S72 — POS audit P1: the tablet order path could fire a dine_in order with a
-- blank table_number (the owner "table mandatory for dine-in" rule was enforced
-- only on the counter path). v4 mirrors fire_counter_order_v4's guard.
--   T1 : dine_in + blank table  -> P0011 table_required_for_dine_in
--   T2 : dine_in + valid table  -> creates order
--   T3 : take_out + blank table -> creates order (no table needed)
--   T4 : create_tablet_order_v3 dropped (monotonic versioning)
-- Run via MCP execute_sql (BEGIN/ROLLBACK included).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

DO $fx$
DECLARE
  v_auth UUID := 'a5720000-0000-0000-0000-000000000301';
  v_prof UUID := 'b5720000-0000-0000-0000-000000000301';
  v_prod UUID;
  v_tbl  TEXT;
BEGIN
  SELECT id INTO v_prod FROM products WHERE deleted_at IS NULL LIMIT 1;
  SELECT name INTO v_tbl FROM restaurant_tables WHERE deleted_at IS NULL LIMIT 1;
  IF v_tbl IS NULL THEN v_tbl := 'T1'; END IF;
  INSERT INTO auth.users (id) VALUES (v_auth);
  INSERT INTO user_profiles (id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
    VALUES (v_prof, v_auth, 'CASHIER', 'S72 tablet', 'S72TAB1', TRUE, crypt('123456', gen_salt('bf')));
  INSERT INTO user_permission_overrides (user_profile_id, permission_code, is_granted, reason)
    VALUES (v_prof, 'sales.create', TRUE, 'S72 test');
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, TRUE);
  PERFORM set_config('s72.prof', v_prof::text, FALSE);
  PERFORM set_config('s72.tbl', v_tbl, FALSE);
  PERFORM set_config('s72.items',
    json_build_array(json_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::json))::text,
    FALSE);
END $fx$;

SELECT throws_ok(
  format('SELECT create_tablet_order_v4(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), '', 'dine_in', current_setting('s72.items')),
  'P0011', 'table_required_for_dine_in',
  'T1: dine_in + blank table -> P0011 table_required_for_dine_in');

SELECT lives_ok(
  format('SELECT create_tablet_order_v4(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), current_setting('s72.tbl'), 'dine_in', current_setting('s72.items')),
  'T2: dine_in + valid table -> creates order');

SELECT lives_ok(
  format('SELECT create_tablet_order_v4(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), '', 'take_out', current_setting('s72.items')),
  'T3: take_out + blank table -> creates order (no table needed)');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_tablet_order_v3'),
  0, 'T4: create_tablet_order_v3 dropped');

SELECT * FROM finish();
ROLLBACK;
