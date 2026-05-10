-- supabase/tests/promotions_rpcs.sql
-- pgTAP integration tests for the three RPCs that consume the promotion engine:
--   - create_tablet_order        (Session 8 / migration 7) — freeze at create-time
--   - complete_order_with_payment v6 (migration 5) — server-side eval at payment
--   - pay_existing_order v3      (migration 6) — reads frozen promo, no re-eval
--
-- Mocks auth.uid() via set_config('request.jwt.claim.sub', ...). Reuses seeded
-- products and demo promotions. Wraps in BEGIN/ROLLBACK so DB is untouched.

BEGIN;
SELECT plan(15);

-- ============================================================
-- Shared setup
-- ============================================================
-- Open POS sessions for cashier (EMP001) and waiter (EMP002). Idempotent.
INSERT INTO pos_sessions (id, opened_by, opening_cash, status, opened_at)
SELECT gen_random_uuid(), id, 0, 'open', now()
FROM user_profiles WHERE employee_code = 'EMP001'
  AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = user_profiles.id AND ps.status = 'open');

INSERT INTO pos_sessions (id, opened_by, opening_cash, status, opened_at)
SELECT gen_random_uuid(), id, 0, 'open', now()
FROM user_profiles WHERE employee_code = 'EMP002'
  AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = user_profiles.id AND ps.status = 'open');

-- Test context: stable references to seeded data.
CREATE TEMP TABLE _ctx AS SELECT
  (SELECT ps.id FROM pos_sessions ps
     JOIN user_profiles up ON up.id = ps.opened_by
     WHERE up.employee_code = 'EMP001' AND ps.status = 'open'
     ORDER BY ps.opened_at DESC LIMIT 1)                 AS cashier_session_id,
  (SELECT ps.id FROM pos_sessions ps
     JOIN user_profiles up ON up.id = ps.opened_by
     WHERE up.employee_code = 'EMP002' AND ps.status = 'open'
     ORDER BY ps.opened_at DESC LIMIT 1)                 AS waiter_session_id,
  (SELECT id FROM products WHERE sku = 'PAS-CROI')       AS croissant_id,
  (SELECT id FROM products WHERE sku = 'BEV-AMER')       AS americano_id,
  (SELECT id FROM products WHERE sku = 'BEV-FLAT')       AS flat_id,
  (SELECT id FROM products WHERE sku = 'BRD-SOUR')       AS sourdough_id,
  (SELECT c.id FROM customers c
     JOIN customer_categories cc ON cc.id = c.category_id
     WHERE cc.slug = 'vip' LIMIT 1)                      AS vip_customer_id;

-- Temp table to track order_ids returned by the RPCs across tests.
CREATE TEMP TABLE _orders (label TEXT PRIMARY KEY, order_id UUID NOT NULL);

-- ============================================================
-- create_tablet_order tests (waiter EMP002 — has sales.create)
-- ============================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

