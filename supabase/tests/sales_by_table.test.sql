-- supabase/tests/sales_by_table.test.sql
-- Rapport « Ventes par table » — pgTAP pour get_sales_by_table_v1
-- (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : le périmètre est dine-in AVEC
-- table — une dine-in sans table (cas non autorisé, arbitrage 2026-08-17),
-- un take-out portant un nom de table et une voided n'entrent pas (T6-T8) ;
-- les seats se joignent par NOM en LEFT JOIN (T9-T10) ; la heatmap est en
-- jour ISO avec commandes ET CA (T11) ; et tout se recoupe (T12).
--
--   T1  : happy path MANAGER — 6-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours
--   T5  : summary — 350k / 4 commandes / 2 tables utilisées
--   T6  : une dine-in SANS table n'entre pas (cas non autorisé)
--   T7  : un take-out portant un nom de table n'entre pas
--   T8  : une dine-in voided n'entre pas
--   T9  : by_table A — seats joints par nom, 3 cmd / 260k / avg 86,7k / prev 50k
--   T10 : by_table B — seats 2, 1 cmd / 90k
--   T11 : heatmap ISO — A dim(7) 2 cmd 200k, A lun(1) 1 cmd, B lun(1) 1 cmd
--   T12 : Σ by_table = summary ; Σ heatmap.orders = summary.orders
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (17/01 = dimanche ISO 7, 18/01 = lundi 1).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

CREATE TEMP TABLE _st_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS ta, gen_random_uuid() AS tb,
       gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS o3,
       gen_random_uuid() AS o4, gen_random_uuid() AS o5, gen_random_uuid() AS o6,
       gen_random_uuid() AS o7, gen_random_uuid() AS o_prev,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _st_fix;

  INSERT INTO restaurant_tables (id, name, seats, is_active)
  VALUES
    (f.ta, 'PGTAP-TBL-A', 4, true),
    (f.tb, 'PGTAP-TBL-B', 2, true);

  -- chk void : voided_at/by posés au même INSERT.
  INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total,
                      paid_at, session_id, table_number, voided_at, voided_by, void_reason)
  VALUES
    (f.o1,     '#PGTAP-ST-1', 'dine_in',  'paid', 120000, 0, 120000, '2027-01-17T12:00:00+08', f.sid, 'PGTAP-TBL-A', NULL, NULL, NULL),
    (f.o2,     '#PGTAP-ST-2', 'dine_in',  'paid',  80000, 0,  80000, '2027-01-17T19:00:00+08', f.sid, 'PGTAP-TBL-A', NULL, NULL, NULL),
    (f.o3,     '#PGTAP-ST-3', 'dine_in',  'paid',  60000, 0,  60000, '2027-01-18T12:00:00+08', f.sid, 'PGTAP-TBL-A', NULL, NULL, NULL),
    (f.o4,     '#PGTAP-ST-4', 'dine_in',  'paid',  90000, 0,  90000, '2027-01-18T13:00:00+08', f.sid, 'PGTAP-TBL-B', NULL, NULL, NULL),
    -- Cas non autorisé : dine-in sans table — exclue (arbitrage).
    (f.o5,     '#PGTAP-ST-5', 'dine_in',  'paid', 999000, 0, 999000, '2027-01-18T14:00:00+08', f.sid, NULL,          NULL, NULL, NULL),
    -- Un take-out qui porterait un nom de table n'est pas de la salle.
    (f.o6,     '#PGTAP-ST-6', 'take_out', 'paid', 777000, 0, 777000, '2027-01-18T15:00:00+08', f.sid, 'PGTAP-TBL-A', NULL, NULL, NULL),
    (f.o7,     '#PGTAP-ST-7', 'dine_in',  'voided', 888000, 0, 888000, '2027-01-18T16:00:00+08', f.sid, 'PGTAP-TBL-A', '2027-01-18T17:00:00+08', (SELECT uid FROM _st_fix), 'pgtap fixture'),
    (f.o_prev, '#PGTAP-ST-P', 'dine_in',  'paid',  50000, 0,  50000, '2026-12-12T12:00:00+08', f.sid, 'PGTAP-TBL-A', NULL, NULL, NULL);
