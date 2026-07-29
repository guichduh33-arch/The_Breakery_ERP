-- supabase/tests/adr008_d5_d6.test.sql
-- ADR-008 D5 + D6 — comportement introduit par la migration 20260729000003
-- (record_production_v4 / record_batch_production_v6), porté sans changement par
-- 20260729000005 sur record_production_v5 / record_batch_production_v7, seules
-- versions vivantes. La suite s'exécute contre ces dernières.
--
-- D6 : produire un article marqué `deduct_stock = false` est refusé
--      (production_requires_deduct_stock, P0001). Côté lot le refus a lieu à la
--      validation des items, avant toute écriture, et le DETAIL nomme l'item.
-- D5 : s'il reste un intermédiaire NON suivi en stock à la profondeur maximale
--      du dépliage BOM (5), la production échoue avec recipe_depth_exceeded au
--      lieu de sous-consommer en silence. La condition exacte est
--      `depth = 5 AND is_intermediate AND NOT is_stocked` : depuis ADR-016 un
--      intermédiaire SUIVI en stock est légitimement consommé tel quel et ne
--      doit PAS déclencher l'erreur.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- ---------------------------------------------------------------------------
-- BRANCHE POSITIVE DE D5 : NON COUVERTE, ET STRUCTURELLEMENT INATTEIGNABLE.
-- ---------------------------------------------------------------------------
-- Faire remonter recipe_depth_exceeded depuis record_production_v5 demande un
-- nœud à `depth = 5` qui soit encore un intermédiaire, donc porteur de sa
-- propre recette : il faut une chaîne de SIX arêtes sous le produit fabriqué.
-- Or l'enregistrement de la 6ᵉ arête est déjà refusé en amont par la garde de
-- profondeur qui s'exécute à l'INSERT dans `recipes` (elle ne connaît pas
-- `track_inventory` et ne s'arrête donc pas aux intermédiaires stockés) :
-- l'insertion lève elle-même recipe_depth_exceeded (P0001) et la chaîne
-- n'existe jamais. Vérifié en base le 2026-07-29 : sur une chaîne bottom-up
-- P7←P6←…←P1, les cinq premières arêtes passent et la dernière (P1→P2) est
-- rejetée, que le nœud de profondeur 5 soit stocké ou non.
-- Conséquence : le garde D5 est une ceinture de sécurité derrière une garde
-- amont déjà fermée. Il n'est pas déclenchable sans désactiver un trigger, ce
-- que cette suite ne fait pas. Ce qui EST testé ici est le risque réel — le
-- FAUX POSITIF : la production doit passer sans erreur quand le dépliage
-- s'arrête sur un intermédiaire stocké (CHECK 3) et quand il atteint la
-- profondeur maximale sur une feuille (CHECK 4).
--
-- Coverage matrix :
--   1  D6 unitaire : production_requires_deduct_stock (P0001), et l'échec ne
--      laisse ni mouvement de stock ni production_records (T1-T3).
--   2  D6 lot : même refus, DETAIL 'Item #2 product=<uuid>' (T4-T5).
--   3  D5 non-régression : dépliage stoppé sur un intermédiaire STOCKÉ ->
--      aucune erreur, un seul production_out, sur cet intermédiaire (T6-T7).
--   4  D5 non-régression : dépliage atteignant la profondeur maximale 5 sur
--      une feuille -> aucune erreur (T8-T9).
--   5  droits : anon révoqué / authenticated conservé sur _v5 et _v7, et
--      record_production_v4 / record_batch_production_v6 absentes de pg_proc
--      (T10-T11).
--
-- Fixture topology (tout en 'pcs' sauf la matière, en 'kg') :
--   mat   (feuille, 1000 kg, track_inventory=true)
--   nd    (deduct_stock = FALSE)                  <- mat 0.1 kg/pcs   [D6]
--   ok    (deduct_stock = true)                   <- mat 0.1 kg/pcs   [item #1 du lot]
--   d1 -> d2 -> d3 -> d4 -> d5s -> mat            [CHECK 3]
--     d2/d3/d4 : track_inventory = FALSE (dépliage traversant)
--     d5s      : track_inventory = TRUE, 100 en stock -> le dépliage s'arrête
--                sur lui à depth = 4, il est consommé tel quel
--   e1 -> e2 -> e3 -> e4 -> e5 -> mat             [CHECK 4]
--     e2..e5   : track_inventory = FALSE -> le dépliage descend jusqu'à mat,
--                atteinte à depth = 5 en tant que FEUILLE (donc hors garde D5)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Bootstrap : section + catégorie actives.
-- ---------------------------------------------------------------------------
DO $bootstrap$
DECLARE
  v_section  UUID;
  v_category UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles
                  WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'
                    AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Seed user 00000000-…-001 (EMP000) not found';
  END IF;

  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  IF v_section IS NULL THEN
    RAISE EXCEPTION 'No active section — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.section_id', v_section::text, false);

  SELECT id INTO v_category FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'No active category — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.category_id', v_category::text, false);
