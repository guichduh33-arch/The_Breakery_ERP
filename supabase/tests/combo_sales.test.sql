-- supabase/tests/combo_sales.test.sql
-- Rapport « Ventes de combos » — pgTAP pour get_combo_sales_v1 (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : une ligne combo est identifiée par
-- combo_components NON NULL — une ligne annulée ou un cadeau promo n'entre
-- pas (T8/T9) ; l'uplift compare le panier des commandes AVEC combo à celles
-- SANS (T7) ; et les picks de composants sont pondérés par la quantité de
-- ligne (T11 — un combo ×2 compte ses composants ×2).
--
--   T1  : happy path MANAGER — 7-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours
--   T5  : summary — 260k / 3 combos / 2 commandes
--   T6  : gross_sales porte TOUTES les commandes canoniques (394k)
--   T7  : uplift — avg avec 138k, avg sans 39 333
--   T8  : une ligne combo annulée n'entre pas
--   T9  : un cadeau promo combo n'entre pas
--   T10 : by_combo — name_snapshot, qty 3, prix effectif moyen 86 667
--   T11 : component_picks pondérés par la quantité de ligne (3 et 3)
--   T12 : by_day recoupe le summary ; décembre en combo_revenue_prev
--
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Fenêtre de fixture : janvier 2027 (0 vente combo en dev).
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

CREATE TEMP TABLE _cs_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS combo1, gen_random_uuid() AS k1, gen_random_uuid() AS k2,
       gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS o3,
       gen_random_uuid() AS o4, gen_random_uuid() AS o5, gen_random_uuid() AS o_prev,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid,
       (SELECT session_id FROM orders WHERE session_id IS NOT NULL LIMIT 1) AS sid,
       (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1) AS cat;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _cs_fix;

  INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  VALUES
    (f.combo1, 'PGTAP-CS-C1', 'PGTAP Combo Breakfast', f.cat, 90000, 'combo'),
    (f.k1,     'PGTAP-CS-K1', 'PGTAP Comp Croissant',  f.cat, 25000, 'finished'),
    (f.k2,     'PGTAP-CS-K2', 'PGTAP Comp Americano',  f.cat, 30000, 'finished');

  INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total,
                      paid_at, session_id)
  VALUES
    (f.o1,     '#PGTAP-CS-1', 'take_out', 'paid',  96000, 0,  96000, '2027-01-17T09:00:00+08', f.sid),
    (f.o2,     '#PGTAP-CS-2', 'dine_in',  'paid', 180000, 0, 180000, '2027-01-18T09:00:00+08', f.sid),
    (f.o3,     '#PGTAP-CS-3', 'take_out', 'paid',  58000, 0,  58000, '2027-01-18T10:00:00+08', f.sid),
    (f.o4,     '#PGTAP-CS-4', 'take_out', 'paid',  40000, 0,  40000, '2027-01-19T10:00:00+08', f.sid),
    (f.o5,     '#PGTAP-CS-5', 'take_out', 'paid',  20000, 0,  20000, '2027-01-19T11:00:00+08', f.sid),
    (f.o_prev, '#PGTAP-CS-P', 'take_out', 'paid',  45000, 0,  45000, '2026-12-12T10:00:00+08', f.sid);

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity,
                           line_total, combo_components, is_cancelled, cancelled_at,
                           cancelled_by, cancelled_reason, is_promo_gift)
  VALUES
    -- O1 : un combo (90k) + une ligne simple (6k, hors combo).
    (f.o1, f.combo1, 'PGTAP Combo Breakfast', 90000, 1, 90000,
     jsonb_build_array(
       jsonb_build_object('product_id', (SELECT k1 FROM _cs_fix), 'quantity', 1),
       jsonb_build_object('product_id', (SELECT k2 FROM _cs_fix), 'quantity', 1)),
     false, NULL, NULL, NULL, false),
    (f.o1, f.k1, 'PGTAP Comp Croissant', 6000, 1, 6000, NULL, false, NULL, NULL, NULL, false),
    -- O2 : deux combos sur UNE ligne (qty 2, 170k) — les picks se pondèrent.
    (f.o2, f.combo1, 'PGTAP Combo Breakfast', 85000, 2, 170000,
     jsonb_build_array(
       jsonb_build_object('product_id', (SELECT k1 FROM _cs_fix), 'quantity', 1),
       jsonb_build_object('product_id', (SELECT k2 FROM _cs_fix), 'quantity', 1)),
     false, NULL, NULL, NULL, false),
    -- O3 : pas de combo (référence avg_without).
    (f.o3, f.k1, 'PGTAP Comp Croissant', 58000, 1, 58000, NULL, false, NULL, NULL, NULL, false),
    -- O4 : ligne combo ANNULÉE (chk : cancelled_at/by au même INSERT).
    (f.o4, f.combo1, 'PGTAP Combo Breakfast', 50000, 1, 50000,
     jsonb_build_array(jsonb_build_object('product_id', (SELECT k1 FROM _cs_fix), 'quantity', 1)),
     true, now(), (SELECT uid FROM _cs_fix), 'pgtap fixture', false),
    -- O5 : combo CADEAU promo (line_total 0) — exclu du CA combo.
    (f.o5, f.combo1, 'PGTAP Combo Breakfast', 0, 1, 0,
     jsonb_build_array(jsonb_build_object('product_id', (SELECT k2 FROM _cs_fix), 'quantity', 1)),
     false, NULL, NULL, NULL, true),
    -- Décembre : fenêtre précédente.
    (f.o_prev, f.combo1, 'PGTAP Combo Breakfast', 45000, 1, 45000,
     jsonb_build_array(jsonb_build_object('product_id', (SELECT k1 FROM _cs_fix), 'quantity', 1)),
     false, NULL, NULL, NULL, false);