END $$;

-- T1 happy path : 6 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary')
      AND (v_r ? 'by_table') AND (v_r ? 'by_table_dow');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_sales_by_table_v1 MANAGER happy path returns 7-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_table_v1('2027-01-01', '2027-01-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_sales_by_table_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_sales_by_table_v1('2027-01-31', '2027-01-01');
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
  v_r := get_sales_by_table_v1('2020-01-01', '2027-01-31');
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
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'revenue')::numeric = 350000)
      AND ((v_r->'summary'->>'orders')::int = 4)
      AND ((v_r->'summary'->>'tables_used')::int = 2);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: summary — 350k across 4 orders on 2 tables');

-- T6 dine-in sans table exclue
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'revenue')::numeric = 350000);  -- pas 1 349k
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: a table-less dine-in (disallowed case) enters nothing');

-- T7 take-out exclu même avec un nom de table
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_r->'by_table') t
    WHERE (t->>'revenue')::numeric >= 777000)
    INTO v_ok;
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: a take-out carrying a table name is not floor revenue');

-- T8 voided exclue
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'orders')::int = 4);  -- pas 5
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: a voided dine-in enters nothing');

-- T9 by_table A — seats joints par nom
DO $$
DECLARE v_r JSONB; v_t JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  SELECT t INTO v_t FROM jsonb_array_elements(v_r->'by_table') t
   WHERE t->>'table_number' = 'PGTAP-TBL-A';
  v_ok := ((v_t->>'seats')::int = 4)
      AND ((v_t->>'orders')::int = 3)
      AND ((v_t->>'revenue')::numeric = 260000)
      AND ((v_t->>'avg_ticket')::numeric = 86667)
      AND ((v_t->>'revenue_prev')::numeric = 50000);
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: table A — seats joined by name, 3 orders / 260k / avg 86,7k / prev 50k');

-- T10 by_table B
DO $$
DECLARE v_r JSONB; v_t JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  SELECT t INTO v_t FROM jsonb_array_elements(v_r->'by_table') t
   WHERE t->>'table_number' = 'PGTAP-TBL-B';
  v_ok := ((v_t->>'seats')::int = 2)
      AND ((v_t->>'orders')::int = 1)
      AND ((v_t->>'revenue')::numeric = 90000);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: table B — seats 2, 1 order / 90k');

-- T11 heatmap ISO
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  SELECT bool_and(CASE
           WHEN d->>'table_number' = 'PGTAP-TBL-A' AND (d->>'dow')::int = 7
             THEN (d->>'orders')::int = 2 AND (d->>'revenue')::numeric = 200000
           WHEN d->>'table_number' = 'PGTAP-TBL-A' AND (d->>'dow')::int = 1
             THEN (d->>'orders')::int = 1 AND (d->>'revenue')::numeric = 60000
           WHEN d->>'table_number' = 'PGTAP-TBL-B' AND (d->>'dow')::int = 1
             THEN (d->>'orders')::int = 1 AND (d->>'revenue')::numeric = 90000
           ELSE true END)
     AND (COUNT(*) FILTER (WHERE d->>'table_number' LIKE 'PGTAP-TBL-%') = 3)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_table_dow') d;
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: heatmap in ISO days — Sunday(7) carries 2 orders on A, Monday(1) one each');

-- T12 tout se recoupe
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN; v_ok2 BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_table_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((t->>'revenue')::numeric) = (v_r->'summary'->>'revenue')::numeric)
     AND (SUM((t->>'orders')::int) = (v_r->'summary'->>'orders')::int)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_table') t;
  SELECT (SUM((d->>'orders')::int) = (v_r->'summary'->>'orders')::int)
    INTO v_ok2 FROM jsonb_array_elements(v_r->'by_table_dow') d;
  PERFORM set_config('breakery.t12', COALESCE(v_ok AND v_ok2, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: by_table and the heatmap both reconcile with the summary');

SELECT * FROM finish();
ROLLBACK;
