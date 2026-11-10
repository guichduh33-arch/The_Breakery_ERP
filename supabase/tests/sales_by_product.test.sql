-- supabase/tests/sales_by_product.test.sql
-- Rapport « Sales by Product » — pgTAP pour get_sales_by_product_v2 et son
-- drill-down get_product_sales_lines_v2 (14 assertions T1–T14).
--
-- CE QUE CETTE SUITE PROTÈGE EN PRIORITÉ : les deux RPC partagent un périmètre
-- qui doit rester STRICTEMENT le même. Si l'une exclut une ligne que l'autre
-- garde, la somme des lignes ne referme plus le total du produit et le lecteur
-- n'a aucun moyen de savoir laquelle des deux ment. T13 est cette assertion, et
-- c'est celle à ne jamais retirer.
--
--   T1  : get_sales_by_product_v2 Owner happy path — 5-key JSONB
--   T2  : get_sales_by_product_v2 CASHIER denied (42501)
--   T3  : end < start raises P0001
--   T4  : clamp 366 jours — la borne de DÉBUT est rognée, la fin demandée tient
--   T5  : summary.revenue == SUM(by_product.revenue) — la ventilation referme
--   T6  : counter.revenue + b2b.revenue == summary.revenue — le canal referme
--   T7  : summary.unattributed porte order_discount ET promotion_total
--   T8  : ligne annulée et cadeau promo EXCLUS, remise de ligne comptée (fixture)
--   T9  : get_product_sales_lines_v2 Owner happy path — 4 clés de page
--   T10 : get_product_sales_lines_v2 CASHIER denied (42501)
--   T11 : curseur malformé → P0001 (jamais un retour silencieux à la page 1)
--   T12 : p_limit=1 rend 1 ligne et un next_cursor quand il en reste
--   T13 : lines.totals.revenue == by_product[ce produit].revenue — MÊME PÉRIMÈTRE
--   T14 : la page 2 ne rejoue pas la dernière ligne de la page 1 (keyset stable)
--   T17 : la ligne porte création, paiement et table de sa commande (S3-21)
--   T18 : filtres vides, nuls ou inconnus == aucun filtre (S3-22)
--   T19 : la somme par type de commande referme le total non filtré
--   T20 : filtre table → la seule commande de la fixture, agrégat ET lignes,
--         et la réconciliation de T13 tient sous ce filtre
--   T21 : moyen de paiement inexistant → résultat vide, sans erreur
--   T22 : T13 tient aussi sous filtres type de commande + moyen de paiement
--   T23 : droits (authenticated oui, anon non) et anciennes versions supprimées
--   T24 : EXCLUSION POSITIVE par type de commande — deux commandes maîtrisées,
--         chaque filtre garde la sienne et écarte l'autre (agrégat ET lignes)
--   T25 : même preuve par moyen de paiement
--
-- Utilisateurs seedés réutilisés (aucune fixture d'identité nécessaire) :
--   Owner : auth_user_id = 00000000-0000-0000-0000-000000000001
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002
--
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;
\ir helpers/released_report_days.sql
SELECT pg_temp.fixture_released_days(current_date-366,current_date);
\ir helpers/sales.sql

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(25);

-- ============================================================
-- A. get_sales_by_product_v2 — garde, bornes, invariants
-- ============================================================

-- T1 happy path : Owner, JSONB à 5 clés
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  v_ok := (v_r ? 'period') AND (v_r ? 'timezone') AND (v_r ? 'generated_at')
      AND (v_r ? 'summary') AND (v_r ? 'by_product');
  PERFORM set_config('breakery.t1', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: get_sales_by_product_v6 Owner happy path returns 5-key JSONB');

INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT id,p.code,false,'Transactional report deny fixture' FROM public.user_profiles
CROSS JOIN (VALUES('reports.sales.read'),('reports.product_sales.read')) p(code)
WHERE employee_code='EMP001' AND deleted_at IS NULL
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;

-- T2 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t2', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: neither sales report permission raises 42501');

-- T3 bornes inversées → 22023
DO $$
DECLARE v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  BEGIN
    PERFORM get_sales_by_product_v6(CURRENT_DATE, '2026-01-01');
  EXCEPTION WHEN invalid_parameter_value THEN v_caught := SQLERRM='invalid_date_range';
  END;
  PERFORM set_config('breakery.t3', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: end before start raises 22023 invalid_date_range');

-- T4 clamp 366 j : on rogne le DÉBUT, la fin demandée est ce qu'on regarde
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2020-01-01', CURRENT_DATE);
  v_ok := ((v_r->'period'->>'start')::date = CURRENT_DATE::date - 366)
      AND ((v_r->'period'->>'end')::date   = CURRENT_DATE::date);
  PERFORM set_config('breakery.t4', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: 366-day clamp trims the START, keeps the requested END');

-- T5 la ventilation par produit referme le total
DO $$
DECLARE v_r JSONB; v_sum NUMERIC; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  SELECT COALESCE(SUM((p->>'revenue')::numeric), 0)
    INTO v_sum FROM jsonb_array_elements(v_r->'by_product') p;
  v_ok := (v_sum = (v_r->'summary'->>'revenue')::numeric);
  PERFORM set_config('breakery.t5', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: SUM(by_product.revenue) equals summary.revenue');

-- T6 le canal referme le total (l'écart assumé avec get_pos_top_products_v2)
DO $$
DECLARE v_r JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
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
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
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
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';

  -- Un produit non-test, sinon la commande entière serait exclue du périmètre.
  SELECT id INTO v_pid FROM products WHERE is_test = false AND deleted_at IS NULL LIMIT 1;
  v_sid := 'f5430000-0000-4000-a000-000000000001';
  SELECT id INTO v_uid FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;

  -- Base de comparaison : ce que le produit pèse AVANT la fixture.
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  SELECT COALESCE((p->>'qty')::numeric, 0) INTO v_qty_before
    FROM jsonb_array_elements(v_r->'by_product') p
   WHERE (p->>'product_id')::uuid = v_pid;
  v_qty_before := COALESCE(v_qty_before, 0);

  -- Créée une heure avant d'être payée, sur une table : T17 relit ces trois champs.
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-SBP', 'take_out', 'paid', 10000, 0, 10000,
          now() - interval '1 hour', now(), 'PGTAP-T9', v_sid)
  RETURNING id INTO v_oid;

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total,
                           is_cancelled, cancelled_at, cancelled_by, cancelled_reason,
                           is_promo_gift, discount_amount)
  VALUES
    (v_oid, v_pid, 'Kept',      10000, 1, 10000, false, NULL,  NULL,  NULL,      false, 2500),
    (v_oid, v_pid, 'Cancelled', 10000, 1, 10000, true,  now(), v_uid, 'fixture', false, 0),
    (v_oid, v_pid, 'Gift',      10000, 1, 10000, false, NULL,  NULL,  NULL,      true,  0);

  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);


  v_r := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
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

-- T17 (S3-21) : la ligne de vente porte la création, le paiement et la table de
-- sa commande ; une commande sans table rend un null, jamais une clé absente.
DO $$
DECLARE v_pid uuid; v_r JSONB; v_line JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT oi.product_id INTO v_pid
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
   WHERE o.order_number = '#PGTAP-SBP' LIMIT 1;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_product_sales_lines_v7(v_pid, CURRENT_DATE - 1, CURRENT_DATE, 500);
  SELECT l INTO v_line FROM jsonb_array_elements(v_r->'lines') l
   WHERE l->>'order_number' = '#PGTAP-SBP';
  v_ok := v_line IS NOT NULL
      AND v_line->>'table_number' = 'PGTAP-T9'
      AND (v_line->>'created_at')::timestamptz < (v_line->>'paid_at')::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_r->'lines') l
         WHERE NOT (l ? 'created_at' AND l ? 'paid_at' AND l ? 'table_number')
            OR l->>'created_at' IS NULL);
  PERFORM set_config('breakery.t17', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t17')::boolean,
  'T17: sales line carries order created_at, paid_at and table_number');

