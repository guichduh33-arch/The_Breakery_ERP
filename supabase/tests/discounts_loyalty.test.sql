-- supabase/tests/discounts_loyalty.test.sql
-- Rapport « Discounts & Loyalty » — pgTAP pour get_discounts_loyalty_v1 (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : les quatre leviers ne se mélangent
-- pas et by_day les recoupe TOUS (T9) ; la remise PIN sort signée (motif +
-- autorisateur, T6) ; le flux de points est splitté par SIGNE — un `adjust`
-- positif est de l'émission, jamais du brûlé (T8).
--
--   T1  : happy path MANAGER — 8-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — début rogné, fin conservée
--   T5  : fixture — summary : ligne 15k / commande 50k / promo 30k /
--         points brûlés (valeur) 20k / pin_count 1 / gross 250k
--   T6  : la remise PIN sort signée — motif, autorisateur nommé, montant, n°
--   T7  : by_promotion — 1 application, 30k, description snapshotée
--   T8  : points par SIGNE — issued 300 (earn 250 + adjust 50), burned 2000
--   T9  : by_day recoupe LES QUATRE leviers (Σ by_day.X = summary.X)
--   T10 : by_day recoupe les points (Σ issued / Σ burned)
--   T11 : une commande VOIDED avec remise n'entre nulle part
--   T12 : fenêtre précédente — remise commande de déc. dans order_discount_prev
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
  v_r := get_discounts_loyalty_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary') AND (v_r ? 'by_day')
      AND (v_r ? 'pin_discounts') AND (v_r ? 'by_promotion');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_discounts_loyalty_v1 MANAGER happy path returns 8-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_discounts_loyalty_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_discounts_loyalty_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_discounts_loyalty_v1('2026-12-31', '2026-01-01');
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
  v_r := get_discounts_loyalty_v1('2020-01-01', '2026-12-31');
  v_ok := ((v_r->'period'->>'start')::date = '2026-12-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2026-12-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- Fixture T5–T12 : une commande canonique (jan 2027) portant LES QUATRE
-- leviers, une commande VOIDED avec remise (doit être invisible), une commande
-- de DÉCEMBRE avec remise (fenêtre précédente), un ledger earn/adjust/redeem.
CREATE TEMP TABLE _dl_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS oid, gen_random_uuid() AS oid_void, gen_random_uuid() AS oid_prev,
       gen_random_uuid() AS promo_id, gen_random_uuid() AS cust_id,
       (SELECT id FROM products WHERE is_test = false AND deleted_at IS NULL LIMIT 1) AS pid,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL AND full_name IS NOT NULL LIMIT 1) AS uid,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _dl_fix;
  INSERT INTO customers (id, name, customer_type) VALUES (f.cust_id, 'PGTAP DL Cust', 'retail');
  -- chk_promotion_type_fields : percentage exige discount_value ET scope.
  INSERT INTO promotions (id, name, slug, type, scope, discount_value)
  VALUES (f.promo_id, 'PGTAP Promo', 'pgtap-promo-dl', 'percentage', 'cart', 10);

  -- chk_orders_void_consistency : status='voided' exige voided_at/voided_by
  -- posés dans la MÊME ligne — pas d'UPDATE après coup.
  INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total, paid_at,
                      session_id, customer_id, discount_amount, discount_reason,
                      discount_authorized_by, promotion_total,
                      loyalty_redemption_amount, loyalty_points_redeemed, loyalty_points_earned,
                      voided_at, voided_by, void_reason)
  VALUES
    (f.oid, '#PGTAP-DL-1', 'take_out', 'paid', 295000, 0, 250000, '2027-01-10T10:00:00+08',
     f.sid, f.cust_id, 50000, 'geste commercial pgtap', f.uid, 30000, 20000, 2000, 250,
     NULL, NULL, NULL),
    (f.oid_void, '#PGTAP-DL-V', 'take_out', 'voided', 100000, 0, 100000, '2027-01-11T10:00:00+08',
     f.sid, NULL, 99999, 'void fixture', f.uid, 0, 0, 0, 0,
     '2027-01-11T11:00:00+08', f.uid, 'pgtap fixture'),
    (f.oid_prev, '#PGTAP-DL-P', 'take_out', 'paid', 80000, 0, 70000, '2026-12-12T10:00:00+08',
     f.sid, NULL, 10000, 'remise decembre', f.uid, 0, 0, 0, 0,
     NULL, NULL, NULL);

  -- Ligne remisée (15k), ligne annulée remisée (exclue), cadeau promo (exclu).
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total,
                           discount_amount, is_cancelled, cancelled_at, cancelled_by,
                           cancelled_reason, is_promo_gift)
  VALUES
    (f.oid, f.pid, 'Kept',      100000, 1, 85000, 15000, false, NULL,  NULL,  NULL,    false),
    (f.oid, f.pid, 'Cancelled',  50000, 1, 40000, 10000, true,  now(), (SELECT uid FROM _dl_fix), 'fixture', false),
    (f.oid, f.pid, 'Gift',       20000, 1, 0,     20000, false, NULL,  NULL,  NULL,    true);

  INSERT INTO promotion_applications (order_id, promotion_id, amount, description, created_at)
  VALUES (f.oid, f.promo_id, 30000, 'PGTAP Promo −10 % (snapshot)', '2027-01-10T10:00:00+08');

  INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points,
                                    points_balance_after, order_amount, description, created_at)
  VALUES
    (f.cust_id, f.oid, 'earn',   250,  250, 250000, 'pgtap earn',   '2027-01-10T10:01:00+08'),
    (f.cust_id, NULL,  'adjust',  50,  300, NULL,   'pgtap adjust', '2027-01-15T09:00:00+08'),
    (f.cust_id, f.oid, 'redeem', -2000, -1700, 250000, 'pgtap redeem', '2027-01-10T10:00:30+08');
