-- supabase/tests/sales_by_product.test.sql
-- Rapport « Sales by Product » — pgTAP pour get_sales_by_product_v1 et son
-- drill-down get_product_sales_lines_v1 (14 assertions T1–T14).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : les deux RPC partagent un périmètre
-- qui doit rester STRICTEMENT le même. Si l'une exclut une ligne que l'autre
-- garde, la somme des lignes ne referme plus le total du produit et le lecteur
-- n'a aucun moyen de savoir laquelle des deux ment. T13 est cette assertion, et
-- c'est celle à ne jamais retirer.
--
--   T1  : get_sales_by_product_v1 MANAGER happy path — 5-key JSONB
--   T2  : get_sales_by_product_v1 CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — la borne de DÉBUT est rognée, la fin demandée tient
--   T5  : summary.revenue == SUM(by_product.revenue) — la ventilation referme
--   T6  : counter.revenue + b2b.revenue == summary.revenue — le canal referme
--   T7  : summary.unattributed porte order_discount ET promotion_total
--   T8  : ligne annulée et cadeau promo EXCLUS, remise de ligne comptée (fixture)
--   T9  : get_product_sales_lines_v1 MANAGER happy path — 4 clés de page
--   T10 : get_product_sales_lines_v1 CASHIER denied (42501)
--   T11 : curseur malformé → P0001 (jamais un retour silencieux à la page 1)
--   T12 : p_limit=1 rend 1 ligne et un next_cursor quand il en reste
--   T13 : lines.totals.revenue == by_product[ce produit].revenue — MÊME PÉRIMÈTRE
--   T14 : la page 2 ne rejoue pas la dernière ligne de la page 1 (keyset stable)
--
-- Utilisateurs seedés réutilisés (aucune fixture d'identité nécessaire) :
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002
--
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ============================================================
-- A. get_sales_by_product_v1 — garde, bornes, invariants
-- ============================================================

-- T1 happy path : MANAGER, JSONB à 5 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'period') AND (v_r ? 'timezone') AND (v_r ? 'generated_at')
      AND (v_r ? 'summary') AND (v_r ? 'by_product');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_sales_by_product_v1 MANAGER happy path returns 5-key JSONB');

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_product_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: get_sales_by_product_v1 CASHIER raises 42501');