END $$;

-- T1 happy path : 7 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'timezone')
      AND (v_r ? 'generated_at') AND (v_r ? 'summary')
      AND (v_r ? 'by_day') AND (v_r ? 'by_combo') AND (v_r ? 'component_picks');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_combo_sales_v1 MANAGER happy path returns 8-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_combo_sales_v1('2027-01-01', '2027-01-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_combo_sales_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_combo_sales_v1('2027-01-31', '2027-01-01');
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
  v_r := get_combo_sales_v1('2020-01-01', '2027-01-31');
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
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'combo_revenue')::numeric = 260000)
      AND ((v_r->'summary'->>'combo_qty')::numeric = 3)
      AND ((v_r->'summary'->>'combo_orders')::int = 2);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: summary — 260k across 3 combos in 2 orders');

-- T6 gross_sales = toutes les commandes canoniques
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'gross_sales')::numeric = 394000);
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: gross_sales carries every canonical order (394k) — the share closes on it');

-- T7 uplift
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'avg_ticket_with')::numeric = 138000)
      AND ((v_r->'summary'->>'avg_ticket_without')::numeric = 39333);
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: avg ticket with combo 138k vs without 39,3k — the uplift is real data');

-- T8 ligne annulée exclue
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'combo_revenue')::numeric = 260000);  -- pas 310k
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: a cancelled combo line enters nothing');

-- T9 cadeau promo exclu
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  v_ok := ((v_r->'summary'->>'combo_qty')::numeric = 3)  -- pas 4
      AND ((v_r->'summary'->>'combo_orders')::int = 2);   -- O5 n'est pas une commande combo
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: a promo-gift combo enters nothing — a free combo is not combo revenue');

-- T10 by_combo
DO $$
DECLARE v_r JSONB; v_c JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _cs_fix;
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  SELECT c INTO v_c FROM jsonb_array_elements(v_r->'by_combo') c
   WHERE (c->>'product_id')::uuid = f.combo1;
  v_ok := (v_c->>'name' = 'PGTAP Combo Breakfast')
      AND ((v_c->>'qty')::numeric = 3)
      AND ((v_c->>'revenue')::numeric = 260000)
      AND ((v_c->>'avg_price')::numeric = 86667);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: by_combo carries the snapshot name and the effective avg price (86,7k)');

-- T11 picks pondérés
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _cs_fix;
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  SELECT bool_and(CASE (p->>'product_id')::uuid
           WHEN f.k1 THEN (p->>'qty')::numeric = 3   -- 1×1 (O1) + 1×2 (O2)
           WHEN f.k2 THEN (p->>'qty')::numeric = 3
           ELSE true END)
     AND (COUNT(*) FILTER (WHERE (p->>'product_id')::uuid IN (f.k1, f.k2)) = 2)
    INTO v_ok FROM jsonb_array_elements(v_r->'component_picks') p;
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: component picks are weighted by line quantity — a x2 combo counts twice');

-- T12 by_day recoupe + prev
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_combo_sales_v1('2027-01-01', '2027-01-31');
  SELECT (SUM((d->>'revenue')::numeric) = (v_r->'summary'->>'combo_revenue')::numeric)
     AND (SUM((d->>'qty')::numeric) = (v_r->'summary'->>'combo_qty')::numeric)
     AND ((v_r->'summary'->>'combo_revenue_prev')::numeric = 45000)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_day') d;
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: by_day reconciles with the summary; December lands in combo_revenue_prev');

SELECT * FROM finish();
ROLLBACK;