END $bootstrap$;

-- ---------------------------------------------------------------------------
-- Fixture : produits + recettes.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ids(label text PRIMARY KEY, id uuid) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_cat uuid := current_setting('breakery.category_id')::uuid;
  v_mat uuid := gen_random_uuid();
  v_nd  uuid := gen_random_uuid();
  v_ok  uuid := gen_random_uuid();
  v_d1  uuid := gen_random_uuid();
  v_d2  uuid := gen_random_uuid();
  v_d3  uuid := gen_random_uuid();
  v_d4  uuid := gen_random_uuid();
  v_d5s uuid := gen_random_uuid();
  v_e1  uuid := gen_random_uuid();
  v_e2  uuid := gen_random_uuid();
  v_e3  uuid := gen_random_uuid();
  v_e4  uuid := gen_random_uuid();
  v_e5  uuid := gen_random_uuid();
BEGIN
  INSERT INTO products (
    id, sku, name, category_id, retail_price, unit, cost_price,
    product_type, is_active, current_stock, track_inventory, deduct_stock
  ) VALUES
    (v_mat, 'ADR008-MAT', 'ADR008 Matiere',              v_cat, 0, 'kg',  1000, 'finished', true, 1000, true,  true),
    -- D6 : le produit dont la production doit être refusée
    (v_nd,  'ADR008-ND',  'ADR008 No Deduct',            v_cat, 0, 'pcs', 0,    'finished', true, 0,    true,  false),
    (v_ok,  'ADR008-OK',  'ADR008 Ok Deduct',            v_cat, 0, 'pcs', 0,    'finished', true, 0,    true,  true),
    -- CHECK 3 : la descente s'arrête sur d5s, intermédiaire STOCKÉ
    (v_d1,  'ADR008-D1',  'ADR008 D1 Fini',              v_cat, 0, 'pcs', 0,    'finished', true, 0,    true,  true),
    (v_d2,  'ADR008-D2',  'ADR008 D2 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_d3,  'ADR008-D3',  'ADR008 D3 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_d4,  'ADR008-D4',  'ADR008 D4 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_d5s, 'ADR008-D5S', 'ADR008 D5 Stocked Interm',    v_cat, 0, 'pcs', 500,  'finished', true, 100,  true,  true),
    -- CHECK 4 : la descente atteint la profondeur maximale 5 sur mat (feuille)
    (v_e1,  'ADR008-E1',  'ADR008 E1 Fini',              v_cat, 0, 'pcs', 0,    'finished', true, 0,    true,  true),
    (v_e2,  'ADR008-E2',  'ADR008 E2 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_e3,  'ADR008-E3',  'ADR008 E3 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_e4,  'ADR008-E4',  'ADR008 E4 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true),
    (v_e5,  'ADR008-E5',  'ADR008 E5 Unstocked',         v_cat, 0, 'pcs', 0,    'finished', true, 0,    false, true);

  -- Chaînes construites bottom-up : chaque INSERT reste sous la garde de
  -- profondeur amont (5 arêtes au plus par chaîne).
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_nd,  v_mat, 0.1, 'kg',  true),
    (v_ok,  v_mat, 0.1, 'kg',  true),
    (v_d5s, v_mat, 0.1, 'kg',  true),
    (v_d4,  v_d5s, 1,   'pcs', true),
    (v_d3,  v_d4,  1,   'pcs', true),
    (v_d2,  v_d3,  1,   'pcs', true),
    (v_d1,  v_d2,  1,   'pcs', true),
    (v_e5,  v_mat, 0.1, 'kg',  true),
    (v_e4,  v_e5,  1,   'pcs', true),
    (v_e3,  v_e4,  1,   'pcs', true),
    (v_e2,  v_e3,  1,   'pcs', true),
    (v_e1,  v_e2,  1,   'pcs', true);

  INSERT INTO _ids VALUES
    ('mat', v_mat), ('nd', v_nd), ('ok', v_ok),
    ('d1', v_d1), ('d5s', v_d5s), ('e1', v_e1);
END $fixture$;

-- ===========================================================================
-- CHECK 1 — D6 unitaire : record_production_v5 refuse un deduct_stock = false,
-- et l'échec ne laisse aucune trace (ni mouvement, ni production_records).
-- ===========================================================================
DO $chk1$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_nd      UUID := (SELECT id FROM _ids WHERE label='nd');
  v_mv_before   INT;
  v_mv_after    INT;
  v_prod_before INT;
  v_prod_after  INT;
  v_errmsg  TEXT := '';
  v_errcode TEXT := '';
BEGIN
  SELECT COUNT(*) INTO v_mv_before   FROM stock_movements;
  SELECT COUNT(*) INTO v_prod_before FROM production_records;

  BEGIN
    PERFORM record_production_v5(
      p_product_id := v_nd, p_quantity_produced := 3,
      p_section_id := v_section, p_batch_number := 'ADR008-C1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_errmsg  := SQLERRM;
    v_errcode := SQLSTATE;
  END;

  SELECT COUNT(*) INTO v_mv_after   FROM stock_movements;
  SELECT COUNT(*) INTO v_prod_after FROM production_records;

  PERFORM set_config('breakery.c1_err', v_errmsg || '|' || v_errcode, false);
  PERFORM set_config('breakery.c1_mv_delta',   (v_mv_after - v_mv_before)::text, false);
  PERFORM set_config('breakery.c1_prod_delta', (v_prod_after - v_prod_before)::text, false);
END $chk1$;

SELECT is(current_setting('breakery.c1_err'), 'production_requires_deduct_stock|P0001',
  'T1: ADR-008 D6 — record_production_v5 on a deduct_stock = false product raises production_requires_deduct_stock (P0001)');
SELECT is(current_setting('breakery.c1_mv_delta')::int, 0,
  'T2: the refused production created zero stock_movements rows');
SELECT is(current_setting('breakery.c1_prod_delta')::int, 0,
  'T3: the refused production created zero production_records rows');

-- ===========================================================================
-- CHECK 2 — D6 côté lot : record_batch_production_v7 refuse à la validation
-- des items et le DETAIL nomme l'item fautif.
-- ===========================================================================
DO $chk2$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_nd      UUID := (SELECT id FROM _ids WHERE label='nd');
  v_ok      UUID := (SELECT id FROM _ids WHERE label='ok');
  v_errmsg  TEXT := '';
  v_errcode TEXT := '';
  v_detail  TEXT := '';
BEGIN
  BEGIN
    PERFORM record_batch_production_v7(
      jsonb_build_object('section_id', v_section::text, 'notes', 'ADR008-C2'),
      jsonb_build_array(
        jsonb_build_object('product_id', v_ok::text, 'quantity_produced', 1),
        jsonb_build_object('product_id', v_nd::text, 'quantity_produced', 1)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_errmsg  := SQLERRM;
    v_errcode := SQLSTATE;
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;

  PERFORM set_config('breakery.c2_err', v_errmsg || '|' || v_errcode, false);
  PERFORM set_config('breakery.c2_detail_ok',
    CASE WHEN v_detail = format('Item #%s product=%s', 2, v_nd) THEN '1' ELSE '0|' || v_detail END,
    false);
END $chk2$;

SELECT is(current_setting('breakery.c2_err'), 'production_requires_deduct_stock|P0001',
  'T4: ADR-008 D6 — record_batch_production_v7 refuses the batch as soon as one item is deduct_stock = false');
SELECT is(current_setting('breakery.c2_detail_ok'), '1',
  'T5: the batch DETAIL names the faulty item verbatim (''Item #2 product=<uuid of ADR008-ND>'')');

-- ===========================================================================
-- CHECK 3 — D5 non-régression : le dépliage s'arrête sur un intermédiaire
-- SUIVI EN STOCK. Aucune erreur, un seul production_out, sur cet intermédiaire.
-- ===========================================================================
DO $chk3$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_d1      UUID := (SELECT id FROM _ids WHERE label='d1');
  v_d5s     UUID := (SELECT id FROM _ids WHERE label='d5s');
  v_result  JSONB;
  v_pr      UUID;
  v_errmsg  TEXT := 'no_error';
  v_out_count INT := -1;
  v_out_on_d5s INT := -1;
BEGIN
  BEGIN
    v_result := record_production_v5(
      p_product_id := v_d1, p_quantity_produced := 2,
      p_section_id := v_section, p_batch_number := 'ADR008-C3',
      p_recurse_subrecipes := TRUE
    );
    v_pr := (v_result->>'production_id')::uuid;

    SELECT COUNT(*) INTO v_out_count FROM stock_movements
      WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';
    SELECT COUNT(*) INTO v_out_on_d5s FROM stock_movements
      WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out'
        AND product_id = v_d5s;
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;

  PERFORM set_config('breakery.c3_err', v_errmsg, false);
  PERFORM set_config('breakery.c3_shape',
    v_out_count::text || '|' || v_out_on_d5s::text, false);
END $chk3$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c3_err'), 'no_error',
  'T6: ADR-008 D5 — a STOCKED intermediate ending the BOM descent raises NO recipe_depth_exceeded (the guard is is_stocked-aware, no false positive)');
SELECT is(current_setting('breakery.c3_shape'), '1|1',
  'T7: that production emits exactly 1 production_out row, on the stocked intermediate itself (ADR-016 descent preserved)');

-- ===========================================================================
-- CHECK 4 — D5 non-régression : le dépliage atteint la profondeur maximale (5)
-- sur une FEUILLE. Aucune erreur : la garde ne vise que les intermédiaires.
-- ===========================================================================
DO $chk4$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_e1      UUID := (SELECT id FROM _ids WHERE label='e1');
  v_mat     UUID := (SELECT id FROM _ids WHERE label='mat');
  v_result  JSONB;
  v_pr      UUID;
  v_errmsg  TEXT := 'no_error';
  v_depth   TEXT := '';
  v_out_on_mat INT := -1;
BEGIN
  BEGIN
    v_result := record_production_v5(
      p_product_id := v_e1, p_quantity_produced := 2,
      p_section_id := v_section, p_batch_number := 'ADR008-C4',
      p_recurse_subrecipes := TRUE
    );
    v_pr    := (v_result->>'production_id')::uuid;
    v_depth := COALESCE(v_result->>'depth_reached', 'null');

    SELECT COUNT(*) INTO v_out_on_mat FROM stock_movements
      WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out'
        AND product_id = v_mat;
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;

  PERFORM set_config('breakery.c4_err',   v_errmsg, false);
  PERFORM set_config('breakery.c4_depth', v_depth, false);
  PERFORM set_config('breakery.c4_out_on_mat', v_out_on_mat::text, false);
END $chk4$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c4_err') || '|' || current_setting('breakery.c4_depth'),
  'no_error|5',
  'T8: ADR-008 D5 — a descent reaching the maximum depth (5) on a LEAF raises no error (depth_reached = 5)');
SELECT is(current_setting('breakery.c4_out_on_mat')::int, 1,
  'T9: that production consumes the raw-material leaf reached at depth 5');

-- ===========================================================================
-- CHECK 5 — droits et disparition des versions précédentes.
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_production_v5(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)',
    'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_batch_production_v7(jsonb, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.record_production_v5(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)',
    'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_batch_production_v7(jsonb, jsonb)', 'EXECUTE'),
  'T10: anon has EXECUTE revoked and authenticated retains it, on both record_production_v5 and record_batch_production_v7'
);

SELECT ok(
  to_regprocedure('public.record_production_v4(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean)') IS NULL
  AND to_regprocedure('public.record_batch_production_v6(jsonb, jsonb)') IS NULL,
  'T11: the superseded record_production_v4 and record_batch_production_v6 are absent from pg_proc'
);

SELECT * FROM finish();
ROLLBACK;
