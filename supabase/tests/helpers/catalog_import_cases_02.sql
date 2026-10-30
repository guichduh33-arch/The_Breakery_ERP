-- T27 : recipes.quantity > NUMERIC(10,3) bound -> value_out_of_range (DEV-S45-IMP-01 follow-up)
DO $t27$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  v_rep := import_catalog_v2(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-FLOUR', 'quantity', 50000000::numeric, 'unit', 'g'))
  ), true);
  PERFORM set_config('breakery.t27',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t27$;
SELECT is(current_setting('breakery.t27'), '1', 'T27 over-range recipe quantity -> value_out_of_range');

-- T28 : product_unit_alternatives.factor_to_base > NUMERIC(20,10) bound -> value_out_of_range
DO $t28$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  v_rep := import_catalog_v2(jsonb_build_object(
    'units', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-FLOUR', 'code', 'megabag', 'factor_to_base', 99999999999::numeric, 'tags', jsonb_build_array('purchase')))
  ), true);
  PERFORM set_config('breakery.t28',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t28$;
SELECT is(current_setting('breakery.t28'), '1', 'T28 over-range factor_to_base -> value_out_of_range');

-- T29 : a recipe whose computed cost exceeds the safety ceiling is rejected atomically.
-- S41-FLOUR cost_price = 12000 -> 1,000,000 * 12000 = 1.2e10 > 5,000,000.
DO $t29$
DECLARE v_rep JSONB;
        v_rejected BOOLEAN := FALSE;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  BEGIN
    v_rep := import_catalog_v2(jsonb_build_object(
      'recipes', jsonb_build_array(jsonb_build_object(
        'product_sku', 'S41-CROIS', 'material_sku', 'S41-FLOUR', 'quantity', 1000000::numeric, 'unit', 'kg'))
    ), false, 'aaaaaaaa-0000-0000-0000-000000000029'::uuid);
  EXCEPTION WHEN SQLSTATE '22003' THEN
    v_rejected := SQLERRM = 'recipe_cost_out_of_range';
  END;
  PERFORM set_config('breakery.t29', v_rejected::text, true);
END $t29$;
SELECT is(current_setting('breakery.t29'), 'true', 'T29 out-of-range computed recipe cost rejects the entire import');

-- =================== S61 F-5 -- station allowlist aligned on live CHECK -- T30/T31 ===================
-- categories_dispatch_station_check enforces {kitchen,barista,display,none} in the live schema.
-- Before the fix the RPC's own allowlist checked {kitchen,barista,bakery,none} instead: 'display'
-- was falsely rejected at validation (T30) and 'bakery' passed validation then crashed with a
-- raw 23514 at commit (T31 uses dry-run to observe the missing rejection without crashing).

-- T30 : dispatch_station='display' -- commit succeeds, category persisted with dispatch_station='display'
DO $t30$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  v_rep := import_catalog_v2(jsonb_build_object(
    'categories', jsonb_build_array(jsonb_build_object(
      'name', 'S61 Display Cat', 'dispatch_station', 'display'))
  ), false, 'aaaaaaaa-0000-0000-0000-000000000030'::uuid);
  PERFORM set_config('breakery.t30_valid', (v_rep->>'valid'), true);
END $t30$;
SELECT is(
  (SELECT dispatch_station FROM categories WHERE name = 'S61 Display Cat'), 'display',
  'T30 display category committed with dispatch_station=display');

-- T31 : dispatch_station='bakery' -- rejected in validation (dry-run), never reaches the CHECK
DO $t31$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  v_rep := import_catalog_v2(jsonb_build_object(
    'categories', jsonb_build_array(jsonb_build_object(
      'name', 'S61 Bakery Cat', 'dispatch_station', 'bakery'))
  ), true);
  PERFORM set_config('breakery.t31',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'invalid_dispatch_station'), true);
END $t31$;
SELECT is(current_setting('breakery.t31'), '1', 'T31 bakery category rejected at validation (invalid_dispatch_station)');

SELECT * FROM finish();
