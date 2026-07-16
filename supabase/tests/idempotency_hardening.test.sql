-- supabase/tests/idempotency_hardening.test.sql
-- Session 25 — Phase 2.A.1 — pgTAP coverage for idempotency hardening.
-- Session 59 (17 D1.1) — bumped to create_tablet_order_v4 (+p_notes); v2 dropped.
--
-- Covers Session 25 / Phase 1.A migrations 20260602000010..012 and Session 59
-- migrations 20260710000103..104 :
--   - tablet_order_idempotency_keys table + RLS + grants
--   - create_tablet_order_v4 (idempotent replay via p_client_uuid ; +p_notes -> orders.notes)
--   - v1 create_tablet_order AND v2 create_tablet_order_v2 both dropped (D14 monotonic versioning)
--   - refund_order_rpc_v2 idempotency_key replay (already shipped S13/000014,
--     but re-exercised here in the hardening suite for regression).
--
-- T1  create_tablet_order_v4 first call with a fresh client_uuid → succeeds, returns UUID order_id
-- T2  create_tablet_order_v4 same p_client_uuid second call → returns SAME order_id,
--     1 row in orders, 1 row in tablet_order_idempotency_keys
-- T3  v1 create_tablet_order is dropped (hasnt_function)
-- T4  refund_order_rpc_v2 first call with a fresh p_idempotency_key → succeeds,
--     idempotent_replay missing/false
-- T5  refund_order_rpc_v2 same p_idempotency_key second call → returns same response
--     with idempotent_replay=true, no new stock_movements (same refund_id, same stock impact)
-- T6  tablet_order_idempotency_keys REVOKE — anon has NO SELECT privilege
-- T7  tablet_order_idempotency_keys policy — authenticated HAS SELECT privilege
-- T8  create_tablet_order_v4 EXECUTE REVOKE — anon has NO EXECUTE privilege
-- T9  v2 create_tablet_order_v2 is dropped (hasnt_function, S59 bump)
-- T10 create_tablet_order_v4 with p_notes writes orders.notes verbatim
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap extension is pre-created
-- on V3 dev (ikcyvlovptebroadgtvd).
--
-- Fixture shortcut : the paid order needed by T4/T5 is constructed via direct INSERTs
-- (orders / order_items / order_payments) bypassing complete_order_with_payment_v9.
-- This is acceptable because there is NO trigger on orders that auto-emits a JE on
-- status='paid' insert (the JE is emitted inline by the RPC itself, not by a trigger),
-- and the refund-side stock_movements (the focus of T5) are emitted unconditionally
-- by refund_order_rpc_v2 itself. The shortcut is reverted by ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- Bootstrap fixtures
-- ---------------------------------------------------------------------------

-- Test product (cloud-safe id, non-colliding with other tests)
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-000000000025'::uuid,
  'PGTAP-IDEMP-PROD', 'pgTAP Idempotency Product',
  (SELECT id FROM categories LIMIT 1),
  20000, 100.000, 0
) ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock = 100.000
 WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000025';

-- Resolve seed user uids + profile ids (EMP000 SUPER_ADMIN, EMP001 CASHIER, EMP003 MANAGER).
-- Stored in GUCs so the per-test DO blocks can read them via current_setting().
DO $bootstrap$
DECLARE
  v_admin_uid     UUID;
  v_admin_pid     UUID;
  v_cashier_uid   UUID;
  v_cashier_pid   UUID;
  v_manager_pid   UUID;
  v_session_id    UUID := 'aaaaaaaa-bbbb-cccc-dddd-000000005555'::uuid;
  v_order_id      UUID := 'aaaaaaaa-bbbb-cccc-dddd-000000004444'::uuid;
  v_order_item_id UUID := 'aaaaaaaa-bbbb-cccc-dddd-000000003333'::uuid;
