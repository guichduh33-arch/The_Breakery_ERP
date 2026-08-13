-- supabase/tests/b2b_dashboard_counters_v1.test.sql
-- ADR-026 — agrégats du dashboard B2B servis côté serveur.
-- Runs via psql (pgtap-pr.yml) ou MCP execute_sql, BEGIN ... ROLLBACK.
--
-- La fonction n'a pas de fenêtre paramétrée : les assertions sont des PARITÉS
-- contre le SQL naïf calculé dans la même transaction (même snapshot), plus un
-- DELTA après seed qui prouve qu'une ligne nouvelle traverse les agrégats.
-- Gardes négatives : CASHIER sans b2b.read (Permission denied) et appel non
-- authentifié (Authentication required) — les deux en 42501 (ADR-021 déc. 6).

BEGIN;
SELECT plan(7);

-- ===== T1 : gate négatif — CASHIER sans b2b.read, le BON 42501 =====
DO $$
DECLARE
  v_cashier_id UUID := (SELECT auth_user_id FROM user_profiles
                        WHERE role_code='CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
                        ORDER BY created_at LIMIT 1);
  v_status TEXT := 'fail_no_raise';
BEGIN
  IF v_cashier_id IS NULL THEN
    PERFORM set_config('breakery.t1_pass', 'fail_no_cashier_seed', false);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM get_b2b_dashboard_counters_v1();
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := CASE WHEN SQLERRM LIKE 'Permission denied%'
                     THEN 'pass' ELSE 'fail_wrong_42501: ' || SQLERRM END;
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t1_pass', true), 'missing') = 'pass',
  'T1: CASHIER without b2b.read raises Permission denied'
);

-- ===== T2 : gate négatif — non authentifié =====
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM get_b2b_dashboard_counters_v1();
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := CASE WHEN SQLERRM LIKE 'Authentication required%'
                     THEN 'pass' ELSE 'fail_wrong_42501: ' || SQLERRM END;
  END;
  PERFORM set_config('breakery.t2_pass', v_status, false);
END $$;
SELECT ok(
  COALESCE(current_setting('breakery.t2_pass', true), 'missing') = 'pass',
  'T2: unauthenticated call raises Authentication required'
);

-- Contexte MANAGER pour la suite
DO $$
DECLARE v_mgr UUID := (SELECT auth_user_id FROM user_profiles
                       WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
                       ORDER BY created_at LIMIT 1);
BEGIN
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'no MANAGER seed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
END $$;

-- ===== T3 : parité des comptes purs contre le SQL naïf =====
DO $$
DECLARE v_c JSONB;
BEGIN
  SELECT get_b2b_dashboard_counters_v1() INTO v_c;
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN (v_c->>'total_orders')::int   = (SELECT COUNT(*) FROM view_b2b_invoices)
          AND (v_c->>'pending_orders')::int = (SELECT COUNT(*) FROM view_b2b_invoices WHERE paid_at IS NULL)
          AND (v_c->>'active_clients')::int = (SELECT COUNT(DISTINCT customer_id) FROM view_b2b_invoices WHERE customer_id IS NOT NULL)
         THEN 'pass' ELSE 'fail_' || v_c::text END, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t3_pass', true), 'missing') = 'pass',
  'T3: total/pending/active match a naive count over view_b2b_invoices');

-- ===== T4 : parité du revenu mensuel (bornes de mois en fuseau métier) =====
DO $$
DECLARE v_c JSONB;
BEGIN
  SELECT get_b2b_dashboard_counters_v1() INTO v_c;
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN (v_c->>'monthly_revenue')::numeric =
              COALESCE((SELECT SUM(invoice_total) FROM view_b2b_invoices
                        WHERE invoice_date >= date_trunc('month', now())), 0)
          AND (v_c->>'prev_monthly_revenue')::numeric =
              COALESCE((SELECT SUM(invoice_total) FROM view_b2b_invoices
                        WHERE invoice_date >= date_trunc('month', now()) - interval '1 month'
                          AND invoice_date <  date_trunc('month', now())), 0)
         THEN 'pass' ELSE 'fail_' || v_c::text END, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t4_pass', true), 'missing') = 'pass',
  'T4: monthly and prev-monthly revenue match naive sums on business-TZ month bounds');