-- ============================================================
-- B. get_product_sales_lines_v2 — garde, curseur, réconciliation
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
      BETWEEN '2026-01-01' AND CURRENT_DATE
GROUP BY oi.product_id
ORDER BY COUNT(*) DESC
LIMIT 1;

-- T9 happy path : 4 clés de page
DO $$
DECLARE v_r JSONB; v_pid uuid; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE);
  v_ok := (v_r ? 'lines') AND (v_r ? 'totals') AND (v_r ? 'next_cursor') AND (v_r ? 'has_more');
  PERFORM set_config('breakery.t9', v_ok::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: get_product_sales_lines_v7 returns lines/totals/next_cursor/has_more');

-- T10 garde : CASHIER → 42501
DO $$
DECLARE v_caught BOOLEAN := false; v_pid uuid;
BEGIN
  SELECT pid INTO v_pid FROM _sbp_subject;
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
  END;
  PERFORM set_config('breakery.t10', v_caught::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: neither product line permission raises 42501');

-- T11 curseur malformé : on REFUSE. Servir la page 1 en silence ferait boucler
-- le défilement sans fin.
DO $$
DECLARE v_caught BOOLEAN := false; v_pid uuid;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  BEGIN
    PERFORM get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 100, 'not-a-cursor');
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
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid, n INTO v_pid, v_n FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_r := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 1);
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
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_agg   := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_lines := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE);
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
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid, n INTO v_pid, v_n FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_p1  := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 1);
  v_cur := v_p1->>'next_cursor';
  v_last := (v_p1->'lines'->0)->>'id';
  IF v_n > 1 AND v_cur IS NOT NULL THEN
    PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

    v_p2 := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 1, v_cur);
    v_ok := (jsonb_array_length(v_p2->'lines') = 1)
        AND (((v_p2->'lines'->0)->>'id') <> v_last);
  ELSE
    v_ok := (v_cur IS NULL);
  END IF;
  PERFORM set_config('breakery.t14', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t14')::boolean,
  'T14: the keyset cursor advances — page 2 never repeats page 1 last row');

