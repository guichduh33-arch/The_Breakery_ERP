-- supabase/tests/orders_counters_v1.test.sql
-- ADR-025 — parité compteurs/lignes de la liste des commandes.
-- Runs via MCP execute_sql with BEGIN ... ROLLBACK envelope.
--
-- Coverage (7 cases) :
--   T1  perm gate négatif : CASHIER sans orders.read → 42501 (ADR-021 déc. 6)
--   T2  parité du total : counters.total.count = Σ lignes paginées (D1/D4)
--   T3  parité par statut : chaque panier by_status = lignes du même statut (D4)
--   T4  la clé 'status' dans p_filters est ignorée par les compteurs (D2)
--   T5  parité payé : count+amount = lignes avec paiement (D5)
--   T6  parité impayé : count+amount = lignes sans paiement non annulées (D5)
--   T7  fenêtre vide → total 0, by_status {} (le pied peut dire « 0 sur N »)
--
-- Auth simulée via set_config('request.jwt.claim.sub', '<AUTH_USER_ID>', true)
-- — convention projet (voir orders_list_v2.test.sql, note S77).

BEGIN;
SELECT plan(7);

-- ===== T1 : CASHIER sans orders.read → 42501 =====
DO $$
DECLARE
  v_cashier_id UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM get_orders_counters_v1('2026-05-01', '2026-05-31', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := 'pass';
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') = 'pass',
  'T1: CASHIER without orders.read raises 42501'
);

-- ===== T2 : parité du total (pagination épuisée) =====
DO $$
DECLARE
  v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_counters JSONB;
  v_page JSONB;
  v_cursor TIMESTAMPTZ := NULL;
  v_lines INT := 0;
  v_guard INT := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_counters_v1('2026-01-01', '2026-12-31', '{}'::jsonb) INTO v_counters;
  LOOP
    SELECT get_orders_list_v2('2026-01-01', '2026-12-31', '{}'::jsonb, 200, v_cursor) INTO v_page;
    v_lines := v_lines + jsonb_array_length(v_page->'lines');
    v_cursor := (v_page->>'next_cursor')::timestamptz;
    v_guard := v_guard + 1;
    EXIT WHEN v_cursor IS NULL OR v_guard > 200;
  END LOOP;
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN (v_counters->'total'->>'count')::int = v_lines
         THEN 'pass'
         ELSE 'fail_' || (v_counters->'total'->>'count') || '_vs_' || v_lines::text END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') = 'pass',
  'T2: counters.total.count equals exhaustively paginated line count'
);

-- ===== T3 : parité par statut, pour CHAQUE valeur de l''enum =====
DO $$
DECLARE
  v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_counters JSONB;
  v_page JSONB;
  v_cursor TIMESTAMPTZ;
  v_lines INT;
  v_counter INT;
  v_guard INT;
  v_s TEXT;
  v_status TEXT := 'pass';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_counters_v1('2026-01-01', '2026-12-31', '{}'::jsonb) INTO v_counters;
  FOR v_s IN SELECT unnest(enum_range(NULL::order_status))::text LOOP
    v_cursor := NULL; v_lines := 0; v_guard := 0;
    LOOP
      SELECT get_orders_list_v2('2026-01-01', '2026-12-31',
        jsonb_build_object('status', v_s), 200, v_cursor) INTO v_page;
      v_lines := v_lines + jsonb_array_length(v_page->'lines');
      v_cursor := (v_page->>'next_cursor')::timestamptz;
      v_guard := v_guard + 1;
      EXIT WHEN v_cursor IS NULL OR v_guard > 200;
    END LOOP;
    v_counter := COALESCE((v_counters->'by_status'->v_s->>'count')::int, 0);
    IF v_counter <> v_lines THEN
      v_status := 'fail_' || v_s || '_' || v_counter::text || '_vs_' || v_lines::text;
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t3_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass') = 'pass',
  'T3: every by_status bucket equals the line count for that status'
);