-- Test 1: No promo applicable → promotion_total_amount = 0, no order_promotions row
INSERT INTO _orders (label, order_id)
SELECT 'tablet_no_promo',
  ((create_tablet_order(
    (SELECT waiter_session_id FROM _ctx), 'T-01',
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    NULL, gen_random_uuid(),
    '2026-05-12 12:00:00+08'::timestamptz
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT promotion_total_amount FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_no_promo')),
  0::DECIMAL(14,2),
  'create_tablet_order T1: no eligible promo → promotion_total_amount = 0'
);

SELECT is(
  (SELECT COUNT(*) FROM order_promotions
     WHERE order_id = (SELECT order_id FROM _orders WHERE label = 'tablet_no_promo')),
  0::BIGINT,
  'create_tablet_order T1: no eligible promo → 0 order_promotions audit rows'
);

-- Test 2: BOGO Croissant frozen at create-time
INSERT INTO _orders (label, order_id)
SELECT 'tablet_bogo',
  ((create_tablet_order(
    (SELECT waiter_session_id FROM _ctx), 'T-02',
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT croissant_id FROM _ctx),
      'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb
    )),
    NULL, gen_random_uuid(),
    '2026-05-12 10:00:00+08'::timestamptz
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT promotion_total_amount FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo')),
  25000::DECIMAL(14,2),
  'create_tablet_order T2: BOGO frozen → promotion_total_amount = 25000'
);

SELECT is(
  (SELECT target FROM order_promotions
     WHERE order_id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo')
     LIMIT 1),
  'cart',
  'create_tablet_order T2: BOGO audit row target = cart (BOGO returns applied_promotion.target=cart)'
);

-- Test 3: Cart percentage_off (Happy Hour) → audit row target = cart with metadata snapshot
INSERT INTO _orders (label, order_id)
SELECT 'tablet_happyhour',
  ((create_tablet_order(
    (SELECT waiter_session_id FROM _ctx), 'T-03',
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    NULL, gen_random_uuid(),
    '2026-05-12 15:00:00+08'::timestamptz  -- Tuesday 15:00 → Happy Hour eligible
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT target FROM order_promotions
     WHERE order_id = (SELECT order_id FROM _orders WHERE label = 'tablet_happyhour')
     LIMIT 1),
  'item',
  'create_tablet_order T3: Happy Hour (percentage_off category) audit row target = item (per affected line)'
);

SELECT is(
  (SELECT metadata->>'name_snapshot' FROM order_promotions
     WHERE order_id = (SELECT order_id FROM _orders WHERE label = 'tablet_happyhour')
     LIMIT 1),
  'Happy Hour Beverages 15% off',
  'create_tablet_order T3: Happy Hour metadata.name_snapshot frozen at create-time'
);

-- Test 4: Idempotent replay returns same order_id.
-- Use a temp table to share the idempotency key + first order_id between calls.
CREATE TEMP TABLE _idem AS SELECT gen_random_uuid() AS k;

INSERT INTO _orders (label, order_id)
SELECT 'tablet_idem_1',
  ((create_tablet_order(
    (SELECT waiter_session_id FROM _ctx), 'T-04',
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    NULL, (SELECT k FROM _idem),
    '2026-05-12 12:00:00+08'::timestamptz
  ))->>'order_id')::UUID;

INSERT INTO _orders (label, order_id)
SELECT 'tablet_idem_2',
  ((create_tablet_order(
    (SELECT waiter_session_id FROM _ctx), 'T-04',
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    NULL, (SELECT k FROM _idem),
    '2026-05-12 12:00:00+08'::timestamptz
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT order_id FROM _orders WHERE label = 'tablet_idem_2'),
  (SELECT order_id FROM _orders WHERE label = 'tablet_idem_1'),
  'create_tablet_order T4: idempotent replay returns same order_id'
);

-- ============================================================
-- complete_order_with_payment v6 tests (cashier EMP001 — has pos.sale.create)
-- ============================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

-- Test 5: BOGO frozen at payment + total math (items_total - promo - discount)
INSERT INTO _orders (label, order_id)
SELECT 'pos_bogo',
  ((complete_order_with_payment(
    p_session_id  => (SELECT cashier_session_id FROM _ctx),
    p_order_type  => 'dine_in',
    p_items       => jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT croissant_id FROM _ctx),
      'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb
    )),
    p_payment     => jsonb_build_object('method', 'cash', 'amount', 25000, 'cash_received', 25000, 'change_given', 0),
    p_idempotency_key => gen_random_uuid(),
    p_evaluation_ts => '2026-05-12 10:00:00+08'::timestamptz
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT promotion_total_amount FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'pos_bogo')),
  25000::DECIMAL(14,2),
  'complete_order_with_payment T5: BOGO promo total = 25000 stored on order'
);

SELECT is(
  (SELECT total FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'pos_bogo')),
  25000::DECIMAL(14,2),
  'complete_order_with_payment T5: total = 50000 items - 25000 promo = 25000'
);