-- ============================================================
-- C. Filtres serveur (S3-22) — type de commande, moyen de paiement, table.
--    Les deux fonctions reçoivent le MÊME p_filters : le périmètre reste commun.
-- ============================================================

-- T18 filtres vides, nuls ou inconnus : même résultat que sans argument.
DO $$
DECLARE
  v_base JSONB; v_empty JSONB; v_blank JSONB; v_null JSONB;
  v_lbase JSONB; v_lblank JSONB; v_pid uuid; v_ok BOOLEAN;
  v_noop JSONB := '{"order_type":"","payment_method":"","table_number":null,"unknown_key":"x"}';
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_base  := get_sales_by_product_v6('2026-01-01', CURRENT_DATE);
  v_empty := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, '{}'::jsonb);
  v_blank := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, v_noop);
  v_null  := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, NULL);
  v_lbase  := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE);
  v_lblank := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 100, NULL, v_noop);
  v_ok := jsonb_array_length(v_base->'by_product') > 0
      AND v_empty->'by_product' = v_base->'by_product'
      AND v_blank->'by_product' = v_base->'by_product'
      AND v_null->'by_product'  = v_base->'by_product'
      AND v_empty->'summary'    = v_base->'summary'
      AND v_blank->'summary'    = v_base->'summary'
      AND v_lblank->'lines'     = v_lbase->'lines'
      AND v_lblank->'totals'    = v_lbase->'totals';
  PERFORM set_config('breakery.t18', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t18')::boolean,
  'T18: empty, blank, null or unknown filters equal no filter (aggregate and lines)');

-- T19 partition : chaque commande a UN type, donc la somme des chiffres filtrés
-- sur chaque valeur de l'enum referme le total non filtré.
DO $$
DECLARE v_total NUMERIC; v_sum NUMERIC := 0; v_t text; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_total := (get_sales_by_product_v6('2026-01-01', CURRENT_DATE)->'summary'->>'revenue')::numeric;
  FOR v_t IN SELECT unnest(enum_range(NULL::order_type))::text LOOP
    v_sum := v_sum + (get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL,
      jsonb_build_object('order_type', v_t))->'summary'->>'revenue')::numeric;
  END LOOP;
  v_ok := v_total > 0 AND v_sum = v_total;
  PERFORM set_config('breakery.t19', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t19')::boolean,
  'T19: revenue summed over every order_type closes the unfiltered total');