-- ===== T4 : la clé status de p_filters est ignorée (D2) =====
DO $$
DECLARE
  v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_without JSONB;
  v_with JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_counters_v1('2026-01-01', '2026-12-31', '{}'::jsonb) INTO v_without;
  SELECT get_orders_counters_v1('2026-01-01', '2026-12-31',
    jsonb_build_object('status', 'completed')) INTO v_with;
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN v_without = v_with THEN 'pass' ELSE 'fail_status_applied' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t4_pass') = 'pass',
  'T4: a status key in p_filters never narrows the counters (ADR-025 D2)'
);

-- ===== T5 + T6 : parité payé / impayé (comptes ET sommes) =====
DO $$
DECLARE
  v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_counters JSONB;
  v_page JSONB;
  v_cursor TIMESTAMPTZ := NULL;
  v_guard INT := 0;
  v_paid_n INT := 0;   v_paid_amt NUMERIC := 0;
  v_unpaid_n INT := 0; v_unpaid_amt NUMERIC := 0;
  v_n INT; v_amt NUMERIC;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_counters_v1('2026-01-01', '2026-12-31', '{}'::jsonb) INTO v_counters;
  LOOP
    SELECT get_orders_list_v2('2026-01-01', '2026-12-31', '{}'::jsonb, 200, v_cursor) INTO v_page;
    -- payé = payment_method_primary non nul (il n''est nul que sans paiement)
    SELECT COUNT(*), COALESCE(SUM((l->>'total')::numeric), 0)
      INTO v_n, v_amt
      FROM jsonb_array_elements(v_page->'lines') l
      WHERE l->>'payment_method_primary' IS NOT NULL;
    v_paid_n := v_paid_n + v_n; v_paid_amt := v_paid_amt + v_amt;
    SELECT COUNT(*), COALESCE(SUM((l->>'total')::numeric), 0)
      INTO v_n, v_amt
      FROM jsonb_array_elements(v_page->'lines') l
      WHERE l->>'payment_method_primary' IS NULL AND l->>'status' <> 'voided';
    v_unpaid_n := v_unpaid_n + v_n; v_unpaid_amt := v_unpaid_amt + v_amt;
    v_cursor := (v_page->>'next_cursor')::timestamptz;
    v_guard := v_guard + 1;
    EXIT WHEN v_cursor IS NULL OR v_guard > 200;
  END LOOP;
  PERFORM set_config('breakery.t5_pass',
    CASE WHEN (v_counters->'paid'->>'count')::int = v_paid_n
          AND (v_counters->'paid'->>'amount')::numeric = v_paid_amt
         THEN 'pass'
         ELSE 'fail_' || (v_counters->'paid'->>'count') || '/' || (v_counters->'paid'->>'amount')
              || '_vs_' || v_paid_n::text || '/' || v_paid_amt::text END,
    false);
  PERFORM set_config('breakery.t6_pass',
    CASE WHEN (v_counters->'unpaid'->>'count')::int = v_unpaid_n
          AND (v_counters->'unpaid'->>'amount')::numeric = v_unpaid_amt
         THEN 'pass'
         ELSE 'fail_' || (v_counters->'unpaid'->>'count') || '/' || (v_counters->'unpaid'->>'amount')
              || '_vs_' || v_unpaid_n::text || '/' || v_unpaid_amt::text END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t5_pass') = 'pass',
  'T5: paid count and amount match lines carrying a payment'
);
SELECT ok(
  current_setting('breakery.t6_pass') = 'pass',
  'T6: unpaid count and amount match unpaid non-voided lines'
);

-- ===== T7 : fenêtre vide → zéros, pas d''absence =====
DO $$
DECLARE
  v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_counters JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_counters_v1('2020-01-01', '2020-01-02', '{}'::jsonb) INTO v_counters;
  PERFORM set_config('breakery.t7_pass',
    CASE WHEN (v_counters->'total'->>'count')::int = 0
          AND (v_counters->'total'->>'amount')::numeric = 0
          AND v_counters->'by_status' = '{}'::jsonb
         THEN 'pass' ELSE 'fail_' || v_counters::text END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t7_pass') = 'pass',
  'T7: empty window yields zero total and empty by_status (footer can say 0 of N)'
);

SELECT * FROM finish();
ROLLBACK;
