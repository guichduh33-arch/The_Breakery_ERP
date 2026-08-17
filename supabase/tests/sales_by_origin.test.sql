-- supabase/tests/sales_by_origin.test.sql
-- Rapport « Ventes par origine » — pgTAP pour get_sales_by_origin_v1
-- (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : l'origine est LUE DANS LE NUMÉRO
-- source-codé (T8 — P/T1/T2/BO extraits, T1 et T2 jamais fusionnés) ; une
-- commande pré-numérotation n'entre NULLE PART (T6 — arbitrage : exclue, pas
-- de bucket Historique) ; et les trois vues se recoupent (T5/T12).
--
--   T1  : happy path MANAGER — 7-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — début rogné, fin conservée
--   T5  : summary — 500k / 5 commandes sur la fenêtre
--   T6  : une commande legacy (#…) n'entre nulle part
--   T7  : une commande voided n'entre nulle part
--   T8  : by_origin — P 150k/2, T1 80k/1, T2 70k/1, BO 200k/1
--   T9  : avg_ticket P = 75k
--   T10 : discount_total = remise commande + promo + points (P 10k, T1 5k)
--   T11 : fenêtre précédente — la commande de décembre en revenue_prev
--   T12 : Σ by_day (format long) = summary
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (vide en dev, période préc. déc. 2026).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

CREATE TEMP TABLE _so_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS o3,
       gen_random_uuid() AS o4, gen_random_uuid() AS o5, gen_random_uuid() AS o_leg,
       gen_random_uuid() AS o_void, gen_random_uuid() AS o_prev,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _so_fix;
  -- chk void : voided_at/by posés au même INSERT.
  INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total,
                      paid_at, session_id, discount_amount, promotion_total,
                      loyalty_redemption_amount, voided_at, voided_by, void_reason)
  VALUES
    (f.o1,     'P17012027001',    'take_out', 'paid',  110000, 0, 100000, '2027-01-17T10:00:00+08', f.sid, 10000, 0, 0, NULL, NULL, NULL),
    (f.o2,     'P17012027002',    'take_out', 'paid',   50000, 0,  50000, '2027-01-17T11:00:00+08', f.sid, 0, 0, 0, NULL, NULL, NULL),
    (f.o3,     'T117012027003',   'dine_in',  'paid',   85000, 0,  80000, '2027-01-17T12:00:00+08', f.sid, 0, 5000, 0, NULL, NULL, NULL),
    (f.o4,     'T217012027004',   'dine_in',  'paid',   70000, 0,  70000, '2027-01-18T10:00:00+08', f.sid, 0, 0, 0, NULL, NULL, NULL),
    (f.o5,     'BO17012027005',   'b2b',      'paid',  200000, 0, 200000, '2027-01-18T11:00:00+08', NULL,  0, 0, 0, NULL, NULL, NULL),
    (f.o_leg,  '#PGTAP-ORIG-LEG', 'take_out', 'paid',   60000, 0,  60000, '2027-01-17T13:00:00+08', f.sid, 0, 0, 0, NULL, NULL, NULL),
    (f.o_void, 'P17012027099',    'take_out', 'voided', 999000, 0, 999000, '2027-01-17T14:00:00+08', f.sid, 0, 0, 0, '2027-01-17T15:00:00+08', (SELECT uid FROM _so_fix), 'pgtap fixture'),
    (f.o_prev, 'P12122026001',    'take_out', 'paid',   40000, 0,  40000, '2026-12-12T10:00:00+08', f.sid, 0, 0, 0, NULL, NULL, NULL);
END $$;

-- T1 happy path : 7 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary')
      AND (v_r ? 'by_origin') AND (v_r ? 'by_day');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_sales_by_origin_v1 MANAGER happy path returns 7-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_sales_by_origin_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_sales_by_origin_v1('2027-01-31', '2027-01-01');
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
  v_r := get_sales_by_origin_v1('2020-01-01', '2027-01-31');
  v_ok := ((v_r->'period'->>'start')::date = '2027-01-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2027-01-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 summary
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'total_revenue')::numeric = 500000)
      AND ((v_r->'summary'->>'total_orders')::int = 5);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: summary carries 500k across 5 source-coded orders');

-- T6 legacy exclue partout
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT ((v_r->'summary'->>'total_revenue')::numeric = 500000)
     AND (SUM((b->>'revenue')::numeric) = 500000)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_origin') b;
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: a pre-cutover order number enters nothing (no Historical bucket)');

-- T7 voided exclue
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'total_revenue')::numeric = 500000);  -- pas 1 499k
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: a voided source-coded order enters nothing');

-- T8 origines extraites
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT bool_and(CASE b->>'origin'
           WHEN 'P'  THEN (b->>'revenue')::numeric = 150000 AND (b->>'orders')::int = 2
           WHEN 'T1' THEN (b->>'revenue')::numeric =  80000 AND (b->>'orders')::int = 1
           WHEN 'T2' THEN (b->>'revenue')::numeric =  70000 AND (b->>'orders')::int = 1
           WHEN 'BO' THEN (b->>'revenue')::numeric = 200000 AND (b->>'orders')::int = 1
           ELSE false END)
     AND (COUNT(*) = 4)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_origin') b;
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: P/T1/T2/BO are parsed from the number — T1 and T2 never merged');

-- T9 avg_ticket
DO $$
DECLARE v_r JSONB; v_b JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT b INTO v_b FROM jsonb_array_elements(v_r->'by_origin') b WHERE b->>'origin' = 'P';
  v_ok := ((v_b->>'avg_ticket')::numeric = 75000);
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: avg_ticket P = 150k / 2 = 75k');

-- T10 discount_total par origine
DO $$
DECLARE v_r JSONB; v_p JSONB; v_t1 JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT b INTO v_p  FROM jsonb_array_elements(v_r->'by_origin') b WHERE b->>'origin' = 'P';
  SELECT b INTO v_t1 FROM jsonb_array_elements(v_r->'by_origin') b WHERE b->>'origin' = 'T1';
  v_ok := ((v_p->>'discount_total')::numeric = 10000)
      AND ((v_t1->>'discount_total')::numeric = 5000);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: discount_total = order discount + promos + points, per origin');

-- T11 fenêtre précédente
DO $$
DECLARE v_r JSONB; v_p JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT b INTO v_p FROM jsonb_array_elements(v_r->'by_origin') b WHERE b->>'origin' = 'P';
  v_ok := ((v_r->'summary'->>'total_revenue_prev')::numeric = 40000)
      AND ((v_p->>'revenue_prev')::numeric = 40000);
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: the December order lands in the previous window, per origin too');

-- T12 by_day (format long) recoupe le summary
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_origin_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((d->>'revenue')::numeric) = (v_r->'summary'->>'total_revenue')::numeric)
     AND (SUM((d->>'orders')::int) = (v_r->'summary'->>'total_orders')::int)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_day') d;
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: the long-format by_day reconciles revenue and orders with the summary');

SELECT * FROM finish();
ROLLBACK;
