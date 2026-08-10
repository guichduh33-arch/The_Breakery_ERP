-- supabase/tests/order_edit_items.test.sql
-- Session 33 / Wave 4.2 — add / update_qty / remove order_item RPC coverage.
-- ADR-013 Lot 3 (D15/M2) — bumps v3/v4 : pricing serveur via _resolve_line_price_v2.
-- Runs via MCP execute_sql with BEGIN ... ROLLBACK envelope.
--
-- Coverage (15 cases) :
--   T1  add_order_item happy (MANAGER, status='open')
--   T2  CASHIER → 42501 (no orders.edit_open perm)
--   T3  add on completed order → P0002
--   T4  idempotency replay returns OK without re-executing
--   T5  order subtotal > 0 after T1+T4 adds
--   T6  update_order_item_qty happy
--   T7  qty=0 → 22023
--   T8  update_qty on completed → P0002
--   T9  line_total = unit_price * new_qty after update (unit_price persisté, hybride)
--   T10 remove_order_item happy
--   T11 remove non-existent → P0002
--   T12 order subtotal >= 0 after remove
--   T13 add avec modificateur : price_adjustment SERVEUR (client menti ignoré)
--   T14 add d'un produit combo → refusé (23514)
--   T15 update_qty : unit_price persisté conservé + modificateurs re-tarifés
--
-- Auth simulated via set_config('request.jwt.claim.sub', '<uuid>', true).
-- Helper RPC : auth.uid() reads request.jwt.claim.sub OR request.jwt.claims JSON.

BEGIN;
SELECT plan(15);

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
  -- ADR-013 M2 : jamais un combo (add_order_item_v5 les refuse) ni un parent.
  -- ADR-022 dec. 1 : la garde de vendabilite est active sur cette RPC, le fixture doit choisir un produit vendable de facon deterministe.
  v_product  UUID := (SELECT p.id FROM products p
                       WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
                         AND p.product_type <> 'combo'
                         AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
                         AND p.retail_price > 0
                       ORDER BY p.created_at LIMIT 1);
BEGIN
  IF v_product IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;
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
    PERFORM add_order_item_v5(
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
    PERFORM add_order_item_v5(
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
    PERFORM add_order_item_v5(
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
    SELECT add_order_item_v5(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, v_key) INTO v_first;
    SELECT add_order_item_v5(
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
    PERFORM update_order_item_qty_v5(
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
    PERFORM update_order_item_qty_v5(
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
    PERFORM update_order_item_qty_v5(
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
  PERFORM update_order_item_qty_v5(
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
    PERFORM remove_order_item_v3(
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
    PERFORM remove_order_item_v3(gen_random_uuid(), gen_random_uuid());
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

-- ===== T13 : add avec modificateur — price_adjustment SERVEUR, client menti ignoré =====
DO $$
DECLARE
  v_product UUID := current_setting('breakery.test_product')::uuid;
  v_retail  NUMERIC;
  v_result  JSONB;
  v_line    RECORD;
  v_status  TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  SELECT retail_price INTO v_retail FROM products WHERE id = v_product;
  INSERT INTO product_modifiers (product_id, group_name, option_label, price_adjustment, is_active)
  VALUES (v_product, 'T13Grp', 'T13Opt', 2000, true);
  BEGIN
    SELECT add_order_item_v5(
      current_setting('breakery.test_order')::uuid,
      v_product, 2,
      -- price_adjustment client MENTI (999999) : le resolveur doit imposer 2000.
      '[{"group_name":"T13Grp","option_label":"T13Opt","price_adjustment":999999}]'::jsonb,
      gen_random_uuid()) INTO v_result;
    SELECT unit_price, line_total, modifiers_total, modifiers INTO v_line
      FROM order_items WHERE id = (v_result->>'order_item_id')::uuid;
    IF v_line.line_total = round_idr((v_retail + 2000) * 2)
       AND v_line.modifiers_total = 4000
       AND (v_line.modifiers->0->>'price_adjustment')::numeric = 2000 THEN
      v_status := 'pass';
    ELSE
      v_status := 'fail_pricing_' || v_line.line_total::text || '_' || COALESCE(v_line.modifiers_total::text, 'null');
    END IF;
    PERFORM set_config('breakery.t13_item', v_result->>'order_item_id', false);
    PERFORM set_config('breakery.t13_retail', v_retail::text, false);
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t13_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t13_pass') = 'pass', 'T13: add prices modifiers server-side (client adjustment ignored)');

-- ===== T14 : add d'un produit combo → 23514 =====
DO $$
DECLARE
  v_status TEXT := 'fail_no_raise';
  v_orig   products.product_type%TYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  SELECT product_type INTO v_orig FROM products WHERE id = current_setting('breakery.test_product')::uuid;
  UPDATE products SET product_type='combo' WHERE id = current_setting('breakery.test_product')::uuid;
  BEGIN
    PERFORM add_order_item_v5(
      current_setting('breakery.test_order')::uuid,
      current_setting('breakery.test_product')::uuid,
      1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '23514' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  UPDATE products SET product_type = v_orig WHERE id = current_setting('breakery.test_product')::uuid;
  PERFORM set_config('breakery.t14_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t14_pass') = 'pass', 'T14: add of a combo product is refused (23514)');

-- ===== T15 : update_qty hybride — unit_price persisté conservé, modificateurs re-tarifés =====
DO $$
DECLARE
  v_item   UUID := current_setting('breakery.t13_item')::uuid;
  v_retail NUMERIC := current_setting('breakery.t13_retail')::numeric;
  v_before NUMERIC;
  v_line   RECORD;
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('breakery.test_manager'), true);
  SELECT unit_price INTO v_before FROM order_items WHERE id = v_item;
  -- Le catalogue bouge entre-temps : le prix de base persisté ne doit PAS suivre.
  UPDATE products SET retail_price = retail_price + 7777
   WHERE id = current_setting('breakery.test_product')::uuid;
  BEGIN
    PERFORM update_order_item_qty_v5(v_item, 3, gen_random_uuid());
    SELECT unit_price, line_total, modifiers_total INTO v_line
      FROM order_items WHERE id = v_item;
    IF v_line.unit_price = v_before
       AND v_line.line_total = round_idr((v_before + 2000) * 3)
       AND v_line.modifiers_total = 6000 THEN
      v_status := 'pass';
    ELSE
      v_status := 'fail_' || v_line.unit_price::text || '_' || v_line.line_total::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  UPDATE products SET retail_price = retail_price - 7777
   WHERE id = current_setting('breakery.test_product')::uuid;
  PERFORM set_config('breakery.t15_pass', v_status, false);
END $$;
SELECT ok(current_setting('breakery.t15_pass') = 'pass', 'T15: update_qty keeps persisted unit_price and re-prices modifiers');

SELECT * FROM finish();
ROLLBACK;