END $$;

-- T5 summary : les quatre leviers + compteurs
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'line_discount')::numeric = 15000)
      AND ((v_r->'summary'->>'order_discount')::numeric = 50000)
      AND ((v_r->'summary'->>'promotion')::numeric = 30000)
      AND ((v_r->'summary'->>'redemption_value')::numeric = 20000)
      AND ((v_r->'summary'->>'pin_count')::int = 1)
      AND ((v_r->'summary'->>'gross_sales')::numeric = 250000);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: summary carries the four levers — 15k line / 50k order / 30k promo / 20k points');

-- T6 la remise PIN sort signée
DO $$
DECLARE v_r JSONB; v_e JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  SELECT e INTO v_e FROM jsonb_array_elements(v_r->'pin_discounts') e
   WHERE e->>'order_number' = '#PGTAP-DL-1';
  v_ok := ((v_e->>'amount')::numeric = 50000)
      AND (v_e->>'reason' = 'geste commercial pgtap')
      AND ((v_e->'authorized_by'->>'name') IS NOT NULL);
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: the PIN discount is signed — reason, named authorizer, amount, order number');

-- T7 by_promotion : snapshot lisible
DO $$
DECLARE v_r JSONB; v_p JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _dl_fix;
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_p FROM jsonb_array_elements(v_r->'by_promotion') p
   WHERE (p->>'promotion_id')::uuid = f.promo_id;
  v_ok := ((v_p->>'applications')::int = 1)
      AND ((v_p->>'amount')::numeric = 30000)
      AND (v_p->>'description' = 'PGTAP Promo −10 % (snapshot)');
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: by_promotion — one application, 30k, snapshot description');

-- T8 points par signe : adjust positif = émission
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'points_issued')::int = 300)
      AND ((v_r->'summary'->>'points_burned')::int = 2000);
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: ledger split by SIGN — issued 300 (earn 250 + adjust 50), burned 2000');

-- T9 by_day recoupe les quatre leviers
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((d->>'line_discount')::numeric)    = (v_r->'summary'->>'line_discount')::numeric)
     AND (SUM((d->>'order_discount')::numeric)   = (v_r->'summary'->>'order_discount')::numeric)
     AND (SUM((d->>'promotion')::numeric)        = (v_r->'summary'->>'promotion')::numeric)
     AND (SUM((d->>'redemption_value')::numeric) = (v_r->'summary'->>'redemption_value')::numeric)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_day') d;
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: by_day reconciles ALL four levers with the summary');

-- T10 by_day recoupe les points
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((d->>'points_issued')::int) = (v_r->'summary'->>'points_issued')::int)
     AND (SUM((d->>'points_burned')::int) = (v_r->'summary'->>'points_burned')::int)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_day') d;
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: by_day reconciles issued and burned points with the summary');

-- T11 une commande voided avec remise n'entre nulle part
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'order_discount')::numeric = 50000)  -- pas 149 999
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_r->'pin_discounts') e
        WHERE e->>'order_number' = '#PGTAP-DL-V'
      );
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: a voided order with a discount enters nothing');

-- T12 fenêtre précédente
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_discounts_loyalty_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'order_discount_prev')::numeric = 10000)
      AND ((v_r->'summary'->>'gross_sales_prev')::numeric = 70000);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: the December discount lands in order_discount_prev');

SELECT * FROM finish();
ROLLBACK;
