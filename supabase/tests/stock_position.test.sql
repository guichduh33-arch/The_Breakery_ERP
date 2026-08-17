-- supabase/tests/stock_position.test.sql
-- Rapport « Position de stock à date » — pgTAP pour get_stock_position_v1
-- (12 assertions).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : la reconstruction est ARRIÈRE —
-- position(J) = current_stock − Σ mouvements POSTÉRIEURS à J (T4/T5), donc
-- exacte même quand le stock initial n'est jamais entré par le ledger ; le
-- périmètre exclut vitrine / supprimés / non-suivis (T6) ; et les vues se
-- recoupent entre elles (T8/T9) — assertions au grain fixture + cohérences
-- internes, jamais de totaux absolus (la base dev vit).
--
--   T1  : happy path MANAGER — 7-key JSONB
--   T2  : CASHIER denied (42501)
--   T3  : as_of futur raises P0001
--   T4  : reconstruction à J-3 — 100 − (incoming +20, sale −5) = 85
--   T5  : à aujourd'hui (défaut) la position EST current_stock (100)
--   T6  : display item, deleted, non-suivi : absents
--   T7  : statuts — below_threshold / negative / at_zero
--   T8  : Σ products.value = summary.total_value
--   T9  : by_category recoupe total et compte de réfs
--   T10 : valuation étiquetée 'current_wac' ; as_of défaut = aujourd'hui métier
--   T11 : les compteurs de statut comptent au moins les fixtures
--   T12 : value = qty × WAC courant (85 × 2000 = 170k à J-3)
--
-- Fixtures : INSERT direct stock_movements (service role, ROLLBACK) avec des
-- types SANS effet de bord — incoming/sale ne déclenchent NI le trigger WAC
-- (purchase/production_in seulement) NI le trigger JE (early-return).
-- Utilisateurs seedés : MANAGER 00000000-0000-0000-0000-000000000004,
-- CASHIER 00000000-0000-0000-0000-000000000002.
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

CREATE TEMP TABLE _sp_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS f1, gen_random_uuid() AS f2, gen_random_uuid() AS f3,
       gen_random_uuid() AS f4, gen_random_uuid() AS f5, gen_random_uuid() AS f6,
       gen_random_uuid() AS f7,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid,
       -- products.category_id est NOT NULL : on s'ancre sur une catégorie vivante.
       (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1) AS cat;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _sp_fix;

  INSERT INTO products (id, sku, name, category_id, retail_price, unit, current_stock,
                        cost_price, min_stock_threshold, track_inventory, is_display_item,
                        deleted_at)
  VALUES
    (f.f1, 'PGTAP-POS-1', 'PGTAP Pos Flour',     f.cat, 0, 'kg',  100, 2000, 10, true,  false, NULL),
    (f.f2, 'PGTAP-POS-2', 'PGTAP Pos Display',   f.cat, 0, 'pcs',  50, 1000,  0, true,  true,  NULL),
    (f.f3, 'PGTAP-POS-3', 'PGTAP Pos Deleted',   f.cat, 0, 'pcs',  50, 1000,  0, true,  false, now()),
    (f.f4, 'PGTAP-POS-4', 'PGTAP Pos Untracked', f.cat, 0, 'pcs',  50, 1000,  0, false, false, NULL),
    (f.f5, 'PGTAP-POS-5', 'PGTAP Pos LowStock',  f.cat, 0, 'pcs',   4, 1500, 10, true,  false, NULL),
    (f.f6, 'PGTAP-POS-6', 'PGTAP Pos Negative',  f.cat, 0, 'pcs',  -3, 1000,  0, true,  false, NULL),
    (f.f7, 'PGTAP-POS-7', 'PGTAP Pos Zero',      f.cat, 0, 'pcs',   0, 1000,  5, true,  false, NULL);

  -- Après J-3 : +20 (incoming, J-2) puis −5 (sale, J-1) → position(J-3) = 85.
  -- reference_type='orders' exige un reference_id (CHECK) — colonne polymorphe.
  INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reason,
                               reference_type, reference_id, created_at, created_by)
  VALUES
    (f.f1, 'incoming',  20, 'kg', 'pgtap fixture', 'admin_action', NULL,              now() - interval '2 days', f.uid),
    (f.f1, 'sale',      -5, 'kg', NULL,            'orders',       gen_random_uuid(), now() - interval '1 day',  f.uid);
END $$;

