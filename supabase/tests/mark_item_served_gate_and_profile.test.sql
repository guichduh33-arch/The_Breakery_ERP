-- supabase/tests/mark_item_served_gate_and_profile.test.sql
-- S72 — POS audit fix for mark_item_served (KDS ready -> served handoff):
--   1) served_by = auth.uid() wrote the auth id into order_items.served_by, a FK
--      to user_profiles(id) -> foreign_key_violation for real (id<>auth) users.
--   2) no kds.operate gate (the only KDS RPC without one).
--   T1 : real user (id<>auth) with kds.operate can serve (FK fix)
--   T2 : served_by = user_profiles.id (not auth_user_id)
--   T3 : user without kds.operate -> forbidden (P0003)
--   T4 : no anon / PUBLIC EXECUTE grant (S20 trio)
-- Run via MCP execute_sql (BEGIN/ROLLBACK included).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

DO $fx$
DECLARE
  v_auth1 UUID := 'a5720000-0000-0000-0000-000000000201';
  v_prof1 UUID := 'b5720000-0000-0000-0000-000000000201';  -- deliberately <> v_auth1
  v_auth2 UUID := 'a5720000-0000-0000-0000-000000000202';
  v_prof2 UUID := 'b5720000-0000-0000-0000-000000000202';
  v_prod  UUID;
  v_ord   UUID := 'd5720000-0000-0000-0000-000000000201';
  v_sess  UUID := 'c5720000-0000-0000-0000-000000000201';
BEGIN
  SELECT id INTO v_prod FROM products WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO auth.users (id) VALUES (v_auth1),(v_auth2);
  INSERT INTO user_profiles (id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash) VALUES
    (v_prof1, v_auth1, 'CASHIER', 'S72 KDS ok',     'S72KDS1', TRUE, crypt('123456', gen_salt('bf'))),
    (v_prof2, v_auth2, 'CASHIER', 'S72 KDS noperm', 'S72KDS2', TRUE, crypt('123456', gen_salt('bf')));
  -- user1 has kds.operate via role CASHIER; user2 gets an explicit deny override.
  INSERT INTO user_permission_overrides (user_profile_id, permission_code, is_granted, reason)
    VALUES (v_prof2, 'kds.operate', FALSE, 'S72 test: revoke kds.operate');
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status) VALUES (v_sess, v_prof1, 0, 'open');
  INSERT INTO orders (id, order_number, subtotal, tax_amount, total, session_id)
    VALUES (v_ord, 'S72-KDS-TEST-1', 10000, 1000, 11000, v_sess);
  INSERT INTO order_items (id, order_id, product_id, name_snapshot, unit_price, quantity, line_total, kitchen_status) VALUES
    ('e5720000-0000-0000-0000-000000000201', v_ord, v_prod, 'A', 10000, 1, 10000, 'ready'),
    ('e5720000-0000-0000-0000-000000000202', v_ord, v_prod, 'B', 10000, 1, 10000, 'ready');
END $fx$;

SELECT set_config('request.jwt.claim.sub','a5720000-0000-0000-0000-000000000201',true);

SELECT lives_ok(
  $$SELECT mark_item_served('e5720000-0000-0000-0000-000000000201'::uuid)$$,
  'T1: real user (id<>auth) with kds.operate can serve (FK fix)');

SELECT is(
  (SELECT served_by FROM order_items WHERE id='e5720000-0000-0000-0000-000000000201'),
  'b5720000-0000-0000-0000-000000000201'::uuid,
  'T2: served_by = user_profiles.id (not auth_user_id)');

SELECT set_config('request.jwt.claim.sub','a5720000-0000-0000-0000-000000000202',true);

SELECT throws_ok(
  $$SELECT mark_item_served('e5720000-0000-0000-0000-000000000202'::uuid)$$,
  'P0003', 'forbidden',
  'T3: user without kds.operate is forbidden');

SELECT ok(
  (SELECT proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='mark_item_served') !~ '(^\{|,)(anon)?=X/',
  'T4: no anon / PUBLIC EXECUTE grant');

SELECT * FROM finish();
ROLLBACK;
