-- supabase/tests/refunds_report.test.sql
-- Rapport « Refunds & Voids » — pgTAP pour get_refunds_report_v1 (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : les trois flux ne se mélangent pas
-- (void + partiel = remboursé ; les lignes annulées avant paiement ne sont
-- JAMAIS dans le remboursé), et la table recoupe la synthèse (T12). Si l'une
-- de ces identités casse, le lecteur ne peut plus faire confiance à rien.
--
--   T1  : happy path MANAGER — 7-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — début rogné, fin demandée conservée
--   T5  : refunded == void_amount + partial_amount (toujours, même à vide)
--   T6  : fixture — synthèse : 2 événements, 1 void (45k), 1 partiel (100k)
--   T7  : familles de motif — « Erreur de saisie … » → input_error,
--         « double payment … » → duplicate
--   T8  : paiements du partiel — 2 méthodes, somme = total de l'événement
--   T9  : double signature — refunded_by porte le full_name du profil
--   T10 : gross_sales = total de la commande canonique de la fenêtre
--   T11 : lignes annulées à part — count/value, JAMAIS dans refunded
--   T12 : SUM(events.total) == summary.refunded — la table recoupe la synthèse
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (vide en dev, période préc. déc. 2026 vide).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- T1 happy path : 7 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary') AND (v_r ? 'events')
      AND (v_r ? 'cancelled_by_product');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_refunds_report_v1 MANAGER happy path returns 7-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_refunds_report_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_refunds_report_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_refunds_report_v1('2026-12-31', '2026-01-01');
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
  v_r := get_refunds_report_v1('2020-01-01', '2026-12-31');
  v_ok := ((v_r->'period'->>'start')::date = '2026-12-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2026-12-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 void + partiel = remboursé, toujours
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2026-01-01', '2026-12-31');
  v_ok := ((v_r->'summary'->>'void_amount')::numeric
         + (v_r->'summary'->>'partial_amount')::numeric
         = (v_r->'summary'->>'refunded')::numeric);
  PERFORM set_config('breakery.t5', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: void_amount + partial_amount equals summary.refunded');

-- Fixture T6–T12 : une commande payée (jan 2027), un remboursement partiel
-- (100k, 2 méthodes), un void (45k), une ligne annulée avant paiement (15k).
CREATE TEMP TABLE _rr_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS oid, gen_random_uuid() AS rid_partial, gen_random_uuid() AS rid_void,
       (SELECT id FROM products WHERE is_test = false AND deleted_at IS NULL LIMIT 1) AS pid,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL AND full_name IS NOT NULL LIMIT 1) AS uid,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _rr_fix;
  INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total, paid_at, session_id)
  VALUES (f.oid, '#PGTAP-RR', 'take_out', 'paid', 227273, 22727, 250000, '2027-01-10T10:00:00+08', f.sid);

  -- Ligne annulée AVANT paiement — friction, pas de sortie d'argent.
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total,
                           is_cancelled, cancelled_at, cancelled_by, cancelled_reason)
  VALUES (f.oid, f.pid, 'Cancelled fixture', 15000, 1, 15000,
          true, '2027-01-13T09:00:00+08', f.uid, 'erreur de saisie');

  INSERT INTO refunds (id, refund_number, order_id, session_id, total, tax_refunded, reason,
                       refunded_by, authorized_by, is_full_void, created_at)
  VALUES
    (f.rid_partial, 'RF-PGTAP-1', f.oid, f.sid, 100000, 9091, 'Erreur de saisie caissier',
     f.uid, f.uid, false, '2027-01-12T10:00:00+08'),
    (f.rid_void,    'RF-PGTAP-2', f.oid, f.sid, 45000, 4091, 'double payment detected',
     f.uid, f.uid, true,  '2027-01-14T15:00:00+08');

  INSERT INTO refund_payments (refund_id, method, amount)
  VALUES (f.rid_partial, 'cash', 60000), (f.rid_partial, 'qris', 40000);
END $$;

-- T6 synthèse
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'refunded')::numeric = 145000)
      AND ((v_r->'summary'->>'refund_count')::int = 2)
      AND ((v_r->'summary'->>'void_count')::int = 1)
      AND ((v_r->'summary'->>'void_amount')::numeric = 45000)
      AND ((v_r->'summary'->>'partial_amount')::numeric = 100000);
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: fixture summary — 2 events, 1 void (45k) + 1 partial (100k) = 145k');

-- T7 familles de motif
DO $$
DECLARE v_r JSONB; v_fam1 TEXT; v_fam2 TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  SELECT e->>'reason_family' INTO v_fam1
    FROM jsonb_array_elements(v_r->'events') e WHERE e->>'refund_number' = 'RF-PGTAP-1';
  SELECT e->>'reason_family' INTO v_fam2
    FROM jsonb_array_elements(v_r->'events') e WHERE e->>'refund_number' = 'RF-PGTAP-2';
  PERFORM set_config('breakery.t7',
    (v_fam1 = 'input_error' AND v_fam2 = 'duplicate')::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: free-text reasons map to input_error and duplicate families');

-- T8 paiements du partiel
DO $$
DECLARE v_r JSONB; v_e JSONB; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  SELECT e INTO v_e
    FROM jsonb_array_elements(v_r->'events') e WHERE e->>'refund_number' = 'RF-PGTAP-1';
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(v_e->'payments') p;
  v_ok := (jsonb_array_length(v_e->'payments') = 2) AND (v_sum = (v_e->>'total')::numeric);
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: split refund carries both methods and they sum to the event total');

-- T9 double signature
DO $$
DECLARE v_r JSONB; v_e JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  SELECT e INTO v_e
    FROM jsonb_array_elements(v_r->'events') e WHERE e->>'refund_number' = 'RF-PGTAP-1';
  v_ok := (v_e->'refunded_by'->>'name') IS NOT NULL
      AND (v_e->'authorized_by'->>'name') IS NOT NULL;
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: refunded_by and authorized_by resolve to profile full_name');

-- T10 CA brut de la fenêtre = la commande canonique
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'gross_sales')::numeric = 250000);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: gross_sales equals the canonical paid order total of the window');

-- T11 lignes annulées à part, jamais dans le remboursé
DO $$
DECLARE v_r JSONB; v_row JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _rr_fix;
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_row
    FROM jsonb_array_elements(v_r->'cancelled_by_product') p
   WHERE (p->>'product_id')::uuid = f.pid;
  v_ok := ((v_r->'summary'->'cancelled'->>'lines')::int = 1)
      AND ((v_r->'summary'->'cancelled'->>'value')::numeric = 15000)
      AND ((v_row->>'line_count')::int = 1)
      AND ((v_r->'summary'->>'refunded')::numeric = 145000);  -- 15k PAS dedans
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: cancelled lines live beside the money, never inside refunded');

-- T12 la table recoupe la synthèse
DO $$
DECLARE v_r JSONB; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_refunds_report_v1('2027-01-01', '2027-01-31');
  SELECT COALESCE(SUM((e->>'total')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(v_r->'events') e;
  v_ok := (v_sum = (v_r->'summary'->>'refunded')::numeric);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: SUM(events.total) reconciles with summary.refunded');

SELECT * FROM finish();
ROLLBACK;
