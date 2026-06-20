BEGIN;
SELECT plan(6);

-- Fixtures: a raw material "Oat Milk" base unit 'L', alt 'ml' factor 0.001.
INSERT INTO categories (id, name, slug, category_type, is_active)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'RM P2', 'rm-p2', 'raw_material', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'RAW-OAT-P2', 'Oat Milk P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'ml', 0.001, 1)
ON CONFLICT DO NOTHING;

-- A drink product carrying a Milk modifier with Oat option deducting 30 ml.
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'FIN-LATTE-P2', 'Latte P2', 'pcs', 30000, 0, 0, '00000000-0000-0000-0000-0000000000c1', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a1","qty":30,"unit":"ml"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- T1: resolves one ingredient line
SELECT is(
  jsonb_array_length(_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)),
  1, 'T1: one ingredient line resolved');

-- T2: ml -> L conversion, line qty 1  => 30 * 0.001 * 1 = 0.03
SELECT is(
  (_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)->0->>'qty_base')::numeric,
  0.03, 'T2: ml->L converted qty_base = 0.03');

-- T3: scaled by line qty 3 => 0.09
SELECT is(
  (_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 3)->0->>'qty_base')::numeric,
  0.09, 'T3: scaled by line qty');

-- T4: output unit is the ingredient base unit
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)->0->>'unit',
  'L', 'T4: output unit = ingredient base unit');

-- T5: unknown/edited-away option resolves to empty array
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Almond","price_adjustment":0}]'::jsonb, 1),
  '[]'::jsonb, 'T5: unresolved option => empty');

-- T6: empty modifiers => empty array
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1', '[]'::jsonb, 1),
  '[]'::jsonb, 'T6: no modifiers => empty');

SELECT * FROM finish();
ROLLBACK;
