-- 20260630000018_add_gr_ml_lt_unit_conversion_aliases.sql
-- Root cause of the recipe-costing ×1000 bug: recipe lines use the unit spelling
-- 'gr' (and 'ml'/'lt') but unit_conversions only knew 'g' / 'mL' / 'L'. So
-- convert_quantity('gr','kg') raised unit_conversion_missing → callers
-- (_calculate_recipe_cost_walk via its EXCEPTION fallback) silently used the raw
-- quantity, giving costs 1000× too high. These rows register the missing metric
-- aliases (gr == gram, ml == milliliter, lt == liter) so conversion works.
--
-- Pure data (additive INSERT, ON CONFLICT DO NOTHING). No trigger on this table,
-- so nothing is re-snapshotted by this migration — stored products.cost_price is
-- untouched; the live cost walk merely re-aligns onto the (correct) stored values.
-- Genuinely unconvertible pairs (mass/volume → 'cup') are intentionally NOT added:
-- they need a per-material density and remain a separate data-modelling gap.

INSERT INTO public.unit_conversions (from_unit, to_unit, factor, notes) VALUES
  -- 'gr' is an alias of gram ('g')
  ('gr', 'g',  1,        'gr alias of gram'),
  ('g',  'gr', 1,        'gr alias of gram'),
  ('gr', 'kg', 0.001,    'gr alias of gram'),
  ('kg', 'gr', 1000,     'gr alias of gram'),
  ('gr', 'mg', 1000,     'gr alias of gram'),
  ('mg', 'gr', 0.001,    'gr alias of gram'),
  -- 'ml' / 'lt' are lowercase/spelled aliases of mL / L
  ('ml', 'mL', 1,        'ml alias of millilitre'),
  ('mL', 'ml', 1,        'ml alias of millilitre'),
  ('ml', 'L',  0.001,    'ml alias of millilitre'),
  ('L',  'ml', 1000,     'ml alias of millilitre'),
  ('lt', 'L',  1,        'lt alias of litre'),
  ('L',  'lt', 1,        'lt alias of litre'),
  ('lt', 'mL', 1000,     'lt alias of litre'),
  ('mL', 'lt', 0.001,    'lt alias of litre'),
  ('ml', 'lt', 0.001,    'ml/lt metric volume'),
  ('lt', 'ml', 1000,     'ml/lt metric volume')
ON CONFLICT (from_unit, to_unit) DO NOTHING;
