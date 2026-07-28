-- supabase/tests/adr016_descente_semi_finis.test.sql
-- ADR-016 — la cascade de production s'arrête au premier intermédiaire suivi
-- en stock (`products.track_inventory = true`) et le consomme depuis SON
-- stock, au lieu de descendre jusqu'aux matières premières. Seuls les
-- intermédiaires NON suivis en stock restent dépliés jusqu'aux feuilles.
--
-- Couvre les migrations 20260729000001 (record_production_v3,
-- record_batch_production_v5) et 20260729000002 (recipe_bom_full_v2,
-- upsert_recipe_v2).
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- Coverage matrix :
--   1  fini -> semi-fini STOCKÉ -> matières : production_out UNIQUEMENT sur
--      le semi-fini, aucun sur les matières sous-jacentes (T1-T4).
--   2  Même arbre, ligne en 'g' / stockage en 'kg' : consommation = 0,09 et
--      non 90 — LE test de non-régression du facteur 1000 (T5-T8).
--   3  fini -> semi-fini NON STOCKÉ -> matières : dépliage jusqu'aux feuilles
--      conservé (T9-T12).
--   4  semi-fini stocké à zéro : insufficient_stock, DETAIL nomme le
--      semi-fini (T13-T14).
--   5  recipe_bom_full_v2 : le semi-fini stocké est une ligne terminale
--      valorisée à son cost_price (T15-T19).
--   6  upsert_recipe_v2 : refus unit_not_convertible sur g -> pcs,
--      acceptation de gr -> kg (T20-T21).
--   7  paire REVOKE (FROM PUBLIC + FROM anon) sur les 4 fonctions, grant
--      authenticated sur record_batch_production_v5, anciennes versions
--      absentes de pg_proc (T22-T24).
--
-- Fixture topology (unit 'kg' for the stocked/unstocked semi-finis, 'pcs'
-- for the finished goods) :
--   farine (leaf, 1000 kg @ 1000/kg)
--   pate_a (STOCKED semi-fini, 50 kg @ 8000/kg)  <- farine 0.6 kg/kg
--     croissant (fini, pcs)                      <- pate_a 0.2 kg/pcs
--   pate_b (STOCKED semi-fini, 50 kg @ 1000/kg)  <- farine 1 kg/kg
--     baguette (fini, pcs)                       <- pate_b 90 g/pcs  (×1000 case)
--   pate_c (NON-STOCKED semi-fini, 0 kg)         <- farine 0.5 kg/kg
--     bagel (fini, pcs)                          <- pate_c 0.1 kg/pcs
--   pate_d (STOCKED semi-fini, 0 kg @ 500/kg)    <- farine 0.5 kg/kg
--     donut (fini, pcs)                          <- pate_d 1 kg/pcs

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

-- ---------------------------------------------------------------------------
-- Bootstrap : admin (SUPER_ADMIN, EMP000) JWT + section + category.
-- ---------------------------------------------------------------------------
DO $bootstrap$
DECLARE
  v_admin_uid UUID;
  v_section   UUID;
  v_category  UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
  PERFORM set_config('breakery.admin_uid', v_admin_uid::text, false);

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
-- Fixture products + recipes.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ids(label text PRIMARY KEY, id uuid) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_cat uuid := current_setting('breakery.category_id')::uuid;
  v_farine    uuid := gen_random_uuid();
  v_pate_a    uuid := gen_random_uuid();
  v_croissant uuid := gen_random_uuid();
  v_pate_b    uuid := gen_random_uuid();
  v_baguette  uuid := gen_random_uuid();
  v_pate_c    uuid := gen_random_uuid();
  v_bagel     uuid := gen_random_uuid();
  v_pate_d    uuid := gen_random_uuid();
  v_donut     uuid := gen_random_uuid();
  v_topping   uuid := gen_random_uuid();
  v_dummy     uuid := gen_random_uuid();
