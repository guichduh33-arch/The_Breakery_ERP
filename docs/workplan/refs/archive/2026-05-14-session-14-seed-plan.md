# Session 14 — Seed plan The Breakery démo

**Date:** 2026-05-14
**Migration target:** `supabase/migrations/20260518000001_seed_breakery_demo.sql`
**Idempotent:** all `INSERT ... ON CONFLICT DO NOTHING`.
**Env-gated:** wrapped in `IF current_setting('app.demo_seed', true) = 'enabled' THEN ... END IF;` to never run in production.

---

## 1. Goal

Peupler la V3 dev `ikcyvlovptebroadgtvd` avec un dataset démo The Breakery suffisant pour :
- Que le POS affiche une grille de produits visuellement riche (matchs aux screenshots).
- Que le BO Dashboard affiche des KPIs non-vides.
- Que les reports financiers calculent sur ≥ 1 journée de ventes.
- Que tous les flows (open shift, complete order, refund, PO, etc.) soient testables manuellement.

---

## 2. Inventory cible

### 2.1 Catégories (8 rows)

| Code | Display name | Sort order | Icon (Lucide) |
|---|---|---|---|
| `BAGEL` | Bagel | 10 | (none — gold accent only) |
| `BEVERAGE` | Beverage | 20 | (none) |
| `BREAD` | Bread | 30 | (none) |
| `PASTRY` | Pastry | 40 | (none) |
| `PLATE` | Plate | 50 | (none) |
| `SANDWICH` | Sandwiches | 60 | (none) |
| `SAVOURY` | Savoury | 70 | (none) |
| `VIENNOISERIE` | Viennoiserie | 80 | (none) |

### 2.2 Produits (~40 rows)

Tous avec :
- `code` ≈ `<3-letter-cat>-<num>` (e.g. `BAG-001`).
- `name` (FR/EN mix matching bakery vocabulary).
- `category_id` → FK to category.
- `price_cents` (in IDR cents — multiply by 100 because Rp).
- `image_url` → CDN URL (Unsplash, Pexels CC0).
- `is_active = true`.
- `unit` = 'unit' for most, 'cup' for beverages, 'plate' for plates.
- `tax_inclusive = true` (PB1 included).
- `default_shelf_life_hours` = 24 for bakery items, NULL for plates/beverages.

Sample list:

**Bagels (4)**
- `BAG-001` American Bagel — Rp 70 000 — img: bagel everything seed
- `BAG-002` Cheesy Brie — Rp 70 000 — img: brie melt bagel
- `BAG-003` Smoky Fish — Rp 85 000 — img: smoked salmon bagel
- `BAG-004` Vegetarian Bagel — Rp 60 000 — img: avocado bagel

**Beverages (8)**
- `BEV-001` Americano — Rp 35 000 — modifiers : hot/iced (required)
- `BEV-002` Flat White — Rp 42 000 — modifiers : milk type (required), shot count (optional)
- `BEV-003` Latte — Rp 45 000 — modifiers : milk + shot + syrup (optional)
- `BEV-004` Cappuccino — Rp 42 000
- `BEV-005` Mocha — Rp 50 000
- `BEV-006` Hot Chocolate — Rp 38 000
- `BEV-007` Iced Tea — Rp 30 000
- `BEV-008` Sparkling Water — Rp 25 000

**Breads (6)**
- `BRD-001` Sourdough Loaf — Rp 65 000 — `default_shelf_life_hours` = 36
- `BRD-002` Country Bread — Rp 55 000
- `BRD-003` Multigrain — Rp 60 000
- `BRD-004` Brioche — Rp 75 000
- `BRD-005` Baguette Classique — Rp 28 000 — shelf life 12h
- `BRD-006` Pain de Campagne — Rp 70 000

**Pastries (6)**
- `PAS-001` Pain au Chocolat — Rp 32 000
- `PAS-002` Croissant Beurre — Rp 30 000
- `PAS-003` Almond Croissant — Rp 38 000
- `PAS-004` Tarte Citron — Rp 45 000
- `PAS-005` Éclair Café — Rp 42 000
- `PAS-006` Macaron Assortis (3pc) — Rp 60 000

**Plates (4)**
- `PLT-001` Breakfast Plate — Rp 95 000
- `PLT-002` Granola Bowl — Rp 75 000
- `PLT-003` Eggs Benedict — Rp 85 000
- `PLT-004` Smashed Avo Toast — Rp 78 000

**Sandwiches (4)**
- `SND-001` Ham & Cheese — Rp 65 000
- `SND-002` Chicken Pesto — Rp 78 000
- `SND-003` Veggie Wrap — Rp 60 000
- `SND-004` Tuna Mayo — Rp 70 000

**Savoury (4)**
- `SAV-001` Quiche Lorraine — Rp 55 000
- `SAV-002` Empanada — Rp 35 000
- `SAV-003` Cheese Twist — Rp 28 000
- `SAV-004` Sausage Roll — Rp 38 000

