-- supabase/tests/floor_plan_crud.test.sql
-- S75 Lot 1 — pgTAP suite for table_sections + floor plan CRUD RPCs
-- (create_table_section_v1/update_table_section_v1/delete_table_section_v1,
--  create_restaurant_table_v1/update_restaurant_table_v1/delete_restaurant_table_v1).
-- Auth pattern mirrors customer_category_crud.test.sql: an ADMIN identity
-- (EMP000) is set via request.jwt.claims so auth.uid()/has_permission resolve
-- (MANAGER has tables.create/update per the S11 seed, delete is ADMIN+ — EMP000
-- covers all six RPCs in one identity). The occupied-table order seed mirrors
-- the raw orders INSERT in table_transfer_dinein_guard.test.sql (minimal
-- NOT NULL columns: order_number, order_type, status, subtotal, tax_amount,
-- total, created_via, session_id, table_number).
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

-- Seed an ADMIN identity for the whole transaction.
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- 1/2: create section happy path
SELECT lives_ok(
  $$SELECT create_table_section_v1('Bar Corner', 5)$$,
  'create section Bar Corner');
SELECT is(
  (SELECT name FROM table_sections WHERE name = 'Bar Corner'),
  'Bar Corner', 'section name persisted');

-- 3: duplicate name -> P0001 name_taken
SELECT throws_ok(
  $$SELECT create_table_section_v1('Bar Corner', 6)$$,
  'P0001', NULL, 'duplicate section name rejected');

-- 4: empty name -> P0001 name_required
SELECT throws_ok(
  $$SELECT create_table_section_v1('', 7)$$,
  'P0001', NULL, 'empty section name rejected');

-- 5: create table in the section
SELECT lives_ok(
  $$SELECT create_restaurant_table_v1('T-99', 4, (SELECT id FROM table_sections WHERE name = 'Bar Corner'), 1)$$,
  'create table T-99 in Bar Corner');

-- 5a: update nonexistent section -> P0002 section_not_found
SELECT throws_ok(
  $$SELECT update_table_section_v1(gen_random_uuid(), 'Bar Corner', 5, true)$$,
  'P0002', NULL, 'nonexistent section rejected');

-- 5b: update with empty name -> P0001 name_required
SELECT throws_ok(
  $$SELECT update_table_section_v1((SELECT id FROM table_sections WHERE name = 'Bar Corner'), '', 5, true)$$,
  'P0001', NULL, 'empty section name rejected');

-- 5c: deactivate section holding active table -> P0001 section_in_use
SELECT throws_ok(
  $$SELECT update_table_section_v1((SELECT id FROM table_sections WHERE name = 'Bar Corner'), 'Bar Corner', 5, false)$$,
  'P0001', NULL, 'deactivate section with active table rejected');

-- 5d: rename section -> lives_ok, then verify persistence
SELECT lives_ok(
  $$SELECT update_table_section_v1((SELECT id FROM table_sections WHERE name = 'Bar Corner'), 'Bar Corner 2', 5, true)$$,
  'rename section Bar Corner to Bar Corner 2');
SELECT is(
  (SELECT name FROM table_sections WHERE name = 'Bar Corner 2'),
  'Bar Corner 2', 'section rename persisted');

-- 6: invalid seats -> P0001 invalid_seats
SELECT throws_ok(
  $$SELECT create_restaurant_table_v1('T-98', 0, (SELECT id FROM table_sections WHERE name = 'Bar Corner 2'), 1)$$,
  'P0001', NULL, 'seats=0 rejected');

-- 7: nonexistent section -> P0001 section_not_found
SELECT throws_ok(
  $$SELECT create_restaurant_table_v1('T-97', 2, gen_random_uuid(), 1)$$,
  'P0001', NULL, 'nonexistent section rejected');

