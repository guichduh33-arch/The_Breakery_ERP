-- supabase/tests/purchase_price_trends.test.sql
-- Rapport « Purchase Price Trends » — pgTAP pour get_purchase_price_trends_v1
-- et son compagnon get_purchase_price_points_v1 (12 assertions T1–T12).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : la conversion en unité de base
-- (unit_factor_to_base) et l'identité de périmètre entre l'agrégat et les
-- points. Si l'un convertit et pas l'autre, le graphe ne recoupe plus la table
-- et le lecteur n'a aucun moyen de savoir lequel ment. T7 et T12 sont ces
-- assertions, et ce sont celles à ne jamais retirer.
--
--   T1  : trends MANAGER happy path — 6-key JSONB
--   T2  : trends CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — la borne de DÉBUT est rognée, la fin demandée tient
--   T5  : summary.spend == SUM(by_product.spend) — la ventilation referme
--   T6  : summary.spend == SUM(by_supplier.spend) ET Σ share_pct ≈ 100
--   T7  : fixture — draft/cancelled EXCLUS ; conversion base : qty 2 × factor
--         1000 à 50 000/sac → wavg_price 50, qty_base 2000, spend 100 000
--   T8  : delta_pct NULL pour un article absent de la période précédente
--   T9  : points MANAGER happy path — 4 clés, le point porte unit_price 50
--   T10 : points CASHIER denied (42501)
--   T11 : points produit inconnu → P0001
--   T12 : SUM(points.qty_base) == by_product.qty_base — MÊME PÉRIMÈTRE
--
-- Utilisateurs seedés réutilisés :
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002
--
-- Fenêtre de fixture : janvier 2027 (vide en dev, période précédente = déc.
-- 2026, vide aussi) — le delta NULL et les comptages exacts sont garantis.
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- T1 happy path : MANAGER, JSONB à 6 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_purchase_price_trends_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'period_prev') AND (v_r ? 'generated_at')
      AND (v_r ? 'summary') AND (v_r ? 'by_product') AND (v_r ? 'by_supplier');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_purchase_price_trends_v1 MANAGER happy path returns 6-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_purchase_price_trends_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_purchase_price_trends_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_purchase_price_trends_v1('2026-12-31', '2026-01-01');
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t3', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: end before start raises P0001');

