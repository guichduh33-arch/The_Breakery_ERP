-- 20260510000008_seed_5_demo_promotions.sql
-- Session 8 / migration 8 : 5 promos demo couvrant les 4 action_types et 9 condition_types.
-- Spec: §3.13.

INSERT INTO promotions (name, slug, action_type, action_params, conditions, priority) VALUES
  ('Happy Hour Beverages 15% off', 'happy-hour-bev', 'percentage_off',
   jsonb_build_object('percentage', 15, 'target', 'category',
                      'target_id', (SELECT id FROM categories WHERE slug='beverage')),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'category_in_cart',
                        'category_id', (SELECT id FROM categories WHERE slug='beverage'),
                        'min_qty', 1),
     jsonb_build_object('type', 'time_window', 'start', '14:00', 'end', '17:00', 'tz', 'Asia/Jakarta'),
     jsonb_build_object('type', 'weekday_in', 'days', jsonb_build_array(1,2,3,4,5)),
     jsonb_build_object('type', 'valid_dates', 'from', '2026-01-01', 'until', '2027-01-01')
   )), 10),

  ('Spend 50k Get 5k off', 'spend-50k-5k-off', 'fixed_off',
   jsonb_build_object('amount', 5000, 'target', 'cart'),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'cart_total_min', 'value', 50000)
   )), 5),

  ('BOGO Croissant', 'bogo-croissant', 'bogo',
   jsonb_build_object('buy_product_id', (SELECT id FROM products WHERE sku='PAS-CROI'),
                      'buy_qty', 1, 'get_qty', 1, 'get_discount_pct', 100),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'product_in_cart',
                        'product_id', (SELECT id FROM products WHERE sku='PAS-CROI'),
                        'min_qty', 2)
   )), 8),

  ('Free Americano on 100k+', 'free-americano-100k', 'free_product',
   jsonb_build_object('product_id', (SELECT id FROM products WHERE sku='BEV-AMER'), 'qty', 1),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'cart_total_min', 'value', 100000)
   )), 7),

  ('VIP Birthday 20% off cart', 'vip-20-off', 'percentage_off',
   jsonb_build_object('percentage', 20, 'target', 'cart'),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'customer_category_in',
                        'category_ids', jsonb_build_array((SELECT id FROM customer_categories WHERE slug='vip'))),
     jsonb_build_object('type', 'cart_total_min', 'value', 30000)
   )), 6);