BEGIN
  SELECT auth_user_id, id INTO v_admin_uid, v_admin_pid
    FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 (SUPER_ADMIN) not found';
  END IF;

  SELECT auth_user_id, id INTO v_cashier_uid, v_cashier_pid
    FROM user_profiles WHERE employee_code = 'EMP001';
  IF v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP001 (CASHIER) not found';
  END IF;

  SELECT id INTO v_manager_pid
    FROM user_profiles WHERE employee_code = 'EMP003';
  IF v_manager_pid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP003 (MANAGER) not found';
  END IF;

  PERFORM set_config('breakery.admin_uid',   v_admin_uid::text,   false);
  PERFORM set_config('breakery.admin_pid',   v_admin_pid::text,   false);
  PERFORM set_config('breakery.cashier_uid', v_cashier_uid::text, false);
  PERFORM set_config('breakery.cashier_pid', v_cashier_pid::text, false);
  PERFORM set_config('breakery.manager_pid', v_manager_pid::text, false);
  PERFORM set_config('breakery.session_id',  v_session_id::text,  false);
  PERFORM set_config('breakery.order_id',    v_order_id::text,    false);
  PERFORM set_config('breakery.order_item_id', v_order_item_id::text, false);

  -- Close any pre-existing open session for EMP001 so we can deterministically
  -- create a fresh one owned by EMP001 (one_open_session_per_user EXCLUDE constraint).
  -- This UPDATE is rolled back by ROLLBACK at end of file.
  UPDATE pos_sessions
     SET status = 'closed', closed_at = now(), closed_by = v_cashier_pid,
         closing_cash = 0
   WHERE opened_by = v_cashier_pid AND status = 'open';

  -- Fresh open session for EMP001 (the refund caller).
  INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status)
    VALUES (v_session_id, v_cashier_pid, now(), 0, 'open');

  -- Fresh PAID order on that session, with 1 item + 1 payment.
  -- subtotal/tax/total simple : line 2 × 20000 = 40000 ; tax_amount 0 ; total 40000.
  INSERT INTO orders (
    id, order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, paid_at
  ) VALUES (
    v_order_id,
    'PGTAP-IDEMP-' || substr(v_order_id::text, 1, 8),
    v_session_id, v_cashier_pid, 'dine_in', 'paid',
    40000, 0, 40000, now()
  );

  INSERT INTO order_items (
    id, order_id, product_id, name_snapshot, unit_price, quantity, line_total
  ) VALUES (
    v_order_item_id, v_order_id,
    'aaaaaaaa-bbbb-cccc-dddd-000000000025'::uuid,
    'pgTAP Idempotency Product',
    20000, 2.000, 40000
  );

  INSERT INTO order_payments (order_id, method, amount, paid_at)
    VALUES (v_order_id, 'cash'::payment_method, 40000, now());
END $bootstrap$;

-- Helper for tests that need to spoof auth.uid() inside SECURITY DEFINER calls.
CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
END $$;

-- ===========================================================================
-- T1 — create_tablet_order_v4 first call with a fresh client_uuid succeeds
-- ===========================================================================
DO $t1$
DECLARE
  v_admin_uid  UUID := current_setting('breakery.admin_uid')::uuid;
  v_admin_pid  UUID := current_setting('breakery.admin_pid')::uuid;
  v_client     UUID := 'fefefefe-0000-0000-0000-000000000001'::uuid;
  v_order_id   UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);

  v_order_id := create_tablet_order_v4(
    p_client_uuid  => v_client,
    p_waiter_id    => v_admin_pid,
    p_table_number => 'T-T1',
    p_order_type   => 'dine_in'::order_type,
    p_items        => jsonb_build_array(jsonb_build_object(
      'product_id', 'aaaaaaaa-bbbb-cccc-dddd-000000000025'::uuid,
      'quantity',   1,
      'unit_price', 20000
    ))
  );

  PERFORM set_config('breakery.t1_pass',
    CASE WHEN v_order_id IS NOT NULL THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t1_client', v_client::text, false);
  PERFORM set_config('breakery.t1_order_id', v_order_id::text, false);
END $t1$;
SELECT ok(current_setting('breakery.t1_pass')::boolean,
  'T1: create_tablet_order_v4 first call with fresh client_uuid returns a UUID order_id');

-- ===========================================================================
-- T2 — create_tablet_order_v4 same p_client_uuid second call → replay
-- ===========================================================================
DO $t2$
DECLARE
  v_admin_uid     UUID := current_setting('breakery.admin_uid')::uuid;
  v_admin_pid     UUID := current_setting('breakery.admin_pid')::uuid;
  v_client        UUID := current_setting('breakery.t1_client')::uuid;
  v_order_id_1    UUID := current_setting('breakery.t1_order_id')::uuid;
  v_order_id_2    UUID;
  v_orders_count  INT;
  v_keys_count    INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);

  -- Second call with the SAME p_client_uuid → must return same order_id.
  v_order_id_2 := create_tablet_order_v4(
    p_client_uuid  => v_client,
    p_waiter_id    => v_admin_pid,
    p_table_number => 'T-T2',  -- different on purpose; replay must ignore the new args
    p_order_type   => 'dine_in'::order_type,
    p_items        => jsonb_build_array(jsonb_build_object(
      'product_id', 'aaaaaaaa-bbbb-cccc-dddd-000000000025'::uuid,
      'quantity',   5,
      'unit_price', 20000
    ))
  );

  SELECT COUNT(*) INTO v_orders_count
    FROM orders WHERE id = v_order_id_1;
  SELECT COUNT(*) INTO v_keys_count
    FROM tablet_order_idempotency_keys WHERE client_uuid = v_client;

  PERFORM set_config('breakery.t2_pass',
    CASE WHEN
      v_order_id_2 = v_order_id_1
      AND v_orders_count = 1
      AND v_keys_count = 1
    THEN 'true' ELSE 'false' END, false);
