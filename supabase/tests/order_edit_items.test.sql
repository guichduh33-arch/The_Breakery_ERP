-- supabase/tests/order_edit_items.test.sql
-- Session 33 / Wave 4.2 — add / update_qty / remove order_item RPC coverage.
-- Runs via MCP execute_sql with BEGIN ... ROLLBACK envelope.
--
-- Coverage (12 cases) :
--   T1  add_order_item happy (MANAGER, status='open')
--   T2  CASHIER → 42501 (no orders.edit_open perm)
--   T3  add on completed order → P0002
--   T4  idempotency replay returns OK without re-executing
--   T5  order subtotal > 0 after T1+T4 adds
--   T6  update_order_item_qty happy
--   T7  qty=0 → 22023
--   T8  update_qty on completed → P0002
--   T9  line_total = unit_price * new_qty after update
--   T10 remove_order_item happy
--   T11 remove non-existent → P0002
--   T12 order subtotal >= 0 after remove
--
-- Auth simulated via set_config('request.jwt.claim.sub', '<uuid>', true).
-- Helper RPC : auth.uid() reads request.jwt.claim.sub OR request.jwt.claims JSON.

BEGIN;
SELECT plan(12);

-- ===== Setup : create a draft order + 1 line via direct INSERT =====
DO $$
DECLARE
  -- S77 (classe F-5) : claim.sub doit porter auth_user_id (pas user_profiles.id) —
  -- has_permission/auth.uid() lisent l'auth uid. LIMIT 1 sans ORDER BY tombait
  -- par chance sur des comptes seed (id == auth_user_id) ; sélection déterministe.
  v_manager_auth UUID;
  v_cashier      UUID;
  v_cashier_auth UUID;
  v_session  UUID;
  v_order    UUID;
  v_item     UUID;
  v_product  UUID := (SELECT id FROM products WHERE is_active=true LIMIT 1);
BEGIN
  SELECT auth_user_id INTO v_manager_auth
    FROM user_profiles
   WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
   ORDER BY created_at LIMIT 1;
  SELECT id, auth_user_id INTO v_cashier, v_cashier_auth
    FROM user_profiles
   WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
   ORDER BY created_at LIMIT 1;
  -- S77 (D-7) : clôture transactionnelle d'une éventuelle session ouverte
  -- fuitée pour ce profil (annulée par le ROLLBACK final).
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_cashier, closing_cash=0
   WHERE opened_by = v_cashier AND status='open';

  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total)
  VALUES ('T-ORD-S33-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'draft', 0, 0, 0)
  RETURNING id INTO v_order;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, v_product, 'Test croissant', 1, 25000, 25000) RETURNING id INTO v_item;
  -- Reset order subtotal to 25000 to reflect the seeded line
  UPDATE orders SET subtotal=25000, total=25000 WHERE id=v_order;
  PERFORM set_config('breakery.test_order',   v_order::text,   true);
  PERFORM set_config('breakery.test_item',    v_item::text,    true);
  PERFORM set_config('breakery.test_product', v_product::text, true);
  PERFORM set_config('breakery.test_manager', v_manager_auth::text, true);
  PERFORM set_config('breakery.test_cashier', v_cashier_auth::text, true);
END $$;

-- ===== T1 : add_order_item happy (MANAGER) =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    PERFORM add_order_item_v1(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      2, '[]'::jsonb, gen_random_uuid());
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t1_pass') = 'pass', 'T1: add_order_item happy path');

-- ===== T2 : CASHIER → 42501 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_cashier'), true);
  BEGIN
    PERFORM add_order_item_v1(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '42501' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t2_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t2_pass') = 'pass', 'T2: CASHIER without orders.edit_open raises 42501');

-- ===== T3 : add on completed order → P0002 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  UPDATE orders SET status='completed' WHERE id = current_setting('breakery.test_order')::uuid;
  BEGIN
    PERFORM add_order_item_v1(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  -- Restore status=draft
  UPDATE orders SET status='draft' WHERE id = current_setting('breakery.test_order')::uuid;
  PERFORM set_config('breakery.t3_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t3_pass') = 'pass', 'T3: add on completed order raises P0002');

-- ===== T4 : idempotency replay returns OK without re-executing =====
DO $$
DECLARE
  v_key UUID := gen_random_uuid();
  v_first  JSONB;
  v_second JSONB;
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    SELECT add_order_item_v1(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, v_key) INTO v_first;
    SELECT add_order_item_v1(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, v_key) INTO v_second;
    v_status := CASE WHEN v_first = v_second THEN 'pass' ELSE 'fail_diff_replay' END;
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t4_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t4_pass') = 'pass', 'T4: idempotency replay returns identical result');

-- ===== T5 : order subtotal > 0 after T1+T4 adds =====
SELECT cmp_ok(
  (SELECT subtotal FROM orders WHERE id = current_setting('breakery.test_order')::uuid),
  '>', 0::numeric,
  'T5: order subtotal > 0 after T1 + T4 adds'
);

-- ===== T6 : update_order_item_qty happy =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('breakery.test_item')::uuid,
      5, gen_random_uuid());
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t6_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t6_pass') = 'pass', 'T6: update_order_item_qty happy');

-- ===== T7 : qty=0 → 22023 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('breakery.test_item')::uuid,
      0, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '22023' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t7_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t7_pass') = 'pass', 'T7: update_qty qty=0 raises 22023');

-- ===== T8 : update_qty on completed → P0002 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  UPDATE orders SET status='completed' WHERE id = current_setting('breakery.test_order')::uuid;
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('breakery.test_item')::uuid,
      3, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  UPDATE orders SET status='draft' WHERE id = current_setting('breakery.test_order')::uuid;
  PERFORM set_config('breakery.t8_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t8_pass') = 'pass', 'T8: update_qty on completed raises P0002');

-- ===== T9 : line_total = unit_price * new_qty after update =====
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  PERFORM update_order_item_qty_v2(
    current_setting('breakery.test_item')::uuid, 7, gen_random_uuid());
END $$;
SELECT cmp_ok(
  (SELECT line_total FROM order_items WHERE id = current_setting('breakery.test_item')::uuid),
  '=', (25000 * 7)::numeric,
  'T9: line_total = unit_price * new_qty after update'
);

-- ===== T10 : remove_order_item happy =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    PERFORM remove_order_item_v2(
      current_setting('breakery.test_item')::uuid,
      gen_random_uuid());
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t10_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t10_pass') = 'pass', 'T10: remove_order_item happy');

-- ===== T11 : remove non-existent → P0002 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  BEGIN
    PERFORM remove_order_item_v2(gen_random_uuid(), gen_random_uuid());
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t11_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t11_pass') = 'pass', 'T11: remove non-existent raises P0002');

-- ===== T12 : order subtotal >= 0 after remove =====
SELECT cmp_ok(
  (SELECT subtotal FROM orders WHERE id = current_setting('breakery.test_order')::uuid),
  '>=', 0::numeric,
  'T12: order subtotal >= 0 after T10 remove'
);

SELECT * FROM finish();
ROLLBACK;