-- T1 happy path : 7 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_stock_position_v1();
  v_ok := (v_r ? 'as_of') AND (v_r ? 'timezone') AND (v_r ? 'generated_at')
      AND (v_r ? 'valuation') AND (v_r ? 'summary')
      AND (v_r ? 'by_category') AND (v_r ? 'products');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_stock_position_v1 MANAGER happy path returns 7-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_stock_position_v1();
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_stock_position_v1 CASHIER raises 42501');

-- T3 as_of futur → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_stock_position_v1((now() AT TIME ZONE 'Asia/Makassar')::date + 1);
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t3', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: a future as_of raises P0001');

-- T4 reconstruction arrière à J-3
DO $$
DECLARE v_r JSONB; v_p JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sp_fix;
  v_r := get_stock_position_v1((now() AT TIME ZONE 'Asia/Makassar')::date - 3);
  SELECT p INTO v_p FROM jsonb_array_elements(v_r->'products') p
   WHERE (p->>'product_id')::uuid = f.f1;
  v_ok := ((v_p->>'qty')::numeric = 85);
  PERFORM set_config('breakery.t4', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: position at J-3 rewinds the later incoming +20 and sale -5 (100 -> 85)');

-- T5 à aujourd'hui, la position EST current_stock
DO $$
DECLARE v_r JSONB; v_p JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sp_fix;
  v_r := get_stock_position_v1();
  SELECT p INTO v_p FROM jsonb_array_elements(v_r->'products') p
   WHERE (p->>'product_id')::uuid = f.f1;
  v_ok := ((v_p->>'qty')::numeric = 100);
  PERFORM set_config('breakery.t5', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: with no as_of the position IS current_stock');

-- T6 vitrine / supprimé / non-suivi absents
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sp_fix;
  v_r := get_stock_position_v1();
  v_ok := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_r->'products') p
    WHERE (p->>'product_id')::uuid IN (f.f2, f.f3, f.f4));
  PERFORM set_config('breakery.t6', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: display-case, deleted and untracked products enter nothing');

-- T7 statuts
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sp_fix;
  v_r := get_stock_position_v1();
  SELECT bool_and(CASE (p->>'product_id')::uuid
           WHEN f.f5 THEN p->>'status' = 'below_threshold'
           WHEN f.f6 THEN p->>'status' = 'negative'
           WHEN f.f7 THEN p->>'status' = 'at_zero'
           ELSE true END)
    INTO v_ok
    FROM jsonb_array_elements(v_r->'products') p;
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: below_threshold / negative / at_zero statuses land on the right rows');

-- T8 Σ products.value = total_value
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_stock_position_v1();
  SELECT SUM((p->>'value')::numeric) = (v_r->'summary'->>'total_value')::numeric
    INTO v_ok FROM jsonb_array_elements(v_r->'products') p;
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: sum of product values reconciles with summary.total_value');

-- T9 by_category recoupe
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_stock_position_v1();
  SELECT (SUM((c->>'value')::numeric) = (v_r->'summary'->>'total_value')::numeric)
     AND (SUM((c->>'refs')::int) = (v_r->'summary'->>'refs_tracked')::int)
    INTO v_ok FROM jsonb_array_elements(v_r->'by_category') c;
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: by_category reconciles both value and ref count with the summary');

-- T10 étiquette de valorisation + défaut as_of
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_stock_position_v1();
  v_ok := (v_r->>'valuation' = 'current_wac')
      AND ((v_r->>'as_of')::date = (now() AT TIME ZONE (v_r->>'timezone'))::date);
  PERFORM set_config('breakery.t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: valuation is labeled current_wac; default as_of is the business today');

-- T11 compteurs de statut
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_stock_position_v1();
  v_ok := ((v_r->'summary'->>'refs_below_threshold')::int >= 1)
      AND ((v_r->'summary'->>'refs_negative')::int >= 1)
      AND ((v_r->'summary'->>'refs_at_zero')::int >= 1);
  PERFORM set_config('breakery.t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: the status counters count at least the fixtures');

-- T12 value = qty × WAC courant
DO $$
DECLARE v_r JSONB; v_p JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _sp_fix;
  v_r := get_stock_position_v1((now() AT TIME ZONE 'Asia/Makassar')::date - 3);
  SELECT p INTO v_p FROM jsonb_array_elements(v_r->'products') p
   WHERE (p->>'product_id')::uuid = f.f1;
  v_ok := ((v_p->>'value')::numeric = 170000)
      AND ((v_p->>'wac')::numeric = 2000);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: value = qty x current WAC (85 x 2000 = 170k at J-3)');

SELECT * FROM finish();
ROLLBACK;
