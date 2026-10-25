-- ---------------------------------------------------------------------------
-- T_PROD_13 — MANAGER → forbidden on revert_production_v3
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_mgr UUID; v_caught TEXT; v_dummy UUID := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    RAISE EXCEPTION 'T_PROD_13: missing required actor fixture';
  END IF;
  PERFORM pg_temp.authenticate_pin(v_mgr);
  PERFORM set_config('role','authenticated',true);
  BEGIN
    PERFORM revert_production_v3(v_dummy, 'test reason');
    v_caught := 'no_raise';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_13_pass',
    CASE WHEN v_caught='forbidden' THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_13_pass') = 'yes',
  'T_PROD_13: MANAGER → forbidden on revert_production_v3');

-- ---------------------------------------------------------------------------
-- T_PROD_14 — ADMIN reverts → stock restored + balanced ledger
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID; v_adm UUID;
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_section UUID;
  v_pid UUID; v_result JSONB; v_revert JSONB;
  v_bag_before NUMERIC; v_flo_before NUMERIC;
  v_bag_after NUMERIC;  v_flo_after NUMERIC;
  v_reverted_at TIMESTAMPTZ;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  SELECT auth_user_id INTO v_adm FROM user_profiles WHERE employee_code='EMP000';
  IF v_mgr IS NULL OR v_adm IS NULL THEN
    RAISE EXCEPTION 'T_PROD_14: missing required actor fixture';
  END IF;
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  UPDATE products SET current_stock=0   WHERE id=v_bag;
  SELECT current_stock INTO v_bag_before FROM products WHERE id=v_bag;
  SELECT current_stock INTO v_flo_before FROM products WHERE id=v_flo;
  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  -- Isolate: T_PROD_11 left salt/yeast/water recipes active on the shared
  -- T_PROD_BAGUETTE product. Deactivate every active recipe (postgres context —
  -- authenticated has no UPDATE on recipes) so this single-ingredient production
  -- yields exactly 1 production_in + 1 production_out = 2 movements to reverse.
  UPDATE recipes SET is_active = false, deleted_at = now() WHERE product_id = v_bag AND is_active;

  PERFORM pg_temp.authenticate_pin(v_mgr);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v2(v_bag, v_flo, 250, 'g', NULL);
  v_result := record_production_v7(v_bag, 50, v_section, NULL, 0, NULL, NULL);
  v_pid := (v_result->>'production_id')::uuid;
  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.authenticate_pin(v_adm);
  PERFORM set_config('role','authenticated',true);
  v_revert := revert_production_v3(v_pid, 'pgTAP test reversal');
  PERFORM set_config('role','postgres',true);

  SELECT current_stock INTO v_bag_after FROM products WHERE id=v_bag;
  SELECT current_stock INTO v_flo_after FROM products WHERE id=v_flo;
  SELECT reverted_at INTO v_reverted_at FROM production_records WHERE id=v_pid;

  PERFORM set_config('breakery.t_prod_14_pass',
    CASE WHEN v_bag_after = v_bag_before
              AND v_flo_after = v_flo_before
              AND v_reverted_at IS NOT NULL
              AND (v_revert->>'reverse_movements_count')::int = 2
              AND (v_revert->>'reverse_je_count')::int = 2
         THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_14_pass') = 'yes',
  'T_PROD_14: ADMIN reverts → stock restored + balanced ledger');
-- ---------------------------------------------------------------------------
-- T_PROD_15 — get_production_suggestions_v1 returns row for product with
-- recent sales + active recipe + low stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID;
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_count INT;
  v_test_order UUID;
  v_session UUID;
  v_opener UUID;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    RAISE EXCEPTION 'T_PROD_15: missing required actor fixture';
  END IF;

  -- Ensure: low stock + active recipe + recent sales injected via direct INSERT.
  UPDATE products SET current_stock=2 WHERE id=v_bag;
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  PERFORM pg_temp.authenticate_pin(v_mgr);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v2(v_bag, v_flo, 250, 'g', NULL);
  PERFORM set_config('role','postgres',true);

  -- POS orders now require a session_id (constraint orders_session_id_required_for_pos).
  -- Seed an open POS session for the synthetic recent-sale fixture.
  SELECT id INTO v_opener FROM user_profiles ORDER BY created_at LIMIT 1;
  INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status)
  VALUES (gen_random_uuid(), v_opener, NOW(), 0, 'open') RETURNING id INTO v_session;

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at, created_via, session_id)
  VALUES ('T_PROD_15_O1', 'dine_in', 'completed', 50000, 0, 50000, now() - INTERVAL '1 day', 'pos', v_session)
  RETURNING id INTO v_test_order;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, created_at)
  VALUES (v_test_order, v_bag, 'Baguette', 5000, 10, 50000, now() - INTERVAL '1 day');

  PERFORM pg_temp.authenticate_pin(v_mgr);
  PERFORM set_config('role','authenticated',true);
  SELECT COUNT(*) INTO v_count FROM get_production_suggestions_v1(7, 3, 7) WHERE product_id = v_bag;
  PERFORM set_config('role','postgres',true);

  PERFORM set_config('breakery.t_prod_15_pass',
    CASE WHEN v_count = 1 THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_15_pass') = 'yes',
  'T_PROD_15: get_production_suggestions_v1 returns row for low-stock product');
