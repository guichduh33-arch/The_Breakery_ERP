-- supabase/tests/retail_tab_credit_gate.test.sql
-- S62 — attach_tab_customer_v1 (customers.retail_credit_limit gate).
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_profile UUID; v_session UUID; v_cat UUID; v_prod UUID;
  v_c1 UUID; v_c2 UUID; v_c3 UUID; v_c4 UUID; v_c5 UUID; v_c6 UUID;
  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o4a UUID; v_o4b UUID; v_o5 UUID; v_o6 UUID;
BEGIN
  -- Reuse an already-seeded user with payments.process (cashier/manager/admin) as actor.
  SELECT up.auth_user_id, up.id INTO v_auth, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- A 'pos' order always requires session_id (CHECK orders_session_id_required_for_pos)
  -- unless order_type='b2b' / created_via='tablet' / is_held=true — none apply here.
  -- status='closed' sidesteps the one-open-session-per-user EXCLUDE constraint (the RPC
  -- under test never reads pos_sessions, so the status value itself is irrelevant).
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_profile, 0, 'closed') RETURNING id INTO v_session;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-S62-TAB', 'S62 Tab Item', v_cat, 50000, 20000, 'pcs', 100)
    RETURNING id INTO v_prod;

  -- ── Customers ────────────────────────────────────────────────────────────
  INSERT INTO customers (name, customer_type, retail_credit_limit)
    VALUES ('S62 Tab C1 (T1/T7/T8)', 'retail', 100000) RETURNING id INTO v_c1;
  INSERT INTO customers (name, customer_type, retail_credit_limit)
    VALUES ('S62 Tab C2 (T2)', 'retail', 50000) RETURNING id INTO v_c2;
  INSERT INTO customers (name, customer_type, retail_credit_limit)
    VALUES ('S62 Tab C3 (T3, unlimited)', 'retail', NULL) RETURNING id INTO v_c3;
  INSERT INTO customers (name, customer_type, retail_credit_limit)
    VALUES ('S62 Tab C4 (T4)', 'retail', 100000) RETURNING id INTO v_c4;
  INSERT INTO customers (name, customer_type, retail_credit_limit)
    VALUES ('S62 Tab C5 (T5)', 'retail', 100000) RETURNING id INTO v_c5;
  INSERT INTO customers (name, customer_type, retail_credit_limit, deleted_at)
    VALUES ('S62 Tab C6 (T6, inactive)', 'retail', 100000, now()) RETURNING id INTO v_c6;

  -- ── T1: fired counter order, 50 000, under a 100 000 cap ────────────────
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T1', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session) RETURNING id INTO v_o1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o1, v_prod, 'S62 Tab Item', 50000, 1, 50000);

  -- ── T2: fired counter order, 100 000, over a 50 000 cap (no prior debt) ─
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T2', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session) RETURNING id INTO v_o2;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o2, v_prod, 'S62 Tab Item', 50000, 2, 100000);

  -- ── T3: fired counter order, huge total (still within orders.total's
  --        DECIMAL(12,2) precision), unlimited cap ────────────────────────
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T3', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session) RETURNING id INTO v_o3;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o3, v_prod, 'S62 Tab Item', 50000, 100000, 5000000000);

  -- ── T4: existing 60 000 tab already attached to C4 (unpaid) + a NEW
  --        50 000 order being attached now, cap 100 000 -> 60k+50k > 100k.
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, customer_id, session_id)
    VALUES ('#S62T4A', 'take_out', 'pending_payment', 60000, 0, 60000, 'pos', v_c4, v_session) RETURNING id INTO v_o4a;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o4a, v_prod, 'S62 Tab Item', 50000, 1.2, 60000);
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T4B', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session) RETURNING id INTO v_o4b;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o4b, v_prod, 'S62 Tab Item', 50000, 1, 50000);

  -- ── T5: already-paid order -> not attachable regardless of created_via ──
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T5', 'take_out', 'paid', 10000, 0, 10000, 'pos', v_session) RETURNING id INTO v_o5;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o5, v_prod, 'S62 Tab Item', 10000, 1, 10000);

  -- ── T6: fired counter order for the soft-deleted customer C6 ────────────
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id)
    VALUES ('#S62T6', 'take_out', 'pending_payment', 0, 0, 0, 'pos', v_session) RETURNING id INTO v_o6;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o6, v_prod, 'S62 Tab Item', 10000, 1, 10000);

  PERFORM set_config('s62.c1', v_c1::text, true);
  PERFORM set_config('s62.c2', v_c2::text, true);
  PERFORM set_config('s62.c3', v_c3::text, true);
  PERFORM set_config('s62.c4', v_c4::text, true);
  PERFORM set_config('s62.c5', v_c5::text, true);
  PERFORM set_config('s62.c6', v_c6::text, true);
  PERFORM set_config('s62.o1', v_o1::text, true);
  PERFORM set_config('s62.o2', v_o2::text, true);
  PERFORM set_config('s62.o3', v_o3::text, true);
  PERFORM set_config('s62.o4b', v_o4b::text, true);
  PERFORM set_config('s62.o5', v_o5::text, true);
  PERFORM set_config('s62.o6', v_o6::text, true);
