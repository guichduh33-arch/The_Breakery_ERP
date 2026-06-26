-- recipe_consumption_cascade.test.sql
-- Vérifie _resolve_recipe_consumption_v1 (Task 3) : cascade de vente d'un produit
-- fait-à-la-commande avec la règle "arrêt aux nœuds suivis".
-- Lancer via MCP execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).

BEGIN;
SELECT plan(4);

-- Fixture : cappuccino (non suivi) → espresso (non suivi) → grains (suivi) ;
--           cappuccino → lait (suivi). Catégorie : première dispo.
CREATE TEMP TABLE _ids(label text, id uuid) ON COMMIT DROP;
DO $$
DECLARE
  v_cat uuid; v_milk uuid := gen_random_uuid(); v_beans uuid := gen_random_uuid();
  v_esp uuid := gen_random_uuid(); v_cap uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, unit, track_inventory, deduct_stock, current_stock) VALUES
    (v_milk,  'T-MILK-'||v_milk,  'Test Milk',  v_cat, 0, 'ml',   true,  false, 1000),
    (v_beans, 'T-BEANS-'||v_beans,'Test Beans', v_cat, 0, 'g',    true,  false, 1000),
    (v_esp,   'T-ESP-'||v_esp,    'Test Espresso', v_cat, 0, 'shot', false, true, 0),
    (v_cap,   'T-CAP-'||v_cap,    'Test Cappuccino', v_cat, 30000, 'cup', false, true, 0);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_esp, v_beans, 18,  'g',    true),
    (v_cap, v_esp,   1,   'shot', true),
    (v_cap, v_milk,  150, 'ml',   true);
  INSERT INTO _ids VALUES ('milk',v_milk),('beans',v_beans),('esp',v_esp),('cap',v_cap);
END $$;

-- 1. Cappuccino cascade : descend dans espresso (non suivi), s'arrête sur
--    grains + lait (suivis) → exactement 2 lignes.
SELECT is(
  (SELECT count(*)::int FROM _resolve_recipe_consumption_v1((SELECT id FROM _ids WHERE label='cap'), 1)),
  2, 'cappuccino cascade yields exactly the two tracked leaves (beans + milk)');

-- 2. La quantité de grains est convertie/positive (18 g pour 1 cappuccino).
SELECT is(
  (SELECT qty_base FROM _resolve_recipe_consumption_v1((SELECT id FROM _ids WHERE label='cap'), 1)
     WHERE product_id = (SELECT id FROM _ids WHERE label='beans')),
  18::numeric, 'beans consumption is 18 g per cappuccino');

-- 3. Quand l'espresso devient suivi, la cascade s'arrête sur lui (présent).
UPDATE products SET track_inventory = true WHERE id = (SELECT id FROM _ids WHERE label='esp');
SELECT ok(
  EXISTS(SELECT 1 FROM _resolve_recipe_consumption_v1((SELECT id FROM _ids WHERE label='cap'),1)
           WHERE product_id = (SELECT id FROM _ids WHERE label='esp')),
  'stops at espresso once it becomes tracked (espresso emitted)');

-- 4. ... et ne descend plus jusqu'aux grains.
SELECT ok(
  NOT EXISTS(SELECT 1 FROM _resolve_recipe_consumption_v1((SELECT id FROM _ids WHERE label='cap'),1)
           WHERE product_id = (SELECT id FROM _ids WHERE label='beans')),
  'no longer descends to beans once espresso is tracked');

SELECT * FROM finish();
ROLLBACK;
