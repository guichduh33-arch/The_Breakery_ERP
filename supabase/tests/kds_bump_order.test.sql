-- supabase/tests/kds_bump_order.test.sql
-- S60 (04 D1.2) — pgTAP suite for kds_bump_order_v1 ("All ready" mass bump).
-- Modeled on reversal_idempotency.test.sql (request.jwt.claim.sub simulation)
-- and reversal_rpc_revoke.test.sql (grant trio check).
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope). pgtap pre-installed on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- ===========================================================================
-- Fixture: cashier profile w/ kds.operate ; draft order + 3 items
-- (pending, preparing, cancelled).
-- ===========================================================================
DO $fixture$
DECLARE
  v_auth  UUID;
  v_prof  UUID;
  v_cat   UUID;
  v_prod  UUID := '60000001-0000-0000-0000-000000000001';
  v_sess  UUID;
  v_order UUID;
  v_item_pending    UUID;
  v_item_preparing  UUID;
  v_item_cancelled  UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'kds.operate') LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no profile with kds.operate'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);

  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, track_inventory, deduct_stock)
  VALUES (v_prod, 'PGTAP-S60-KBO', 'pgTAP S60 KDS Bump Order Product', v_cat, 15000, 100.000, false, false)
  ON CONFLICT (id) DO UPDATE SET current_stock = 100.000;

  -- POS orders require a session_id (chk orders_session_id_required_for_pos).
  INSERT INTO pos_sessions (opened_by, opened_at, opening_cash, status)
  VALUES (v_prof, NOW(), 0, 'open')
  RETURNING id INTO v_sess;

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('T-S60-KBO-' || gen_random_uuid()::text, 'take_out', 'draft', 45000, 0, 45000, NOW(), v_sess)
  RETURNING id INTO v_order;

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, kitchen_status, is_locked, sent_to_kitchen_at)
  VALUES (v_order, v_prod, 'pgTAP KBO pending', 15000, 1, 15000, 'pending', TRUE, NOW())
  RETURNING id INTO v_item_pending;

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, kitchen_status, is_locked, sent_to_kitchen_at)
  VALUES (v_order, v_prod, 'pgTAP KBO preparing', 15000, 1, 15000, 'preparing', TRUE, NOW())
  RETURNING id INTO v_item_preparing;

  INSERT INTO order_items (
    order_id, product_id, name_snapshot, unit_price, quantity, line_total, kitchen_status, is_locked, sent_to_kitchen_at,
    is_cancelled, cancelled_at, cancelled_reason, cancelled_by
  ) VALUES (
    v_order, v_prod, 'pgTAP KBO cancelled', 15000, 1, 15000, 'pending', TRUE, NOW(),
    TRUE, NOW(), 'test cancel reason', v_prof
  )
  RETURNING id INTO v_item_cancelled;

  PERFORM set_config('s60kbo.auth',            v_auth::text,           false);
  PERFORM set_config('s60kbo.order',           v_order::text,          false);
  PERFORM set_config('s60kbo.item_pending',    v_item_pending::text,   false);
  PERFORM set_config('s60kbo.item_preparing',  v_item_preparing::text, false);
  PERFORM set_config('s60kbo.item_cancelled',  v_item_cancelled::text, false);
END $fixture$;

-- ---------------------------------------------------------------------------
-- T1: function exists with the right signature
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'kds_bump_order_v1', ARRAY['uuid', 'uuid'],
                    'T1 kds_bump_order_v1(uuid,uuid) exists');

-- ---------------------------------------------------------------------------
-- T2/T3: first call bumps pending+preparing to ready, leaves cancelled intact
-- ---------------------------------------------------------------------------
DO $t2$
DECLARE
  v_order  UUID := current_setting('s60kbo.order')::uuid;
  v_key    UUID := '60000002-0000-0000-0000-000000000001';
  v_result INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('s60kbo.auth'), true);
  v_result := kds_bump_order_v1(v_order, v_key);
  PERFORM set_config('s60kbo.key',        v_key::text,    false);
  PERFORM set_config('s60kbo.t2_result',  v_result::text, false);
