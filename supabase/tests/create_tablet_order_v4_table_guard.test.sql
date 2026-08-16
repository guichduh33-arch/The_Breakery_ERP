-- supabase/tests/create_tablet_order_v4_table_guard.test.sql
-- S72 — POS audit P1: the tablet order path could fire a dine_in order with a
-- blank table_number (the owner "table mandatory for dine-in" rule was enforced
-- only on the counter path). The guard mirrors fire_counter_order's.
--   T1 : dine_in + blank table  -> P0011 table_required_for_dine_in
--   T2 : dine_in + valid table  -> creates order
--   T3 : take_out + blank table -> creates order (no table needed)
--   T4 : les versions précédentes sont droppées (versionnage monotone)
-- Lot 1.B (2026-08-03) — repointé v4 -> v5 : v4 était droppée depuis le bump
-- « tournée supplémentaire » (p_order_id), et les trois gardes tombaient en
-- « function does not exist » sans que personne ne le voie hors run nocturne.
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
  -- ADR-022 dec. 1 : la garde de vendabilite est active sur cette RPC, le fixture doit choisir un produit vendable de facon deterministe.
  SELECT p.id INTO v_prod FROM products p
   WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
     AND p.product_type <> 'combo'
     AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
   LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;
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
  format('SELECT create_tablet_order_v7(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), '', 'dine_in', current_setting('s72.items')),
  'P0011', 'table_required_for_dine_in',
  'T1: dine_in + blank table -> P0011 table_required_for_dine_in');

SELECT lives_ok(
  format('SELECT create_tablet_order_v7(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), current_setting('s72.tbl'), 'dine_in', current_setting('s72.items')),
  'T2: dine_in + valid table -> creates order');

SELECT lives_ok(
  format('SELECT create_tablet_order_v7(%L::uuid, %L::uuid, %L, %L::order_type, %L::jsonb)',
    gen_random_uuid(), current_setting('s72.prof'), '', 'take_out', current_setting('s72.items')),
  'T3: take_out + blank table -> creates order (no table needed)');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('create_tablet_order_v3','create_tablet_order_v4','create_tablet_order_v5')),
  0, 'T4: les versions précédentes de create_tablet_order sont droppées');

SELECT * FROM finish();
ROLLBACK;