BEGIN
  INSERT INTO products (
    id, sku, name, category_id, retail_price, unit, cost_price,
    product_type, is_active, current_stock, track_inventory, deduct_stock
  ) VALUES
    (v_farine,    'ADR016-FARINE',    'ADR016 Farine',                 v_cat, 0,    'kg',  1000, 'finished', true, 1000, true,  false),
    -- 1 : semi-fini STOCKÉ
    (v_pate_a,    'ADR016-PATE-A',    'ADR016 Pate A Stocked',         v_cat, 0,    'kg',  8000, 'finished', true, 50,   true,  false),
    (v_croissant, 'ADR016-CROISSANT', 'ADR016 Croissant',              v_cat, 5000, 'pcs', 0,    'finished', true, 0,    true,  true),
    -- 2 : même topologie, ligne en 'g' -> stockage 'kg' (régression x1000)
    (v_pate_b,    'ADR016-PATE-B',    'ADR016 Pate B Stocked',         v_cat, 0,    'kg',  1000, 'finished', true, 50,   true,  false),
    (v_baguette,  'ADR016-BAGUETTE',  'ADR016 Baguette',               v_cat, 3000, 'pcs', 0,    'finished', true, 0,    true,  true),
    -- 3 : semi-fini NON STOCKÉ -> dépliage conservé
    (v_pate_c,    'ADR016-PATE-C',    'ADR016 Pate C Unstocked',       v_cat, 0,    'kg',  0,    'finished', true, 0,    false, false),
    (v_bagel,     'ADR016-BAGEL',     'ADR016 Bagel',                  v_cat, 4000, 'pcs', 0,    'finished', true, 0,    true,  true),
    -- 4 : semi-fini STOCKÉ à zéro -> insufficient_stock
    (v_pate_d,    'ADR016-PATE-D',    'ADR016 Pate D Stocked Zero',    v_cat, 0,    'kg',  500,  'finished', true, 0,    true,  false),
    (v_donut,     'ADR016-DONUT',     'ADR016 Donut',                  v_cat, 6000, 'pcs', 0,    'finished', true, 0,    true,  true),
    -- 6 : upsert_recipe_v2 unit guard fixtures
    (v_topping,   'ADR016-TOPPING',   'ADR016 Topping Counted In Pcs', v_cat, 0,    'pcs', 100,  'finished', true, 100,  true,  false),
    (v_dummy,     'ADR016-DUMMY',     'ADR016 Dummy Finished',         v_cat, 1000, 'pcs', 0,    'finished', true, 0,    true,  true);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_pate_a,    v_farine, 0.6,  'kg', true),
    (v_croissant, v_pate_a, 0.2,  'kg', true),
    (v_pate_b,    v_farine, 1,    'kg', true),
    (v_baguette,  v_pate_b, 90,   'g',  true),  -- line unit 'g', pate_b stored in 'kg'
    (v_pate_c,    v_farine, 0.5,  'kg', true),
    (v_bagel,     v_pate_c, 0.1,  'kg', true),
    (v_pate_d,    v_farine, 0.5,  'kg', true),
    (v_donut,     v_pate_d, 1,    'kg', true);

  INSERT INTO _ids VALUES
    ('farine',    v_farine),
    ('pate_a',    v_pate_a),
    ('croissant', v_croissant),
    ('pate_b',    v_pate_b),
    ('baguette',  v_baguette),
    ('pate_c',    v_pate_c),
    ('bagel',     v_bagel),
    ('pate_d',    v_pate_d),
    ('donut',     v_donut),
    ('topping',   v_topping),
    ('dummy',     v_dummy);
END $fixture$;

-- ===========================================================================
-- CHECK 1 — fini -> semi-fini STOCKÉ -> matières.
-- Production emits a production_out ONLY on pate_a ; none on farine.
-- ===========================================================================
DO $chk1$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_croissant UUID := (SELECT id FROM _ids WHERE label='croissant');
  v_pate_a    UUID := (SELECT id FROM _ids WHERE label='pate_a');
  v_farine    UUID := (SELECT id FROM _ids WHERE label='farine');
  v_result JSONB;
  v_pr UUID;
  v_out_count INT;
  v_out_material UUID;
  v_out_qty NUMERIC;
  v_farine_out_count INT;
BEGIN
  v_result := record_production_v3(
    p_product_id := v_croissant, p_quantity_produced := 5,
    p_section_id := v_section, p_batch_number := 'ADR016-C1'
  );
  v_pr := (v_result->>'production_id')::uuid;

  SELECT COUNT(*) INTO v_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';
  SELECT product_id, quantity INTO v_out_material, v_out_qty FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out' LIMIT 1;
  SELECT COUNT(*) INTO v_farine_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out'
      AND product_id = v_farine;

  PERFORM set_config('breakery.c1_out_count',     v_out_count::text, false);
  PERFORM set_config('breakery.c1_out_material',  CASE WHEN v_out_material = v_pate_a THEN 'pate_a' ELSE 'OTHER' END, false);
  PERFORM set_config('breakery.c1_out_qty',       v_out_qty::text, false);
  PERFORM set_config('breakery.c1_farine_count',  v_farine_out_count::text, false);
