-- supabase/tests/order_item_lock_adr010.test.sql
-- ADR-010 — verrou items envoyés en cuisine : cancel v6 (perte obligatoire),
-- update_qty v2 (baisse seule + nonce + perte delta), remove v2 (refus).
-- Runs via MCP execute_sql / API-from-file with BEGIN ... ROLLBACK envelope.
--
-- Coverage (17 assertions) :
--   T1  cancel v6 locked sans p_waste_qty → 23514
--   T2  cancel v6 locked waste_qty > qty ligne → 23514
--   T3  cancel v6 locked (tracked, waste 2/3) → pass
--   T3b stock_movements waste -2, reference_type='order_cancel', ref=order
--   T3c products.current_stock décrémenté de 2
--   T4  cancel v6 NON verrouillé sans waste → pass (comportement v5 intact)
--   T5  update v2 locked : hausse → 23514
--   T6  update v2 locked : baisse sans nonce → P0003
--   T7  update v2 locked : nonce scope 'discount' → P0003 (mauvais scope)
--   T8  update v2 locked : baisse 5→3 avec nonce valide → pass
--   T8b qty mise à jour à 3
--   T8c waste movement -2 (delta) rattaché à la commande
--   T8d nonce consommé (consumed_at NOT NULL, consumed_order_id = order)
--   T9  réutilisation du nonce consommé sur une autre ligne → P0003
--   T10 remove v2 locked → 23514 (renvoi flux cancel)
--   T11 remove v2 non verrouillé → pass (v1 intact)
--   T12 cancel v6 locked produit recette (track=false, deduct_stock=true) →
--       waste movement sur l'INGRÉDIENT (explosion _resolve_recipe_consumption_v1)
--
-- Auth simulée via set_config('request.jwt.claim.sub', ...) (pattern S33/S77).

BEGIN;
SELECT plan(17);

-- ===== Setup =====
DO $$
DECLARE
  v_manager_auth UUID;
  v_manager_prof UUID;
  v_cashier      UUID;
  v_cashier_auth UUID;
  v_session  UUID;
  v_order    UUID;
  v_cat      UUID := (SELECT id FROM categories LIMIT 1);
  v_p_track  UUID;
  v_p_recipe UUID;
  v_p_ing    UUID;
  v_i1 UUID; v_i2 UUID; v_i3 UUID; v_i4 UUID; v_i5 UUID; v_i6 UUID; v_i7 UUID;
  v_nonce_ok  UUID;
  v_nonce_bad UUID;
BEGIN
  SELECT id, auth_user_id INTO v_manager_prof, v_manager_auth
    FROM user_profiles
   WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
   ORDER BY created_at LIMIT 1;
  SELECT id, auth_user_id INTO v_cashier, v_cashier_auth
    FROM user_profiles
   WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
   ORDER BY created_at LIMIT 1;

  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_cashier, closing_cash=0
   WHERE opened_by = v_cashier AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;

  -- Produits dédiés (cost_price=0 → pas de JE waste, hors périmètre du test).
  INSERT INTO products (sku, name, category_id, retail_price, unit, cost_price,
                        track_inventory, deduct_stock, is_active, current_stock)
  VALUES ('T-ADR10-TRK-' || substr(gen_random_uuid()::text,1,8), 'ADR10 tracked', v_cat, 10000, 'pcs', 0,
          true, false, true, 100)
  RETURNING id INTO v_p_track;

  INSERT INTO products (sku, name, category_id, retail_price, unit, cost_price,
                        track_inventory, deduct_stock, is_active, current_stock)
  VALUES ('T-ADR10-RCP-' || substr(gen_random_uuid()::text,1,8), 'ADR10 recipe prod', v_cat, 20000, 'pcs', 0,
          false, true, true, 0)
  RETURNING id INTO v_p_recipe;

  INSERT INTO products (sku, name, category_id, retail_price, unit, cost_price,
                        track_inventory, deduct_stock, is_active, current_stock)
  VALUES ('T-ADR10-ING-' || substr(gen_random_uuid()::text,1,8), 'ADR10 ingredient', v_cat, 1000, 'pcs', 0,
          true, false, true, 50)
  RETURNING id INTO v_p_ing;

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_p_recipe, v_p_ing, 2, 'pcs', true);

  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total)
  VALUES ('T-ADR10-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'draft', 0, 0, 0)
  RETURNING id INTO v_order;

  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I1 locked tracked', 3, 10000, 30000, true)  RETURNING id INTO v_i1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I2 free tracked',   1, 10000, 10000, false) RETURNING id INTO v_i2;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I3 locked tracked', 5, 10000, 50000, true)  RETURNING id INTO v_i3;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I4 locked tracked', 2, 10000, 20000, true)  RETURNING id INTO v_i4;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I5 locked tracked', 1, 10000, 10000, true)  RETURNING id INTO v_i5;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_track, 'I6 free tracked',   1, 10000, 10000, false) RETURNING id INTO v_i6;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, is_locked)
  VALUES (v_order, v_p_recipe, 'I7 locked recipe', 1, 20000, 20000, true)  RETURNING id INTO v_i7;

  -- Nonces : un valide (scope order_item_edit), un du mauvais scope (discount).
  INSERT INTO discount_authorizations (manager_profile_id, scope)
  VALUES (v_manager_prof, 'order_item_edit') RETURNING id INTO v_nonce_ok;
  INSERT INTO discount_authorizations (manager_profile_id, scope)
  VALUES (v_manager_prof, 'discount') RETURNING id INTO v_nonce_bad;

  PERFORM set_config('brk.order',        v_order::text, true);
  PERFORM set_config('brk.i1', v_i1::text, true);
  PERFORM set_config('brk.i2', v_i2::text, true);
  PERFORM set_config('brk.i3', v_i3::text, true);
  PERFORM set_config('brk.i4', v_i4::text, true);
  PERFORM set_config('brk.i5', v_i5::text, true);
  PERFORM set_config('brk.i6', v_i6::text, true);
  PERFORM set_config('brk.i7', v_i7::text, true);
  PERFORM set_config('brk.p_track', v_p_track::text, true);
  PERFORM set_config('brk.p_ing',   v_p_ing::text, true);
  PERFORM set_config('brk.mgr_prof',  v_manager_prof::text, true);
  PERFORM set_config('brk.mgr_auth',  v_manager_auth::text, true);
  PERFORM set_config('brk.cash_auth', v_cashier_auth::text, true);
  PERFORM set_config('brk.nonce_ok',  v_nonce_ok::text, true);
  PERFORM set_config('brk.nonce_bad', v_nonce_bad::text, true);
