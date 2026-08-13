-- supabase/tests/search_orders_v1.test.sql
-- Audit UX/UI 2026-08-13, lot 4 — recherche de commandes de la palette globale.
-- Runs via psql (pgtap-pr.yml) ou MCP execute_sql, BEGIN ... ROLLBACK.
-- Patron : orders_counters_v2.test.sql (seed transactionnel, jwt simulé par
-- set_config, verdicts current_setting(..., true)).

BEGIN;
SELECT plan(6);

-- ===== Seed =====
DO $$
DECLARE
  v_sess UUID := (SELECT id FROM pos_sessions ORDER BY opened_at LIMIT 1);
BEGIN
  IF v_sess IS NULL THEN
    RAISE EXCEPTION 'seed prerequisites missing: pos_sessions empty';
  END IF;
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('UXL4-0005A', 'completed', 10000, 0, 10000, '2024-01-16T02:00:00Z', v_sess);
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('UXL4-777', 'draft', 20000, 0, 20000, '2024-01-16T03:00:00Z', v_sess);
END $$;

-- ===== T1 : privilèges — anon n'a pas EXECUTE, authenticated l'a =====
SELECT ok(
  NOT has_function_privilege('anon', 'public.search_orders_v1(text,integer)', 'EXECUTE'),
  'T1: anon has no EXECUTE on search_orders_v1'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.search_orders_v1(text,integer)', 'EXECUTE'),
  'T2: authenticated has EXECUTE on search_orders_v1'
);

-- ===== T3 : gate négatif — CASHIER sans orders.read =====
DO $$
DECLARE
  v_cashier_id UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_status TEXT := 'fail_no_raise';
BEGIN
  IF v_cashier_id IS NULL THEN
    PERFORM set_config('breakery.t3_pass', 'fail_no_cashier_seed', false);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM search_orders_v1('UXL4', 10);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := CASE WHEN SQLERRM LIKE 'permission denied%'
                     THEN 'pass' ELSE 'fail_wrong_42501: ' || SQLERRM END;
  END;
  PERFORM set_config('breakery.t3_pass', v_status, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t3_pass', true), 'missing') = 'pass',
  'T3: CASHIER without orders.read raises permission denied'
);

-- Contexte MANAGER pour la suite
DO $$
DECLARE v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
BEGIN
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'no MANAGER seed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
END $$;

-- ===== T4 : '0005' trouve la commande seedée, tri anté-chronologique =====
DO $$
DECLARE v_found BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM search_orders_v1('0005', 10) r WHERE r.order_number = 'UXL4-0005A'
  ) INTO v_found;
  PERFORM set_config('breakery.t4_pass', CASE WHEN v_found THEN 'pass' ELSE 'fail_not_found' END, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t4_pass', true), 'missing') = 'pass',
  'T4: searching 0005 returns the seeded UXL4-0005A'
);

-- ===== T5 : requête < 2 chars → vide =====
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) FROM search_orders_v1('7', 10) INTO v_count;
  PERFORM set_config('breakery.t5_pass', CASE WHEN v_count = 0 THEN 'pass' ELSE 'fail_' || v_count END, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t5_pass', true), 'missing') = 'pass',
  'T5: a 1-char query returns no rows'
);

-- ===== T6 : le clamp de limite tient (p_limit 500 → ≤ 20) =====
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) FROM search_orders_v1('UXL4', 500) INTO v_count;
  PERFORM set_config('breakery.t6_pass', CASE WHEN v_count <= 20 THEN 'pass' ELSE 'fail_' || v_count END, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t6_pass', true), 'missing') = 'pass',
  'T6: p_limit is clamped to 20'
);

SELECT * FROM finish();
ROLLBACK;
