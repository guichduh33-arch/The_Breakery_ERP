-- supabase/tests/sales_by_customer.test.sql
-- Rapport « Sales by Customer » — pgTAP pour get_sales_by_customer_v1 (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : l'identifié et l'anonyme ne se
-- mélangent jamais (T9 : by_day recoupe les deux totaux), le décrochage est
-- exact (≥ seuil en fenêtre précédente ET zéro en courante — T8/T12), et le
-- filtre de type ne touche QUE l'identifié (T10/T11).
--
--   T1  : happy path MANAGER — 8-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — début rogné, fin conservée
--   T5  : p_customer_type hors retail|b2b → P0001
--   T6  : fixture — synthèse : 410k identifié / 4 cmds / 3 clients / 2 nouveaux
--         / 40k anonyme / 180k identifié précédent
--   T7  : delta par client — B porte revenue_prev 80k et is_new=false ; A is_new=true
--   T8  : décrochage — C seul (2 achats déc., 0 jan.), 100k à risque
--   T9  : by_day recoupe — Σ identified = 410k ET Σ anonymous = 40k
--   T10 : filtre retail — 210k, 2 clients, C toujours en décrochage
--   T11 : filtre b2b — 200k, décrochage vide (C est retail)
--   T12 : seuil de décrochage 3 → personne (C n'a que 2 achats)
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (vide en dev, période préc. déc. 2026 vide).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- T1 happy path : 8 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary') AND (v_r ? 'by_customer')
      AND (v_r ? 'churned') AND (v_r ? 'by_day');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_sales_by_customer_v1 MANAGER happy path returns 8-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_customer_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_sales_by_customer_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_sales_by_customer_v1('2026-12-31', '2026-01-01');
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t3', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: end before start raises P0001');

-- T4 clamp 366 j
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2020-01-01', '2026-12-31');
  v_ok := ((v_r->'period'->>'start')::date = '2026-12-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2026-12-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 type inconnu → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_sales_by_customer_v1('2026-01-01', '2026-12-31', 'wholesale');
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t5', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: unknown customer type raises P0001');

-- Fixture T6–T12 : A retail nouveau (2 cmds jan), B retail récurrent (déc+jan),
-- C retail en décrochage (2 cmds déc, 0 jan), D b2b nouveau (1 cmde jan),
-- une commande anonyme (jan).
CREATE TEMP TABLE _sbc_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS ca, gen_random_uuid() AS cb, gen_random_uuid() AS cc,
       gen_random_uuid() AS cd,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _sbc_fix;
  INSERT INTO customers (id, name, customer_type) VALUES
    (f.ca, 'PGTAP Cust A', 'retail'),
    (f.cb, 'PGTAP Cust B', 'retail'),
    (f.cc, 'PGTAP Cust C', 'retail'),
    (f.cd, 'PGTAP Cust D', 'b2b');
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, paid_at, session_id, customer_id)
  VALUES
    ('#PGTAP-SBC-A1', 'take_out', 'paid', 100000, 0, 100000, '2027-01-05T10:00:00+08', f.sid, f.ca),
    ('#PGTAP-SBC-A2', 'take_out', 'paid',  50000, 0,  50000, '2027-01-18T10:00:00+08', f.sid, f.ca),
    ('#PGTAP-SBC-B1', 'take_out', 'paid',  80000, 0,  80000, '2026-12-10T10:00:00+08', f.sid, f.cb),
    ('#PGTAP-SBC-B2', 'take_out', 'paid',  60000, 0,  60000, '2027-01-12T10:00:00+08', f.sid, f.cb),
    ('#PGTAP-SBC-C1', 'take_out', 'paid',  70000, 0,  70000, '2026-12-08T10:00:00+08', f.sid, f.cc),
    ('#PGTAP-SBC-C2', 'take_out', 'paid',  30000, 0,  30000, '2026-12-20T10:00:00+08', f.sid, f.cc),
    ('#PGTAP-SBC-D1', 'b2b',      'paid', 200000, 0, 200000, '2027-01-20T10:00:00+08', f.sid, f.cd),
    ('#PGTAP-SBC-AN', 'take_out', 'paid',  40000, 0,  40000, '2027-01-09T10:00:00+08', f.sid, NULL);