END $$;

-- ===== T1 : cancel locked sans waste_qty → 23514 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  BEGIN
    PERFORM cancel_order_item_rpc_v6(
      current_setting('brk.i1')::uuid, 'ADR10 T1 no waste',
      current_setting('brk.mgr_prof')::uuid, current_setting('brk.cash_auth')::uuid,
      NULL, NULL);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t1', v_status, false);
END $$;
SELECT ok(current_setting('brk.t1') = 'pass', 'T1: locked cancel without waste declaration → 23514');

-- ===== T2 : waste_qty > qty ligne → 23514 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  BEGIN
    PERFORM cancel_order_item_rpc_v6(
      current_setting('brk.i1')::uuid, 'ADR10 T2 over waste',
      current_setting('brk.mgr_prof')::uuid, current_setting('brk.cash_auth')::uuid,
      NULL, 4);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t2', v_status, false);
END $$;
SELECT ok(current_setting('brk.t2') = 'pass', 'T2: waste_qty above line qty → 23514');

-- ===== T3 : cancel locked avec waste 2/3 → pass + mouvement + stock =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  BEGIN
    PERFORM cancel_order_item_rpc_v6(
      current_setting('brk.i1')::uuid, 'ADR10 T3 waste ok',
      current_setting('brk.mgr_prof')::uuid, current_setting('brk.cash_auth')::uuid,
      NULL, 2);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t3', v_status, false);
END $$;
SELECT ok(current_setting('brk.t3') = 'pass', 'T3: locked cancel with waste declaration succeeds');

SELECT ok(EXISTS (
  SELECT 1 FROM stock_movements
   WHERE product_id = current_setting('brk.p_track')::uuid
     AND movement_type = 'waste'
     AND quantity = -2
     AND reference_type = 'order_cancel'
     AND reference_id = current_setting('brk.order')::uuid
     AND metadata->>'order_item_id' = current_setting('brk.i1')
), 'T3b: waste movement -2 linked to the order (reference_type order_cancel)');

SELECT is(
  (SELECT current_stock FROM products WHERE id = current_setting('brk.p_track')::uuid),
  98::numeric,
  'T3c: tracked product stock decremented by the declared waste (100 → 98)');

-- ===== T4 : cancel non verrouillé sans waste → pass, aucun waste =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  BEGIN
    PERFORM cancel_order_item_rpc_v6(
      current_setting('brk.i2')::uuid, 'ADR10 T4 free line',
      current_setting('brk.mgr_prof')::uuid, current_setting('brk.cash_auth')::uuid,
      NULL, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t4', v_status, false);
END $$;
SELECT ok(current_setting('brk.t4') = 'pass'
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements
     WHERE metadata->>'order_item_id' = current_setting('brk.i2')),
  'T4: unlocked cancel keeps v5 behaviour (no waste required, none recorded)');

