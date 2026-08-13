-- supabase/tests/orders_counters_v2.test.sql
-- ADR-025 (amendé, review PR #367) — compteurs de la liste des commandes.
-- Runs via psql (pgtap-pr.yml) ou MCP execute_sql, BEGIN ... ROLLBACK.
--
-- Reprise complète après review (findings 1, 3, 11) :
--   · SEED déterministe dans la transaction (fenêtre isolée 2024-01-15) —
--     plus aucune assertion vacueuse sur fenêtre vide ;
--   · le cas B2B est éprouvé : une commande RÉGLÉE PAR STATUT sans ligne
--     order_payments compte dans le panier payé ;
--   · keyset v3 éprouvé : pagination limit 2 sur 7 lignes dont deux à
--     created_at IDENTIQUE — 7 ids distincts collectés, zéro perte/doublon ;
--   · T1 négatif durci : échec si le seed CASHIER manque, et le 42501 doit
--     porter 'Permission denied%' (pas 'Authentication required') ;
--   · current_setting(..., true) partout — un bloc DO qui meurt rend un
--     'not ok' diagnostiqué, plus un abort de fichier.
--
-- Seed sans détonation de triggers : INSERT en 'paid' est évité (le trigger
-- JE d'INSERT ne vise que 'paid' ; 'completed' ne déclenche rien), customer_id
-- reste NULL (trigger notify), et le trigger JE des refunds est DEFERRED — il
-- ne s'exécute jamais sous ROLLBACK.

BEGIN;
SELECT plan(9);

-- ===== Seed =====
DO $$
DECLARE
  v_sess UUID := (SELECT id FROM pos_sessions ORDER BY opened_at LIMIT 1);
  v_user UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1);
  o_c UUID; o_e UUID; o_f UUID;
BEGIN
  IF v_sess IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'seed prerequisites missing: pos_sessions or user_profiles empty';
  END IF;

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-A', 'pending_payment', 10000, 0, 10000, '2024-01-15T02:00:00Z', v_sess);
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-B', 'draft', 20000, 0, 20000, '2024-01-15T03:00:00Z', v_sess);
  -- G partage EXACTEMENT le created_at de B : c'est le cas que le keyset v3
  -- doit départager par id sans perdre de ligne.
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-G', 'draft', 5000, 0, 5000, '2024-01-15T03:00:00Z', v_sess);
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-C', 'completed', 30000, 0, 30000, '2024-01-15T04:00:00Z', v_sess)
  RETURNING id INTO o_c;
  -- D : réglée PAR STATUT, sans ligne order_payments — le cas B2B (finding 1).
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-D', 'completed', 40000, 0, 40000, '2024-01-15T05:00:00Z', v_sess);
  -- E annulée : chk_orders_void_consistency exige voided_at/by/reason.
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id,
                      voided_at, voided_by, void_reason)
  VALUES ('RVW367-E', 'voided', 50000, 0, 50000, '2024-01-15T06:00:00Z', v_sess,
          '2024-01-15T06:30:00Z', v_user, 'review seed void')
  RETURNING id INTO o_e;
  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_at, session_id)
  VALUES ('RVW367-F', 'completed', 60000, 0, 60000, '2024-01-15T07:00:00Z', v_sess)
  RETURNING id INTO o_f;

  INSERT INTO order_payments (order_id, method, amount) VALUES
    (o_c, 'cash', 30000), (o_e, 'cash', 50000), (o_f, 'cash', 60000);

  INSERT INTO refunds (refund_number, order_id, session_id, total, reason, refunded_by, authorized_by)
  VALUES ('RVW367-R1', o_f, v_sess, 15000, 'review seed', v_user, v_user);
END $$;

-- ===== T1 : gate négatif — CASHIER sans orders.read, et le BON 42501 =====
DO $$
DECLARE
  v_cashier_id UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
  v_status TEXT := 'fail_no_raise';
BEGIN
  IF v_cashier_id IS NULL THEN
    PERFORM set_config('breakery.t1_pass', 'fail_no_cashier_seed', false);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM get_orders_counters_v2('2024-01-15', '2024-01-15', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := CASE WHEN SQLERRM LIKE 'Permission denied%'
                     THEN 'pass' ELSE 'fail_wrong_42501: ' || SQLERRM END;
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t1_pass', true), 'missing') = 'pass',
  'T1: CASHIER without orders.read raises Permission denied (not an auth fallback)'
);

-- Contexte MANAGER pour la suite
DO $$
DECLARE v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
BEGIN
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'no MANAGER seed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
END $$;

-- ===== T2-T5 : la fenêtre seedée, chiffres exacts =====
DO $$
DECLARE v_c JSONB;
BEGIN
  SELECT get_orders_counters_v2('2024-01-15', '2024-01-15', '{}'::jsonb) INTO v_c;
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN (v_c->'total'->>'count')::int = 7 AND (v_c->'total'->>'amount')::numeric = 215000
         THEN 'pass' ELSE 'fail_' || (v_c->'total')::text END, false);
  -- B2B : RVW367-D (completed, AUCUN paiement) DOIT compter réglée.
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN (v_c->'paid'->>'count')::int = 3 AND (v_c->'paid'->>'amount')::numeric = 130000
         THEN 'pass' ELSE 'fail_' || (v_c->'paid')::text END, false);
  -- voided (E) dans AUCUN panier : 7 = 3 réglées + 3 impayées + 1 annulée.
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN (v_c->'unpaid'->>'count')::int = 3 AND (v_c->'unpaid'->>'amount')::numeric = 35000
         THEN 'pass' ELSE 'fail_' || (v_c->'unpaid')::text END, false);
  PERFORM set_config('breakery.t5_pass',
    CASE WHEN (v_c->'refunded'->>'count')::int = 1 AND (v_c->'refunded'->>'amount')::numeric = 15000
         THEN 'pass' ELSE 'fail_' || COALESCE((v_c->'refunded')::text, 'absent') END, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t2_pass', true), 'missing') = 'pass',
  'T2: seeded window total = 7 orders / 215000');