-- ===== T5 : parité encours + aging contre view_ar_aging =====
DO $$
DECLARE v_c JSONB; v_naive NUMERIC; v_bucket TEXT; v_status TEXT := 'pass';
BEGIN
  SELECT get_b2b_dashboard_counters_v1() INTO v_c;
  v_naive := COALESCE((SELECT SUM(total_outstanding) FROM view_ar_aging), 0);
  IF (v_c->>'outstanding_ar')::numeric <> v_naive THEN
    v_status := 'fail_outstanding_' || (v_c->>'outstanding_ar') || '_vs_' || v_naive::text;
  END IF;
  FOR v_bucket IN SELECT DISTINCT bucket FROM view_ar_aging LOOP
    IF COALESCE((v_c->'aging'->v_bucket->>'total')::numeric, -1) <>
       (SELECT COALESCE(SUM(total_outstanding), 0) FROM view_ar_aging WHERE bucket = v_bucket) THEN
      v_status := 'fail_bucket_' || v_bucket;
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t5_pass', v_status, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t5_pass', true), 'missing') = 'pass',
  'T5: outstanding AR and every aging bucket match view_ar_aging');

-- ===== T6 : top clients — bornés à 5, triés décroissant, tête exacte =====
DO $$
DECLARE v_c JSONB; v_top JSONB; v_status TEXT := 'pass'; v_max NUMERIC; i INT;
BEGIN
  SELECT get_b2b_dashboard_counters_v1() INTO v_c;
  v_top := v_c->'top_clients';
  IF jsonb_array_length(v_top) > 5 THEN v_status := 'fail_more_than_5'; END IF;
  FOR i IN 1 .. GREATEST(jsonb_array_length(v_top) - 1, 0) LOOP
    IF (v_top->(i-1)->>'total_spent')::numeric < (v_top->i->>'total_spent')::numeric THEN
      v_status := 'fail_not_sorted'; EXIT;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_top) > 0 THEN
    SELECT MAX(spent) INTO v_max FROM (
      SELECT SUM(invoice_total) AS spent FROM view_b2b_invoices
      WHERE customer_id IS NOT NULL GROUP BY customer_id
    ) s;
    IF (v_top->0->>'total_spent')::numeric <> v_max THEN v_status := 'fail_head_not_max'; END IF;
  END IF;
  PERFORM set_config('breakery.t6_pass', v_status, false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t6_pass', true), 'missing') = 'pass',
  'T6: top clients capped at 5, sorted desc, head equals the naive max spend');

-- ===== T7 : delta après seed — une facture neuve traverse les agrégats =====
DO $$
DECLARE
  v_before JSONB; v_after JSONB;
  v_cust UUID := (SELECT id FROM customers
                  WHERE customer_type = 'b2b' AND deleted_at IS NULL
                  ORDER BY created_at LIMIT 1);
BEGIN
  IF v_cust IS NULL THEN
    PERFORM set_config('breakery.t7_pass', 'fail_no_b2b_customer_seed', false);
    RETURN;
  END IF;
  SELECT get_b2b_dashboard_counters_v1() INTO v_before;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at, customer_id)
  VALUES ('ADR026-T7', 'b2b', 'b2b_pending', 77000, 0, 77000, now(), v_cust);
  SELECT get_b2b_dashboard_counters_v1() INTO v_after;
  PERFORM set_config('breakery.t7_pass',
    CASE WHEN (v_after->>'total_orders')::int   = (v_before->>'total_orders')::int + 1
          AND (v_after->>'monthly_revenue')::numeric = (v_before->>'monthly_revenue')::numeric + 77000
          AND (v_after->>'pending_orders')::int = (v_before->>'pending_orders')::int + 1
         THEN 'pass'
         ELSE 'fail_before_' || (v_before->>'total_orders') || '_after_' || (v_after->>'total_orders') END,
    false);
END $$;
SELECT ok(COALESCE(current_setting('breakery.t7_pass', true), 'missing') = 'pass',
  'T7: a freshly seeded b2b invoice moves total, pending and monthly revenue by exactly its own weight');

SELECT * FROM finish();
ROLLBACK;