-- T20 filtre table : seule la commande #PGTAP-SBP (table PGTAP-T9) reste, dans
-- l'agrégat ET dans les lignes, et les deux se referment (T13 sous filtre).
DO $$
DECLARE
  v_pid uuid; v_f JSONB := '{"table_number":"PGTAP-T9"}';
  v_agg JSONB; v_lines JSONB; v_ok BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT oi.product_id INTO v_pid
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
   WHERE o.order_number = '#PGTAP-SBP' LIMIT 1;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  v_agg   := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, v_f);
  v_lines := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 500, NULL, v_f);
  v_ok := (v_agg->'summary'->>'orders')::int = 1
      AND (v_agg->'summary'->>'lines')::int = 1
      AND (v_agg->'summary'->>'revenue')::numeric = 10000
      AND jsonb_array_length(v_agg->'by_product') = 1
      AND (v_agg->'by_product'->0->>'product_id')::uuid = v_pid
      AND (v_agg->'by_product'->0->>'qty')::numeric = 1
      AND jsonb_array_length(v_lines->'lines') = 1
      AND v_lines->'lines'->0->>'order_number' = '#PGTAP-SBP'
      AND v_lines->'lines'->0->>'table_number' = 'PGTAP-T9'
      AND (v_lines->'totals'->>'lines')::int = 1
      AND (v_lines->'totals'->>'revenue')::numeric
          = (v_agg->'by_product'->0->>'revenue')::numeric;
  PERFORM set_config('breakery.t20', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t20')::boolean,
  'T20: table filter keeps only the fixture order, in aggregate and lines, and they reconcile');

-- T21 moyen de paiement inexistant : vide, sans erreur (comparaison en texte,
-- jamais un cast vers l'enum qui lèverait).
DO $$
DECLARE
  v_pid uuid; v_f JSONB := '{"payment_method":"pgtap_no_such_method"}';
  v_agg JSONB; v_lines JSONB; v_ok BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  BEGIN
    v_agg   := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, v_f);
    v_lines := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 100, NULL, v_f);
    v_ok := v_agg->'by_product' = '[]'::jsonb
        AND (v_agg->'summary'->>'revenue')::numeric = 0
        AND (v_agg->'summary'->>'orders')::int = 0
        AND v_lines->'lines' = '[]'::jsonb
        AND (v_lines->'totals'->>'lines')::int = 0
        AND (v_lines->'totals'->>'revenue')::numeric = 0
        AND v_lines->>'next_cursor' IS NULL;
  EXCEPTION WHEN others THEN v_ok := false;
  END;
  PERFORM set_config('breakery.t21', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t21')::boolean,
  'T21: an unknown payment_method yields an empty result without raising');

-- T22 T13 sous filtres combinés : type de commande + moyen de paiement, sur le
-- sujet. Un produit absent de l'agrégat filtré vaut 0, comme le total des lignes.
DO $$
DECLARE
  v_pid uuid; v_f JSONB; v_agg JSONB; v_lines JSONB; v_prod NUMERIC; v_ok BOOLEAN := true;
  v_m text;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT pid INTO v_pid FROM _sbp_subject;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  FOR v_m IN SELECT unnest(enum_range(NULL::payment_method))::text LOOP
    v_f := jsonb_build_object('order_type', 'take_out', 'payment_method', v_m);
    v_agg   := get_sales_by_product_v6('2026-01-01', CURRENT_DATE, NULL, v_f);
    v_lines := get_product_sales_lines_v7(v_pid, '2026-01-01', CURRENT_DATE, 100, NULL, v_f);
    SELECT (p->>'revenue')::numeric INTO v_prod
      FROM jsonb_array_elements(v_agg->'by_product') p
     WHERE (p->>'product_id')::uuid = v_pid;
    v_ok := v_ok AND COALESCE(v_prod, 0) = (v_lines->'totals'->>'revenue')::numeric;
    v_prod := NULL;
  END LOOP;
  PERFORM set_config('breakery.t22', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t22')::boolean,
  'T22: lines reconcile with by_product under order_type + payment_method, for every method');