END $t2$;
SELECT ok(current_setting('breakery.t2_pass')::boolean,
  'T2: create_tablet_order_v4 replay returns same order_id, 1 orders row, 1 idempotency_keys row');

-- ===========================================================================
-- T3 — create_tablet_order v1 dropped (D14 monotonic versioning)
-- ===========================================================================
SELECT hasnt_function(
  'public', 'create_tablet_order',
  'T3: create_tablet_order v1 is dropped'
);

-- ===========================================================================
-- T4 — refund_order_rpc_v2 first call with fresh p_idempotency_key succeeds
-- ===========================================================================
DO $t4$
DECLARE
  v_cashier_uid UUID := current_setting('breakery.cashier_uid')::uuid;
  v_manager_pid UUID := current_setting('breakery.manager_pid')::uuid;
  v_order_id    UUID := current_setting('breakery.order_id')::uuid;
  v_oi_id       UUID := current_setting('breakery.order_item_id')::uuid;
  v_idemp_key   UUID := 'fefefefe-0000-0000-0000-000000000004'::uuid;
  v_result      JSONB;
  v_replay      BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_cashier_uid);

  v_result := refund_order_rpc_v5(
    p_order_id            => v_order_id,
    p_lines               => jsonb_build_array(jsonb_build_object(
      'order_item_id', v_oi_id,
      'qty',           1
    )),
    p_tenders             => jsonb_build_array(jsonb_build_object(
      'method', 'cash',
      'amount', 20000
    )),
    p_reason              => 'T4 first refund call',
    p_authorized_by       => v_manager_pid,
    p_idempotency_key     => v_idemp_key,
    p_acting_auth_user_id => v_cashier_uid
  );

  v_replay := COALESCE((v_result->>'idempotent_replay')::boolean, false);

  PERFORM set_config('breakery.t4_pass',
    CASE WHEN
      (v_result->>'refund_id') IS NOT NULL
      AND (v_result->>'total_refunded')::numeric = 20000
      AND v_replay = FALSE
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t4_refund_id', v_result->>'refund_id', false);
  PERFORM set_config('breakery.t4_idemp_key', v_idemp_key::text, false);
END $t4$;
SELECT ok(current_setting('breakery.t4_pass')::boolean,
  'T4: refund_order_rpc_v2 first call with fresh idempotency_key succeeds with idempotent_replay=false');

-- ===========================================================================
-- T5 — refund_order_rpc_v2 same p_idempotency_key second call → idempotent_replay=true,
-- no new stock_movements
-- ===========================================================================
DO $t5$
DECLARE
  v_cashier_uid     UUID := current_setting('breakery.cashier_uid')::uuid;
  v_manager_pid     UUID := current_setting('breakery.manager_pid')::uuid;
  v_order_id        UUID := current_setting('breakery.order_id')::uuid;
  v_oi_id           UUID := current_setting('breakery.order_item_id')::uuid;
  v_idemp_key       UUID := current_setting('breakery.t4_idemp_key')::uuid;
  v_refund_id_1     UUID := current_setting('breakery.t4_refund_id')::uuid;
  v_result          JSONB;
  v_refund_id_2     UUID;
  v_replay          BOOLEAN;
  v_mvts_before     INT;
  v_mvts_after      INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_cashier_uid);

  SELECT COUNT(*) INTO v_mvts_before
    FROM stock_movements
    WHERE reference_type = 'refunds' AND reference_id = v_refund_id_1;

  -- Replay : same idempotency_key, identical args (the RPC short-circuits before
  -- touching refunds / refund_lines / stock_movements).
  v_result := refund_order_rpc_v5(
    p_order_id            => v_order_id,
    p_lines               => jsonb_build_array(jsonb_build_object(
      'order_item_id', v_oi_id,
      'qty',           1
    )),
    p_tenders             => jsonb_build_array(jsonb_build_object(
      'method', 'cash',
      'amount', 20000
    )),
    p_reason              => 'T5 replay (should be ignored)',
    p_authorized_by       => v_manager_pid,
    p_idempotency_key     => v_idemp_key,
    p_acting_auth_user_id => v_cashier_uid
  );

  v_refund_id_2 := (v_result->>'refund_id')::uuid;
  v_replay      := COALESCE((v_result->>'idempotent_replay')::boolean, false);

  SELECT COUNT(*) INTO v_mvts_after
    FROM stock_movements
    WHERE reference_type = 'refunds' AND reference_id = v_refund_id_1;

  PERFORM set_config('breakery.t5_pass',
    CASE WHEN
      v_refund_id_2 = v_refund_id_1
      AND v_replay = TRUE
      AND v_mvts_after = v_mvts_before
    THEN 'true' ELSE 'false' END, false);