END $chk1$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c1_out_count')::int, 1,
  'T1: croissant production (stocked pate_a) emits exactly 1 production_out row');
SELECT is(current_setting('breakery.c1_out_material'), 'pate_a',
  'T2: the single production_out row is on pate_a, not on farine');
SELECT is(current_setting('breakery.c1_out_qty')::numeric, -1.000::numeric,
  'T3: pate_a consumption = 5 * 0.2 kg = 1.000 kg (signed negative)');
SELECT is(current_setting('breakery.c1_farine_count')::int, 0,
  'T4: farine has zero production_out rows for this production (no descent past the stocked semi-fini)');

-- ===========================================================================
-- CHECK 2 — même arbre, ligne en 'g' / stockage en 'kg'. Consommation = 0.09,
-- pas 90 : LE test de non-régression du facteur 1000.
-- ===========================================================================
DO $chk2$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_baguette UUID := (SELECT id FROM _ids WHERE label='baguette');
  v_pate_b   UUID := (SELECT id FROM _ids WHERE label='pate_b');
  v_farine   UUID := (SELECT id FROM _ids WHERE label='farine');
  v_result JSONB;
  v_pr UUID;
  v_out_count INT;
  v_out_material UUID;
  v_out_qty NUMERIC;
  v_farine_out_count INT;
BEGIN
  v_result := record_production_v3(
    p_product_id := v_baguette, p_quantity_produced := 1,
    p_section_id := v_section, p_batch_number := 'ADR016-C2'
  );
  v_pr := (v_result->>'production_id')::uuid;

  SELECT COUNT(*) INTO v_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';
  SELECT product_id, quantity INTO v_out_material, v_out_qty FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out' LIMIT 1;
  SELECT COUNT(*) INTO v_farine_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out'
      AND product_id = v_farine;

  PERFORM set_config('breakery.c2_out_count',    v_out_count::text, false);
  PERFORM set_config('breakery.c2_out_material', CASE WHEN v_out_material = v_pate_b THEN 'pate_b' ELSE 'OTHER' END, false);
  PERFORM set_config('breakery.c2_out_qty',      v_out_qty::text, false);
  PERFORM set_config('breakery.c2_farine_count', v_farine_out_count::text, false);
END $chk2$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c2_out_count')::int, 1,
  'T5: baguette production (stocked pate_b) emits exactly 1 production_out row');
SELECT is(current_setting('breakery.c2_out_material'), 'pate_b',
  'T6: the single production_out row is on pate_b, not on farine');
SELECT is(current_setting('breakery.c2_out_qty')::numeric, -0.09::numeric,
  'T7: REGRESSION x1000 — 90 gr consumed against a kg-stored pate_b converts to 0.09 kg, NOT 90');
SELECT is(current_setting('breakery.c2_farine_count')::int, 0,
  'T8: farine has zero production_out rows (cascade stopped at the stocked pate_b)');

-- ===========================================================================
-- CHECK 3 — fini -> semi-fini NON STOCKÉ -> matières : dépliage conservé.
-- ===========================================================================
DO $chk3$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_bagel  UUID := (SELECT id FROM _ids WHERE label='bagel');
  v_pate_c UUID := (SELECT id FROM _ids WHERE label='pate_c');
  v_farine UUID := (SELECT id FROM _ids WHERE label='farine');
  v_result JSONB;
  v_pr UUID;
  v_out_count INT;
  v_out_material UUID;
  v_out_qty NUMERIC;
  v_pate_c_out_count INT;
BEGIN
  v_result := record_production_v3(
    p_product_id := v_bagel, p_quantity_produced := 10,
    p_section_id := v_section, p_batch_number := 'ADR016-C3'
  );
  v_pr := (v_result->>'production_id')::uuid;

  SELECT COUNT(*) INTO v_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';
  SELECT product_id, quantity INTO v_out_material, v_out_qty FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out' LIMIT 1;
  SELECT COUNT(*) INTO v_pate_c_out_count FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out'
      AND product_id = v_pate_c;

  PERFORM set_config('breakery.c3_out_count',    v_out_count::text, false);
  PERFORM set_config('breakery.c3_out_material', CASE WHEN v_out_material = v_farine THEN 'farine' ELSE 'OTHER' END, false);
  PERFORM set_config('breakery.c3_out_qty',      v_out_qty::text, false);
  PERFORM set_config('breakery.c3_pate_c_count', v_pate_c_out_count::text, false);