**Viennoiserie (4)**
- `VIE-001` Chausson aux Pommes — Rp 35 000
- `VIE-002` Brioche Suisse — Rp 38 000
- `VIE-003` Kouign-Amann — Rp 42 000
- `VIE-004` Cinnamon Roll — Rp 38 000

Total: **40 produits**.

### 2.3 Combos (6 rows)

| Code | Name | Components | Combo price | Saving |
|---|---|---|---|---|
| `CMB-001` | Coffee Combo | 1 Americano + 1 Croissant | Rp 55 000 | Rp 7 000 |
| `CMB-002` | Breakfast Combo | 1 Eggs Benedict + 1 Latte + 1 Orange Juice | Rp 130 000 | Rp 20 000 |
| `CMB-003` | Bagel Set | 1 American Bagel + 1 Iced Tea | Rp 90 000 | Rp 10 000 |
| `CMB-004` | Family Bread Pack | 1 Sourdough + 1 Brioche + 4 Pastries | Rp 250 000 | Rp 40 000 |
| `CMB-005` | Sandwich Lunch | 1 Ham & Cheese + 1 Soup + 1 Latte | Rp 130 000 | Rp 20 000 |
| `CMB-006` | Sweet Trio | 1 Tarte Citron + 1 Macaron + 1 Eclair | Rp 130 000 | Rp 17 000 |

### 2.4 Recipes (12 rows)

Pour les produits manufacturés en interne (Bread + Pastry + Viennoiserie). Chaque recipe = BOM (ingredients + qty).

| Recipe | For product | Ingredients (qty + unit) |
|---|---|---|
| `RCP-001 Sourdough Loaf` | `BRD-001` | Flour 500g, Water 350ml, Salt 10g, Sourdough starter 50g |
| `RCP-002 Country Bread` | `BRD-002` | Flour 450g, Whole wheat 50g, Water 320ml, Salt 10g, Yeast 5g |
| `RCP-003 Multigrain` | `BRD-003` | Flour 400g, Multigrain mix 100g, Water 340ml, Salt 10g, Yeast 5g |
| `RCP-004 Brioche` | `BRD-004` | Flour 500g, Butter 200g, Eggs 4, Sugar 50g, Yeast 10g, Salt 8g, Milk 100ml |
| `RCP-005 Baguette` | `BRD-005` | Flour 500g, Water 350ml, Salt 10g, Yeast 5g |
| `RCP-006 Pain de Campagne` | `BRD-006` | Flour 450g, Rye 50g, Water 350ml, Salt 10g, Sourdough 50g |
| `RCP-007 Pain au Chocolat` | `PAS-001` | Croissant dough 100g, Chocolate batons 30g |
| `RCP-008 Croissant Beurre` | `PAS-002` | Flour 250g, Butter 125g, Milk 100ml, Sugar 25g, Yeast 5g, Salt 5g |
| `RCP-009 Almond Croissant` | `PAS-003` | Croissant 1pc, Almond cream 50g, Almond flakes 10g |
| `RCP-010 Tarte Citron` | `PAS-004` | Pâte sablée 80g, Crème citron 100g, Meringue 30g |
| `RCP-011 Éclair Café` | `PAS-005` | Pâte à choux 60g, Crème pâtissière café 80g, Fondant café 20g |
| `RCP-012 Cinnamon Roll` | `VIE-004` | Brioche dough 100g, Butter 20g, Sugar 30g, Cinnamon 5g, Icing 20g |

### 2.5 Ingredients (raw materials, ~20 rows)

`Flour`, `Whole wheat flour`, `Rye flour`, `Multigrain mix`, `Water`, `Salt`, `Yeast`, `Sourdough starter`, `Butter`, `Sugar`, `Eggs`, `Milk`, `Chocolate batons`, `Almond cream`, `Almond flakes`, `Pâte sablée mix`, `Lemon cream mix`, `Cinnamon`, `Vanilla extract`, `Coffee beans` (for the espresso machine).

Each with `unit` (g / ml / pc), and `current_stock` seeded ~enough for 1 day production.

### 2.6 Suppliers (2 rows)

- `SUP-001 Boulangerie Wholesale SA` — type: flour/yeast/grains
- `SUP-002 Pâtisserie Premium Co` — type: butter/eggs/chocolate

Each with address, phone, contact name, and 3-5 historical purchases seeded.

### 2.7 Customers (5 rows)

| Name | Tier | Birthday | Phone |
|---|---|---|---|
| `Anna Putri` | Bronze | 1985-04-12 | +62 812-3456-7890 |
| `Budi Setiawan` | Silver | 1990-08-23 | +62 813-2345-6789 |
| `Citra Wijaya` | Gold | 1988-12-05 | +62 812-9876-5432 |
| `Dewi Lestari` | Bronze | 1995-06-18 | +62 856-1234-5678 |
| `Eko Nugroho` | (none) | NULL | +62 858-7890-1234 |

Each with `marketing_consent = true` (for birthday cron testing).

### 2.8 POS sessions (2 rows)

- 1 closed session yesterday (opening_cash 500 000, closing_cash 1 250 000, variance +50 000)
- 1 open session today (opening_cash 500 000)

### 2.9 Orders (10 sample orders on today's open session)

