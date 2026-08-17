-- supabase/tests/ar_aging.test.sql
-- Rapport « AR aging B2B » — pgTAP pour get_ar_aging_v1 (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : le bucket se calcule par jours de
-- RETARD après échéance (émission + terms, défaut 30 j quand NULL — T4/T7) ;
-- l'encours d'une facture partiellement réglée est total − Σ allocations
-- (T5) ; et les trois vues du rapport (invoices, by_customer, summary) se
-- recoupent entre elles (T8-T10) — le snapshot étant ancré sur now(), les
-- assertions de somme sont des COHÉRENCES INTERNES, jamais des totaux
-- absolus qui casseraient dès qu'une vraie créance apparaît en dev.
--
--   T1  : happy path MANAGER — 8-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : by_bucket sort TOUJOURS les 5 buckets, dans l'ordre
--   T4  : chaque facture fixture atterrit dans son bucket
--   T5  : allocation partielle — settled 120k, outstanding 180k
--   T6  : une facture paid et une voided n'entrent nulle part
--   T7  : due_date = émission + terms (30 par défaut, 15 explicite)
--   T8  : Σ invoices.outstanding = summary.total_outstanding
--   T9  : Σ by_customer = summary ; les 5 colonnes buckets recoupent le total
--   T10 : overdue_total = total − bucket current ; montants exacts client Alpha
--   T11 : balance_cached exposé (réconciliation avec b2b_current_balance)
--   T12 : dso_90d non NULL avec allocation < 90 j ; oldest_days_late ≥ 115
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- Fixture : 2 clients B2B (terms NULL → 30 ; terms 15), 6 factures ouvertes
-- d'âges contrôlés, 1 allocation partielle (aussi support du DSO), 1 facture
-- paid et 1 voided (invisibles).
CREATE TEMP TABLE _ar_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS cust_a, gen_random_uuid() AS cust_b,
       gen_random_uuid() AS a1, gen_random_uuid() AS a2, gen_random_uuid() AS a3,
       gen_random_uuid() AS b1, gen_random_uuid() AS b2, gen_random_uuid() AS b3,
       gen_random_uuid() AS o_paid, gen_random_uuid() AS o_void,
       gen_random_uuid() AS pay1,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _ar_fix;

  INSERT INTO customers (id, name, customer_type, b2b_company_name,
                         b2b_payment_terms_days, b2b_credit_limit, b2b_current_balance)
  VALUES
    (f.cust_a, 'PGTAP AR Alpha', 'b2b', 'PT Alpha PGTAP', NULL, 20000000, 480000),
    (f.cust_b, 'PGTAP AR Beta',  'b2b', NULL,             15,   NULL,     290000);

  INSERT INTO orders (id, order_number, invoice_number, order_type, status,
                      subtotal, tax_amount, total, customer_id, created_at,
                      paid_at, voided_at, voided_by, void_reason)
  VALUES
    -- Alpha, terms 30 (défaut) : 10 j → current ; 45 j → retard 15 ; 100 j → retard 70.
    (f.a1, '#PGTAP-AR-A1', 'INV-AR-A1', 'b2b', 'b2b_pending', 100000, 0, 100000, f.cust_a, now() - interval '10 days',  NULL, NULL, NULL, NULL),
    (f.a2, '#PGTAP-AR-A2', 'INV-AR-A2', 'b2b', 'b2b_pending', 200000, 0, 200000, f.cust_a, now() - interval '45 days',  NULL, NULL, NULL, NULL),
    (f.a3, '#PGTAP-AR-A3', 'INV-AR-A3', 'b2b', 'b2b_pending', 300000, 0, 300000, f.cust_a, now() - interval '100 days', NULL, NULL, NULL, NULL),
    -- Beta, terms 15 : 20 j → retard 5 ; 130 j → retard 115 ; 60 j → retard 45.
    (f.b1, '#PGTAP-AR-B1', 'INV-AR-B1', 'b2b', 'b2b_pending', 150000, 0, 150000, f.cust_b, now() - interval '20 days',  NULL, NULL, NULL, NULL),
    (f.b2, '#PGTAP-AR-B2', 'INV-AR-B2', 'b2b', 'b2b_pending',  50000, 0,  50000, f.cust_b, now() - interval '130 days', NULL, NULL, NULL, NULL),
    (f.b3, '#PGTAP-AR-B3', 'INV-AR-B3', 'b2b', 'b2b_pending',  90000, 0,  90000, f.cust_b, now() - interval '60 days',  NULL, NULL, NULL, NULL),
    -- Invisibles : payée, et annulée (chk void : voided_at/by au même INSERT).
    (f.o_paid, '#PGTAP-AR-PD', NULL, 'b2b', 'paid',   999000, 0, 999000, f.cust_a, now() - interval '40 days', now() - interval '35 days', NULL, NULL, NULL),
    (f.o_void, '#PGTAP-AR-VD', NULL, 'b2b', 'voided', 888000, 0, 888000, f.cust_b, now() - interval '50 days', NULL, now() - interval '49 days', f.uid, 'pgtap fixture');

  -- Règlement partiel sur A3 : 120k il y a 5 j — réduit l'encours ET nourrit
  -- le DSO (délai émission → règlement : ~95 j).
  INSERT INTO b2b_payments (id, payment_number, customer_id, amount, method,
                            paid_at, created_by, allocation)
  VALUES (f.pay1, 'BP-PGTAP-0001', f.cust_a, 120000, 'transfer',
          now() - interval '5 days', f.uid, '[]'::jsonb);

  INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
  VALUES (f.pay1, f.a3, 120000);
END $$;

-- T1 happy path : 8 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  v_ok := (v_r ? 'as_of') AND (v_r ? 'timezone') AND (v_r ? 'generated_at')
      AND (v_r ? 'terms_default_days') AND (v_r ? 'summary')
      AND (v_r ? 'by_bucket') AND (v_r ? 'by_customer') AND (v_r ? 'invoices');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_ar_aging_v1 MANAGER happy path returns 8-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_ar_aging_v1();
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_ar_aging_v1 CASHIER raises 42501');

-- T3 les 5 buckets, toujours, dans l'ordre
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  v_ok := (jsonb_array_length(v_r->'by_bucket') = 5)
      AND (v_r->'by_bucket'->0->>'bucket' = 'current')
      AND (v_r->'by_bucket'->1->>'bucket' = 'late_1_30')
      AND (v_r->'by_bucket'->2->>'bucket' = 'late_31_60')
      AND (v_r->'by_bucket'->3->>'bucket' = 'late_61_90')
      AND (v_r->'by_bucket'->4->>'bucket' = 'late_90_plus');
  PERFORM set_config('breakery.t3', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: by_bucket always carries the 5 buckets, in order');

-- T4 chaque fixture dans son bucket
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  SELECT bool_and(CASE e->>'order_number'
           WHEN '#PGTAP-AR-A1' THEN e->>'bucket' = 'current'
           WHEN '#PGTAP-AR-A2' THEN e->>'bucket' = 'late_1_30'
           WHEN '#PGTAP-AR-A3' THEN e->>'bucket' = 'late_61_90'
           WHEN '#PGTAP-AR-B1' THEN e->>'bucket' = 'late_1_30'
           WHEN '#PGTAP-AR-B2' THEN e->>'bucket' = 'late_90_plus'
           WHEN '#PGTAP-AR-B3' THEN e->>'bucket' = 'late_31_60'
           ELSE true END)
     AND (COUNT(*) FILTER (WHERE e->>'order_number' LIKE '#PGTAP-AR-%') = 6)
    INTO v_ok
    FROM jsonb_array_elements(v_r->'invoices') e;
  PERFORM set_config('breakery.t4', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: each fixture invoice lands in its lateness bucket');

-- T5 allocation partielle
DO $$
DECLARE v_r JSONB; v_e JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  SELECT e INTO v_e FROM jsonb_array_elements(v_r->'invoices') e
   WHERE e->>'order_number' = '#PGTAP-AR-A3';
  v_ok := ((v_e->>'total')::numeric = 300000)
      AND ((v_e->>'settled')::numeric = 120000)
      AND ((v_e->>'outstanding')::numeric = 180000);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: a partially-settled invoice carries outstanding = total - allocations');

-- T6 paid et voided invisibles
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  v_ok := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_r->'invoices') e
    WHERE e->>'order_number' IN ('#PGTAP-AR-PD', '#PGTAP-AR-VD'));
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: a paid invoice and a voided invoice enter nothing');

-- T7 due_date = émission + terms (30 par défaut, 15 explicite)
DO $$
DECLARE v_r JSONB; v_a1 JSONB; v_b1 JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  SELECT e INTO v_a1 FROM jsonb_array_elements(v_r->'invoices') e
   WHERE e->>'order_number' = '#PGTAP-AR-A1';
  SELECT e INTO v_b1 FROM jsonb_array_elements(v_r->'invoices') e
   WHERE e->>'order_number' = '#PGTAP-AR-B1';
  v_ok := ((v_a1->>'due_date')::date = (v_a1->>'issued_on')::date + 30)
      AND ((v_b1->>'due_date')::date = (v_b1->>'issued_on')::date + 15);
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: due_date = issued_on + terms (default 30 when NULL, explicit 15 honored)');

-- T8 Σ invoices = summary.total_outstanding
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  SELECT SUM((e->>'outstanding')::numeric) = (v_r->'summary'->>'total_outstanding')::numeric
    INTO v_ok FROM jsonb_array_elements(v_r->'invoices') e;
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: sum of invoice outstandings reconciles with summary.total_outstanding');

-- T9 by_customer recoupe le summary et ses propres colonnes
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  SELECT (SUM((c->>'total_outstanding')::numeric)
            = (v_r->'summary'->>'total_outstanding')::numeric)
     AND bool_and(
           (c->>'current')::numeric + (c->>'late_1_30')::numeric
         + (c->>'late_31_60')::numeric + (c->>'late_61_90')::numeric
         + (c->>'late_90_plus')::numeric = (c->>'total_outstanding')::numeric)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_customer') c;
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: by_customer reconciles with the summary and its own bucket columns');

-- T10 overdue cohérent + montants exacts du client Alpha
DO $$
DECLARE v_r JSONB; v_c JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ar_fix;
  v_r := get_ar_aging_v1();
  SELECT c INTO v_c FROM jsonb_array_elements(v_r->'by_customer') c
   WHERE (c->>'customer_id')::uuid = f.cust_a;
  v_ok := ((v_r->'summary'->>'overdue_total')::numeric
             = (v_r->'summary'->>'total_outstanding')::numeric
               - (v_r->'by_bucket'->0->>'amount')::numeric)
      AND ((v_c->>'current')::numeric = 100000)
      AND ((v_c->>'late_1_30')::numeric = 200000)
      AND ((v_c->>'late_61_90')::numeric = 180000)
      AND ((v_c->>'total_outstanding')::numeric = 480000);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: overdue_total = total - current bucket; Alpha carries 100k/200k/180k = 480k');

-- T11 balance_cached exposé pour la réconciliation
DO $$
DECLARE v_r JSONB; v_c JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ar_fix;
  v_r := get_ar_aging_v1();
  SELECT c INTO v_c FROM jsonb_array_elements(v_r->'by_customer') c
   WHERE (c->>'customer_id')::uuid = f.cust_a;
  v_ok := ((v_c->>'balance_cached')::numeric = 480000)
      AND ((v_c->>'terms_days')::int = 30)
      AND ((v_c->>'credit_limit')::numeric = 20000000);
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: by_customer exposes balance_cached, terms and credit limit');

-- T12 DSO présent ; plus vieux retard ≥ 115 j
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_ar_aging_v1();
  v_ok := (v_r->'summary'->>'dso_90d') IS NOT NULL
      AND ((v_r->'summary'->>'oldest_days_late')::int >= 115);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: dso_90d is computed from recent allocations; oldest lateness >= 115 days');

SELECT * FROM finish();
ROLLBACK;