-- ===== T5 : update locked hausse → 23514 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('brk.i3')::uuid, 7, gen_random_uuid(), NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t5', v_status, false);
END $$;
SELECT ok(current_setting('brk.t5') = 'pass', 'T5: locked line qty increase → 23514');

-- ===== T6 : baisse sans nonce → P0003 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('brk.i3')::uuid, 3, gen_random_uuid(), NULL, NULL, 'ADR10 T6');
  EXCEPTION WHEN SQLSTATE 'P0003' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t6', v_status, false);
END $$;
SELECT ok(current_setting('brk.t6') = 'pass', 'T6: locked decrease without nonce → P0003');

-- ===== T7 : nonce mauvais scope (discount) → P0003 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('brk.i3')::uuid, 3, gen_random_uuid(),
      current_setting('brk.nonce_bad')::uuid, NULL, 'ADR10 T7');
  EXCEPTION WHEN SQLSTATE 'P0003' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t7', v_status, false);
END $$;
SELECT ok(current_setting('brk.t7') = 'pass', 'T7: discount-scope nonce rejected → P0003');

-- ===== T8 : baisse 5→3 avec nonce valide =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('brk.i3')::uuid, 3, gen_random_uuid(),
      current_setting('brk.nonce_ok')::uuid, NULL, 'ADR10 T8 delta waste');
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t8', v_status, false);
END $$;
SELECT ok(current_setting('brk.t8') = 'pass', 'T8: locked decrease with valid nonce succeeds');

SELECT is(
  (SELECT quantity FROM order_items WHERE id = current_setting('brk.i3')::uuid),
  3::numeric,
  'T8b: quantity updated to 3');

SELECT ok(EXISTS (
  SELECT 1 FROM stock_movements
   WHERE product_id = current_setting('brk.p_track')::uuid
     AND movement_type = 'waste'
     AND quantity = -2
     AND reference_type = 'order_cancel'
     AND reference_id = current_setting('brk.order')::uuid
     AND metadata->>'order_item_id' = current_setting('brk.i3')
), 'T8c: waste movement on the removed delta (-2) linked to the order');

SELECT ok(
  (SELECT consumed_at IS NOT NULL AND consumed_order_id = current_setting('brk.order')::uuid
     FROM discount_authorizations WHERE id = current_setting('brk.nonce_ok')::uuid),
  'T8d: nonce atomically consumed (consumed_at + consumed_order_id)');

-- ===== T9 : réutilisation du nonce consommé → P0003 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM update_order_item_qty_v2(
      current_setting('brk.i4')::uuid, 1, gen_random_uuid(),
      current_setting('brk.nonce_ok')::uuid, NULL, 'ADR10 T9 reuse');
  EXCEPTION WHEN SQLSTATE 'P0003' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t9', v_status, false);
END $$;
SELECT ok(current_setting('brk.t9') = 'pass', 'T9: consumed nonce cannot be replayed → P0003');

-- ===== T10 : remove locked → 23514 =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM remove_order_item_v2(current_setting('brk.i5')::uuid, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '23514' THEN v_status := 'pass';
                WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t10', v_status, false);
END $$;
SELECT ok(current_setting('brk.t10') = 'pass', 'T10: locked item removal refused → 23514');

-- ===== T11 : remove non verrouillé → pass =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('brk.mgr_auth'), true);
  BEGIN
    PERFORM remove_order_item_v2(current_setting('brk.i6')::uuid, gen_random_uuid());
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t11', v_status, false);
END $$;
SELECT ok(current_setting('brk.t11') = 'pass'
  AND NOT EXISTS (SELECT 1 FROM order_items WHERE id = current_setting('brk.i6')::uuid),
  'T11: unlocked item removal keeps v1 behaviour (deleted)');

-- ===== T12 : explosion recette — waste sur l'ingrédient =====
DO $$
DECLARE v_status TEXT := 'fail_raised';
BEGIN
  BEGIN
    PERFORM cancel_order_item_rpc_v6(
      current_setting('brk.i7')::uuid, 'ADR10 T12 recipe waste',
      current_setting('brk.mgr_prof')::uuid, current_setting('brk.cash_auth')::uuid,
      NULL, 1);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('brk.t12', v_status, false);
END $$;
SELECT ok(current_setting('brk.t12') = 'pass'
  AND EXISTS (
    SELECT 1 FROM stock_movements
     WHERE product_id = current_setting('brk.p_ing')::uuid
       AND movement_type = 'waste'
       AND quantity = -2
       AND reference_type = 'order_cancel'
       AND reference_id = current_setting('brk.order')::uuid
       AND metadata->>'order_item_id' = current_setting('brk.i7')),
  'T12: recipe product waste explodes to ingredient (-2 pcs via recipe qty 2)');

SELECT * FROM finish();
ROLLBACK;