Mix of `dine_in`, `take_out`, `delivery`. Each with:
- 2-5 items
- Cash, card, or split payment
- ~2-3 with promo applied
- 1 with customer attached (loyalty)
- All status `completed` or `paid`

Total seeded revenue ≈ Rp 1 500 000 today.

### 2.10 Sections (POS-side stock locations)

3 sections : `MAIN_KITCHEN`, `FRONT_DISPLAY`, `COFFEE_STATION`. Stock levels seeded for each section (visible in POSStockView).

---

## 3. Image URLs strategy

Two approaches :

**A. External CDN (Unsplash/Pexels, recommended for V3 dev)**
- Cost : free
- Reliability : CDN-class, 99%+ uptime
- License : CC0 (no attribution required for Unsplash basic / Pexels)
- Risk : URLs can break if Unsplash de-indexes (rare for established photos)
- Format : `https://images.unsplash.com/photo-XXXXXXXXX?w=800&q=80`

**B. Supabase storage bucket (move later)**
- Cost : storage on V3 dev plan
- Reliability : tied to Supabase project
- License : own assets
- Risk : need to upload + maintain bucket
- Format : `https://ikcyvlovptebroadgtvd.supabase.co/storage/v1/object/public/products/bag-001.jpg`

**Decision** : Use **A (Unsplash)** for Wave 1 seed. If demo evolves to staging/prod, migration script downloads + uploads to Supabase storage and rewrites URLs.

**Curated photo URLs** (pre-vetted):
- Bagels : various from Unsplash search "everything bagel" / "smoked salmon bagel"
- Beverages : "flat white coffee", "americano", etc.
- Breads : "sourdough", "brioche", "baguette"
- Pastries : "pain au chocolat", "croissant", "tarte citron", "eclair"

The seed-author sub-agent picks URLs at execution time and validates them with `curl --head` before INSERT.

---

## 4. Seed migration structure

```sql
-- 20260518000001_seed_breakery_demo.sql

DO $$
BEGIN
  IF current_setting('app.demo_seed', true) IS DISTINCT FROM 'enabled' THEN
    RAISE NOTICE 'Demo seed skipped (set app.demo_seed=enabled to apply)';
    RETURN;
  END IF;

  -- 1. Categories
  INSERT INTO product_categories (code, name, sort_order) VALUES
    ('BAGEL', 'Bagel', 10),
    -- ... 7 more
  ON CONFLICT (code) DO NOTHING;

  -- 2. Products (40 rows)
  INSERT INTO products (code, name, category_id, price_cents, image_url, unit, ...)
  SELECT * FROM (VALUES
    ('BAG-001', 'American Bagel', (SELECT id FROM product_categories WHERE code='BAGEL'), 7000000, 'https://images.unsplash.com/...', 'unit', ...),
    -- ... 39 more
  ) AS t
  ON CONFLICT (code) DO NOTHING;

  -- 3. Ingredients (20 rows)
  -- 4. Recipes + recipe_ingredients (12 + 60 rows)
  -- 5. Suppliers (2 rows)
  -- 6. Customers (5 rows)
  -- 7. POS sessions (2 rows — 1 closed yesterday + 1 open today)
  -- 8. Orders + order_items (10 + 30 rows) on today's open session
  -- 9. Stock levels per section (3 sections × ~60 products = 180 rows)

  RAISE NOTICE 'Demo seed applied successfully';
END $$;
```

Apply with :

```sql
-- One-shot enable
ALTER DATABASE postgres SET app.demo_seed = 'enabled';
-- Apply migration
\i 20260518000001_seed_breakery_demo.sql
-- Disable to prevent re-run (optional — migration is idempotent anyway)
ALTER DATABASE postgres RESET app.demo_seed;
```

---

## 5. DoD seed

- [ ] Migration applied via MCP `apply_migration`.
- [ ] `SELECT COUNT(*) FROM products WHERE is_active = true` = 40+.
- [ ] `SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND is_active = true` = 40 (all have photos).
- [ ] `SELECT COUNT(*) FROM combos` = 6.
- [ ] `SELECT COUNT(*) FROM recipes WHERE deleted_at IS NULL` = 12.
- [ ] `SELECT COUNT(*) FROM customers WHERE marketing_consent = true` = 4.
- [ ] `SELECT COUNT(*) FROM suppliers` = 2.
- [ ] `SELECT COUNT(*) FROM pos_sessions WHERE closed_at IS NULL` = 1.
- [ ] `SELECT SUM(total_cents) FROM orders WHERE status = 'completed' AND created_at::date = CURRENT_DATE` ≈ 150 000 000 (Rp 1 500 000).
- [ ] POS dev server : product grid shows 40+ photos.
- [ ] BO Dashboard : KPIs not-zero.

---

## 6. Cleanup strategy

When done with démo and ready to seed prod, run reverse migration `20260518000099_demo_seed_cleanup.sql` (TBD) that :
- Deletes all rows where `metadata->>'seed' = 'breakery_demo'`.
- Idempotent.

Or simply `DROP DATABASE` + recreate V3 dev clean (more brutal but reliable for staging).
