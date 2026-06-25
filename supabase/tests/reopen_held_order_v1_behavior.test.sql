-- supabase/tests/reopen_held_order_v1_behavior.test.sql
-- Spec A, Bloc 2/3 — BEHAVIORAL round-trip for hold_fired_order_v1 +
-- reopen_held_order_v1 under a real authenticated CASHIER context.
--
-- Controller-run only (MCP execute_sql against the V3 dev cloud) — it sets
-- `role authenticated` + a request.jwt.claims sub, which the platform pooler
-- allows for the seeded cashier. Wrapped in BEGIN/ROLLBACK: seeds a fired
-- counter order, exercises the two RPCs, asserts via RAISE EXCEPTION, rolls back.
-- A clean run returns NO rows and NO error (any failed assertion raises).
--
-- Complements the ACL/signature pgTAP (reopen_held_order_v1.test.sql) and the
-- mocked POS smoke (reopen-held-order.smoke.test.tsx). The Vitest live file
-- supabase/tests/functions/reopen-held-order-v1.test.ts stays a skipIf skeleton
-- (no shared PIN-JWT login helper exists); THIS file is the executable proof of
-- the server contract. Append-no-duplicate is a CLIENT invariant (useFireToStations
-- excludes lockedItemIds before the append RPC) covered by the POS smokes.
BEGIN;

DO $seed$
DECLARE
  v_oid     uuid := '11111111-1111-4111-8111-111111111111';
  v_pid     uuid;
  v_session uuid;
BEGIN
  SELECT id INTO v_pid FROM products WHERE is_active LIMIT 1;
  SELECT id INTO v_session FROM pos_sessions LIMIT 1;

  INSERT INTO orders (id, order_number, order_type, status, created_via, session_id,
                      is_held, sent_to_kitchen_at, subtotal, tax_amount, total)
  VALUES (v_oid, '#TST-REOPEN', 'dine_in', 'pending_payment', 'pos', v_session,
          false, now(), 0, 0, 0);

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity,
                           line_total, modifiers, dispatch_station, is_locked,
                           kitchen_status, sent_to_kitchen_at)
  VALUES
   (v_oid, v_pid, 'Latte',    30000, 1, 30000, '[]'::jsonb, 'barista', true, 'pending', now()),
   (v_oid, v_pid, 'Omelette', 45000, 1, 45000, '[]'::jsonb, 'kitchen', true, 'pending', now());
END $seed$;

-- Authenticate as the seeded Test Cashier (stable seed uuid) for the gated RPCs.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

DO $rpc$
DECLARE
  v_oid  uuid := '11111111-1111-4111-8111-111111111111';
  v_env  jsonb;
  v_held boolean;
  v_threw boolean := false;
BEGIN
  -- hold → is_held=true
  PERFORM hold_fired_order_v1(v_oid);
  SELECT is_held INTO v_held FROM orders WHERE id = v_oid;
  IF v_held IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: hold did not set is_held=true'; END IF;

  -- reopen → returns 2 locked items (with order_items.id), claims is_held=false, no delete
  v_env := reopen_held_order_v1(v_oid);
  IF jsonb_array_length(v_env->'items') <> 2 THEN RAISE EXCEPTION 'FAIL: reopen returned % items', jsonb_array_length(v_env->'items'); END IF;
  IF (v_env->'items'->0->>'is_locked')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: reopened item not locked'; END IF;
  IF (v_env->'items'->0->'id') IS NULL THEN RAISE EXCEPTION 'FAIL: reopened item missing order_items.id'; END IF;
  SELECT is_held INTO v_held FROM orders WHERE id = v_oid;
  IF v_held IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: reopen did not claim is_held=false'; END IF;
  IF (SELECT count(*) FROM orders WHERE id = v_oid) <> 1 THEN RAISE EXCEPTION 'FAIL: reopen deleted the order'; END IF;

  -- second reopen on an already-open order → P0002 (concurrency claim)
  BEGIN
    PERFORM reopen_held_order_v1(v_oid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_threw := true;
  END;
  IF NOT v_threw THEN RAISE EXCEPTION 'FAIL: second reopen did not raise P0002'; END IF;

  RAISE NOTICE 'RPC behavior PASS';
END $rpc$;

-- audit_logs has RLS that blocks the authenticated role from SELECT, so assert
-- the trail back as the table owner.
RESET ROLE;
DO $audit$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM audit_logs
   WHERE entity_id = '11111111-1111-4111-8111-111111111111'
     AND action IN ('order.held','order.reopened');
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'FAIL: audit rows = % (expected 2)', v_cnt; END IF;
  RAISE NOTICE 'AUDIT PASS: order.held + order.reopened';
END $audit$;

ROLLBACK;