-- T23 droits et ménage des versions remplacées.
SELECT ok(
  has_function_privilege('authenticated','public.get_sales_by_product_v6(date,date,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_product_sales_lines_v7(uuid,date,date,integer,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_product_v6(date,date,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_product_sales_lines_v7(uuid,date,date,integer,text,jsonb)','EXECUTE')
  AND to_regprocedure('public.get_sales_by_product_v5(date,date,uuid)') IS NULL
  AND to_regprocedure('public.get_product_sales_lines_v6(uuid,date,date,integer,text)') IS NULL,
  'T23: authenticated may execute, anon may not, replaced versions are dropped');

-- T24/T25 EXCLUSION POSITIVE. T19 et T22 prouvent que les totaux se referment,
-- pas qu'un filtre écarte quoi que ce soit : un prédicat qui garderait tout
-- passerait. Ici deux commandes maîtrisées sur le même produit non-test —
--   A  #PGTAP-FA  take_out  table PGTAP-TA  qty 3  31 000  réglée en cash
--   B  #PGTAP-FB  dine_in   table PGTAP-TB  qty 7  72 000  réglée en qris
-- et l'on mesure le produit AVANT puis APRÈS, sous chaque filtre : le filtre A
-- ne doit bouger que de A, le filtre B que de B, dans l'agrégat ET les lignes.
CREATE FUNCTION pg_temp.sbp_probe(p_pid uuid, p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT jsonb_build_object(
    'agg_qty', COALESCE((SELECT (p->>'qty')::numeric
                           FROM jsonb_array_elements(a.r->'by_product') p
                          WHERE (p->>'product_id')::uuid = p_pid), 0),
    'agg_rev', COALESCE((SELECT (p->>'revenue')::numeric
                           FROM jsonb_array_elements(a.r->'by_product') p
                          WHERE (p->>'product_id')::uuid = p_pid), 0),
    'lin_qty', (l.r->'totals'->>'qty')::numeric,
    'lin_rev', (l.r->'totals'->>'revenue')::numeric,
    'orders',  COALESCE((SELECT jsonb_agg(x->>'order_number')
                           FROM jsonb_array_elements(l.r->'lines') x), '[]'::jsonb))
  FROM (SELECT get_sales_by_product_v6(CURRENT_DATE - 1, CURRENT_DATE, NULL, p_f) AS r) a,
       (SELECT get_product_sales_lines_v7(p_pid, CURRENT_DATE - 1, CURRENT_DATE, 500, NULL, p_f) AS r) l
$probe$;
-- Vrai si, entre deux sondes, l'agrégat ET les lignes ont bougé d'exactement
-- (p_qty, p_rev).
CREATE FUNCTION pg_temp.sbp_moved(p_before jsonb, p_after jsonb, p_qty numeric, p_rev numeric)
RETURNS boolean LANGUAGE sql AS $moved$
  SELECT (p_after->>'agg_qty')::numeric - (p_before->>'agg_qty')::numeric = p_qty
     AND (p_after->>'lin_qty')::numeric - (p_before->>'lin_qty')::numeric = p_qty
     AND (p_after->>'agg_rev')::numeric - (p_before->>'agg_rev')::numeric = p_rev
     AND (p_after->>'lin_rev')::numeric - (p_before->>'lin_rev')::numeric = p_rev
$moved$;

DO $$
DECLARE
  v_pid uuid; v_a uuid; v_b uuid;
  v_sid uuid := 'f5430000-0000-4000-a000-000000000001';
  b_all JSONB; b_to JSONB; b_di JSONB; b_cash JSONB; b_qris JSONB;
  a_all JSONB; a_to JSONB; a_di JSONB; a_cash JSONB; a_qris JSONB;
  v_ok24 BOOLEAN; v_ok25 BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT oi.product_id INTO v_pid
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
   WHERE o.order_number = '#PGTAP-SBP' LIMIT 1;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  b_all  := pg_temp.sbp_probe(v_pid, '{}');
  b_to   := pg_temp.sbp_probe(v_pid, '{"order_type":"take_out"}');
  b_di   := pg_temp.sbp_probe(v_pid, '{"order_type":"dine_in"}');
  b_cash := pg_temp.sbp_probe(v_pid, '{"payment_method":"cash"}');
  b_qris := pg_temp.sbp_probe(v_pid, '{"payment_method":"qris"}');

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-FA', 'take_out', 'paid', 31000, 0, 31000,
          now() - interval '30 minutes', now(), 'PGTAP-TA', v_sid)
  RETURNING id INTO v_a;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-FB', 'dine_in', 'paid', 72000, 0, 72000,
          now() - interval '30 minutes', now(), 'PGTAP-TB', v_sid)
  RETURNING id INTO v_b;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_a, v_pid, 'Filter A', 10000, 3, 31000),
         (v_b, v_pid, 'Filter B', 10000, 7, 72000);
  INSERT INTO order_payments (order_id, method, amount, session_id)
  VALUES (v_a, 'cash', 31000, v_sid),
         (v_b, 'qris', 72000, v_sid);
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  a_all  := pg_temp.sbp_probe(v_pid, '{}');
  a_to   := pg_temp.sbp_probe(v_pid, '{"order_type":"take_out"}');
  a_di   := pg_temp.sbp_probe(v_pid, '{"order_type":"dine_in"}');
  a_cash := pg_temp.sbp_probe(v_pid, '{"payment_method":"cash"}');
  a_qris := pg_temp.sbp_probe(v_pid, '{"payment_method":"qris"}');

  -- Sans filtre les deux commandes entrent ; sous A seule A, sous B seule B.
  v_ok24 := pg_temp.sbp_moved(b_all, a_all, 10, 103000)
        AND pg_temp.sbp_moved(b_to,  a_to,   3,  31000)
        AND pg_temp.sbp_moved(b_di,  a_di,   7,  72000)
        AND     (a_to->'orders') ? '#PGTAP-FA'
        AND NOT (a_to->'orders') ? '#PGTAP-FB'
        AND     (a_di->'orders') ? '#PGTAP-FB'
        AND NOT (a_di->'orders') ? '#PGTAP-FA';
  -- Même preuve par moyen de paiement ; #PGTAP-SBP, sans règlement, sort des deux.
  v_ok25 := pg_temp.sbp_moved(b_cash, a_cash, 3, 31000)
        AND pg_temp.sbp_moved(b_qris, a_qris, 7, 72000)
        AND     (a_cash->'orders') ? '#PGTAP-FA'
        AND NOT (a_cash->'orders') ? '#PGTAP-FB'
        AND NOT (a_cash->'orders') ? '#PGTAP-SBP'
        AND     (a_qris->'orders') ? '#PGTAP-FB'
        AND NOT (a_qris->'orders') ? '#PGTAP-FA'
        AND NOT (a_qris->'orders') ? '#PGTAP-SBP'
        AND     (a_all->'orders')  ? '#PGTAP-SBP';
  PERFORM set_config('breakery.t24', COALESCE(v_ok24, false)::text, false);
  PERFORM set_config('breakery.t25', COALESCE(v_ok25, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t24')::boolean,
  'T24: order_type filter keeps its own order and drops the other, in aggregate and lines');
SELECT ok(current_setting('breakery.t25')::boolean,
  'T25: payment_method filter keeps its own order and drops the others, in aggregate and lines');

-- Permission produit dédiée : le droit financier général reste explicitement refusé.
UPDATE public.user_permission_overrides SET is_granted=true WHERE permission_code='reports.product_sales.read'
 AND user_profile_id=(SELECT id FROM public.user_profiles WHERE employee_code='EMP001' AND deleted_at IS NULL);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002"}',true);
SELECT lives_ok($$SELECT get_sales_by_product_v6('2026-01-01',CURRENT_DATE)$$,'Dedicated product-sales permission can read the report');
SELECT lives_ok(format('SELECT get_product_sales_lines_v7(%L,%L,%L)',pid,'2026-01-01',CURRENT_DATE),
 'Dedicated product-sales permission can read its lines') FROM _sbp_subject;
SELECT * FROM finish();
ROLLBACK;
