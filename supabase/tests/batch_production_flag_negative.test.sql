-- batch_production_flag_negative.test.sql
-- Vérifie le gate stock-négatif du batch (Task 6). La logique vit dans
-- record_batch_production_v1 ; record_batch_production_v2 est un wrapper de date
-- qui délègue à v1 — on teste via v2 pour couvrir toute la chaîne.
--   - allow_negative_stock=false + matière insuffisante → insufficient_stock (P0002)
--   - allow_negative_stock=true → la production batch passe, matière en négatif
--
-- Contexte JWT simulé d'EMP000 (perm inventory.production.create). Lancer via MCP
-- execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).

BEGIN;
SELECT plan(3);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

CREATE TEMP TABLE _r(label text, val numeric) ON COMMIT DROP;
DO $$
DECLARE
  v_cat uuid; v_sec uuid;
  v_flour uuid := gen_random_uuid(); v_bread uuid := gen_random_uuid();
  v_blocked boolean := false;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  SELECT id INTO v_sec FROM sections WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, unit, track_inventory, deduct_stock, current_stock) VALUES
    (v_flour, 'BF-'||v_flour, 'Flour', v_cat, 0, 'g',   true, false, 10),
    (v_bread, 'BB-'||v_bread, 'Bread', v_cat, 0, 'pcs', true, true,  0);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_bread, v_flour, 100, 'g', true);

  UPDATE business_config SET allow_negative_stock=false WHERE id=1;
  BEGIN
    PERFORM record_batch_production_v2(
      jsonb_build_object('section_id', v_sec::text, 'notes','t'),
      jsonb_build_array(jsonb_build_object('product_id', v_bread::text, 'quantity_produced', 1)));
    v_blocked := false;
  EXCEPTION WHEN OTHERS THEN v_blocked := (SQLSTATE='P0002');
  END;
  INSERT INTO _r VALUES ('blocked', v_blocked::int);

  UPDATE business_config SET allow_negative_stock=true WHERE id=1;
  PERFORM record_batch_production_v2(
    jsonb_build_object('section_id', v_sec::text, 'notes','t'),
    jsonb_build_array(jsonb_build_object('product_id', v_bread::text, 'quantity_produced', 1)));
  INSERT INTO _r VALUES ('flour', (SELECT current_stock FROM products WHERE id=v_flour));
  INSERT INTO _r VALUES ('bread', (SELECT current_stock FROM products WHERE id=v_bread));
END $$;

SELECT is((SELECT val FROM _r WHERE label='blocked'), 1::numeric,  'allow_negative=false blocks insufficient batch');
SELECT is((SELECT val FROM _r WHERE label='flour'),  -90::numeric, 'allow_negative=true lets batch material go to -90');
SELECT is((SELECT val FROM _r WHERE label='bread'),   1::numeric,  'batch finished good produced (+1)');

SELECT * FROM finish();
ROLLBACK;
