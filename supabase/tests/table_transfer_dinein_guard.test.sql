-- supabase/tests/table_transfer_dinein_guard.test.sql
-- Fiche 02 D2.5 — transfer_order_table_v1 (_121) + gardes fire_counter_order_v4 (_122) :
-- table obligatoire à la création dine-in, audit order.fire_appended sur append,
-- audit order.table_transfer sur transfert.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_profile UUID; v_session UUID; v_cat UUID; v_prod UUID;
  v_o1 UUID; v_o3 UUID; v_o6 UUID;
BEGIN
  -- Acteur déjà seedé porteur de pos.sale.create (cashier/waiter/manager/admin).
  SELECT up.auth_user_id, up.id INTO v_auth, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_profile, 0, 'closed') RETURNING id INTO v_session;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-D25-TRF', 'D25 Transfer Item', v_cat, 30000, 10000, 'pcs', 100)
    RETURNING id INTO v_prod;

  -- Tables de test (noms préfixés, uniques vs seeds T-01..VIP).
  INSERT INTO restaurant_tables (name, seats, sort_order, is_active)
    VALUES ('TST-TRF-A', 2, 90, true), ('TST-TRF-B', 2, 91, true);
  INSERT INTO restaurant_tables (name, seats, sort_order, is_active)
    VALUES ('TST-TRF-X', 2, 92, false);

  -- T1/T2/T4/T5 : commande active sur TST-TRF-A.
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_via, session_id, table_number)
    VALUES ('#D25T1', 'dine_in', 'pending_payment', 0, 0, 0, 'pos', v_session, 'TST-TRF-A')
    RETURNING id INTO v_o1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o1, v_prod, 'D25 Transfer Item', 30000, 1, 30000);

  -- T3 : commande voided (non transférable). chk_orders_void_consistency exige
  -- le trio voided_at/voided_by/void_reason sur status='voided'.
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_via, session_id, table_number,
                      voided_at, voided_by, void_reason)
    VALUES ('#D25T3', 'dine_in', 'voided', 0, 0, 0, 'pos', v_session, 'TST-TRF-A',
            now(), v_profile, 'D25 test void')
    RETURNING id INTO v_o3;

  -- T6 : commande active SANS table (from NULL → pose de table = transfert valide).
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_via, session_id)
    VALUES ('#D25T6', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session)
    RETURNING id INTO v_o6;

  PERFORM set_config('d25.session', v_session::text, true);
  PERFORM set_config('d25.prod', v_prod::text, true);
  PERFORM set_config('d25.o1', v_o1::text, true);
  PERFORM set_config('d25.o3', v_o3::text, true);
  PERFORM set_config('d25.o6', v_o6::text, true);
END $$;

