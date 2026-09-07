-- supabase/tests/combo_component_flag_aware.test.sql
--
-- Audit lot 2, P0-5. Le trou que AUCUNE fixture combo ne pouvait voir : toutes
-- (`combo_sale`, `combo_server_pricing`, `combo_fire_pay`, `tablet_combo_fire_pay`,
-- `counter_combo_server_price`) posent leurs composants en `track_inventory = true`.
--
-- Or 14 composants RÉELS de la base sont `track_inventory = false,
-- deduct_stock = true` — tous les cafés (Latte, Americano, Capuccino, Affogato…).
-- Avant le correctif, la branche combo de `complete_order_with_payment` et de
-- `pay_existing_order` envoyait chaque composant dans `_record_sale_stock_v1`
-- SANS lire ces drapeaux. Deux effets :
--   * la recette n'était jamais résolue (ni grains, ni lait ne sortaient) ;
--   * `current_stock` du café était décrémenté malgré `track_inventory = false`,
--     donc il partait en négatif.
-- Le même café vendu HORS combo consommait correctement sa recette : ce test
-- épingle la PARITÉ entre les deux chemins.
--
-- Ce fichier est le miroir combo de `sale_flag_aware_deduction.test.sql`.
-- Lancer via MCP execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).

BEGIN;
SELECT plan(5);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

CREATE TEMP TABLE _r(label text, val numeric) ON COMMIT DROP;

DO $$
DECLARE
  v_cat    uuid;
  v_admin  uuid := '00000000-0000-0000-0000-000000000001';
  v_beans  uuid := gen_random_uuid();
  v_coffee uuid := gen_random_uuid();  -- composant A RECETTE : track=false, deduct=true
  v_cake   uuid := gen_random_uuid();  -- composant SUIVI : track=true (temoin de non-regression)
  v_combo  uuid := gen_random_uuid();
  v_grp_a  uuid := gen_random_uuid();
  v_grp_b  uuid := gen_random_uuid();
  v_sess   uuid;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  SELECT id INTO v_sess FROM pos_sessions WHERE opened_by=v_admin AND status='open' LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status)
      VALUES (v_admin, 0, 'open') RETURNING id INTO v_sess;
  END IF;
  UPDATE business_config SET allow_negative_stock=false WHERE id=1;

  -- `product_type` laisse au defaut : le CHECK products_product_type_check ne
  -- connait pas 'raw_material' — la matiere se designe par ses drapeaux
  -- (track_inventory=true, deduct_stock=false), pas par un type.
  INSERT INTO products (id, sku, name, category_id, retail_price, unit,
                        track_inventory, deduct_stock, current_stock) VALUES
    (v_beans,  'CFA-B-'||v_beans,  'Beans CFA',  v_cat,     0, 'g',   true,  false, 1000),
    (v_coffee, 'CFA-C-'||v_coffee, 'Coffee CFA', v_cat, 20000, 'cup', false, true,     0),
    (v_cake,   'CFA-K-'||v_cake,   'Cake CFA',   v_cat, 15000, 'pcs', true,  true,    10);
  INSERT INTO products (id, sku, name, category_id, retail_price, unit,
                        track_inventory, deduct_stock, current_stock, product_type, combo_base_price)
    VALUES (v_combo, 'CFA-X-'||v_combo, 'Combo CFA', v_cat, 0, 'pcs', false, false, 0, 'combo', 50000);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_coffee, v_beans, 18, 'g', true);

  INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order) VALUES
    (v_grp_a, v_combo, 'Drink',  'single', true, 1, 1, 0),
    (v_grp_b, v_combo, 'Pastry', 'single', true, 1, 1, 1);
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order) VALUES
    (v_grp_a, v_coffee, 0, true, 0),
    (v_grp_b, v_cake,   0, true, 0);

  PERFORM complete_order_with_payment_v28(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_combo,
      'quantity',   1,
      'unit_price', 50000,
      'modifiers',  jsonb_build_array(
        jsonb_build_object('group_name','Drink',  'option_label','Coffee CFA', 'price_adjustment',0),
        jsonb_build_object('group_name','Pastry', 'option_label','Cake CFA',   'price_adjustment',0)),
      'combo_components', jsonb_build_array(
        jsonb_build_object('product_id', v_coffee, 'quantity', 1),
        jsonb_build_object('product_id', v_cake,   'quantity', 1)))),
    p_payment := '{"method":"cash","amount":50000,"cash_received":50000,"change_given":0}'::jsonb);

  INSERT INTO _r VALUES ('beans',  (SELECT current_stock FROM products WHERE id=v_beans));
  INSERT INTO _r VALUES ('coffee', (SELECT current_stock FROM products WHERE id=v_coffee));
  INSERT INTO _r VALUES ('cake',   (SELECT current_stock FROM products WHERE id=v_cake));
  INSERT INTO _r VALUES ('combo',  (SELECT current_stock FROM products WHERE id=v_combo));
  INSERT INTO _r VALUES ('mvt_coffee',
    (SELECT count(*) FROM stock_movements WHERE product_id=v_coffee));
END $$;

SELECT is((SELECT val FROM _r WHERE label='beans'), 982::numeric,
  'P0-5 : le composant a recette consomme ses grains (1000-18) — avant, rien ne sortait');

SELECT is((SELECT val FROM _r WHERE label='coffee'), 0::numeric,
  'P0-5 : le composant non suivi n''est PAS decremente — avant, il tombait a -1');

SELECT is((SELECT val FROM _r WHERE label='mvt_coffee'), 0::numeric,
  'P0-5 : aucun stock_movements pose sur un produit track_inventory=false');

SELECT is((SELECT val FROM _r WHERE label='cake'), 9::numeric,
  'non-regression : un composant SUIVI vend toujours son propre stock (10-1)');

SELECT is((SELECT val FROM _r WHERE label='combo'), 0::numeric,
  'non-regression : le produit combo lui-meme ne bouge pas');

SELECT * FROM finish();
ROLLBACK;