-- Test 6: p_evaluation_ts BEFORE Happy Hour window → no promo applied
INSERT INTO _orders (label, order_id)
SELECT 'pos_no_happyhour',
  ((complete_order_with_payment(
    p_session_id  => (SELECT cashier_session_id FROM _ctx),
    p_order_type  => 'dine_in',
    p_items       => jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    p_payment     => jsonb_build_object('method', 'cash', 'amount', 35000, 'cash_received', 35000, 'change_given', 0),
    p_idempotency_key => gen_random_uuid(),
    p_evaluation_ts => '2026-05-12 13:00:00+08'::timestamptz  -- before HH window (14:00–17:00)
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT promotion_total_amount FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'pos_no_happyhour')),
  0::DECIMAL(14,2),
  'complete_order_with_payment T6: p_evaluation_ts before Happy Hour → no promo'
);

-- Test 7: Cart percentage_off promo audit row has cart target
INSERT INTO _orders (label, order_id)
SELECT 'pos_happyhour',
  ((complete_order_with_payment(
    p_session_id  => (SELECT cashier_session_id FROM _ctx),
    p_order_type  => 'dine_in',
    p_items       => jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT americano_id FROM _ctx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
    )),
    p_payment     => jsonb_build_object('method', 'cash', 'amount', 30000, 'cash_received', 30000, 'change_given', 0),
    p_idempotency_key => gen_random_uuid(),
    p_evaluation_ts => '2026-05-12 15:00:00+08'::timestamptz  -- HH eligible
  ))->>'order_id')::UUID;

SELECT is(
  (SELECT target FROM order_promotions
     WHERE order_id = (SELECT order_id FROM _orders WHERE label = 'pos_happyhour')
     LIMIT 1),
  'item',
  'complete_order_with_payment T7: HH (percentage_off category) audit row target = item'
);

-- ============================================================
-- pay_existing_order v3 tests (cashier EMP001 — has payments.process)
-- Uses tablet orders frozen earlier (BOGO + Happy Hour) to verify NO re-eval.
-- ============================================================

-- Test 8: pay_existing_order respects frozen BOGO promo (no re-eval).
-- Capture the frozen promo BEFORE paying, then run pay_existing_order, then assert.
CREATE TEMP TABLE _t8_before AS
  SELECT promotion_total_amount AS promo_before
    FROM orders WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo');

DO $$ BEGIN
  PERFORM pay_existing_order(
    p_order_id  => (SELECT order_id FROM _orders WHERE label = 'tablet_bogo'),
    p_payment   => jsonb_build_object('method', 'cash', 'amount', 25000,
                                       'cash_received', 25000, 'change_given', 0),
    p_idempotency_key => gen_random_uuid()
  );
END $$;

SELECT is(
  (SELECT promotion_total_amount FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo')),
  (SELECT promo_before FROM _t8_before),
  'pay_existing_order T8a: frozen promotion_total_amount preserved (no re-eval)'
);

SELECT is(
  (SELECT total FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo')),
  25000::DECIMAL(14,2),
  'pay_existing_order T8b: total = 50000 items - 25000 frozen promo = 25000'
);

SELECT is(
  (SELECT status::TEXT FROM orders
     WHERE id = (SELECT order_id FROM _orders WHERE label = 'tablet_bogo')),
  'paid',
  'pay_existing_order T8c: order transitioned pending_payment → paid'
);

-- Test 9: pay_existing_order rejects non-pending_payment orders.
-- Catch the exception in a DO block and surface it via a temp table so SELECT is() prints TAP.
CREATE TEMP TABLE _t9_caught (sqlstate TEXT);

DO $$ BEGIN
  BEGIN
    PERFORM pay_existing_order(
      p_order_id  => (SELECT order_id FROM _orders WHERE label = 'pos_bogo'),
      p_payment   => jsonb_build_object('method', 'cash', 'amount', 25000,
                                         'cash_received', 25000, 'change_given', 0),
      p_idempotency_key => gen_random_uuid()
    );
    INSERT INTO _t9_caught (sqlstate) VALUES ('NO_EXCEPTION');
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _t9_caught (sqlstate) VALUES ('check_violation');
    WHEN OTHERS THEN INSERT INTO _t9_caught (sqlstate) VALUES (SQLSTATE);
  END;
END $$;

SELECT is(
  (SELECT sqlstate FROM _t9_caught),
  'check_violation',
  'pay_existing_order T9: paid order rejected with check_violation'
);

SELECT * FROM finish();
ROLLBACK;