-- T1 : transfert heureux A→B — row mise à jour + audit order.table_transfer {from,to}.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := transfer_order_table_v1(current_setting('d25.o1')::uuid, 'TST-TRF-B');
  INSERT INTO _r VALUES ('t1_envelope',
        (v_res->>'from_table') = 'TST-TRF-A' AND (v_res->>'to_table') = 'TST-TRF-B'
    AND (v_res->>'noop')::boolean = false);
  INSERT INTO _r VALUES ('t1_row',
        (SELECT table_number FROM orders WHERE id = current_setting('d25.o1')::uuid) = 'TST-TRF-B');
  INSERT INTO _r VALUES ('t1_audit', EXISTS (
        SELECT 1 FROM audit_logs
         WHERE action = 'order.table_transfer'
           AND entity_type = 'orders'
           AND entity_id = current_setting('d25.o1')::uuid
           AND metadata->>'from_table' = 'TST-TRF-A'
           AND metadata->>'to_table' = 'TST-TRF-B'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_envelope', false);
  INSERT INTO _r VALUES ('t1_row', false);
  INSERT INTO _r VALUES ('t1_audit', false);
END $$;

-- T2 : table inconnue → P0002 table_not_found.
DO $$ BEGIN
  PERFORM transfer_order_table_v1(current_setting('d25.o1')::uuid, 'NO-SUCH-TABLE');
  INSERT INTO _r VALUES ('t2_unknown_table', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t2_unknown_table', SQLERRM LIKE 'table_not_found%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_unknown_table', false);
END $$;

-- T3 : commande voided → P0001 order_not_transferable.
DO $$ BEGIN
  PERFORM transfer_order_table_v1(current_setting('d25.o3')::uuid, 'TST-TRF-B');
  INSERT INTO _r VALUES ('t3_voided', false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  INSERT INTO _r VALUES ('t3_voided', SQLERRM LIKE 'order_not_transferable%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_voided', false);
END $$;

-- T4 : même table → noop=true, AUCUNE ligne d'audit supplémentaire.
DO $$ DECLARE v_res JSONB; v_before INT; v_after INT; BEGIN
  SELECT count(*) INTO v_before FROM audit_logs
   WHERE action = 'order.table_transfer' AND entity_id = current_setting('d25.o1')::uuid;
  v_res := transfer_order_table_v1(current_setting('d25.o1')::uuid, 'TST-TRF-B');
  SELECT count(*) INTO v_after FROM audit_logs
   WHERE action = 'order.table_transfer' AND entity_id = current_setting('d25.o1')::uuid;
  INSERT INTO _r VALUES ('t4_noop', (v_res->>'noop')::boolean = true AND v_after = v_before);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_noop', false);
END $$;

-- T5 : table inactive → P0002 table_not_found.
DO $$ BEGIN
  PERFORM transfer_order_table_v1(current_setting('d25.o1')::uuid, 'TST-TRF-X');
  INSERT INTO _r VALUES ('t5_inactive_table', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t5_inactive_table', SQLERRM LIKE 'table_not_found%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_inactive_table', false);
END $$;

-- T6 : from NULL (commande sans table) → transfert valide, from_table absent/null.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := transfer_order_table_v1(current_setting('d25.o6')::uuid, 'TST-TRF-A');
  INSERT INTO _r VALUES ('t6_from_null',
        (v_res->'from_table') = 'null'::jsonb AND (v_res->>'to_table') = 'TST-TRF-A'
    AND (SELECT table_number FROM orders WHERE id = current_setting('d25.o6')::uuid) = 'TST-TRF-A');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_from_null', false);
END $$;

-- T7 : fire v4 CRÉATION dine_in SANS table → P0011 table_required_for_dine_in.
DO $$ BEGIN
  PERFORM fire_counter_order_v4(
    gen_random_uuid(), current_setting('d25.session')::uuid,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('d25.prod'), 'quantity', 1, 'unit_price', 30000)),
    NULL, NULL, 'dine_in'::order_type, NULL);
  INSERT INTO _r VALUES ('t7_dinein_no_table', false);
EXCEPTION WHEN SQLSTATE 'P0011' THEN
  INSERT INTO _r VALUES ('t7_dinein_no_table', SQLERRM = 'table_required_for_dine_in');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_dinein_no_table', false);
END $$;

-- T8 : fire v4 CRÉATION dine_in AVEC table → OK, table posée sur la commande.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := fire_counter_order_v4(
    gen_random_uuid(), current_setting('d25.session')::uuid,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('d25.prod'), 'quantity', 1, 'unit_price', 30000)),
    NULL, 'TST-TRF-A', 'dine_in'::order_type, NULL);
  PERFORM set_config('d25.o8', v_res->>'order_id', true);
  INSERT INTO _r VALUES ('t8_dinein_with_table',
        (v_res->>'idempotent_replay')::boolean = false
    AND (SELECT table_number FROM orders WHERE id = (v_res->>'order_id')::uuid) = 'TST-TRF-A');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_dinein_with_table', false);
END $$;

-- T9 : fire v4 take_out sans table → toujours accepté (non-régression).
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := fire_counter_order_v4(
    gen_random_uuid(), current_setting('d25.session')::uuid,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('d25.prod'), 'quantity', 1, 'unit_price', 30000)),
    NULL, NULL, 'take_out'::order_type, NULL);
  INSERT INTO _r VALUES ('t9_takeout_ok', (v_res->>'order_id') IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t9_takeout_ok', false);
END $$;

-- T10 : fire v4 APPEND (p_order_id de T8) → audit order.fire_appended écrit
--       (le « adding order » du KOT devient un fait DB), et pas de re-garde table.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := fire_counter_order_v4(
    gen_random_uuid(), current_setting('d25.session')::uuid,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('d25.prod'), 'quantity', 2, 'unit_price', 30000)),
    current_setting('d25.o8')::uuid, NULL, 'dine_in'::order_type, NULL);
  INSERT INTO _r VALUES ('t10_append_audit',
        (v_res->>'order_id')::uuid = current_setting('d25.o8')::uuid
    AND EXISTS (
        SELECT 1 FROM audit_logs
         WHERE action = 'order.fire_appended'
           AND entity_type = 'orders'
           AND entity_id = current_setting('d25.o8')::uuid
           AND (metadata->>'items_count')::int = 1
           AND metadata->>'table_number' = 'TST-TRF-A'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t10_append_audit', false);
END $$;

-- T11 : ACL — anon ne peut PAS exécuter transfer_order_table_v1 (trio S20).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t11_anon_acl',
        NOT has_function_privilege('anon', 'public.transfer_order_table_v1(uuid, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.transfer_order_table_v1(uuid, text)', 'EXECUTE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t11_anon_acl', false);
END $$;

SELECT plan(12);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_envelope') AND (SELECT pass FROM _r WHERE name='t1_row'),
                            'T1: transfer A->B updates orders.table_number + envelope from/to');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_audit'),        'T1b: audit_logs order.table_transfer {from,to} written');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_unknown_table'),'T2: unknown destination raises P0002 table_not_found');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_voided'),       'T3: voided order raises P0001 order_not_transferable');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_noop'),         'T4: same-table transfer is a noop with no extra audit row');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_inactive_table'),'T5: inactive destination raises P0002 table_not_found');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_from_null'),    'T6: order with no table gets one (from_table null)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_dinein_no_table'),'T7: fire v4 dine_in creation without table raises P0011 table_required_for_dine_in');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_dinein_with_table'),'T8: fire v4 dine_in creation with table succeeds and posts it');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t9_takeout_ok'),   'T9: fire v4 take_out without table still accepted (no regression)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t10_append_audit'),'T10: append fire writes audit order.fire_appended (adding-order is a DB fact)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t11_anon_acl'),    'T11: anon blocked / authenticated granted on transfer_order_table_v1');
SELECT * FROM finish();
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
ROLLBACK;