-- T4 clamp 366 j : on rogne le DÉBUT, la fin demandée est ce qu'on regarde
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_purchase_price_trends_v1('2020-01-01', '2026-12-31');
  v_ok := ((v_r->'period'->>'start')::date = '2026-12-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2026-12-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 la ventilation par article referme le total
DO $$
DECLARE v_r JSONB; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_purchase_price_trends_v1('2026-01-01', '2026-12-31');
  SELECT COALESCE(SUM((p->>'spend')::numeric), 0)
    INTO v_sum FROM jsonb_array_elements(v_r->'by_product') p;
  v_ok := (v_sum = (v_r->'summary'->>'spend')::numeric);
  PERFORM set_config('breakery.t5', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: SUM(by_product.spend) equals summary.spend');

-- T6 la ventilation fournisseur referme le total, les parts somment à 100
DO $$
DECLARE v_r JSONB; v_sum NUMERIC; v_share NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_purchase_price_trends_v1('2026-01-01', '2026-12-31');
  SELECT COALESCE(SUM((p->>'spend')::numeric), 0), COALESCE(SUM((p->>'share_pct')::numeric), 0)
    INTO v_sum, v_share FROM jsonb_array_elements(v_r->'by_supplier') p;
  v_ok := (v_sum = (v_r->'summary'->>'spend')::numeric)
      AND (v_sum = 0 OR (v_share BETWEEN 99.5 AND 100.5));
  PERFORM set_config('breakery.t6', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: SUM(by_supplier.spend) equals summary.spend and shares sum to ~100');

-- Fixture partagée T7–T12 : un fournisseur, un produit, trois POs en janvier
-- 2027 (fenêtre vide) — un received (compté), un draft et un cancelled (exclus).
CREATE TEMP TABLE _ppt_fix ON COMMIT DROP AS
SELECT gen_random_uuid() AS sup_id, gen_random_uuid() AS po_ok, gen_random_uuid() AS po_draft,
       gen_random_uuid() AS po_cxl,
       (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1) AS pid,
       (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1) AS uid;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM _ppt_fix;
  INSERT INTO suppliers (id, code, name) VALUES (f.sup_id, 'PGTAP-PPT', 'PGTAP Supplier');
  INSERT INTO purchase_orders (id, po_number, supplier_id, status, order_date, subtotal, total_amount, created_by)
  VALUES
    (f.po_ok,    '#PGTAP-PPT-1', f.sup_id, 'received',  '2027-01-15', 100000, 100000, f.uid),
    (f.po_draft, '#PGTAP-PPT-2', f.sup_id, 'draft',     '2027-01-16',  50000,  50000, f.uid),
    (f.po_cxl,   '#PGTAP-PPT-3', f.sup_id, 'cancelled', '2027-01-17',  50000,  50000, f.uid);
  -- 2 sacs de 1000 (unité de base) à 50 000/sac → 50/base, qty_base 2000.
  -- subtotal est une colonne GÉNÉRÉE (quantity × unit_cost) : on ne l'insère pas.
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES
    (f.po_ok,    f.pid, 2, 'sack', 50000, 1000),
    (f.po_draft, f.pid, 1, 'sack', 50000, 1000),
    (f.po_cxl,   f.pid, 1, 'sack', 50000, 1000);
END $$;

-- T7 draft/cancelled exclus + conversion en unité de base
DO $$
DECLARE v_r JSONB; v_row JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ppt_fix;
  v_r := get_purchase_price_trends_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_row FROM jsonb_array_elements(v_r->'by_product') p
   WHERE (p->>'product_id')::uuid = f.pid;
  v_ok := ((v_r->'summary'->>'spend')::numeric = 100000)
      AND ((v_r->'summary'->>'po_count')::int = 1)
      AND ((v_row->>'wavg_price')::numeric = 50)
      AND ((v_row->>'qty_base')::numeric = 2000)
      AND ((v_row->>'last_price')::numeric = 50)
      AND ((v_row->'last_supplier'->>'name') = 'PGTAP Supplier');
  PERFORM set_config('breakery.t7', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: draft and cancelled POs excluded, base-unit conversion applied (wavg 50)');

-- T8 delta NULL sans achat en période précédente (déc. 2026 vide)
DO $$
DECLARE v_r JSONB; v_row JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ppt_fix;
  v_r := get_purchase_price_trends_v1('2027-01-01', '2027-01-31');
  SELECT p INTO v_row FROM jsonb_array_elements(v_r->'by_product') p
   WHERE (p->>'product_id')::uuid = f.pid;
  v_ok := (v_row->>'delta_pct') IS NULL AND (v_row->>'wavg_price_prev') IS NULL;
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: delta_pct is NULL for an article absent from the previous period');

-- T9 points happy path : 4 clés, le point converti
DO $$
DECLARE v_r JSONB; f RECORD; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ppt_fix;
  v_r := get_purchase_price_points_v1(f.pid, '2027-01-01', '2027-01-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'generated_at') AND (v_r ? 'product') AND (v_r ? 'points')
      AND (jsonb_array_length(v_r->'points') = 1)
      AND (((v_r->'points'->0)->>'unit_price')::numeric = 50)
      AND ((v_r->'points'->0)->>'supplier_name' = 'PGTAP Supplier');
  PERFORM set_config('breakery.t9', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: get_purchase_price_points_v1 returns 4 keys and the converted point');

-- T10 garde points : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false; f RECORD;
BEGIN
  SELECT * INTO f FROM _ppt_fix;
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_purchase_price_points_v1(f.pid, '2027-01-01', '2027-01-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t10', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: get_purchase_price_points_v1 CASHIER raises 42501');

-- T11 produit inconnu → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_purchase_price_points_v1(gen_random_uuid(), '2027-01-01', '2027-01-31');
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t11', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: unknown product raises P0001');

-- T12 L'ASSERTION CENTRALE : agrégat et points partagent le périmètre
DO $$
DECLARE v_agg JSONB; v_pts JSONB; f RECORD; v_qty NUMERIC; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT * INTO f FROM _ppt_fix;
  v_agg := get_purchase_price_trends_v1('2027-01-01', '2027-01-31');
  v_pts := get_purchase_price_points_v1(f.pid, '2027-01-01', '2027-01-31');
  SELECT (p->>'qty_base')::numeric INTO v_qty
    FROM jsonb_array_elements(v_agg->'by_product') p
   WHERE (p->>'product_id')::uuid = f.pid;
  SELECT COALESCE(SUM((p->>'qty_base')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(v_pts->'points') p;
  v_ok := (v_qty = v_sum);
  PERFORM set_config('breakery.t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: points qty_base reconciles with by_product qty_base (same scope)');

SELECT * FROM finish();
ROLLBACK;