END $chk3$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c3_out_count')::int, 1,
  'T9: bagel production (non-stocked pate_c) emits exactly 1 production_out row, on the raw-material leaf');
SELECT is(current_setting('breakery.c3_out_material'), 'farine',
  'T10: the production_out row is on farine (dive-through preserved for a non-stocked intermediate)');
SELECT is(current_setting('breakery.c3_out_qty')::numeric, -0.5::numeric,
  'T11: farine consumption = 10 * 0.1 kg pate_c * 0.5 kg farine/kg pate_c = 0.5 kg');
SELECT is(current_setting('breakery.c3_pate_c_count')::int, 0,
  'T12: pate_c itself has zero production_out rows (it is never consumed directly when non-stocked)');

-- ===========================================================================
-- CHECK 4 — semi-fini STOCKÉ à zéro -> insufficient_stock, DETAIL le nomme.
-- ===========================================================================
DO $chk4$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_donut  UUID := (SELECT id FROM _ids WHERE label='donut');
  v_caught BOOLEAN := false;
  v_errcode TEXT := '';
  v_detail TEXT := '';
BEGIN
  BEGIN
    PERFORM record_production_v3(
      p_product_id := v_donut, p_quantity_produced := 1,
      p_section_id := v_section, p_batch_number := 'ADR016-C4'
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := (SQLERRM = 'insufficient_stock');
    v_errcode := SQLSTATE;
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;

  PERFORM set_config('breakery.c4_caught',  CASE WHEN v_caught THEN '1' ELSE '0' END, false);
  PERFORM set_config('breakery.c4_errcode', v_errcode, false);
  PERFORM set_config('breakery.c4_detail_has_name',
    CASE WHEN v_detail LIKE '%ADR016 Pate D Stocked Zero%' THEN '1' ELSE '0' END, false);
END $chk4$;

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

SELECT is(current_setting('breakery.c4_caught') || '|' || current_setting('breakery.c4_errcode'), '1|P0002',
  'T13: donut production against a zero-stock pate_d raises insufficient_stock (P0002)');
SELECT is(current_setting('breakery.c4_detail_has_name'), '1',
  'T14: the insufficient_stock DETAIL names the semi-fini (pate_d), not a raw material');

-- ===========================================================================
-- CHECK 5 — recipe_bom_full_v2 : le semi-fini stocké est une ligne terminale
-- valorisée à son propre cost_price.
-- ===========================================================================
DO $chk5$
DECLARE
  v_croissant UUID := (SELECT id FROM _ids WHERE label='croissant');
  v_pate_a    UUID := (SELECT id FROM _ids WHERE label='pate_a');
  v_farine    UUID := (SELECT id FROM _ids WHERE label='farine');
  v_row_count INT;
  v_material  UUID;
  v_cost      NUMERIC;
  v_line_cost NUMERIC;
  v_farine_found BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_row_count FROM recipe_bom_full_v2(v_croissant, 5);
  SELECT material_id, cost_price, line_cost INTO v_material, v_cost, v_line_cost
    FROM recipe_bom_full_v2(v_croissant, 5) LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM recipe_bom_full_v2(v_croissant, 5) WHERE material_id = v_farine)
    INTO v_farine_found;

  PERFORM set_config('breakery.c5_row_count', v_row_count::text, false);
  PERFORM set_config('breakery.c5_material',  CASE WHEN v_material = v_pate_a THEN 'pate_a' ELSE 'OTHER' END, false);
  PERFORM set_config('breakery.c5_cost',      v_cost::text, false);
  PERFORM set_config('breakery.c5_line_cost', v_line_cost::text, false);
  PERFORM set_config('breakery.c5_farine',    CASE WHEN v_farine_found THEN '1' ELSE '0' END, false);
END $chk5$;

SELECT is(current_setting('breakery.c5_row_count')::int, 1,
  'T15: recipe_bom_full_v2(croissant) returns exactly 1 row (pate_a as a terminal line)');
SELECT is(current_setting('breakery.c5_material'), 'pate_a',
  'T16: the single row material_id is pate_a, not farine');
