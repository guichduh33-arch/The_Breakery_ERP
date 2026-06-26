-- production_flag_negative.test.sql
-- Vérifie le gate stock-négatif de record_production_v1 (Task 5) :
--   - allow_negative_stock=false + matière insuffisante → insufficient_stock (P0002)
--   - allow_negative_stock=true → la production passe et la matière va en négatif
--
-- record_production_v1 exige auth.uid() + perm inventory.production.create → on
-- simule le contexte d'EMP000 (00000000-…-001) via set_config. Lancer via MCP
-- execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).
--
-- NOTE : le RPC crée des TEMP TABLE ON COMMIT DROP → au plus UNE production
-- réussie par transaction (en prod chaque appel = sa propre transaction). Le cas
-- deduct_stock=false (matière non consommée) est donc vérifié séparément.

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
    (v_flour, 'PF-'||v_flour, 'Flour', v_cat, 0, 'g',   true, false, 10),
    (v_bread, 'PB-'||v_bread, 'Bread', v_cat, 0, 'pcs', true, true,  0);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_bread, v_flour, 100, 'g', true);

  -- 1) allow_negative=false + flour short (10 < 100) → blocked
  UPDATE business_config SET allow_negative_stock=false WHERE id=1;
  BEGIN
    PERFORM record_production_v1(p_product_id:=v_bread, p_quantity_produced:=1, p_section_id:=v_sec);
    v_blocked := false;
  EXCEPTION WHEN OTHERS THEN v_blocked := (SQLSTATE='P0002');
  END;
  INSERT INTO _r VALUES ('blocked', v_blocked::int);

  -- 2) allow_negative=true → flour 10-100 = -90, bread 0+1 = 1
  UPDATE business_config SET allow_negative_stock=true WHERE id=1;
  PERFORM record_production_v1(p_product_id:=v_bread, p_quantity_produced:=1, p_section_id:=v_sec);
  INSERT INTO _r VALUES ('flour', (SELECT current_stock FROM products WHERE id=v_flour));
  INSERT INTO _r VALUES ('bread', (SELECT current_stock FROM products WHERE id=v_bread));
END $$;

SELECT is((SELECT val FROM _r WHERE label='blocked'), 1::numeric, 'allow_negative=false blocks insufficient production');
SELECT is((SELECT val FROM _r WHERE label='flour'),  -90::numeric, 'allow_negative=true lets material go to -90');
SELECT is((SELECT val FROM _r WHERE label='bread'),   1::numeric,  'finished good produced (+1)');

SELECT * FROM finish();
ROLLBACK;