END $t2$;

SELECT ok(current_setting('s60kbo.t2_result')::integer = 2,
  'T2: first bump_order call returns 2 (pending + preparing bumped)');

SELECT ok(
  (SELECT kitchen_status = 'ready' AND ready_at IS NOT NULL AND bumped_at IS NOT NULL
     FROM order_items WHERE id = current_setting('s60kbo.item_pending')::uuid),
  'T3a: former-pending item is now ready with ready_at/bumped_at set'
);
SELECT ok(
  (SELECT kitchen_status = 'ready' AND ready_at IS NOT NULL AND bumped_at IS NOT NULL
     FROM order_items WHERE id = current_setting('s60kbo.item_preparing')::uuid),
  'T3b: former-preparing item is now ready with ready_at/bumped_at set'
);
SELECT ok(
  (SELECT kitchen_status = 'pending' AND ready_at IS NULL AND bumped_at IS NULL
     FROM order_items WHERE id = current_setting('s60kbo.item_cancelled')::uuid),
  'T3c: cancelled item untouched (still pending, no ready_at/bumped_at)'
);

-- Snapshot ready_at of the former-pending item before the replay call.
DO $snap$
BEGIN
  PERFORM set_config('s60kbo.ready_at_before',
    (SELECT ready_at::text FROM order_items WHERE id = current_setting('s60kbo.item_pending')::uuid),
    false);
END $snap$;

-- ---------------------------------------------------------------------------
-- T4: replay with the SAME idempotency key → returns 2 again, no re-UPDATE
-- ---------------------------------------------------------------------------
DO $t4$
DECLARE
  v_order  UUID := current_setting('s60kbo.order')::uuid;
  v_key    UUID := current_setting('s60kbo.key')::uuid;
  v_result INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('s60kbo.auth'), true);
  v_result := kds_bump_order_v1(v_order, v_key);
  PERFORM set_config('s60kbo.t4_result', v_result::text, false);
END $t4$;

SELECT ok(current_setting('s60kbo.t4_result')::integer = 2,
  'T4a: replay (same idempotency key) returns 2 without re-scanning');
SELECT ok(
  (SELECT ready_at::text FROM order_items WHERE id = current_setting('s60kbo.item_pending')::uuid)
    = current_setting('s60kbo.ready_at_before'),
  'T4b: replay does not re-UPDATE — ready_at stable'
);

-- ---------------------------------------------------------------------------
-- T5: second bump WITHOUT an idempotency key on an all-ready order → 0
-- ---------------------------------------------------------------------------
DO $t5$
DECLARE
  v_order  UUID := current_setting('s60kbo.order')::uuid;
  v_result INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('s60kbo.auth'), true);
  v_result := kds_bump_order_v1(v_order, NULL);
  PERFORM set_config('s60kbo.t5_result', v_result::text, false);
END $t5$;

SELECT ok(current_setting('s60kbo.t5_result')::integer = 0,
  'T5: bump on an order with no pending/preparing items left returns 0');

-- ---------------------------------------------------------------------------
-- T6: grant trio (S20) — anon/PUBLIC revoked, authenticated granted
-- ---------------------------------------------------------------------------
SELECT is(has_function_privilege('anon', 'public.kds_bump_order_v1(uuid,uuid)', 'EXECUTE'),
          false, 'T6a: kds_bump_order_v1 NOT executable by anon');
SELECT is(has_function_privilege('public', 'public.kds_bump_order_v1(uuid,uuid)', 'EXECUTE'),
          false, 'T6b: kds_bump_order_v1 NOT executable by PUBLIC');
SELECT is(has_function_privilege('authenticated', 'public.kds_bump_order_v1(uuid,uuid)', 'EXECUTE'),
          true, 'T6c: kds_bump_order_v1 executable by authenticated');

SELECT * FROM finish();

ROLLBACK;
