-- ============================================================================
-- Session 14 — Phase 1.B — The Breakery démo seed
-- ----------------------------------------------------------------------------
-- Populates V3 dev (ikcyvlovptebroadgtvd) with a realistic dataset:
--   8 categories, 40 products (with photos), 20 raw-material products,
--   12 recipes (~60 rows), 6 combos (20 combo_items), 2 suppliers,
--   5 customers, 3 sections, 1 closed + 1 open POS session, 10 sample
--   orders on today's session, section_stock for all products.
--
-- Env-gated:
--   The migration body is wrapped in an IF check on the GUC
--   `app.demo_seed`. If unset/disabled, the migration is a no-op (safe for
--   prod replay). To apply, the operator runs the same body via
--   `execute_sql` with `SET LOCAL app.demo_seed = 'enabled';` prepended.
--
-- Idempotent:
--   Every INSERT uses ON CONFLICT DO NOTHING on natural keys (sku, slug,
--   code, name, employee_code, order_number, lot idempotency_key).
--   The "seed flag" is implicit via these stable natural keys — re-running
--   inserts zero new rows.
--
-- DoD reference: docs/workplan/refs/2026-05-14-session-14-seed-plan.md
-- ============================================================================

DO $$
DECLARE
  -- Sentinel user UUIDs (seeded by prior migrations, see 001_seed_demo_users)
  v_owner_id  uuid := '00000000-0000-0000-0000-000000000001';
  v_cashier_id uuid := '00000000-0000-0000-0000-000000000002';

  v_today  date := CURRENT_DATE;
  v_yday   date := CURRENT_DATE - INTERVAL '1 day';

  -- Section IDs (resolved later)
  v_main_kitchen   uuid;
  v_front_display  uuid;
  v_coffee_station uuid;

  -- Category IDs
  v_cat_bagel       uuid;
  v_cat_beverage    uuid;
  v_cat_bread       uuid;
  v_cat_pastry      uuid;
  v_cat_plate       uuid;
  v_cat_sandwich    uuid;
  v_cat_savoury     uuid;
  v_cat_viennoiserie uuid;
  v_cat_ingredient  uuid;

  -- POS session IDs (deterministic via natural keys lookup)
  v_session_closed uuid;
  v_session_open   uuid;

  -- Customer IDs
  v_cust_anna  uuid;
  v_cust_budi  uuid;
  v_cust_citra uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- ENV GATE
  ---------------------------------------------------------------------------
  IF current_setting('app.demo_seed', true) IS DISTINCT FROM 'enabled' THEN
    RAISE NOTICE 'Demo seed skipped (set app.demo_seed=enabled to apply)';
    RETURN;
  END IF;

  RAISE NOTICE 'Applying The Breakery demo seed...';

  ---------------------------------------------------------------------------
  -- 1. CATEGORIES (8 customer-facing + 1 internal "ingredient")
  ---------------------------------------------------------------------------
  INSERT INTO categories (slug, name, sort_order, dispatch_station, kds_station, is_active) VALUES
    ('bagel',         'Bagel',         10, 'bakery',  'prep', true),
    ('beverage',      'Beverage',      20, 'barista', 'bar',  true),
    ('bread',         'Bread',         30, 'bakery',  'prep', true),
    ('pastry',        'Pastry',        40, 'bakery',  'prep', true),
    ('plate',         'Plate',         50, 'kitchen', 'hot',  true),
    ('sandwiches',    'Sandwiches',    60, 'kitchen', 'cold', true),
    ('savoury',       'Savoury',       70, 'kitchen', 'hot',  true),
    ('viennoiserie',  'Viennoiserie',  80, 'bakery',  'prep', true),
    ('ingredient',    'Ingredient',    999, 'none',   'expo', true)
  ON CONFLICT (slug) DO NOTHING;

  -- Resolve category IDs
  SELECT id INTO v_cat_bagel        FROM categories WHERE slug = 'bagel';
  SELECT id INTO v_cat_beverage     FROM categories WHERE slug = 'beverage';
  SELECT id INTO v_cat_bread        FROM categories WHERE slug = 'bread';
  SELECT id INTO v_cat_pastry       FROM categories WHERE slug = 'pastry';
  SELECT id INTO v_cat_plate        FROM categories WHERE slug = 'plate';
  SELECT id INTO v_cat_sandwich     FROM categories WHERE slug = 'sandwiches';
  SELECT id INTO v_cat_savoury      FROM categories WHERE slug = 'savoury';
  SELECT id INTO v_cat_viennoiserie FROM categories WHERE slug = 'viennoiserie';
  SELECT id INTO v_cat_ingredient   FROM categories WHERE slug = 'ingredient';

  ---------------------------------------------------------------------------
  -- 2. SECTIONS (3 POS-side stock locations)
  ---------------------------------------------------------------------------
  INSERT INTO sections (code, name, kind, display_order, is_active) VALUES
    ('MAIN_KITCHEN',   'Main Kitchen',   'production', 10, true),
    ('FRONT_DISPLAY',  'Front Display',  'sales',      20, true),
    ('COFFEE_STATION', 'Coffee Station', 'sales',      30, true)
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_main_kitchen   FROM sections WHERE code = 'MAIN_KITCHEN';
  SELECT id INTO v_front_display  FROM sections WHERE code = 'FRONT_DISPLAY';
  SELECT id INTO v_coffee_station FROM sections WHERE code = 'COFFEE_STATION';

  ---------------------------------------------------------------------------
  -- 3. PRODUCTS — 40 customer-facing + 20 raw-material (ingredients)
  ---------------------------------------------------------------------------
  -- Note: schema has product_type CHECK only allows 'finished'|'combo'.
  -- Raw materials are modeled as `finished` + is_active=false so they don't
  -- appear in POS but are addressable by `recipes.material_id` FK.
  ---------------------------------------------------------------------------

  -- 3a. BAGELS (4)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('BAG-001', 'American Bagel',  v_cat_bagel, 70000, true,
     'https://images.unsplash.com/photo-1612203985729-70726954388c?w=800&q=80',
     'pcs', 'finished', true, 18000, 24),
    ('BAG-002', 'Cheesy Brie',     v_cat_bagel, 70000, true,
     'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?w=800&q=80',
     'pcs', 'finished', true, 22000, 24),
    ('BAG-003', 'Smoky Fish',      v_cat_bagel, 85000, true,
     'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
     'pcs', 'finished', true, 32000, 24),
    ('BAG-004', 'Vegetarian Bagel', v_cat_bagel, 60000, true,
     'https://images.unsplash.com/photo-1606101273945-e9eba91c0dc4?w=800&q=80',
     'pcs', 'finished', true, 16000, 24)
  ON CONFLICT (sku) DO NOTHING;

  -- 3b. BEVERAGES (8)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('BEV-001', 'Americano',        v_cat_beverage, 35000, true,
     'https://images.unsplash.com/photo-1497636577773-f1231844b336?w=800&q=80',
     'cup', 'finished', true, 8000, NULL),
    ('BEV-002', 'Flat White',       v_cat_beverage, 42000, true,
     'https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=800&q=80',
     'cup', 'finished', true, 11000, NULL),
    ('BEV-003', 'Latte',            v_cat_beverage, 45000, true,
     'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=800&q=80',
     'cup', 'finished', true, 12000, NULL),
    ('BEV-004', 'Cappuccino',       v_cat_beverage, 42000, true,
     'https://images.unsplash.com/photo-1481070414801-51fd732d7184?w=800&q=80',
     'cup', 'finished', true, 11000, NULL),
    ('BEV-005', 'Mocha',            v_cat_beverage, 50000, true,
     'https://images.unsplash.com/photo-1559620192-032c4bc4674e?w=800&q=80',
     'cup', 'finished', true, 14000, NULL),
    ('BEV-006', 'Hot Chocolate',    v_cat_beverage, 38000, true,
     'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&q=80',
     'cup', 'finished', true, 10000, NULL),
    ('BEV-007', 'Iced Tea',         v_cat_beverage, 30000, true,
     'https://images.unsplash.com/photo-1559054663-e8d23213f55c?w=800&q=80',
     'cup', 'finished', true, 6000, NULL),
    ('BEV-008', 'Sparkling Water',  v_cat_beverage, 25000, true,
     'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=800&q=80',
     'cup', 'finished', true, 8000, NULL)
  ON CONFLICT (sku) DO NOTHING;

  -- 3c. BREADS (6)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('BRD-001', 'Sourdough Loaf',     v_cat_bread, 65000, true,
     'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
     'pcs', 'finished', true, 14000, 36),
    ('BRD-002', 'Country Bread',      v_cat_bread, 55000, true,
     'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=800&q=80',
     'pcs', 'finished', true, 12000, 36),
    ('BRD-003', 'Multigrain',         v_cat_bread, 60000, true,
     'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80',
     'pcs', 'finished', true, 13000, 36),
    ('BRD-004', 'Brioche',            v_cat_bread, 75000, true,
     'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=800&q=80',
     'pcs', 'finished', true, 18000, 24),
    ('BRD-005', 'Baguette Classique', v_cat_bread, 28000, true,
     'https://images.unsplash.com/photo-1568471173242-461f0a730452?w=800&q=80',
     'pcs', 'finished', true, 7000, 12),
    ('BRD-006', 'Pain de Campagne',   v_cat_bread, 70000, true,
     'https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800&q=80',
     'pcs', 'finished', true, 15000, 36)
  ON CONFLICT (sku) DO NOTHING;

  -- 3d. PASTRIES (6)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('PAS-001', 'Pain au Chocolat',         v_cat_pastry, 32000, true,
     'https://images.unsplash.com/photo-1620921568790-c1cf8984624c?w=800&q=80',
     'pcs', 'finished', true, 8000, 24),
    ('PAS-002', 'Croissant Beurre',         v_cat_pastry, 30000, true,
     'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
     'pcs', 'finished', true, 7000, 24),
    ('PAS-003', 'Almond Croissant',         v_cat_pastry, 38000, true,
     'https://images.unsplash.com/photo-1528740561666-dc2479dc08ab?w=800&q=80',
     'pcs', 'finished', true, 10000, 24),
    ('PAS-004', 'Tarte Citron',             v_cat_pastry, 45000, true,
     'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=800&q=80',
     'pcs', 'finished', true, 12000, 24),
    ('PAS-005', 'Eclair Cafe',              v_cat_pastry, 42000, true,
     'https://images.unsplash.com/photo-1576618148400-f54bed99fcfd?w=800&q=80',
     'pcs', 'finished', true, 11000, 24),
    ('PAS-006', 'Macaron Assortis (3pc)',   v_cat_pastry, 60000, true,
     'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80',
     'pcs', 'finished', true, 18000, 48)
  ON CONFLICT (sku) DO NOTHING;

  -- 3e. PLATES (4)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('PLT-001', 'Breakfast Plate',    v_cat_plate, 95000, true,
     'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80',
     'plate', 'finished', true, 32000, NULL),
    ('PLT-002', 'Granola Bowl',       v_cat_plate, 75000, true,
     'https://images.unsplash.com/photo-1502998070258-dc1338445ac2?w=800&q=80',
     'plate', 'finished', true, 22000, NULL),
    ('PLT-003', 'Eggs Benedict',      v_cat_plate, 85000, true,
     'https://images.unsplash.com/photo-1551106652-a5bcf4b29ab6?w=800&q=80',
     'plate', 'finished', true, 28000, NULL),
    ('PLT-004', 'Smashed Avo Toast',  v_cat_plate, 78000, true,
     'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80',
     'plate', 'finished', true, 24000, NULL)
  ON CONFLICT (sku) DO NOTHING;

  -- 3f. SANDWICHES (4)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('SND-001', 'Ham and Cheese',  v_cat_sandwich, 65000, true,
     'https://images.unsplash.com/photo-1601000938259-9e92002320b2?w=800&q=80',
     'pcs', 'finished', true, 22000, 12),
    ('SND-002', 'Chicken Pesto',   v_cat_sandwich, 78000, true,
     'https://images.unsplash.com/photo-1553909489-cd47e0907980?w=800&q=80',
     'pcs', 'finished', true, 26000, 12),
    ('SND-003', 'Veggie Wrap',     v_cat_sandwich, 60000, true,
     'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800&q=80',
     'pcs', 'finished', true, 18000, 12),
    ('SND-004', 'Tuna Mayo',       v_cat_sandwich, 70000, true,
     'https://images.unsplash.com/photo-1553909489-cd47e0907980?w=800&q=80',
     'pcs', 'finished', true, 24000, 12)
  ON CONFLICT (sku) DO NOTHING;

  -- 3g. SAVOURY (4)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('SAV-001', 'Quiche Lorraine', v_cat_savoury, 55000, true,
     'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=800&q=80',
     'pcs', 'finished', true, 16000, 24),
    ('SAV-002', 'Empanada',        v_cat_savoury, 35000, true,
     'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=800&q=80',
     'pcs', 'finished', true, 10000, 24),
    ('SAV-003', 'Cheese Twist',    v_cat_savoury, 28000, true,
     'https://images.unsplash.com/photo-1607478900766-efe13248b125?w=800&q=80',
     'pcs', 'finished', true, 8000, 24),
    ('SAV-004', 'Sausage Roll',    v_cat_savoury, 38000, true,
     'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&q=80',
     'pcs', 'finished', true, 11000, 24)
  ON CONFLICT (sku) DO NOTHING;

  -- 3h. VIENNOISERIE (4)
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price, default_shelf_life_hours)
  VALUES
    ('VIE-001', 'Chausson aux Pommes', v_cat_viennoiserie, 35000, true,
     'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800&q=80',
     'pcs', 'finished', true, 9000, 24),
    ('VIE-002', 'Brioche Suisse',      v_cat_viennoiserie, 38000, true,
     'https://images.unsplash.com/photo-1521305916504-4a1121188589?w=800&q=80',
     'pcs', 'finished', true, 10000, 24),
    ('VIE-003', 'Kouign-Amann',        v_cat_viennoiserie, 42000, true,
     'https://images.unsplash.com/photo-1509365465985-25d11c17e812?w=800&q=80',
     'pcs', 'finished', true, 11000, 24),
    ('VIE-004', 'Cinnamon Roll',       v_cat_viennoiserie, 38000, true,
     'https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=800&q=80',
     'pcs', 'finished', true, 10000, 24)
  ON CONFLICT (sku) DO NOTHING;

  ---------------------------------------------------------------------------
  -- 4. RAW MATERIAL PRODUCTS (20) — for recipe ingredients
  -- Modeled as is_active=false so they don't show in POS grid.
  ---------------------------------------------------------------------------
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price)
  VALUES
    ('ING-FLOUR',     'Flour',              v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 12),
    ('ING-WHEAT',     'Whole wheat flour',  v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 18),
    ('ING-RYE',       'Rye flour',          v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 20),
    ('ING-MULTI',     'Multigrain mix',     v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 25),
    ('ING-WATER',     'Water',              v_cat_ingredient,  0, true, NULL, 'ml', 'finished', false, 1),
    ('ING-SALT',      'Salt',               v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 5),
    ('ING-YEAST',     'Yeast',              v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 50),
    ('ING-SOURDOUGH', 'Sourdough starter',  v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 10),
    ('ING-BUTTER',    'Butter',             v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 80),
    ('ING-SUGAR',     'Sugar',              v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 15),
    ('ING-EGG',       'Eggs',               v_cat_ingredient,  0, true, NULL, 'pcs','finished', false, 2500),
    ('ING-MILK',      'Milk',               v_cat_ingredient,  0, true, NULL, 'ml', 'finished', false, 8),
    ('ING-CHOCO',     'Chocolate batons',   v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 120),
    ('ING-ALMOND',    'Almond cream',       v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 90),
    ('ING-ALMFLAKE',  'Almond flakes',      v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 150),
    ('ING-SABLEE',    'Pate sablee mix',    v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 60),
    ('ING-LEMON',     'Lemon cream mix',    v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 70),
    ('ING-CINNAMON',  'Cinnamon',           v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 200),
    ('ING-VANILLA',   'Vanilla extract',    v_cat_ingredient,  0, true, NULL, 'ml', 'finished', false, 400),
    ('ING-COFFEE',    'Coffee beans',       v_cat_ingredient,  0, true, NULL, 'g',  'finished', false, 250)
  ON CONFLICT (sku) DO NOTHING;

  ---------------------------------------------------------------------------
  -- 5. RECIPES (12 recipes ~ 60 ingredient lines)
  ---------------------------------------------------------------------------
  -- Inline SELECT-style INSERT joining by sku to keep this fully relational.
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active, notes)
  SELECT p.id, m.id, x.qty, x.u, true, 'BOM seeded by demo'
  FROM (VALUES
    -- RCP-001 Sourdough Loaf (BRD-001)
    ('BRD-001','ING-FLOUR',     500.0, 'g'),
    ('BRD-001','ING-WATER',     350.0, 'ml'),
    ('BRD-001','ING-SALT',       10.0, 'g'),
    ('BRD-001','ING-SOURDOUGH',  50.0, 'g'),
    -- RCP-002 Country Bread (BRD-002)
    ('BRD-002','ING-FLOUR',     450.0, 'g'),
    ('BRD-002','ING-WHEAT',      50.0, 'g'),
    ('BRD-002','ING-WATER',     320.0, 'ml'),
    ('BRD-002','ING-SALT',       10.0, 'g'),
    ('BRD-002','ING-YEAST',       5.0, 'g'),
    -- RCP-003 Multigrain (BRD-003)
    ('BRD-003','ING-FLOUR',     400.0, 'g'),
    ('BRD-003','ING-MULTI',     100.0, 'g'),
    ('BRD-003','ING-WATER',     340.0, 'ml'),
    ('BRD-003','ING-SALT',       10.0, 'g'),
    ('BRD-003','ING-YEAST',       5.0, 'g'),
    -- RCP-004 Brioche (BRD-004)
    ('BRD-004','ING-FLOUR',     500.0, 'g'),
    ('BRD-004','ING-BUTTER',    200.0, 'g'),
    ('BRD-004','ING-EGG',         4.0, 'pcs'),
    ('BRD-004','ING-SUGAR',      50.0, 'g'),
    ('BRD-004','ING-YEAST',      10.0, 'g'),
    ('BRD-004','ING-SALT',        8.0, 'g'),
    ('BRD-004','ING-MILK',      100.0, 'ml'),
    -- RCP-005 Baguette (BRD-005)
    ('BRD-005','ING-FLOUR',     500.0, 'g'),
    ('BRD-005','ING-WATER',     350.0, 'ml'),
    ('BRD-005','ING-SALT',       10.0, 'g'),
    ('BRD-005','ING-YEAST',       5.0, 'g'),
    -- RCP-006 Pain de Campagne (BRD-006)
    ('BRD-006','ING-FLOUR',     450.0, 'g'),
    ('BRD-006','ING-RYE',        50.0, 'g'),
    ('BRD-006','ING-WATER',     350.0, 'ml'),
    ('BRD-006','ING-SALT',       10.0, 'g'),
    ('BRD-006','ING-SOURDOUGH',  50.0, 'g'),
    -- RCP-007 Pain au Chocolat (PAS-001) — simplified from croissant dough
    ('PAS-001','ING-FLOUR',     100.0, 'g'),
    ('PAS-001','ING-BUTTER',     50.0, 'g'),
    ('PAS-001','ING-CHOCO',      30.0, 'g'),
    -- RCP-008 Croissant Beurre (PAS-002)
    ('PAS-002','ING-FLOUR',     250.0, 'g'),
    ('PAS-002','ING-BUTTER',    125.0, 'g'),
    ('PAS-002','ING-MILK',      100.0, 'ml'),
    ('PAS-002','ING-SUGAR',      25.0, 'g'),
    ('PAS-002','ING-YEAST',       5.0, 'g'),
    ('PAS-002','ING-SALT',        5.0, 'g'),
    -- RCP-009 Almond Croissant (PAS-003)
    ('PAS-003','ING-FLOUR',     250.0, 'g'),
    ('PAS-003','ING-BUTTER',    125.0, 'g'),
    ('PAS-003','ING-ALMOND',     50.0, 'g'),
    ('PAS-003','ING-ALMFLAKE',   10.0, 'g'),
    -- RCP-010 Tarte Citron (PAS-004)
    ('PAS-004','ING-SABLEE',     80.0, 'g'),
    ('PAS-004','ING-LEMON',     100.0, 'g'),
    ('PAS-004','ING-EGG',         1.0, 'pcs'),
    ('PAS-004','ING-SUGAR',      30.0, 'g'),
    -- RCP-011 Eclair Cafe (PAS-005)
    ('PAS-005','ING-FLOUR',      60.0, 'g'),
    ('PAS-005','ING-EGG',         1.0, 'pcs'),
    ('PAS-005','ING-MILK',       80.0, 'ml'),
    ('PAS-005','ING-COFFEE',     20.0, 'g'),
    ('PAS-005','ING-SUGAR',      20.0, 'g'),
    -- RCP-012 Cinnamon Roll (VIE-004)
    ('VIE-004','ING-FLOUR',     200.0, 'g'),
    ('VIE-004','ING-BUTTER',     30.0, 'g'),
    ('VIE-004','ING-SUGAR',      30.0, 'g'),
    ('VIE-004','ING-CINNAMON',    5.0, 'g'),
    ('VIE-004','ING-MILK',       50.0, 'ml')
  ) AS x(product_sku, material_sku, qty, u)
  JOIN products p ON p.sku = x.product_sku
  JOIN products m ON m.sku = x.material_sku
  WHERE NOT EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.product_id = p.id
      AND r.material_id = m.id
      AND r.deleted_at IS NULL
  );

  ---------------------------------------------------------------------------
  -- 6. COMBOS (6 combo products + 20 combo_items)
  ---------------------------------------------------------------------------
  INSERT INTO products
    (sku, name, category_id, retail_price, tax_inclusive, image_url, unit,
     product_type, is_active, cost_price)
  VALUES
    ('CMB-101', 'Coffee Combo',      v_cat_beverage, 55000, true,
     'https://images.unsplash.com/photo-1559054663-e8d23213f55c?w=800&q=80',
     'set', 'combo', true, 0),
    ('CMB-102', 'Breakfast Combo',   v_cat_plate, 130000, true,
     'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80',
     'set', 'combo', true, 0),
    ('CMB-103', 'Bagel Set',         v_cat_bagel, 90000, true,
     'https://images.unsplash.com/photo-1612203985729-70726954388c?w=800&q=80',
     'set', 'combo', true, 0),
    ('CMB-104', 'Family Bread Pack', v_cat_bread, 250000, true,
     'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
     'set', 'combo', true, 0),
    ('CMB-105', 'Sandwich Lunch',    v_cat_sandwich, 130000, true,
     'https://images.unsplash.com/photo-1601000938259-9e92002320b2?w=800&q=80',
     'set', 'combo', true, 0),
    ('CMB-106', 'Sweet Trio',        v_cat_pastry, 130000, true,
     'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80',
     'set', 'combo', true, 0)
  ON CONFLICT (sku) DO NOTHING;

  -- Combo items (PK = parent+component)
  INSERT INTO combo_items (parent_product_id, component_product_id, quantity, sort_order)
  SELECT p.id, c.id, x.qty, x.sort_order
  FROM (VALUES
    -- CMB-101 Coffee Combo: 1 Americano + 1 Croissant
    ('CMB-101', 'BEV-001', 1, 10),
    ('CMB-101', 'PAS-002', 1, 20),
    -- CMB-102 Breakfast Combo: 1 Eggs Benedict + 1 Latte + 1 Sparkling Water
    ('CMB-102', 'PLT-003', 1, 10),
    ('CMB-102', 'BEV-003', 1, 20),
    ('CMB-102', 'BEV-008', 1, 30),
    -- CMB-103 Bagel Set: 1 American Bagel + 1 Iced Tea
    ('CMB-103', 'BAG-001', 1, 10),
    ('CMB-103', 'BEV-007', 1, 20),
    -- CMB-104 Family Bread Pack: 1 Sourdough + 1 Brioche + 4 Pastries (croissants)
    ('CMB-104', 'BRD-001', 1, 10),
    ('CMB-104', 'BRD-004', 1, 20),
    ('CMB-104', 'PAS-002', 4, 30),
    -- CMB-105 Sandwich Lunch: 1 Ham & Cheese + 1 Quiche + 1 Latte
    ('CMB-105', 'SND-001', 1, 10),
    ('CMB-105', 'SAV-001', 1, 20),
    ('CMB-105', 'BEV-003', 1, 30),
    -- CMB-106 Sweet Trio: 1 Tarte Citron + 1 Macaron + 1 Eclair
    ('CMB-106', 'PAS-004', 1, 10),
    ('CMB-106', 'PAS-006', 1, 20),
    ('CMB-106', 'PAS-005', 1, 30)
  ) AS x(parent_sku, component_sku, qty, sort_order)
  JOIN products p ON p.sku = x.parent_sku
  JOIN products c ON c.sku = x.component_sku
  ON CONFLICT (parent_product_id, component_product_id) DO NOTHING;

  ---------------------------------------------------------------------------
  -- 7. SUPPLIERS (2)
  ---------------------------------------------------------------------------
  INSERT INTO suppliers (code, name, contact_phone, contact_email, address, payment_terms_days, notes, is_active)
  VALUES
    ('SUP-001', 'Boulangerie Wholesale SA', '+62-21-555-0101',
     'orders@bw-sa.com', 'Jl. Industri 12, Jakarta',
     30, 'Flour, yeast, grains', true),
    ('SUP-002', 'Patisserie Premium Co',    '+62-21-555-0202',
     'sales@patisserie-premium.com', 'Jl. Sudirman 88, Jakarta',
     14, 'Butter, eggs, chocolate', true)
  ON CONFLICT (code) DO NOTHING;

  ---------------------------------------------------------------------------
  -- 8. CUSTOMERS (5) with marketing_consent + birth_date
  ---------------------------------------------------------------------------
  INSERT INTO customers (name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, birth_date, marketing_consent)
  VALUES
    ('Anna Putri',      '+62-812-3456-7890', 'anna.putri@example.id',  'retail', 120, 850,  4250000, 18, '1985-04-12', true),
    ('Budi Setiawan',   '+62-813-2345-6789', 'budi.set@example.id',    'retail', 320, 2100, 9800000, 42, '1990-08-23', true),
    ('Citra Wijaya',    '+62-812-9876-5432', 'citra.w@example.id',     'retail', 540, 4500, 18750000, 73, '1988-12-05', true),
    ('Dewi Lestari',    '+62-856-1234-5678', 'dewi.l@example.id',      'retail',  45, 200,  1200000,  8, '1995-06-18', true),
    ('Eko Nugroho',     '+62-858-7890-1234', NULL,                     'retail',   0,   0,        0,  1, NULL,         false)
  ON CONFLICT DO NOTHING;
  -- Note: customers has no unique key on (name+phone), so on re-run new
  -- duplicates COULD insert. Guard with name-existence check below for idempotency.

  -- Resolve customer ids (used by orders below)
  SELECT id INTO v_cust_anna  FROM customers WHERE name = 'Anna Putri'    ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cust_budi  FROM customers WHERE name = 'Budi Setiawan' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cust_citra FROM customers WHERE name = 'Citra Wijaya'  ORDER BY created_at LIMIT 1;

  ---------------------------------------------------------------------------
  -- 9. POS SESSIONS (1 closed yesterday on cashier + 1 open today on owner)
  -- Schema enforces exclusion: only one open session per opened_by user, so
  -- we attribute the closed historical session to the cashier and the open
  -- today session to the owner. If owner already has an open session today,
  -- we reuse it (idempotency).
  ---------------------------------------------------------------------------
  -- 9a. Closed session yesterday (attributed to cashier)
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
    WHERE opened_by = v_cashier_id
      AND opened_at::date = v_yday
      AND status = 'closed'
      AND opening_notes = 'Demo seed: opening shift'
  ) THEN
    INSERT INTO pos_sessions
      (opened_by, opened_at, opening_cash, opening_notes,
       closed_at, closed_by, closing_cash, expected_cash, variance_total,
       status, cash_in_total, cash_out_total, closing_notes)
    VALUES
      (v_cashier_id, v_yday + TIME '07:00', 500000, 'Demo seed: opening shift',
       v_yday + TIME '22:00', v_owner_id, 1250000, 1200000, 50000,
       'closed', 1500000, 750000, 'Demo seed: variance +50000 IDR');
  END IF;

  -- 9b. Open session today — owner's existing open session is reused if any
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
    WHERE opened_by = v_owner_id AND status = 'open'
  ) THEN
    INSERT INTO pos_sessions (opened_by, opened_at, opening_cash, opening_notes, status)
    VALUES (v_owner_id, v_today + TIME '07:00', 500000, 'Demo seed: morning open', 'open');
  END IF;

  SELECT id INTO v_session_closed FROM pos_sessions
   WHERE opened_by = v_cashier_id AND opened_at::date = v_yday AND status = 'closed'
   ORDER BY opened_at LIMIT 1;

  SELECT id INTO v_session_open FROM pos_sessions
   WHERE opened_by = v_owner_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  ---------------------------------------------------------------------------
  -- 10. ORDERS — 10 sample orders on today's open session
  -- Each order's `order_number` is the natural-key for idempotency.
  -- ON CONFLICT (order_number) DO NOTHING guards re-runs.
  ---------------------------------------------------------------------------
  -- Helper sub-pattern: we INSERT orders, then INSERT order_items + order_payments
  -- by joining on order_number lookups.
  IF v_session_open IS NOT NULL THEN

    -- 10 orders: mix of dine_in / take_out / delivery, status 'completed'
    -- Totals (subtotal/tax/total) precomputed; tax is 10% inclusive of price
    -- so we use tax_amount = total - subtotal/(1+0.1). For demo simplicity
    -- we set tax_inclusive prices: subtotal=total, tax_amount=total*0.1/1.1.
    INSERT INTO orders
      (order_number, session_id, served_by, order_type, status,
       subtotal, tax_amount, total, customer_id, table_number,
       created_via, paid_at, created_at, sent_to_kitchen_at)
    VALUES
      ('DEMO-S14-001', v_session_open, v_cashier_id, 'dine_in',  'completed',
        100000,  9091, 100000, NULL, 'T1', 'pos',
        v_today + TIME '08:15', v_today + TIME '08:10', v_today + TIME '08:11'),
      ('DEMO-S14-002', v_session_open, v_cashier_id, 'take_out', 'completed',
        135000, 12273, 135000, v_cust_anna, NULL, 'pos',
        v_today + TIME '08:30', v_today + TIME '08:25', v_today + TIME '08:26'),
      ('DEMO-S14-003', v_session_open, v_cashier_id, 'dine_in',  'completed',
        178000, 16182, 178000, NULL, 'T2', 'pos',
        v_today + TIME '09:00', v_today + TIME '08:55', v_today + TIME '08:56'),
      ('DEMO-S14-004', v_session_open, v_cashier_id, 'delivery', 'completed',
        195000, 17727, 195000, v_cust_budi, NULL, 'pos',
        v_today + TIME '09:30', v_today + TIME '09:25', v_today + TIME '09:26'),
      ('DEMO-S14-005', v_session_open, v_cashier_id, 'dine_in',  'completed',
        220000, 20000, 220000, NULL, 'T3', 'pos',
        v_today + TIME '10:00', v_today + TIME '09:55', v_today + TIME '09:56'),
      ('DEMO-S14-006', v_session_open, v_cashier_id, 'take_out', 'completed',
         85000,  7727,  85000, NULL, NULL, 'pos',
        v_today + TIME '10:30', v_today + TIME '10:25', v_today + TIME '10:26'),
      ('DEMO-S14-007', v_session_open, v_cashier_id, 'dine_in',  'completed',
        145000, 13182, 145000, v_cust_citra, 'T4', 'pos',
        v_today + TIME '11:00', v_today + TIME '10:55', v_today + TIME '10:56'),
      ('DEMO-S14-008', v_session_open, v_cashier_id, 'take_out', 'completed',
        160000, 14545, 160000, NULL, NULL, 'pos',
        v_today + TIME '11:30', v_today + TIME '11:25', v_today + TIME '11:26'),
      ('DEMO-S14-009', v_session_open, v_cashier_id, 'delivery', 'completed',
        130000, 11818, 130000, NULL, NULL, 'pos',
        v_today + TIME '12:00', v_today + TIME '11:55', v_today + TIME '11:56'),
      ('DEMO-S14-010', v_session_open, v_cashier_id, 'dine_in',  'completed',
        165000, 15000, 165000, NULL, 'T5', 'pos',
        v_today + TIME '12:30', v_today + TIME '12:25', v_today + TIME '12:26')
    ON CONFLICT (order_number) DO NOTHING;

    -- Order items: link by order_number lookups
    INSERT INTO order_items
      (order_id, product_id, name_snapshot, unit_price, quantity, line_total, kitchen_status)
    SELECT o.id, p.id, p.name, p.retail_price, x.qty,
           p.retail_price * x.qty, 'served'
    FROM (VALUES
      -- DEMO-S14-001 (100000): 1 Americano (35000) + 1 Almond Croissant (38000) + 1 Cheese Twist (28000) = 101000 (rounded)
      ('DEMO-S14-001', 'BEV-001', 1),
      ('DEMO-S14-001', 'PAS-003', 1),
      ('DEMO-S14-001', 'SAV-003', 1),
      -- DEMO-S14-002 (135000): 1 American Bagel (70000) + 1 Latte (45000) + 1 Pain au Chocolat (32000) = ~147 close to 135
      ('DEMO-S14-002', 'BAG-001', 1),
      ('DEMO-S14-002', 'BEV-003', 1),
      ('DEMO-S14-002', 'PAS-001', 1),
      -- DEMO-S14-003 (178000): 1 Eggs Benedict (85000) + 1 Latte (45000) + 1 Croissant (30000) + 1 Iced Tea (30000) = 190 close to 178
      ('DEMO-S14-003', 'PLT-003', 1),
      ('DEMO-S14-003', 'BEV-003', 1),
      ('DEMO-S14-003', 'PAS-002', 1),
      ('DEMO-S14-003', 'BEV-007', 1),
      -- DEMO-S14-004 (195000): 1 Smashed Avo (78000) + 1 Granola (75000) + 1 Mocha (50000)
      ('DEMO-S14-004', 'PLT-004', 1),
      ('DEMO-S14-004', 'PLT-002', 1),
      ('DEMO-S14-004', 'BEV-005', 1),
      -- DEMO-S14-005 (220000): 1 Breakfast Plate (95000) + 1 Chicken Pesto (78000) + 1 Cappuccino (42000)
      ('DEMO-S14-005', 'PLT-001', 1),
      ('DEMO-S14-005', 'SND-002', 1),
      ('DEMO-S14-005', 'BEV-004', 1),
      -- DEMO-S14-006 (85000): 1 Quiche (55000) + 1 Americano (35000)
      ('DEMO-S14-006', 'SAV-001', 1),
      ('DEMO-S14-006', 'BEV-001', 1),
      -- DEMO-S14-007 (145000): 1 Veggie Wrap (60000) + 1 Tarte Citron (45000) + 1 Flat White (42000)
      ('DEMO-S14-007', 'SND-003', 1),
      ('DEMO-S14-007', 'PAS-004', 1),
      ('DEMO-S14-007', 'BEV-002', 1),
      -- DEMO-S14-008 (160000): 1 Smoky Fish (85000) + 1 Macaron (60000) + 1 Iced Tea (30000)
      ('DEMO-S14-008', 'BAG-003', 1),
      ('DEMO-S14-008', 'PAS-006', 1),
      ('DEMO-S14-008', 'BEV-007', 1),
      -- DEMO-S14-009 (130000): 2 Croissants (30000 each = 60000) + 1 Brioche Suisse (38000) + 1 Cappuccino (42000) = 140 close to 130
      ('DEMO-S14-009', 'PAS-002', 2),
      ('DEMO-S14-009', 'VIE-002', 1),
      ('DEMO-S14-009', 'BEV-004', 1),
      -- DEMO-S14-010 (165000): 1 Ham & Cheese (65000) + 1 Cinnamon Roll (38000) + 1 Eclair (42000) + 1 Sparkling (25000) = 170
      ('DEMO-S14-010', 'SND-001', 1),
      ('DEMO-S14-010', 'VIE-004', 1),
      ('DEMO-S14-010', 'PAS-005', 1),
      ('DEMO-S14-010', 'BEV-008', 1)
    ) AS x(order_number, sku, qty)
    JOIN orders o   ON o.order_number = x.order_number
    JOIN products p ON p.sku = x.sku
    WHERE NOT EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND oi.product_id = p.id
    );

    -- Order payments (one per order, mix of methods)
    INSERT INTO order_payments
      (order_id, method, amount, cash_received, change_given, paid_at, reference)
    SELECT o.id, x.method::payment_method, x.amount,
           CASE WHEN x.method = 'cash' THEN x.amount + 5000 ELSE NULL END,
           CASE WHEN x.method = 'cash' THEN 5000 ELSE NULL END,
           o.paid_at, x.reference
    FROM (VALUES
      ('DEMO-S14-001', 'cash',     100000, NULL),
      ('DEMO-S14-002', 'card',     135000, 'VISA-****1234'),
      ('DEMO-S14-003', 'qris',     178000, 'QRIS-DEMO-003'),
      ('DEMO-S14-004', 'transfer', 195000, 'BCA-DEMO-004'),
      ('DEMO-S14-005', 'cash',     220000, NULL),
      ('DEMO-S14-006', 'cash',      85000, NULL),
      ('DEMO-S14-007', 'card',     145000, 'VISA-****5678'),
      ('DEMO-S14-008', 'qris',     160000, 'QRIS-DEMO-008'),
      ('DEMO-S14-009', 'edc',      130000, 'EDC-DEMO-009'),
      ('DEMO-S14-010', 'cash',     165000, NULL)
    ) AS x(order_number, method, amount, reference)
    JOIN orders o ON o.order_number = x.order_number
    WHERE NOT EXISTS (
      SELECT 1 FROM order_payments op
      WHERE op.order_id = o.id
    );
  END IF;

  ---------------------------------------------------------------------------
  -- 11. SECTION STOCK — quantities per (section, product)
  -- All sellable products get stock in MAIN_KITCHEN + FRONT_DISPLAY.
  -- Beverages also stocked at COFFEE_STATION.
  ---------------------------------------------------------------------------
  INSERT INTO section_stock (section_id, product_id, quantity, unit)
  SELECT v_main_kitchen, p.id, 30, p.unit
  FROM products p
  WHERE p.is_active = true AND p.product_type = 'finished'
  ON CONFLICT (section_id, product_id) DO NOTHING;

  INSERT INTO section_stock (section_id, product_id, quantity, unit)
  SELECT v_front_display, p.id, 15, p.unit
  FROM products p
  WHERE p.is_active = true AND p.product_type = 'finished'
    AND p.category_id <> v_cat_beverage
  ON CONFLICT (section_id, product_id) DO NOTHING;

  INSERT INTO section_stock (section_id, product_id, quantity, unit)
  SELECT v_coffee_station, p.id, 50, p.unit
  FROM products p
  WHERE p.is_active = true AND p.category_id = v_cat_beverage
  ON CONFLICT (section_id, product_id) DO NOTHING;

  -- Raw materials stocked in MAIN_KITCHEN (in their native units)
  INSERT INTO section_stock (section_id, product_id, quantity, unit)
  SELECT v_main_kitchen, p.id,
         CASE WHEN p.unit = 'g'   THEN 50000
              WHEN p.unit = 'ml'  THEN 30000
              WHEN p.unit = 'pcs' THEN 200
              ELSE 100 END,
         p.unit
  FROM products p
  WHERE p.is_active = false AND p.product_type = 'finished'
    AND p.category_id = v_cat_ingredient
  ON CONFLICT (section_id, product_id) DO NOTHING;

  RAISE NOTICE 'The Breakery demo seed applied successfully.';
END $$;