-- T3 bornes inversées → P0001
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_sales_by_product_v1('2026-12-31', '2026-01-01');
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
  v_r := get_sales_by_product_v1('2020-01-01', '2026-12-31');
  v_ok := ((v_r->'period'->>'start')::date = '2026-12-31'::date - 366)
      AND ((v_r->'period'->>'end')::date   = '2026-12-31'::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 la ventilation par produit referme le total
DO $$
DECLARE v_r JSONB; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  SELECT COALESCE(SUM((p->>'revenue')::numeric), 0)
    INTO v_sum FROM jsonb_array_elements(v_r->'by_product') p;
  v_ok := (v_sum = (v_r->'summary'->>'revenue')::numeric);
  PERFORM set_config('breakery.t5', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: SUM(by_product.revenue) equals summary.revenue');

-- T6 le canal referme le total (l'écart assumé avec get_pos_top_products_v1)
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  v_ok := ((v_r->'summary'->'counter'->>'revenue')::numeric
         + (v_r->'summary'->'b2b'->>'revenue')::numeric
         = (v_r->'summary'->>'revenue')::numeric);
  PERFORM set_config('breakery.t6', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: counter.revenue + b2b.revenue equals summary.revenue');

-- T7 les remises non ventilables sortent À CÔTÉ du total, jamais dedans
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  v_ok := (v_r->'summary'->'unattributed' ? 'order_discount')
      AND (v_r->'summary'->'unattributed' ? 'promotion_total');
  PERFORM set_config('breakery.t7', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: summary.unattributed carries order_discount and promotion_total');

-- T8 EXCLUSIONS, sur fixture : trois lignes du même produit dans une commande
-- payée — une gardée (remise 2 500), une annulée, un cadeau promo. Seule la
-- première doit compter, et sa remise doit apparaître.
DO $$
DECLARE
  v_pid uuid; v_sid uuid; v_uid uuid; v_oid uuid;
  v_r JSONB; v_row JSONB;
  v_qty_before NUMERIC := 0; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';

  -- Un produit non-test, sinon la commande entière serait exclue du périmètre.
  SELECT id INTO v_pid FROM products WHERE is_test = false AND deleted_at IS NULL LIMIT 1;
  SELECT session_id INTO v_sid FROM orders WHERE session_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_uid FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;

  -- Base de comparaison : ce que le produit pèse AVANT la fixture.
  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  SELECT COALESCE((p->>'qty')::numeric, 0) INTO v_qty_before
    FROM jsonb_array_elements(v_r->'by_product') p
   WHERE (p->>'product_id')::uuid = v_pid;
  v_qty_before := COALESCE(v_qty_before, 0);

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, paid_at, session_id)
  VALUES ('#PGTAP-SBP', 'take_out', 'paid', 10000, 0, 10000, now(), v_sid)
  RETURNING id INTO v_oid;

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total,
                           is_cancelled, cancelled_at, cancelled_by, cancelled_reason,
                           is_promo_gift, discount_amount)
  VALUES
    (v_oid, v_pid, 'Kept',      10000, 1, 10000, false, NULL,  NULL,  NULL,      false, 2500),
    (v_oid, v_pid, 'Cancelled', 10000, 1, 10000, true,  now(), v_uid, 'fixture', false, 0),
    (v_oid, v_pid, 'Gift',      10000, 1, 10000, false, NULL,  NULL,  NULL,      true,  0);

  v_r := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  SELECT p INTO v_row
    FROM jsonb_array_elements(v_r->'by_product') p
   WHERE (p->>'product_id')::uuid = v_pid;

  -- +1 seulement (la ligne gardée), et la remise de ligne est comptée.
  v_ok := ((v_row->>'qty')::numeric = v_qty_before + 1)
      AND ((v_row->>'discount')::numeric >= 2500);
  PERFORM set_config('breakery.t8', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: cancelled line and promo gift excluded, line discount counted');

-- ============================================================
-- B. get_product_sales_lines_v1 — garde, curseur, réconciliation
-- ============================================================

-- Le produit le plus vendu de la fenêtre sert de sujet aux T9–T14 : c'est celui
-- qui a le plus de chances de porter plusieurs lignes, donc de tester le keyset.
CREATE TEMP TABLE _sbp_subject ON COMMIT DROP AS
SELECT oi.product_id AS pid, COUNT(*) AS n
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status IN ('paid', 'completed')
  AND o.voided_at IS NULL
  AND o.is_historical_import = false
  AND oi.is_cancelled = false
  AND oi.is_promo_gift = false
  AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Asia/Makassar'))::date
      BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY oi.product_id
ORDER BY COUNT(*) DESC
LIMIT 1;

-- T9 happy path : 4 clés de page
DO $$
DECLARE v_r JSONB; v_pid uuid; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  v_r := get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31');
  v_ok := (v_r ? 'lines') AND (v_r ? 'totals') AND (v_r ? 'next_cursor') AND (v_r ? 'has_more');
  PERFORM set_config('breakery.t9', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: get_product_sales_lines_v1 returns lines/totals/next_cursor/has_more');

-- T10 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false; v_pid uuid;
BEGIN
  SELECT pid INTO v_pid FROM _sbp_subject;
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t10', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: get_product_sales_lines_v1 CASHIER raises 42501');

-- T11 curseur malformé : on REFUSE. Servir la page 1 en silence ferait boucler
-- le défilement sans fin.
DO $$
DECLARE v_caught BOOLEAN := false; v_pid uuid;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  BEGIN
    PERFORM get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31', 100, 'not-a-cursor');
  EXCEPTION WHEN raise_exception THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t11', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: a malformed cursor raises P0001 instead of silently serving page 1');

-- T12 p_limit=1 : une ligne, et un curseur tant qu'il en reste
DO $$
DECLARE v_r JSONB; v_pid uuid; v_n INT; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT pid, n INTO v_pid, v_n FROM _sbp_subject;
  v_r := get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31', 1);
  v_ok := (jsonb_array_length(v_r->'lines') = 1)
      AND (CASE WHEN v_n > 1 THEN (v_r->>'has_more')::boolean ELSE true END);
  PERFORM set_config('breakery.t12', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean,
  'T12: p_limit=1 returns one line and a cursor while lines remain');

-- T13 L'ASSERTION CENTRALE : les lignes et l'agrégat partagent le périmètre.
DO $$
DECLARE v_agg JSONB; v_lines JSONB; v_pid uuid; v_prod NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  v_agg   := get_sales_by_product_v1('2026-01-01', '2026-12-31');
  v_lines := get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31');
  SELECT (p->>'revenue')::numeric INTO v_prod
    FROM jsonb_array_elements(v_agg->'by_product') p
   WHERE (p->>'product_id')::uuid = v_pid;
  v_ok := (v_prod = (v_lines->'totals'->>'revenue')::numeric);
  PERFORM set_config('breakery.t13', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t13')::boolean,
  'T13: lines totals.revenue reconciles with by_product revenue (same scope)');

-- T14 keyset : la page 2 ne rejoue pas la dernière ligne de la page 1.
-- Sur un produit à une seule ligne, il n'y a pas de page 2 — et un curseur nul
-- est alors le comportement juste, pas une absence de test.
DO $$
DECLARE
  v_p1 JSONB; v_p2 JSONB; v_pid uuid; v_n INT; v_cur TEXT; v_last TEXT; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT pid, n INTO v_pid, v_n FROM _sbp_subject;
  v_p1  := get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31', 1);
  v_cur := v_p1->>'next_cursor';
  v_last := (v_p1->'lines'->0)->>'id';
  IF v_n > 1 AND v_cur IS NOT NULL THEN
    v_p2 := get_product_sales_lines_v1(v_pid, '2026-01-01', '2026-12-31', 1, v_cur);
    v_ok := (jsonb_array_length(v_p2->'lines') = 1)
        AND (((v_p2->'lines'->0)->>'id') <> v_last);
  ELSE
    v_ok := (v_cur IS NULL);
  END IF;
  PERFORM set_config('breakery.t14', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t14')::boolean,
  'T14: the keyset cursor advances — page 2 never repeats page 1 last row');

SELECT * FROM finish();
ROLLBACK;
