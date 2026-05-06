-- 20260509000007_seed_categories_and_combo.sql
-- Session 7 / migration 7 : 5 customer_categories + "Breakfast Set" demo combo
-- Real SKUs from session 1 seed: BEV-AMER (Americano) + PAS-CROI (Croissant)

INSERT INTO customer_categories
  (name, slug, color, icon, price_modifier_type, discount_percentage, points_multiplier, is_default)
VALUES
  ('Retail',    'retail',    '#64748B', '🛒', 'retail',              0,    1.0, true),
  ('VIP',       'vip',       '#F59E0B', '⭐', 'discount_percentage', 5,    1.2, false),
  ('Staff',     'staff',     '#10B981', '👥', 'discount_percentage', 15,   1.0, false),
  ('Wholesale', 'wholesale', '#3B82F6', '📦', 'wholesale',           0,    1.0, false),
  ('Custom',    'custom',    '#8B5CF6', '🎯', 'custom',              0,    1.0, false)
ON CONFLICT (slug) DO NOTHING;

UPDATE customers
  SET category_id = (SELECT id FROM customer_categories WHERE slug = 'vip')
  WHERE name = 'Loyal Gold Customer' AND category_id IS NULL;

INSERT INTO products (sku, name, category_id, retail_price, product_type, current_stock)
VALUES (
  'COMBO-001',
  'Breakfast Set',
  '11111111-1111-1111-1111-111111111111',
  75000,
  'combo',
  0
) ON CONFLICT (sku) DO NOTHING;

INSERT INTO combo_items (parent_product_id, component_product_id, quantity, sort_order)
SELECT combo.id, comp.id, 1, comp.sort_order
FROM products combo,
     (VALUES ('BEV-AMER', 1), ('PAS-CROI', 2)) AS comp_skus(sku, sort_order)
JOIN products comp ON comp.sku = comp_skus.sku
WHERE combo.sku = 'COMBO-001'
ON CONFLICT (parent_product_id, component_product_id) DO NOTHING;