SELECT is(current_setting('breakery.c5_cost')::numeric, 8000::numeric,
  'T17: pate_a line is valued at its OWN cost_price (8000), not the recomputed farine cost');
SELECT is(current_setting('breakery.c5_line_cost')::numeric, 1600::numeric,
  'T18: line_cost = qty_per_unit (0.2) * pate_a.cost_price (8000) = 1600');
SELECT is(current_setting('breakery.c5_farine'), '0',
  'T19: farine does not appear in recipe_bom_full_v2(croissant) output');

-- ===========================================================================
-- CHECK 6 — upsert_recipe_v2 : refuse g -> pcs, accepte gr -> kg.
-- ===========================================================================
DO $chk6$
DECLARE
  v_dummy   UUID := (SELECT id FROM _ids WHERE label='dummy');
  v_topping UUID := (SELECT id FROM _ids WHERE label='topping');
  v_farine  UUID := (SELECT id FROM _ids WHERE label='farine');
  v_caught  BOOLEAN := false;
  v_detail  TEXT := '';
  v_recipe_id UUID;
  v_stored_qty NUMERIC;
  v_stored_unit TEXT;
BEGIN
  -- g -> pcs : NOT convertible (mass vs count dimension) -> unit_not_convertible.
  BEGIN
    PERFORM upsert_recipe_v2(
      p_product_id := v_dummy, p_material_id := v_topping,
      p_quantity := 10, p_unit := 'g'
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := (SQLERRM = 'unit_not_convertible');
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;
  PERFORM set_config('breakery.c6_rejected', CASE WHEN v_caught THEN '1' ELSE '0' END, false);
  PERFORM set_config('breakery.c6_detail',   CASE WHEN v_detail = 'g -> pcs' THEN '1' ELSE '0' END, false);

  -- gr -> kg : convertible (0.001 factor) -> accepted, no exception.
  v_recipe_id := upsert_recipe_v2(
    p_product_id := v_dummy, p_material_id := v_farine,
    p_quantity := 90, p_unit := 'gr'
  );
  SELECT quantity, unit INTO v_stored_qty, v_stored_unit FROM recipes WHERE id = v_recipe_id;
  PERFORM set_config('breakery.c6_accepted',
    CASE WHEN v_stored_qty = 90 AND v_stored_unit = 'gr' THEN '1' ELSE '0' END, false);
END $chk6$;

SELECT is(current_setting('breakery.c6_rejected') || '|' || current_setting('breakery.c6_detail'), '1|1',
  'T20: upsert_recipe_v2 rejects a g line against a pcs-stored material (unit_not_convertible, DETAIL ''g -> pcs'')');
SELECT is(current_setting('breakery.c6_accepted'), '1',
  'T21: upsert_recipe_v2 accepts a gr line against a kg-stored material (convertible), stores quantity=90 unit=gr verbatim');

-- ===========================================================================
-- CHECK 7 — paire REVOKE (anon + PUBLIC), grant authenticated, anciennes
-- versions absentes de pg_proc.
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_production_v3(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean)',
    'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_batch_production_v5(jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.recipe_bom_full_v2(uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.upsert_recipe_v2(uuid, uuid, numeric, text, text, boolean, numeric)', 'EXECUTE'),
  'T22: anon has EXECUTE revoked on all 4 ADR-016 functions (record_production_v3, record_batch_production_v5, recipe_bom_full_v2, upsert_recipe_v2) — REVOKE FROM PUBLIC is baked into the same migration statements, verified by reading 20260729000001/2'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.record_batch_production_v5(jsonb, jsonb)', 'EXECUTE'),
  'T23: authenticated retains EXECUTE on record_batch_production_v5'
);

SELECT ok(
  to_regprocedure('public.record_production_v2(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean)') IS NULL
  AND to_regprocedure('public.record_batch_production_v3(jsonb, jsonb)') IS NULL
  AND to_regprocedure('public.record_batch_production_v4(jsonb, jsonb)') IS NULL
  AND to_regprocedure('public.recipe_bom_full_v1(uuid, integer)') IS NULL
  AND to_regprocedure('public.upsert_recipe_v1(uuid, uuid, numeric, text, text, boolean, numeric)') IS NULL,
  'T24: all 5 pre-ADR-016 function signatures (record_production_v2, record_batch_production_v3, record_batch_production_v4, recipe_bom_full_v1, upsert_recipe_v1) are absent from pg_proc'
);

SELECT * FROM finish();
ROLLBACK;