-- 8: occupied-table guard — seed a live dine_in order on T-99, then attempt rename.
DO $seed_order$
DECLARE v_admin_profile UUID; v_session UUID;
BEGIN
  SELECT id INTO v_admin_profile FROM user_profiles WHERE employee_code = 'EMP000' LIMIT 1;
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_admin_profile, 0, 'closed') RETURNING id INTO v_session;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_via, session_id, table_number)
    VALUES ('#S75FP1', 'dine_in', 'pending_payment', 0, 0, 0, 'pos', v_session, 'T-99');
END $seed_order$;

SELECT throws_ok(
  $$SELECT update_restaurant_table_v1((SELECT id FROM restaurant_tables WHERE name = 'T-99'),
      'T-99-renamed', 4, (SELECT id FROM table_sections WHERE name = 'Bar Corner 2'), 1, true)$$,
  'P0001', NULL, 'rename of occupied table rejected');

-- 9: deactivate occupied table -> P0001 table_occupied
SELECT throws_ok(
  $$SELECT update_restaurant_table_v1((SELECT id FROM restaurant_tables WHERE name = 'T-99'),
      'T-99', 4, (SELECT id FROM table_sections WHERE name = 'Bar Corner 2'), 1, false)$$,
  'P0001', NULL, 'deactivate of occupied table rejected');

-- 10: complete the order, then rename succeeds
UPDATE orders SET status = 'completed' WHERE table_number = 'T-99' AND order_number = '#S75FP1';

SELECT lives_ok(
  $$SELECT update_restaurant_table_v1((SELECT id FROM restaurant_tables WHERE name = 'T-99'),
      'T-99-renamed', 4, (SELECT id FROM table_sections WHERE name = 'Bar Corner 2'), 1, true)$$,
  'rename succeeds once order is completed');

-- 11: delete section holding an active table -> P0001 section_in_use
SELECT throws_ok(
  $$SELECT delete_table_section_v1((SELECT id FROM table_sections WHERE name = 'Bar Corner 2'))$$,
  'P0001', NULL, 'delete section in use rejected');

-- 12: soft-delete the table (no live order references its current name).
SELECT lives_ok(
  $$SELECT delete_restaurant_table_v1((SELECT id FROM restaurant_tables WHERE name = 'T-99-renamed'))$$,
  'delete table T-99-renamed (soft)');
SELECT isnt(
  (SELECT deleted_at FROM restaurant_tables WHERE name = 'T-99-renamed'),
  NULL, 'table soft-deleted (deleted_at set)');

-- 13: re-delete is idempotent (no-op, no error)
SELECT lives_ok(
  $$SELECT delete_restaurant_table_v1((SELECT id FROM restaurant_tables WHERE name = 'T-99-renamed'))$$,
  're-delete table is a no-op');

-- 14: audit trail — table.created was logged
SELECT ok(
  (SELECT count(*) FROM audit_logs WHERE action = 'table.created') >= 1,
  'table.created audit row exists');

-- 15: RLS — legacy S11 direct-write policies were dropped
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'restaurant_tables'
       AND policyname IN ('perm_create', 'perm_update')),
  0, 'legacy perm_create/perm_update policies dropped');

-- 16: anon cannot execute the RPC (S20 defense-in-depth)
SELECT is(
  has_function_privilege('anon', 'create_restaurant_table_v1(text,int,uuid,int)', 'EXECUTE'),
  false, 'anon cannot create table');

-- 17/18: read-RLS shape (DEV-S75-01, migration _162) — inactive tables stay
-- readable (BO Inactive badge), soft-deleted sections are hidden at row level.
SELECT ok(
  (SELECT qual FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'restaurant_tables'
       AND policyname = 'auth_read') NOT LIKE '%is_active%',
  'restaurant_tables auth_read no longer filters is_active');
SELECT ok(
  (SELECT qual FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'table_sections'
       AND policyname = 'auth_read') LIKE '%deleted_at%',
  'table_sections auth_read hides soft-deleted rows');

SELECT * FROM finish();
ROLLBACK;