END $$;

-- T6 synthèse
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'identified_revenue')::numeric = 410000)
      AND ((v_r->'summary'->>'identified_orders')::int = 4)
      AND ((v_r->'summary'->>'customer_count')::int = 3)
      AND ((v_r->'summary'->>'new_customer_count')::int = 2)
      AND ((v_r->'summary'->>'anonymous_revenue')::numeric = 40000)
      AND ((v_r->'summary'->>'identified_revenue_prev')::numeric = 180000);
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: fixture summary — 410k identified / 4 orders / 3 customers / 2 new / 40k anon / 180k prev');

-- T7 delta par client + is_new
DO $$
DECLARE v_r JSONB; v_a JSONB; v_b JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sbc_fix;
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_a FROM jsonb_array_elements(v_r->'by_customer') p
   WHERE (p->>'customer_id')::uuid = f.ca;
  SELECT p INTO v_b FROM jsonb_array_elements(v_r->'by_customer') p
   WHERE (p->>'customer_id')::uuid = f.cb;
  v_ok := ((v_a->>'is_new')::boolean = true)
      AND ((v_a->>'revenue')::numeric = 150000)
      AND ((v_b->>'is_new')::boolean = false)
      AND ((v_b->>'revenue')::numeric = 60000)
      AND ((v_b->>'revenue_prev')::numeric = 80000);
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: per-customer delta — B carries 80k prev and is_new=false, A is new');

-- T8 décrochage exact
DO $$
DECLARE v_r JSONB; v_c JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sbc_fix;
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_c FROM jsonb_array_elements(v_r->'churned') p
   WHERE (p->>'customer_id')::uuid = f.cc;
  v_ok := (jsonb_array_length(v_r->'churned') = 1)
      AND ((v_c->>'order_count_prev')::int = 2)
      AND ((v_c->>'revenue_prev')::numeric = 100000);
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: churned is exactly C — 2 orders in the previous window, none since');

-- T9 by_day recoupe les deux totaux
DO $$
DECLARE v_r JSONB; v_id NUMERIC; v_an NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31');
  SELECT COALESCE(SUM((d->>'identified')::numeric), 0),
         COALESCE(SUM((d->>'anonymous')::numeric), 0)
    INTO v_id, v_an FROM jsonb_array_elements(v_r->'by_day') d;
  v_ok := (v_id = (v_r->'summary'->>'identified_revenue')::numeric)
      AND (v_an = (v_r->'summary'->>'anonymous_revenue')::numeric);
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: by_day reconciles both identified and anonymous totals');

-- T10 filtre retail — l'identifié se restreint, C reste en décrochage
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sbc_fix;
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31', 'retail');
  v_ok := ((v_r->'summary'->>'identified_revenue')::numeric = 210000)
      AND ((v_r->'summary'->>'customer_count')::int = 2)
      AND (jsonb_array_length(v_r->'churned') = 1);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: retail filter — 210k, 2 customers, C still churned');

-- T11 filtre b2b — décrochage vide (C est retail)
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31', 'b2b');
  v_ok := ((v_r->'summary'->>'identified_revenue')::numeric = 200000)
      AND (jsonb_array_length(v_r->'churned') = 0);
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: b2b filter — 200k identified, no churned');

-- T12 seuil de décrochage à 3 → personne
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_customer_v1('2027-01-01', '2027-01-31', NULL, 3);
  v_ok := (jsonb_array_length(v_r->'churned') = 0);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: churn threshold 3 empties the churned list (C only has 2)');

SELECT * FROM finish();
ROLLBACK;
