-- supabase/tests/orders_list_v3_envelope.test.sql
-- Session 32 / Wave 1.I — enveloppe et formes de la famille get_orders_list
-- (9 cases). S58 : repointé v1→v2. Review PR #367 : repointé v2→v3 (curseur
-- keyset — T6 threade le couple next_cursor/next_cursor_id) et RENOMMÉ, le
-- nom v1 mentait depuis S58. Complémentaire d'orders_list_v3.test.sql
-- (couverture filtres serveur) et d'orders_counters_v2.test.sql (parité).
-- T1 perm gate CASHIER → 42501
-- T2 MANAGER happy basic envelope shape
-- T3 status filter applied
-- T4 payment_method filter applied
-- T5 customer_id filter applied
-- T6 cursor pagination — page2 no overlap with page1
-- T7 limit clamp p_limit=500 → ≤ 200
-- T8 refund_status always in enum {none, partial, full}
-- T9 has_modifiers is always boolean
--
-- Auth simulated via set_config('request.jwt.claim.sub', '<uuid>', false).
-- Run as service_role via MCP execute_sql which can SET LOCAL context.
-- Wrapped in BEGIN ... ROLLBACK so live DB unchanged.

BEGIN;
SELECT plan(9);

-- ===== T1 : CASHIER without orders.read → 42501 =====
DO $$
DECLARE
  v_cashier_id UUID := '00000000-0000-0000-0000-000000000002';
  v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 5, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := 'pass';
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') = 'pass',
  'T1: CASHIER without orders.read raises 42501'
);

-- ===== T2 : MANAGER happy basic =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 5, NULL, NULL) INTO v_result;
  -- v4 : le curseur devient (next_cursor_val texte, next_cursor_id) — la clé
  -- next_cursor de la v3 n'existe plus.
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN (v_result ? 'lines') AND (v_result ? 'next_cursor_val')
         THEN 'pass' ELSE 'fail_shape' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') = 'pass',
  'T2: MANAGER receives { lines, next_cursor_val } envelope'
);

-- ===== T3 : status filter =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
  v_line JSONB;
  v_all_completed BOOLEAN := true;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31',
    jsonb_build_object('status', 'completed'), 100, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    IF v_line->>'status' <> 'completed' THEN v_all_completed := false; END IF;
  END LOOP;
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN v_all_completed THEN 'pass' ELSE 'fail_status_mismatch' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass') = 'pass',
  'T3: status=completed filter → all returned lines have status=completed'
);

-- ===== T4 : payment_method filter =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
  v_line JSONB;
  v_all_match BOOLEAN := true;
  v_count INT := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31',
    jsonb_build_object('payment_method', 'cash'), 100, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    v_count := v_count + 1;
    IF NOT EXISTS (
      SELECT 1 FROM order_payments
      WHERE order_id = (v_line->>'id')::uuid AND method::text = 'cash'
    ) THEN
      v_all_match := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN v_count = 0 OR v_all_match THEN 'pass' ELSE 'fail_payment_mismatch' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t4_pass') = 'pass',
  'T4: payment_method=cash filter → all returned orders have a cash payment'
);

-- ===== T5 : customer_id filter =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_some_customer UUID;
  v_result JSONB;
  v_line JSONB;
  v_all_match BOOLEAN := true;
  v_status TEXT;
BEGIN
  SELECT customer_id INTO v_some_customer FROM orders WHERE customer_id IS NOT NULL LIMIT 1;
  IF v_some_customer IS NULL THEN
    v_status := 'skipped_no_customer_order';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
    SELECT get_orders_list_v4('2020-01-01', '2030-12-31',
      jsonb_build_object('customer_id', v_some_customer::text), 100, NULL) INTO v_result;
    FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
    LOOP
      IF (v_line->>'customer_id')::uuid <> v_some_customer THEN v_all_match := false; END IF;
    END LOOP;
    v_status := CASE WHEN v_all_match THEN 'pass' ELSE 'fail_customer_mismatch' END;
  END IF;
  PERFORM set_config('breakery.t5_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t5_pass') IN ('pass', 'skipped_no_customer_order'),
  'T5: customer_id filter → all returned orders match'
);

-- ===== T6 : cursor pagination =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_p1 JSONB;
  v_p2 JSONB;
  v_cursor TEXT;
  v_cursor_id TEXT;
  v_p1_ids TEXT[];
  v_p2_ids TEXT[];
  v_overlap BOOLEAN := false;
  v_status TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 2, NULL, NULL) INTO v_p1;
  -- v4 : le curseur est le COUPLE (valeur_de_tri texte, id) de la dernière
  -- ligne rendue ; les positions 5-6 sont désormais p_sort/p_dir.
  v_cursor    := v_p1->>'next_cursor_val';
  v_cursor_id := v_p1->>'next_cursor_id';
  IF v_cursor IS NULL THEN
    v_status := 'skipped_too_few_orders';
  ELSE
    SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 2, 'created_at', 'desc', v_cursor, v_cursor_id::uuid) INTO v_p2;
    SELECT array_agg(line->>'id') INTO v_p1_ids FROM jsonb_array_elements(v_p1->'lines') AS line;
    SELECT array_agg(line->>'id') INTO v_p2_ids FROM jsonb_array_elements(v_p2->'lines') AS line;
    v_overlap := v_p1_ids && v_p2_ids;
    v_status := CASE WHEN NOT v_overlap THEN 'pass' ELSE 'fail_overlap' END;
  END IF;
  PERFORM set_config('breakery.t6_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t6_pass') IN ('pass', 'skipped_too_few_orders'),
  'T6: cursor pagination — page2 ids do not overlap page1'
);

-- ===== T7 : limit clamp =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
  v_count INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 500, NULL, NULL) INTO v_result;
  v_count := jsonb_array_length(v_result->'lines');
  PERFORM set_config('breakery.t7_pass',
    CASE WHEN v_count <= 200 THEN 'pass' ELSE 'fail_unclamped' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t7_pass') = 'pass',
  'T7: limit=500 clamped to ≤ 200'
);

-- ===== T8 : refund_status enum =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
  v_line JSONB;
  v_valid BOOLEAN := true;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 50, NULL, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    IF (v_line->>'refund_status') NOT IN ('none', 'partial', 'full') THEN v_valid := false; END IF;
  END LOOP;
  PERFORM set_config('breakery.t8_pass',
    CASE WHEN v_valid THEN 'pass' ELSE 'fail_unknown_status' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t8_pass') = 'pass',
  'T8: refund_status is always one of {none, partial, full}'
);

-- ===== T9 : has_modifiers boolean =====
DO $$
DECLARE
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_result JSONB;
  v_line JSONB;
  v_valid BOOLEAN := true;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v4('2020-01-01', '2030-12-31', '{}'::jsonb, 50, NULL, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    IF jsonb_typeof(v_line->'has_modifiers') <> 'boolean' THEN v_valid := false; END IF;
  END LOOP;
  PERFORM set_config('breakery.t9_pass',
    CASE WHEN v_valid THEN 'pass' ELSE 'fail_not_boolean' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t9_pass') = 'pass',
  'T9: has_modifiers is always a boolean'
);

SELECT * FROM finish();
ROLLBACK;