END $t5$;
SELECT ok(current_setting('breakery.t5_pass')::boolean,
  'T5: refund_order_rpc_v2 replay returns same refund_id + idempotent_replay=true + no new stock_movements');

-- ===========================================================================
-- T6 — tablet_order_idempotency_keys: anon has NO SELECT privilege
-- ===========================================================================
SELECT ok(
  NOT has_table_privilege('anon', 'public.tablet_order_idempotency_keys', 'SELECT'),
  'T6: anon has NO SELECT privilege on tablet_order_idempotency_keys'
);

-- ===========================================================================
-- T7 — tablet_order_idempotency_keys: authenticated HAS SELECT privilege
-- ===========================================================================
SELECT ok(
  has_table_privilege('authenticated', 'public.tablet_order_idempotency_keys', 'SELECT'),
  'T7: authenticated HAS SELECT privilege on tablet_order_idempotency_keys'
);

-- ===========================================================================
-- T8 — create_tablet_order_v4 EXECUTE REVOKE: anon has NO EXECUTE
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.create_tablet_order_v4(uuid, uuid, text, order_type, jsonb, text)',
    'EXECUTE'
  ),
  'T8: anon has NO EXECUTE privilege on create_tablet_order_v4'
);

-- ===========================================================================
-- T9 — create_tablet_order_v2 dropped (S59 bump to v3)
-- ===========================================================================
SELECT hasnt_function(
  'public', 'create_tablet_order_v2',
  'T9: create_tablet_order_v2 is dropped (only create_tablet_order_v4 remains)'
);

-- ===========================================================================
-- T10 — create_tablet_order_v4 with p_notes writes orders.notes verbatim
-- (Session 59, 17 D1.1 — order-level free-text note surfaced on KDS + pickup)
-- ===========================================================================
DO $t10$
DECLARE
  v_admin_uid  UUID := current_setting('breakery.admin_uid')::uuid;
  v_admin_pid  UUID := current_setting('breakery.admin_pid')::uuid;
  v_client     UUID := 'fefefefe-0000-0000-0000-000000000010'::uuid;
  v_note       TEXT := 'No gluten — nut allergy';
  v_order_id   UUID;
  v_db_notes   TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);

  v_order_id := create_tablet_order_v4(
    p_client_uuid  => v_client,
    p_waiter_id    => v_admin_pid,
    p_table_number => 'T-T10',
    p_order_type   => 'dine_in'::order_type,
    p_items        => jsonb_build_array(jsonb_build_object(
      'product_id', 'aaaaaaaa-bbbb-cccc-dddd-000000000025'::uuid,
      'quantity',   1,
      'unit_price', 20000
    )),
    p_notes        => v_note
  );

  SELECT notes INTO v_db_notes FROM orders WHERE id = v_order_id;

  PERFORM set_config('breakery.t10_pass',
    CASE WHEN v_db_notes = v_note THEN 'true' ELSE 'false' END, false);
END $t10$;
SELECT ok(current_setting('breakery.t10_pass')::boolean,
  'T10: create_tablet_order_v4 writes p_notes verbatim to orders.notes');

SELECT * FROM finish();
ROLLBACK;
