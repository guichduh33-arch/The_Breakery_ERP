# The Breakery — Session 7 Spec : Customer Categories + Combos

> **Date** : 2026-05-06
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter les pricing tiers customer (retail / wholesale / discount_percentage / custom) avec RPC `get_customer_product_price`, et un module combos v1 (fixed combos sans choix) — les composants sont DISPLAY-only, le combo est facturé comme un seul order_item au prix combo retail.

---

## 0. Contexte

Session 6 a livré discounts manuels + multi-select modifiers + loyalty multipliers.
Session 7 ajoute :
- **Customer categories** : tiers de pricing (retail / wholesale / discount_percentage 5-15%-staff / custom). Customer attaché → cart auto-applies category pricing. Badge `CustomerCategoryBadge` visible
- **Combos v1 (fixed)** : un produit `product_type='combo'` a une liste de composants (`combo_items`) affichés en sub-lines dans cart + KDS. Charge le retail_price du combo. Pas de choix entre composants en v1
- **`products.wholesale_price` + `products.product_type`** : colonnes ajoutées (n'existent pas en master)

Cette session **ne touche pas** :
- Combos avec **groupes de choix** (V2 `product_combo_groups` + `product_combo_group_items`) — session 8 (sous "promotions" combinés ?) ou session 11
- Promotions auto-évaluées (BOGO, %off catégorie) — session 8
- Modifiers sur composants de combo — session 11+
- Component-level KDS dispatch (chaque composant routed séparément) — session 11+
- Backoffice CRUD customer_categories + combos — session 10
- Recipes / BOM / cost_price tracking — session 11+

## 1. Décisions actées (15 points)

| # | Décision | Choix |
|---|---|---|
| **CC1** | `customer_categories` schema | id, name, slug, color, icon, price_modifier_type enum, discount_percentage DECIMAL(5,2), loyalty_enabled BOOL, points_multiplier DECIMAL(4,2), is_default BOOL, is_active, deleted_at |
| **CC2** | `price_modifier_type` enum | `('retail', 'wholesale', 'discount_percentage', 'custom')` |
| **CC3** | Seed 5 categories | Retail (default, retail), VIP (discount_percentage 5%), Staff (discount_percentage 15%), Wholesale, Custom |
| **CC4** | `customers.category_id` | FK NULLABLE → resolved server-side: NULL → take `is_default=true` row at apply-time |
| **CC5** | Default category guarantee | UNIQUE partial index : `WHERE is_default = true` accepte UNE row au max |
| **CC6** | `product_category_prices` (custom) | id, product_id, customer_category_id, price DECIMAL(12,2). PRIMARY KEY (product_id, customer_category_id). Tables custom override le retail_price |
| **CC7** | RPC `get_customer_product_price` | params (`p_product_id UUID`, `p_customer_id UUID DEFAULT NULL`) → returns DECIMAL(12,2). Logic : si customer NULL → retail. Sinon résout customer.category_id → category.price_modifier_type → applique formula. Custom lookup `product_category_prices` ou fallback retail |
| **CC8** | `products.wholesale_price` | NEW DECIMAL(12,2) NULL. Si NULL et type='wholesale' → fallback retail_price |
| **CC9** | Cart pricing application | client-side : à `addItem`, POS appelle RPC `get_customer_product_price(productId, customerId)` et utilise ce prix comme `unit_price`. Si customer detach → re-fetch retail price (v1 simple : warn user, ne re-applique pas auto) |
| **CC10** | Loyalty earn category-aware | `category.points_multiplier` × `tier.points_multiplier` × FLOOR(amount / 1000). Multipliers cumulables. Default category = 1.0 |
| **CB1** | `products.product_type` | NEW TEXT CHECK IN ('finished', 'combo'). DEFAULT 'finished'. (V2 a aussi semi_finished/raw_material — déférés) |
| **CB2** | `combo_items` schema | id, parent_product_id (FK → products), component_product_id (FK → products), quantity INTEGER >0, sort_order. PRIMARY KEY (parent_product_id, component_product_id) |
| **CB3** | Combo cart line | UNE order_item ligne. unit_price = combo.retail_price (ou category-resolved). Components affichés en sub-lines read-only via JOIN `combo_items` à display time |
| **CB4** | Combo KDS dispatch | combo's category dispatch_station route le tout vers UNE station (whole combo). Component-level dispatch reporté |
| **CB5** | Combo modifiers | NOT supported v1. UI bloque ouverture ModifierModal sur tap combo. Reporté |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | tout via Supabase + RPC + react-query |
| Domain `packages/domain/src/customerCategories/` | types + price-resolution helper |
| Domain `packages/domain/src/combos/` | types + cart helpers |
| UI `packages/ui/src/components/CustomerCategoryBadge.tsx` | badge avec color/icon |
| UI `packages/ui/src/components/ComboLineRow.tsx` | combo cart row avec sub-line components |

---

## 3. Schéma DB — additions

### 3.1 `customer_categories`

```sql
CREATE TYPE price_modifier_type AS ENUM ('retail', 'wholesale', 'discount_percentage', 'custom');

CREATE TABLE customer_categories (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  color                 TEXT,                      -- hex ex '#10B981'
  icon                  TEXT,                      -- lucide name or emoji
  price_modifier_type   price_modifier_type NOT NULL DEFAULT 'retail',
  discount_percentage   DECIMAL(5,2) NOT NULL DEFAULT 0
                        CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  loyalty_enabled       BOOLEAN NOT NULL DEFAULT true,
  points_multiplier     DECIMAL(4,2) NOT NULL DEFAULT 1.0
                        CHECK (points_multiplier >= 0),
  is_default            BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

-- Une seule default category active
CREATE UNIQUE INDEX idx_customer_categories_one_default
  ON customer_categories(is_default)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX idx_customer_categories_active
  ON customer_categories(slug)
  WHERE deleted_at IS NULL AND is_active;
```

### 3.2 `customers.category_id` FK

```sql
ALTER TABLE customers
  ADD COLUMN category_id UUID REFERENCES customer_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_category ON customers(category_id) WHERE deleted_at IS NULL;
```

### 3.3 `product_category_prices`

```sql
CREATE TABLE product_category_prices (
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_category_id  UUID NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE,
  price                 DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, customer_category_id)
);
```

### 3.4 Modifs `products`

```sql
ALTER TABLE products
  ADD COLUMN wholesale_price DECIMAL(12,2) CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
  ADD COLUMN product_type    TEXT NOT NULL DEFAULT 'finished'
                             CHECK (product_type IN ('finished', 'combo'));

CREATE INDEX idx_products_combo
  ON products(id)
  WHERE product_type = 'combo' AND deleted_at IS NULL;
```

### 3.5 `combo_items`

```sql
CREATE TABLE combo_items (
  parent_product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_product_id, component_product_id),
  CHECK (parent_product_id <> component_product_id)
);

CREATE INDEX idx_combo_items_component
  ON combo_items(component_product_id);

-- Guard : parent must be product_type='combo' (enforced via trigger or app-level check)
CREATE OR REPLACE FUNCTION enforce_combo_parent_type() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.parent_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'parent_product_id must be a combo product (product_type = ''combo'')'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE id = NEW.component_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'component_product_id cannot itself be a combo (no nested combos in v1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_combo_items_parent_type
  BEFORE INSERT OR UPDATE ON combo_items
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_parent_type();
```

### 3.6 RPC `get_customer_product_price`

```sql
CREATE FUNCTION get_customer_product_price(
  p_product_id UUID,
  p_customer_id UUID DEFAULT NULL
) RETURNS DECIMAL(12,2)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_product       products;
  v_category_id   UUID;
  v_modifier      price_modifier_type;
  v_discount_pct  DECIMAL(5,2);
  v_custom_price  DECIMAL(12,2);
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- No customer → retail
  IF p_customer_id IS NULL THEN
    RETURN v_product.retail_price;
  END IF;

  -- Resolve customer category (NULL → default category)
  SELECT category_id INTO v_category_id FROM customers WHERE id = p_customer_id;
  IF v_category_id IS NULL THEN
    SELECT id INTO v_category_id FROM customer_categories WHERE is_default = true AND deleted_at IS NULL;
  END IF;

  SELECT price_modifier_type, discount_percentage INTO v_modifier, v_discount_pct
    FROM customer_categories WHERE id = v_category_id;

  RETURN CASE v_modifier
    WHEN 'retail'              THEN v_product.retail_price
    WHEN 'wholesale'           THEN COALESCE(v_product.wholesale_price, v_product.retail_price)
    WHEN 'discount_percentage' THEN round_idr(v_product.retail_price * (1 - v_discount_pct / 100))
    WHEN 'custom'              THEN COALESCE(
                                     (SELECT price FROM product_category_prices
                                       WHERE product_id = p_product_id AND customer_category_id = v_category_id),
                                     v_product.retail_price
                                   )
  END;
END $$;
```

### 3.7 RLS

```sql
ALTER TABLE customer_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON customer_categories FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
-- Pas de WRITE policy v1 — seed only

ALTER TABLE product_category_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_category_prices FOR SELECT
  USING (is_authenticated());

ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON combo_items FOR SELECT
  USING (is_authenticated());
```

### 3.8 Seed

```sql
INSERT INTO customer_categories (name, slug, color, icon, price_modifier_type, discount_percentage, points_multiplier, is_default) VALUES
  ('Retail',    'retail',    '#64748B', '🛒', 'retail',              0,    1.0, true),
  ('VIP',       'vip',       '#F59E0B', '⭐', 'discount_percentage', 5,    1.2, false),
  ('Staff',     'staff',     '#10B981', '👥', 'discount_percentage', 15,   1.0, false),
  ('Wholesale', 'wholesale', '#3B82F6', '📦', 'wholesale',           0,    1.0, false),
  ('Custom',    'custom',    '#8B5CF6', '🎯', 'custom',              0,    1.0, false);

-- Update existing demo customer Gold → VIP
UPDATE customers SET category_id = (SELECT id FROM customer_categories WHERE slug = 'vip')
  WHERE name = 'Loyal Gold Customer';

-- Demo combo : "Breakfast Set"
-- assume products session 1 seed: Croissant (UUID via WHERE name=) + Americano + maybe Banana
-- Combo product itself
INSERT INTO products (sku, name, category_id, retail_price, product_type) VALUES
  ('COMBO-001', 'Breakfast Set', (SELECT id FROM categories WHERE slug='beverage'), 75000, 'combo');

-- Components
INSERT INTO combo_items (parent_product_id, component_product_id, quantity, sort_order)
SELECT p1.id, p2.id, 1, ord
FROM products p1, products p2, generate_series(1, 1) ord
WHERE p1.sku = 'COMBO-001'
  AND p2.sku IN ('SKU-AMERICANO', 'SKU-CROISSANT');

-- (Adapter selon les SKUs réels seedés en session 1.)
```

### 3.9 Migrations à créer

```
20260509000001_init_customer_categories.sql              # table + enum + index + RLS
20260509000002_add_customers_category_fk.sql             # ALTER customers + index
20260509000003_init_product_category_prices.sql          # custom pricing table + RLS
20260509000004_add_products_wholesale_and_type.sql       # ALTER products + index
20260509000005_init_combo_items.sql                      # table + trigger + RLS
20260509000006_get_customer_product_price_rpc.sql        # RPC
20260509000007_seed_categories_and_combo.sql             # 5 categories + 1 demo combo
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
customerCategories/
├── types.ts                # CustomerCategory, PriceModifierType
└── index.ts

combos/
├── types.ts                # ComboComponent, ComboItem
├── isComboProduct.ts       # type-guard product.product_type === 'combo'
└── index.ts

products/
└── types.ts                # EXTEND Product avec product_type, wholesale_price
                            # (si types/product.ts existe → modifier ; sinon créer dans types/)

cart/
├── calculateTotals.ts      # EXTEND : combo line uses combo retail_price (ou category-resolved)
└── __tests__/
```

`CustomerCategory` :
```ts
export interface CustomerCategory {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  price_modifier_type: 'retail' | 'wholesale' | 'discount_percentage' | 'custom';
  discount_percentage: number;
  loyalty_enabled: boolean;
  points_multiplier: number;
  is_default: boolean;
}
```

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `CustomerCategoryBadge.tsx` | pill avec couleur + icon + slug. Props: `{ category: CustomerCategory; className?: string }`. Fallback : Retail style si null |
| `ComboLineRow.tsx` | extends pattern de CartItemRow. Affiche le combo en row principal (font-mono SKU, name, qty, price). Components en sub-lines `text-text-secondary text-xs` indented |

### 4.3 POS app `apps/pos/src/`

```
NEW features/customerCategories/
├── components/
│   └── CategorySelector.tsx     # (optional v1) dropdown pour changer category dans CustomerSearchModal — défer si trop gros
└── hooks/
    ├── useCustomerCategories.ts  # query
    └── useCustomerProductPrice.ts  # RPC get_customer_product_price (memoized par productId+customerId)

NEW features/combos/
├── components/
│   └── ComboBadge.tsx            # badge "COMBO" sur ProductCard si product_type='combo'
└── hooks/
    └── useComboItems.ts          # query combo_items pour un parent_product_id (cached 5min)

MODIFY:
apps/pos/src/features/products/components/ProductCard.tsx       # render ComboBadge si product_type='combo'
apps/pos/src/features/products/ProductTapHandler.tsx            # bloquer ModifierModal pour combo (toast "Modifiers not supported on combos")
apps/pos/src/features/products/hooks/useProducts.ts             # SELECT inclut product_type + wholesale_price
apps/pos/src/features/cart/CartItemRow.tsx                      # render <ComboLineRow> si item.product_type='combo' (props sub-components from useComboItems)
apps/pos/src/features/cart/ActiveOrderPanel.tsx                 # show CustomerCategoryBadge dans CustomerAttachedBadge
apps/pos/src/features/customers/components/CustomerSearchModal.tsx  # show CategoryBadge per row
apps/pos/src/features/customers/components/CustomerAttachedBadge.tsx  # show CategoryBadge inline
apps/pos/src/features/payment/PaymentTerminal.tsx               # earn line uses category.points_multiplier × tier.points_multiplier
apps/pos/src/features/payment/hooks/useCheckout.ts              # multiplier = category.points_multiplier × tier.points_multiplier
apps/pos/src/stores/cartStore.ts                                # addItem accepte unit_price override (déjà ?)

apps/pos/src/features/customers/hooks/useCustomerSearch.ts      # SELECT inclut category_id + JOIN customer_categories
apps/pos/src/features/customers/hooks/useCreateCustomer.ts      # auto-assign default category at create
```

### 4.4 Cart pricing flow

À `addItem(product, modifiers)`:
1. Si `cartStore.attachedCustomer != null` → `unit_price = await rpc('get_customer_product_price', {p_product_id: product.id, p_customer_id: customer.id})`
2. Sinon `unit_price = product.retail_price`
3. Push à cart avec ce `unit_price`
4. À `attachCustomer` après items déjà ajoutés → toast warning "Customer category not applied to existing items. Re-add to apply." (v1 simple, no auto-recalc)
5. À `detachCustomer` → idem, items gardent le prix appliqué (warn user)

(v1 simplification : pas d'auto-recompute. UI guide manually. Future session = recompute hook.)

### 4.5 Combo flow

À tap product avec `product_type='combo'`:
1. Pas d'ouverture ModifierModal (toast si modifiers groups définis sur ce produit en aberration)
2. `addItem(combo, [])` direct, unit_price = via get_customer_product_price si customer
3. Cart affiche row combo + sub-lines components (via `useComboItems(combo.id)` query)
4. Send-to-Kitchen : insert 1 row order_items avec produc_id=combo. KDS voit le combo, dispatch via combo.category_id.dispatch_station

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `combos/isComboProduct` | type guard true/false cases |
| domain `cart/calculateTotals` | combo line = combo unit_price × qty (no modifier add for v1), mixed cart with combos + finished |
| ui `CustomerCategoryBadge` | render color/icon/name, fallback null |
| ui `ComboLineRow` | render parent + components, qty math |
| pgTAP `get_customer_product_price` | retail returns retail_price, wholesale returns wholesale or fallback retail, discount_percentage returns rounded, custom returns lookup or fallback retail, NULL customer returns retail, NULL category returns default |
| pgTAP `enforce_combo_parent_type` trigger | parent non-combo → check_violation, component itself combo → check_violation |
| Vitest smoke `customer-pricing.smoke.test.tsx` | attach VIP customer (5% off) → ProductCard display still retail (display retail), tap product → cart line at retail × 0.95 |
| Vitest smoke `combo.smoke.test.tsx` | tap "Breakfast Set" combo → cart shows combo + 2 components sub-lines, total = combo retail_price (75 000), checkout → 1 order_items row |
| Vitest smoke `category-loyalty.smoke.test.tsx` | VIP customer (category multiplier 1.2) + Bronze tier (1.0) → effective multiplier 1.2 → earn = floor(amount × 1.2 / 1000) |

---

## 6. Critères d'acceptation session 7

- [ ] Migrations 20260509000001 → 20260509000007 passent
- [ ] Seed insère 5 customer_categories (Retail default, VIP, Staff, Wholesale, Custom) + 1 combo "Breakfast Set" (75 000 IDR) avec 2 components
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 540+ tests passent
- [ ] **POS Customer attach** : tap "Attach customer" → CustomerSearchModal → "Loyal Gold" (VIP category) → cart panel affiche `[VIP ⭐]` badge inline
- [ ] **POS Pricing** : produit Americano retail 35000 → tap après VIP attach → cart line 33 250 (5% off, rounded to nearest 50 IDR via round_idr)
- [ ] **POS Detach** : tap detach → toast "Pricing not auto-recomputed" → cart items gardent leur prix VIP
- [ ] **POS Combo** : tap "Breakfast Set" → cart shows row "Breakfast Set 75 000" + sub-line "+ 1× Americano" + sub-line "+ 1× Croissant"
- [ ] **POS Combo modifiers** : tap "Breakfast Set" si modifiers définis sur lui → toast "Modifiers not supported on combos" et pas d'ouverture ModifierModal
- [ ] **POS Loyalty** : VIP (1.2x category) Bronze tier (1.0x) → cart 35000 → earn = floor(35000 × 1.2 / 1000) = 42 (vs 35 sans category)
- [ ] **POS Loyalty Gold + VIP** : Gold tier (1.1x) × VIP (1.2x) = 1.32x → cart 35000 → earn = floor(35000 × 1.32 / 1000) = 46
- [ ] **DB combo** : insert order avec combo → 1 row order_items, dispatch_station = combo.category.dispatch_station
- [ ] **DB combo trigger** : tenter insert combo_items avec parent non-combo → P0001/check_violation
- [ ] **DB pricing** : RPC `get_customer_product_price` Wholesale customer pour Americano (retail 35000, wholesale_price NULL) → fallback 35000
- [ ] **DB pricing** : Custom customer + product_category_prices entry → return custom price; sans entry → fallback retail

---

## 7. Roadmap session 8+

| Session | Module |
|---|---|
| 8 | Promotions engine (BOGO, percentage off, fixed amount, free product, conditions temporelles, stacking) |
| 9 | Split payment + refund/void (manager-PIN cancel item après send) |
| 10 | Backoffice CRUD : products + categories + suppliers + customers + customer_categories + tables + combos admin + discounts |
| 11 | Customer display + QR scan loyalty + recipes/BOM |
| 12 | B2B customers + credit + invoicing |
| 13+ | Reports, settings, hub-printing, idle PIN re-prompt, ... |