SELECT ok(COALESCE(current_setting('breakery.t3_pass', true), 'missing') = 'pass',
  'T3: settled-by-status order (no payment row) counts as paid — B2B case');
SELECT ok(COALESCE(current_setting('breakery.t4_pass', true), 'missing') = 'pass',
  'T4: voided order sits in neither paid nor unpaid');
SELECT ok(COALESCE(current_setting('breakery.t5_pass', true), 'missing') = 'pass',
  'T5: refunded cell carries the window refund total');

-- ===== T6 : la clé status de p_filters est ignorée (D2) =====
DO $$
DECLARE v_without JSONB; v_with JSONB;
BEGIN
  SELECT get_orders_counters_v2('2024-01-15', '2024-01-15', '{}'::jsonb) INTO v_without;
  SELECT get_orders_counters_v2('2024-01-15', '2024-01-15', jsonb_build_object('status', 'completed')) INTO v_with;
  PERFORM set_config('breakery.t6_pass',
    CASE WHEN v_without = v_with THEN 'pass' ELSE 'fail_status_applied' END, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t6_pass', true), 'missing') = 'pass',
  'T6: a status key in p_filters never narrows the counters (ADR-025 D2)');

-- ===== T7 : parité by_status vs lignes v3, par statut seedé (D4) =====
DO $$
DECLARE
  v_c JSONB; v_page JSONB; v_s TEXT; v_counter INT; v_lines INT;
  v_status TEXT := 'pass';
BEGIN
  SELECT get_orders_counters_v2('2024-01-15', '2024-01-15', '{}'::jsonb) INTO v_c;
  FOR v_s IN SELECT unnest(enum_range(NULL::order_status))::text LOOP
    SELECT get_orders_list_v4('2024-01-15', '2024-01-15',
      jsonb_build_object('status', v_s), 200, NULL, NULL) INTO v_page;
    v_lines := jsonb_array_length(v_page->'lines');
    v_counter := COALESCE((v_c->'by_status'->v_s->>'count')::int, 0);
    IF v_counter <> v_lines THEN
      v_status := 'fail_' || v_s || '_' || v_counter::text || '_vs_' || v_lines::text;
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t7_pass', v_status, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t7_pass', true), 'missing') = 'pass',
  'T7: every by_status bucket equals the v3 line count for that status (seeded window)');

-- ===== T8 : keyset v3 — pagination limit 2, tie de created_at, zéro perte =====
DO $$
DECLARE
  v_page JSONB; v_cursor TEXT := NULL; v_cursor_id UUID := NULL;
  v_ids TEXT[] := '{}'; v_guard INT := 0; l JSONB;
BEGIN
  LOOP
    -- v4 : positions 5-6 = p_sort/p_dir ; le curseur (texte, id) suit.
    SELECT get_orders_list_v4('2024-01-15', '2024-01-15', '{}'::jsonb, 2, 'created_at', 'desc', v_cursor, v_cursor_id) INTO v_page;
    FOR l IN SELECT * FROM jsonb_array_elements(v_page->'lines') LOOP
      v_ids := v_ids || (l->>'id');
    END LOOP;
    v_cursor    := v_page->>'next_cursor_val';
    v_cursor_id := (v_page->>'next_cursor_id')::uuid;
    v_guard := v_guard + 1;
    EXIT WHEN v_cursor IS NULL OR v_guard > 20;
  END LOOP;
  PERFORM set_config('breakery.t8_pass',
    CASE WHEN array_length(v_ids, 1) = 7
          AND (SELECT COUNT(DISTINCT x) FROM unnest(v_ids) x) = 7
         THEN 'pass'
         ELSE 'fail_' || COALESCE(array_length(v_ids, 1), 0)::text || '_rows_'
              || (SELECT COUNT(DISTINCT x) FROM unnest(v_ids) x)::text || '_distinct' END,
    false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t8_pass', true), 'missing') = 'pass',
  'T8: keyset pagination walks all 7 seeded rows, tied timestamps included, no loss no dup');

-- ===== T9 : fenêtre vide → zéros, pas d'absence =====
DO $$
DECLARE v_c JSONB;
BEGIN
  SELECT get_orders_counters_v2('2020-01-01', '2020-01-02', '{}'::jsonb) INTO v_c;
  PERFORM set_config('breakery.t9_pass',
    CASE WHEN (v_c->'total'->>'count')::int = 0
          AND (v_c->'total'->>'amount')::numeric = 0
          AND v_c->'by_status' = '{}'::jsonb
         THEN 'pass' ELSE 'fail_' || v_c::text END, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t9_pass', true), 'missing') = 'pass',
  'T9: empty window yields zero total and empty by_status (footer can say 0 of N)');

SELECT * FROM finish();
ROLLBACK;
