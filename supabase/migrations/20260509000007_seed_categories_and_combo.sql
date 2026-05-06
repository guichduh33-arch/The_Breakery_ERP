-- 20260509000007_seed_categories_and_combo.sql
-- Session 7 / migration 7 : 5 customer_categories + UPDATE existing Loyal Gold → VIP
-- The "Breakfast Set" demo combo lives in supabase/seed.sql because it references
-- the demo categories + products (Americano BEV-AMER, Croissant PAS-CROI) that are
-- seeded in seed.sql, which runs AFTER migrations.

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