END $$;

-- T1: attach OK under the cap -> customer_id + total posted on the order.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := attach_tab_customer_v1(current_setting('s62.o1')::uuid, current_setting('s62.c1')::uuid);
  INSERT INTO _r VALUES ('t1_total',      (v_res->>'total')::numeric = 50000);
  INSERT INTO _r VALUES ('t1_outstanding',(v_res->>'outstanding_before')::numeric = 0);
  INSERT INTO _r VALUES ('t1_order_row',  (SELECT customer_id FROM orders WHERE id = current_setting('s62.o1')::uuid) = current_setting('s62.c1')::uuid
                                       AND (SELECT total FROM orders WHERE id = current_setting('s62.o1')::uuid) = 50000);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_total', false);
  INSERT INTO _r VALUES ('t1_outstanding', false);
  INSERT INTO _r VALUES ('t1_order_row', false);
END $$;

-- T2: attach blocked beyond the cap -> P0011 credit_limit_exceeded.
DO $$ BEGIN
  PERFORM attach_tab_customer_v1(current_setting('s62.o2')::uuid, current_setting('s62.c2')::uuid);
  INSERT INTO _r VALUES ('t2_blocked', false);
EXCEPTION WHEN SQLSTATE 'P0011' THEN
  INSERT INTO _r VALUES ('t2_blocked', SQLERRM LIKE 'credit_limit_exceeded%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_blocked', false);
END $$;

-- T3: NULL cap = unlimited -> attach succeeds even with a huge order.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := attach_tab_customer_v1(current_setting('s62.o3')::uuid, current_setting('s62.c3')::uuid);
  INSERT INTO _r VALUES ('t3_unlimited', (v_res->>'credit_limit') IS NULL AND (v_res->>'total')::numeric = 5000000000);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_unlimited', false);
END $$;

-- T4: existing 60 000 tab + a new 50 000 order, cap 100 000 -> blocked.
DO $$ BEGIN
  PERFORM attach_tab_customer_v1(current_setting('s62.o4b')::uuid, current_setting('s62.c4')::uuid);
  INSERT INTO _r VALUES ('t4_outstanding_counted', false);
EXCEPTION WHEN SQLSTATE 'P0011' THEN
  INSERT INTO _r VALUES ('t4_outstanding_counted', SQLERRM LIKE '%credit_limit_exceeded%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_outstanding_counted', false);
END $$;

-- T5: order already paid -> P0001 order_not_attachable.
DO $$ BEGIN
  PERFORM attach_tab_customer_v1(current_setting('s62.o5')::uuid, current_setting('s62.c5')::uuid);
  INSERT INTO _r VALUES ('t5_not_attachable', false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  INSERT INTO _r VALUES ('t5_not_attachable', SQLERRM LIKE 'order_not_attachable%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_not_attachable', false);
END $$;

-- T6: soft-deleted customer -> P0002 customer_not_found_or_inactive.
DO $$ BEGIN
  PERFORM attach_tab_customer_v1(current_setting('s62.o6')::uuid, current_setting('s62.c6')::uuid);
  INSERT INTO _r VALUES ('t6_inactive', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t6_inactive', SQLERRM = 'customer_not_found_or_inactive');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_inactive', false);
END $$;

-- T7: after T1's attach, the debt shows up in get_pos_b2b_debts_v3 (outstanding = total).
DO $$ DECLARE v_outstanding NUMERIC; BEGIN
  SELECT outstanding INTO v_outstanding
    FROM get_pos_b2b_debts_v3(current_setting('s62.c1')::uuid, 730)
   WHERE order_id = current_setting('s62.o1')::uuid;
  INSERT INTO _r VALUES ('t7_debts_view', v_outstanding = 50000);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_debts_view', false);
END $$;

-- T8: re-attach the same customer to order 1 -> idempotent, same values, no error.
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := attach_tab_customer_v1(current_setting('s62.o1')::uuid, current_setting('s62.c1')::uuid);
  INSERT INTO _r VALUES ('t8_reattach', (v_res->>'total')::numeric = 50000
                                     AND (v_res->>'customer_id')::uuid = current_setting('s62.c1')::uuid);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_reattach', false);
END $$;

SELECT plan(8);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_total') AND (SELECT pass FROM _r WHERE name='t1_order_row'),
                            'T1: attach under cap posts total=50000 + customer_id on the order row');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_blocked'),     'T2: attach beyond cap raises P0011 credit_limit_exceeded');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_unlimited'),   'T3: NULL cap = unlimited, huge order attaches fine');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_outstanding_counted'), 'T4: existing outstanding counted against the cap (60k+50k>100k)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_not_attachable'), 'T5: paid order raises P0001 order_not_attachable');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_inactive'),    'T6: soft-deleted customer raises P0002 customer_not_found_or_inactive');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_debts_view'),  'T7: attached debt appears in get_pos_b2b_debts_v3 with outstanding=total');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_reattach'),    'T8: re-attaching the same customer is idempotent (no error, same values)');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
