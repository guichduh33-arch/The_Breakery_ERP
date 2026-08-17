-- supabase/tests/supplier_payments.test.sql
-- Rapport « Règlements fournisseurs » — pgTAP pour get_supplier_payments_v1
-- (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : l'encours ne compte QUE les PO
-- reçus (T8 — un PO soldé ou annulé n'entre pas), HORS imports historiques
-- (T9 — arbitrage 2026-08-17) ; le solde d'un PO partiellement réglé est
-- total − Σ règlements (T7) ; et le délai moyen de règlement est pondéré par
-- montant (T11). L'encours étant un snapshot global, les assertions de somme
-- sont des COHÉRENCES INTERNES + valeurs exactes au grain fixture.
--
--   T1  : happy path MANAGER — 10-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — début rogné, fin conservée
--   T5  : décaissé fenêtre 500k (2 paiements) ; précédente 250k
--   T6  : Σ by_day = paid_total
--   T7  : PO partiellement réglé — settled 500k, outstanding 500k
--   T8  : un PO soldé et un PO annulé n'entrent pas dans l'encours
--   T9  : un PO d'import historique n'entre pas dans l'encours (arbitrage)
--   T10 : by_supplier recoupe le summary ; S1 500k, S2 400k exacts
--   T11 : délai moyen pondéré = 22 j (300k×20 + 200k×25) / 500k
--   T12 : la liste payments porte po_number et method
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (purchase_payments est VIDE en dev).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

CREATE TEMP TABLE _spp_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS s1, gen_random_uuid() AS s2,
       gen_random_uuid() AS po1, gen_random_uuid() AS po2, gen_random_uuid() AS po3,
       gen_random_uuid() AS po4, gen_random_uuid() AS po5,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _spp_fix;

  INSERT INTO suppliers (id, code, name) VALUES
    (f.s1, 'PGTAP-S1', 'PGTAP Supp Moulin'),
    (f.s2, 'PGTAP-S2', 'PGTAP Supp Butter');

  INSERT INTO purchase_orders (id, po_number, supplier_id, status, subtotal, vat_amount,
                               total_amount, order_date, received_date, is_historical_import)
  VALUES
    -- Partiellement réglé : 1 000k, deux règlements en janvier (500k) → solde 500k.
    (f.po1, 'PO-PGTAP-01', f.s1, 'received',  1000000, 0, 1000000, '2026-12-20', '2026-12-26', false),
    -- Jamais réglé : tout l'encours.
    (f.po2, 'PO-PGTAP-02', f.s2, 'received',   400000, 0,  400000, '2026-12-28', '2026-12-31', false),
    -- Soldé en décembre (fenêtre précédente) : hors encours.
    (f.po3, 'PO-PGTAP-03', f.s1, 'received',   250000, 0,  250000, '2026-12-01', '2026-12-05', false),
    -- Annulé : n'entre nulle part.
    (f.po4, 'PO-PGTAP-04', f.s1, 'cancelled',  999000, 0,  999000, '2026-12-10', NULL,         false),
    -- Import historique reçu : EXCLU de l'encours (arbitrage 2026-08-17).
    (f.po5, 'PO-PGTAP-05', f.s2, 'received',   888000, 0,  888000, '2026-11-01', '2026-11-05', true);

  INSERT INTO purchase_payments (purchase_order_id, amount, method, paid_at, paid_by,
                                 idempotency_key)
  VALUES
    -- Délais : 2027-01-15 − 2026-12-26 = 20 j ; 2027-01-20 − 2026-12-26 = 25 j.
    (f.po1, 300000, 'transfer', '2027-01-15T10:00:00+08', f.uid, gen_random_uuid()),
    (f.po1, 200000, 'cash',     '2027-01-20T10:00:00+08', f.uid, gen_random_uuid()),
    (f.po3, 250000, 'transfer', '2026-12-10T10:00:00+08', f.uid, gen_random_uuid());
END $$;

-- T1 happy path : 10 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'as_of') AND (v_r ? 'generated_at') AND (v_r ? 'summary')
      AND (v_r ? 'by_day') AND (v_r ? 'by_supplier_outstanding')
      AND (v_r ? 'open_pos') AND (v_r ? 'payments');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_supplier_payments_v1 MANAGER happy path returns 10-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_supplier_payments_v1('2027-01-01', '2027-01-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_supplier_payments_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_supplier_payments_v1('2027-01-31', '2027-01-01');
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
  v_r := get_supplier_payments_v1('2020-01-01', '2027-01-31');
  v_ok := ((v_r->'period'->>'start')::date = '2027-01-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2027-01-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 décaissé fenêtre + précédente
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'paid_total')::numeric = 500000)
      AND ((v_r->'summary'->>'payments_count')::int = 2)
      AND ((v_r->'summary'->>'paid_total_prev')::numeric = 250000);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: 500k paid across 2 payments in the window; 250k in the previous one');

-- T6 by_day recoupe
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((d->>'amount')::numeric) = (v_r->'summary'->>'paid_total')::numeric)
     AND (SUM((d->>'count')::int) = (v_r->'summary'->>'payments_count')::int)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_day') d;
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: by_day reconciles amount and count with the summary');

-- T7 PO partiellement réglé
DO $$
DECLARE v_r JSONB; v_p JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_p FROM jsonb_array_elements(v_r->'open_pos') p
   WHERE p->>'po_number' = 'PO-PGTAP-01';
  v_ok := ((v_p->>'total')::numeric = 1000000)
      AND ((v_p->>'settled')::numeric = 500000)
      AND ((v_p->>'outstanding')::numeric = 500000);
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: a partially-settled PO carries outstanding = total - payments');

-- T8 soldé et annulé hors encours
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  v_ok := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_r->'open_pos') p
    WHERE p->>'po_number' IN ('PO-PGTAP-03', 'PO-PGTAP-04'));
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: a fully-settled PO and a cancelled PO enter no outstanding');

-- T9 import historique hors encours
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  v_ok := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_r->'open_pos') p
    WHERE p->>'po_number' = 'PO-PGTAP-05');
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: a historical-import PO is excluded from the outstanding (arbitrage)');

-- T10 by_supplier recoupe + valeurs exactes
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _spp_fix;
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((s->>'outstanding')::numeric)
            = (v_r->'summary'->>'outstanding_total')::numeric)
     AND bool_and(CASE (s->>'supplier_id')::uuid
           WHEN f.s1 THEN (s->>'outstanding')::numeric = 500000 AND (s->>'po_count')::int = 1
           WHEN f.s2 THEN (s->>'outstanding')::numeric = 400000 AND (s->>'po_count')::int = 1
           ELSE true END)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_supplier_outstanding') s;
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: by_supplier reconciles with the summary; S1 500k / S2 400k exact');

-- T11 délai moyen pondéré
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'avg_settlement_days')::numeric = 22);
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: settlement delay is amount-weighted — (300k x 20 + 200k x 25) / 500k = 22 d');

-- T12 la liste payments est exploitable
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_supplier_payments_v1('2027-01-01', '2027-01-31');
  SELECT (COUNT(*) = 2)
     AND bool_and((p->>'po_number') IS NOT NULL AND (p->>'method') IS NOT NULL
                  AND (p->>'supplier_name') IS NOT NULL)
    INTO v_ok FROM jsonb_array_elements(v_r->'payments') p;
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: the payments list carries po_number, method and supplier');

SELECT * FROM finish();
ROLLBACK;
