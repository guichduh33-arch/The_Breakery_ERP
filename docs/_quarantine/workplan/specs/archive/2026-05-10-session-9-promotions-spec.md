# The Breakery — Session 9 Spec : Promotions Engine (auto-évaluées) + Backoffice CRUD

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
> **Module de référence associé** : [`../../reference/04-modules/13-promotions-discounts.md`](../../../reference/04-modules/13-promotions-discounts.md).

> **Date** : 2026-05-10
> **Auteur** : guichduh33@gmail.com (suite session 7+8)
> **Statut** : Approuvé pour implémentation
> **Cible** : moteur de promotions auto-évaluées (4 types : percentage, fixed_amount, BOGO, free_product) avec conditions étendues (customer category/tier, date range, day-of-week, hour range, min total) et stacking advanced (priority + flags), plus backoffice CRUD pour gérer les promos depuis Mamat/manager.

---

## 0. Contexte

Session 8 a livré perf-debt (RLS helpers, RPC loop merge, EF caching, React memo). Session 9 ajoute le moteur de promotions auto — la logique de discount **auto-évaluée** (par opposition au manual cart/line discount de session 6 qui était saisi à la main).

Trois axes :
1. **Types de promotions** : percentage off (cart/category/product), fixed amount off (cart total), BOGO (buy X get Y at discount/free), free product (gift)
2. **Conditions** : min total, customer category, customer tier, date range, day-of-week, hour-of-day. Toutes combinables (AND)
3. **Stacking** : priority (int desc), stackable_with_promo flag, stackable_with_manual flag — permet ex: VIP-only -5% non-cumulable avec Happy Hour -10%, mais cumulable avec discount manuel cashier

Cette session **ne touche pas** :
- Codes promo nominatifs / coupons (session 10+)
- Promotions multi-tier "achète X+Y get Z" — session 11+
- Refund / split payment / void (session 10)
- Reports promo / analytics — session 13+
- Notifications client (email/push) — out of scope v1

## 1. Décisions actées (16 + 3 backoffice)

| # | Décision | Choix |
|---|---|---|
| **P1** | Promotion types | `('percentage', 'fixed_amount', 'bogo', 'free_product')` enum |
| **P2** | Promotion scope (percentage/fixed) | `('cart', 'product', 'category')` enum. NULL pour BOGO/free_product |
| **P3** | Conditions champs | `min_items_total` DECIMAL, `customer_category_ids` UUID[], `customer_tier_ids` UUID[], `start_at` TIMESTAMPTZ, `end_at` TIMESTAMPTZ, `day_of_week_mask` SMALLINT (bits 0-6 = Mon-Sun, 127 = tous jours), `start_hour` SMALLINT 0-23, `end_hour` SMALLINT 0-23 (NULL = pas de filtre horaire) |
| **P4** | Stacking model | `priority` INT (highest desc), `stackable_with_promo` BOOL (default false), `stackable_with_manual` BOOL (default true). Tie-break : `created_at` DESC |
| **P5** | Eval order au checkout | Items → modifiers → category-pricing (session 7) → loyalty redemption → manual discount (session 6) → **auto promotions (session 9)**. NET method : `total = items_total - redemption - manual_discount - Σ promo_amounts` |
| **P6** | Eval location | **Client-side** au cart change (debounced 200ms via react-query). **Server-side** revalide à `complete_order_with_payment` v7 / `pay_existing_order` v4 — RAISE check_violation si client a appliqué une promo dont les conditions ne tiennent plus |
| **P7** | BOGO config | `bogo_trigger_product_ids` UUID[] (≥1), `bogo_reward_product_ids` UUID[] (≥1), `bogo_trigger_qty` INT ≥1, `bogo_reward_qty` INT ≥1, `bogo_reward_discount_pct` DECIMAL(5,2) (0=full price, 50=half off, 100=free). Cross-category supporté |
| **P8** | Free product config | `gift_product_id` UUID FK → products, `gift_qty` INT default 1. Auto-add à addItem dès condition matched, auto-remove si condition cesse |
| **P9** | Lifecycle | `is_active` BOOL, `deleted_at` TIMESTAMPTZ. Inactive ou soft-deleted ne s'évalue pas |
| **P10** | Promo + customer category pricing | category pricing s'applique au `unit_price` AVANT promotions (cf. session 7). Promotion calcule sur `unit_price post-category` |
| **P11** | Stacking matrice | Application en ordre `priority` desc. Première promo appliquée. Suivantes : appliquées seulement si `stackable_with_promo=true` ET la 1ère a aussi `stackable_with_promo=true`. Manual discount cumule selon `stackable_with_manual` |
| **P12** | RPC integration | `complete_order_with_payment` v7 + `pay_existing_order` v4 — accept `p_promotions JSONB` array of `{promotion_id, amount, description, scope_line_id?}`. RPC valide eligibility serveur + insère `promotion_applications` |
| **P13** | Free product UX | Au addItem trigger, eval renvoie une AppliedFreeProduct. cartStore auto-add row avec `is_promo_gift=true`, `unit_price=0`, lien vers `promotion_id`. À removeItem trigger qui invalide condition → auto-remove gift (toast info) |
| **P14** | Promotion application audit | Table `promotion_applications` (order_id, promotion_id, amount, description). Insert via RPC. Snapshot description (ex: "Happy Hour 18-20h —10%") pour reporting même si la promo est ensuite supprimée |
| **P15** | JE method | NET — sales credités post-promo. Pas de JE line séparée par promo. `orders.promotion_total` capturé pour reporting analytique |
| **P16** | Tax recompute | Après application des promos, `tax_amount = round_idr(total_post_promo * tax_rate / (1 + tax_rate))`. Tax-inclusive PB1 model identique au reste |
| **BO1** | Backoffice page | `/backoffice/promotions` — list filtrable par type/active/date. Form modal create/edit per type (form layout dynamique). Toggle Active. Soft-delete |
| **BO2** | RBAC | Permissions `promotions.read`, `promotions.create`, `promotions.update`, `promotions.delete`. Seedés sur ADMIN/SUPER_ADMIN/MANAGER (read+create+update). Delete réservé SUPER_ADMIN |
| **BO3** | Form validation | Zod schemas client + CHECK constraints DB. Date range valide, percentage 0-100, qty ≥ 1, mask 0-127, hours 0-23 |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | Tout via Supabase + react-query + Zod existants |
| Domain `packages/domain/src/promotions/` | types + evaluator pure function + condition matchers + amount computers |
| UI `packages/ui/src/components/PromotionLineRow.tsx` | display promo en cart row dédié |
| UI `packages/ui/src/components/PromotionForm.tsx` | form dynamique create/edit per type pour backoffice |
| UI `packages/ui/src/components/PromotionTypeBadge.tsx` | badge couleur par type pour list backoffice |

---

## 3. Schéma DB — additions

### 3.1 enums + table `promotions`

```sql
CREATE TYPE promotion_type  AS ENUM ('percentage', 'fixed_amount', 'bogo', 'free_product');
CREATE TYPE promotion_scope AS ENUM ('cart', 'product', 'category');

CREATE TABLE promotions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  description                 TEXT,
  type                        promotion_type NOT NULL,
  scope                       promotion_scope,                  -- NULL pour BOGO/free_product

  -- Percentage / Fixed amount config
  discount_value              DECIMAL(14,2)
                              CHECK (discount_value IS NULL OR discount_value >= 0),
  max_discount_amount         DECIMAL(14,2)
                              CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  scope_product_ids           UUID[] NOT NULL DEFAULT '{}',     -- si scope=product
  scope_category_ids          UUID[] NOT NULL DEFAULT '{}',     -- si scope=category

  -- BOGO config
  bogo_trigger_product_ids    UUID[] NOT NULL DEFAULT '{}',
  bogo_reward_product_ids     UUID[] NOT NULL DEFAULT '{}',
  bogo_trigger_qty            INTEGER CHECK (bogo_trigger_qty IS NULL OR bogo_trigger_qty >= 1),
  bogo_reward_qty             INTEGER CHECK (bogo_reward_qty IS NULL OR bogo_reward_qty >= 1),
  bogo_reward_discount_pct    DECIMAL(5,2)
                              CHECK (bogo_reward_discount_pct IS NULL OR (bogo_reward_discount_pct >= 0 AND bogo_reward_discount_pct <= 100)),

  -- Free product config
  gift_product_id             UUID REFERENCES products(id) ON DELETE SET NULL,
  gift_qty                    INTEGER NOT NULL DEFAULT 1 CHECK (gift_qty >= 1),

  -- Conditions
  min_items_total             DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (min_items_total >= 0),
  customer_category_ids       UUID[] NOT NULL DEFAULT '{}',
  customer_tier_ids           UUID[] NOT NULL DEFAULT '{}',
  start_at                    TIMESTAMPTZ,
  end_at                      TIMESTAMPTZ,
  day_of_week_mask            SMALLINT NOT NULL DEFAULT 127
                              CHECK (day_of_week_mask >= 0 AND day_of_week_mask <= 127),
  start_hour                  SMALLINT CHECK (start_hour IS NULL OR (start_hour >= 0 AND start_hour <= 23)),
  end_hour                    SMALLINT CHECK (end_hour   IS NULL OR (end_hour   >= 0 AND end_hour   <= 23)),

  -- Stacking
  priority                    INTEGER NOT NULL DEFAULT 0,
  stackable_with_promo        BOOLEAN NOT NULL DEFAULT false,
  stackable_with_manual       BOOLEAN NOT NULL DEFAULT true,

  -- Lifecycle
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ,

  -- Type-specific field requirements
  CONSTRAINT chk_promotion_type_fields CHECK (
    (type IN ('percentage', 'fixed_amount')
      AND discount_value IS NOT NULL AND scope IS NOT NULL)
    OR (type = 'bogo'
      AND array_length(bogo_trigger_product_ids, 1) >= 1
      AND array_length(bogo_reward_product_ids,  1) >= 1
      AND bogo_trigger_qty IS NOT NULL AND bogo_reward_qty IS NOT NULL
      AND bogo_reward_discount_pct IS NOT NULL)
    OR (type = 'free_product' AND gift_product_id IS NOT NULL)
  ),

  -- Date range valid
  CONSTRAINT chk_promotion_date_range CHECK (
    start_at IS NULL OR end_at IS NULL OR start_at < end_at
  ),

  -- Hour range valid (0-23 OK seul, ou range valide)
  CONSTRAINT chk_promotion_hour_range CHECK (
    (start_hour IS NULL AND end_hour IS NULL)
    OR (start_hour IS NOT NULL AND end_hour IS NOT NULL AND start_hour < end_hour)
  )
);

CREATE INDEX idx_promotions_active
  ON promotions(priority DESC, created_at DESC)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX idx_promotions_type
  ON promotions(type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER promotions_set_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 3.2 `promotion_applications` audit table

```sql
CREATE TABLE promotion_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id    UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  amount          DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  description     TEXT NOT NULL,                          -- snapshot ex: "Happy Hour 18-20h −10%"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, promotion_id)
);

CREATE INDEX idx_promo_apps_order ON promotion_applications(order_id);
CREATE INDEX idx_promo_apps_promo ON promotion_applications(promotion_id, created_at DESC);
```

### 3.3 `orders` — capture totaux promotion

```sql
ALTER TABLE orders
  ADD COLUMN promotion_total DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (promotion_total >= 0);

-- Pas de FK directe ; le détail est dans promotion_applications.
```

### 3.4 `order_items` — flag gift

```sql
ALTER TABLE order_items
  ADD COLUMN is_promo_gift  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN promotion_id   UUID REFERENCES promotions(id) ON DELETE SET NULL;

CREATE INDEX idx_order_items_promo_gift
  ON order_items(promotion_id)
  WHERE is_promo_gift = true;
```

### 3.5 RLS

```sql
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON promotions FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON promotions FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'promotions.create'));
CREATE POLICY "perm_update" ON promotions FOR UPDATE
  USING (has_permission(auth.uid(), 'promotions.update'));
CREATE POLICY "perm_delete" ON promotions FOR UPDATE   -- soft delete = UPDATE deleted_at
  USING (has_permission(auth.uid(), 'promotions.delete'));

ALTER TABLE promotion_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON promotion_applications FOR SELECT
  USING (is_authenticated());
-- Pas de policy INSERT — seul les RPCs SECURITY DEFINER (complete_order/pay_existing) écrivent
```

### 3.6 RPC v7 / v4 — extension

`complete_order_with_payment` v7 ajoute :
- Param `p_promotions JSONB` — array of `{promotion_id, amount, description, scope_line_id?}`. NULL/empty → no promotions
- Validation serveur : pour chaque entry, SELECT promo, RAISE check_violation si !is_active OR deleted_at OR conditions fail (re-eval matchDateRange/matchHour/matchDay/matchMinTotal/matchCustomer)
- INSERT `promotion_applications` rows
- Set `orders.promotion_total = SUM(amount)`
- `v_total = v_items_total - v_redemption_amount - p_discount_amount - v_promotion_total`
- `v_tax_amount` recomputé sur `v_total`
- Free-product gift items déjà présents dans `p_items` avec `is_promo_gift=true` + `promotion_id` ; INSERT order_items les passe-through

```sql
-- Squelette v7 (extension v6)
DO $drop$ ... DROP FUNCTION pattern ... END $drop$;

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  -- ... params v6 inchangés ...
  p_promotions             JSONB             DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_promo                  JSONB;
  v_promotion_total        DECIMAL(14,2) := 0;
  v_promotion_id           UUID;
  v_promo_amount           DECIMAL(14,2);
  v_promo_record           promotions;
  -- ... v6 declarations ...
BEGIN
  -- ... v6 logic jusqu'à compute v_items_total inclus ...

  -- Validate promotions server-side
  FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
    v_promotion_id := (v_promo->>'promotion_id')::UUID;
    v_promo_amount := (v_promo->>'amount')::DECIMAL(14,2);

    SELECT * INTO v_promo_record FROM promotions
      WHERE id = v_promotion_id AND is_active AND deleted_at IS NULL;
    IF v_promo_record.id IS NULL THEN
      RAISE EXCEPTION 'Promotion not found or inactive: %', v_promotion_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_promo_record.start_at IS NOT NULL AND v_promo_record.start_at > now() THEN
      RAISE EXCEPTION 'Promotion not yet active: %', v_promo_record.slug
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_promo_record.end_at IS NOT NULL AND v_promo_record.end_at < now() THEN
      RAISE EXCEPTION 'Promotion expired: %', v_promo_record.slug
        USING ERRCODE = 'check_violation';
    END IF;

    -- Day-of-week (0=Mon..6=Sun)
    IF (v_promo_record.day_of_week_mask & (1 << (EXTRACT(ISODOW FROM now())::INT - 1))) = 0 THEN
      RAISE EXCEPTION 'Promotion not valid this day: %', v_promo_record.slug
        USING ERRCODE = 'check_violation';
    END IF;

    -- Hour range
    IF v_promo_record.start_hour IS NOT NULL THEN
      IF EXTRACT(HOUR FROM now())::INT < v_promo_record.start_hour
         OR EXTRACT(HOUR FROM now())::INT >= v_promo_record.end_hour THEN
        RAISE EXCEPTION 'Promotion not valid this hour: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Min items total
    IF v_items_total < v_promo_record.min_items_total THEN
      RAISE EXCEPTION 'Promotion min total not met: % (required %)',
        v_promo_record.slug, v_promo_record.min_items_total
        USING ERRCODE = 'check_violation';
    END IF;

    -- Customer category / tier (if specified)
    IF array_length(v_promo_record.customer_category_ids, 1) > 0 THEN
      IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Promotion requires customer: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
      -- ... (customer.category_id IN (v_promo_record.customer_category_ids))
    END IF;

    v_promotion_total := v_promotion_total + v_promo_amount;
  END LOOP;

  v_total := v_items_total - v_redemption_amount - p_discount_amount - v_promotion_total;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts + promotions exceed items total' USING ERRCODE = 'check_violation';
  END IF;

  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  -- ... INSERT orders avec promotion_total = v_promotion_total ...

  -- INSERT promotion_applications
  FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
    INSERT INTO promotion_applications (order_id, promotion_id, amount, description)
    VALUES (
      v_order_id,
      (v_promo->>'promotion_id')::UUID,
      (v_promo->>'amount')::DECIMAL(14,2),
      v_promo->>'description'
    );
  END LOOP;

  -- ... INSERT order_items (existant v6, tag is_promo_gift + promotion_id depuis p_items)

  -- ... reste v6 (loyalty, payment, audit_log, RETURN)
END $$;
```

`pay_existing_order` v4 ajoute la même logique au pickup.

### 3.7 Seed — perms + 2 demo promos

```sql
-- Perms
INSERT INTO permissions (code, description) VALUES
  ('promotions.read',   'View promotions'),
  ('promotions.create', 'Create promotions'),
  ('promotions.update', 'Update promotions'),
  ('promotions.delete', 'Soft-delete promotions');

-- has_permission() v3 : ADMIN/SUPER_ADMIN/MANAGER → read+create+update ; SUPER_ADMIN seul → delete
-- (refresh la fonction has_permission avec les 4 nouveaux codes)

-- Demo : Happy Hour beverage -10% 18h-20h tous jours
INSERT INTO promotions (name, slug, type, scope, discount_value, scope_category_ids,
  start_hour, end_hour, priority, stackable_with_promo, description)
SELECT 'Happy Hour Beverage', 'happy-hour-bev', 'percentage', 'category', 10,
  ARRAY[(SELECT id FROM categories WHERE slug='beverage')],
  18, 20, 100, false,
  'Happy Hour 18h-20h — 10% off all beverages';

-- Demo : Free croissant for VIP cart > 100k IDR
INSERT INTO promotions (name, slug, type, gift_product_id, gift_qty,
  min_items_total, customer_category_ids, priority, stackable_with_promo, description)
SELECT 'VIP Free Croissant', 'vip-free-croissant', 'free_product',
  (SELECT id FROM products WHERE sku='SKU-CROISSANT'), 1,
  100000, ARRAY[(SELECT id FROM customer_categories WHERE slug='vip')],
  50, true,
  'VIP customers — free croissant on orders ≥ 100,000 IDR';
```

### 3.8 Migrations à créer

```
20260511000001_init_promotions.sql                # enums + table + indexes + RLS
20260511000002_init_promotion_applications.sql    # audit table + RLS
20260511000003_extend_orders_promotion_total.sql  # ALTER orders + ALTER order_items
20260511000004_extend_complete_order_rpc_v7.sql   # RPC v6 → v7 with p_promotions
20260511000005_extend_pay_existing_order_rpc_v4.sql  # RPC v3 → v4 idem
20260511000006_seed_promotions_perms_and_demo.sql # 4 perms + has_permission v3 + 2 demo promos
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/promotions/`

```
promotions/
├── types.ts                # Promotion, PromotionType, PromotionScope, AppliedPromotion, AppliedFreeProduct
├── matchers.ts             # matchDateRange, matchDayOfWeek, matchHour, matchMinTotal, matchCustomerCategory, matchCustomerTier
├── computeAmount.ts        # per-type amount computation
├── evaluator.ts            # evaluatePromotions(cart, customer, now, catalog) → AppliedPromotion[]
├── index.ts
└── __tests__/
    ├── evaluator.test.ts
    ├── matchers.test.ts
    └── computeAmount.test.ts
```

**Types** :
```ts
export type PromotionType  = 'percentage' | 'fixed_amount' | 'bogo' | 'free_product';
export type PromotionScope = 'cart' | 'product' | 'category';

export interface Promotion {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope | null;
  discount_value: number | null;
  max_discount_amount: number | null;
  scope_product_ids: string[];
  scope_category_ids: string[];
  bogo_trigger_product_ids: string[];
  bogo_reward_product_ids: string[];
  bogo_trigger_qty: number | null;
  bogo_reward_qty: number | null;
  bogo_reward_discount_pct: number | null;
  gift_product_id: string | null;
  gift_qty: number;
  min_items_total: number;
  customer_category_ids: string[];
  customer_tier_ids: string[];
  start_at: string | null;
  end_at: string | null;
  day_of_week_mask: number;
  start_hour: number | null;
  end_hour: number | null;
  priority: number;
  stackable_with_promo: boolean;
  stackable_with_manual: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AppliedPromotion {
  promotion_id: string;
  slug: string;
  name: string;
  type: PromotionType;
  amount: number;                 // IDR positif, à soustraire du total
  description: string;            // snapshot pour audit
  scope_line_id?: string;         // si line-scoped
  gift_to_add?: { product_id: string; qty: number };  // pour free_product
}
```

**Evaluator algorithm** :
1. Filter active + non-deleted promos
2. For each, run all condition matchers — keep eligible
3. Compute amount per eligible (percentage off the right scope, fixed cap by max_discount, BOGO matching, gift)
4. Sort by `priority` desc, `created_at` desc
5. Apply with stacking : 1st always applied. Subsequent only if BOTH 1st AND current are `stackable_with_promo=true`. Manual discount cumule selon `stackable_with_manual`
6. Return AppliedPromotion[]

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `PromotionLineRow.tsx` | Cart row format `name + amount IDR (-X)` italique avec couleur muted. Props `{ applied: AppliedPromotion }` |
| `PromotionForm.tsx` | Form dynamique create/edit per type. Tabs (General / Conditions / Stacking). Zod schema dispatch par `type` |
| `PromotionTypeBadge.tsx` | Badge couleur : percentage=indigo, fixed=amber, bogo=emerald, free_product=rose |

### 4.3 POS integration `apps/pos/src/`

```
NEW features/promotions/
├── components/
│   └── PromotionsList.tsx              # display applied promos in cart panel
├── hooks/
│   ├── usePromotions.ts                # query active promotions (5min cache)
│   ├── useEvaluatePromotions.ts        # debounced evaluator runner (200ms)
│   └── usePromotionsRealtime.ts        # subscribe to promotions table changes (cache invalidate)

MODIFY:
apps/pos/src/stores/cartStore.ts                          # appliedPromotions state, runEvaluation action, autoAdd/autoRemove gift
apps/pos/src/features/cart/ActiveOrderPanel.tsx           # render PromotionsList between modifiers and discount
apps/pos/src/features/cart/CartItemRow.tsx                # render gift badge if is_promo_gift
apps/pos/src/features/payment/PaymentTerminal.tsx         # display promo lines in summary
apps/pos/src/features/payment/hooks/useCheckout.ts        # pass p_promotions to RPC v7
apps/pos/src/features/products/components/ProductCard.tsx # optional v1 : "PROMO" overlay if product_id is target of any active promo (defer if too big)
```

### 4.4 Cart auto-eval flow

À chaque `addItem`, `removeItem`, `updateQuantity`, `attachCustomer`, `detachCustomer` :
1. cartStore appelle `runEvaluation` (debounced 200ms)
2. `evaluatePromotions` retourne `AppliedPromotion[]`
3. cartStore met à jour `appliedPromotions`
4. Pour chaque `AppliedFreeProduct`, si pas déjà en cart → auto-addItem avec `is_promo_gift=true`. Pour chaque gift en cart sans promo correspondante → auto-removeItem
5. Total recomputé : `items_total - redemption - manual_discount - Σ promo.amount`

### 4.5 Backoffice integration `apps/backoffice/src/`

```
NEW pages/Promotions.tsx                # list view
NEW features/promotions/
├── components/
│   ├── PromotionListRow.tsx            # row in list
│   ├── PromotionFormModal.tsx          # create/edit modal hosting PromotionForm from @breakery/ui
│   └── PromotionDeleteConfirm.tsx
├── hooks/
│   ├── usePromotionsList.ts            # query with filters
│   ├── useCreatePromotion.ts           # mutation insert
│   ├── useUpdatePromotion.ts           # mutation update
│   └── useDeletePromotion.ts           # mutation soft-delete (UPDATE deleted_at)

MODIFY:
apps/backoffice/src/routes/backofficeRoutes.tsx           # add /backoffice/promotions
apps/backoffice/src/components/Sidebar.tsx                # add menu entry "Promotions"
```

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `matchers` | matchDateRange (in/out), matchDayOfWeek (mask 0/127/specific bits), matchHour (in/out/null=all), matchMinTotal, matchCustomerCategory (member/non-member/empty=all), matchCustomerTier |
| domain `computeAmount` | percentage cart 10% on 100000 → 10000 ; capped by max_discount_amount ; percentage product (only matching products); BOGO buy 2 get 1 50% off (20000 unit → 10000 saving); free_product → returns gift_to_add |
| domain `evaluator` | priority desc ordering ; non-stackable A wins, B skipped ; A+B both stackable → both applied ; eligibility filter chain |
| pgTAP `complete_order_v7` | Iso-comportement v6 si p_promotions=[] ; promo_total computed correctly ; promotion_applications inserted ; check_violation if promo expired/inactive at server side |
| pgTAP `pay_existing_v4` | Idem |
| pgTAP `chk_promotion_type_fields` | Insert percentage sans discount_value → check_violation ; insert bogo sans trigger ids → idem ; insert free_product sans gift → idem |
| pgTAP `RLS promotions` | Cashier read OK + create denied ; Manager create OK + delete denied ; SUPER_ADMIN delete OK |
| Vitest UI `PromotionForm` | Type switcher montre les bons champs ; Zod rejects discount_value=120 (>100%) ; submit calls onCreate avec payload structuré |
| Vitest smoke POS `happy-hour.smoke.test.tsx` | Mock now=18h Monday → tap beverage → cart shows promo line `−10%` |
| Vitest smoke POS `vip-free-gift.smoke.test.tsx` | Attach VIP customer → tap items totaling 110k → gift croissant auto-added avec qty 1 unit_price 0 ; remove items below 100k → gift auto-removed |
| Vitest smoke POS `bogo.smoke.test.tsx` | BOGO (buy 2 croissants get 1 free) seedé → tap croissant 3x → 1 line à 100% off displayed |
| Vitest smoke POS `stacking.smoke.test.tsx` | 2 promos non-stackable → seul priority highest appliquée ; 2 stackable → both appliquées |
| Vitest smoke backoffice `promotions-crud.smoke.test.tsx` | Login MANAGER → /backoffice/promotions → create percentage → edit → soft-delete → list reflects |

---

## 6. Critères d'acceptation session 9

- [ ] Migrations `20260511000001` → `20260511000006` passent (`supabase db reset` clean)
- [ ] Seed insère 4 nouvelles permissions + 2 demo promos (Happy Hour Beverage 18-20h, VIP Free Croissant ≥100k)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` ≥ 580+ tests passent (≥40 nouveaux session 9)
- [ ] **POS Happy Hour** : mock now=18h30 Monday → tap Americano (beverage retail 35000) → cart shows `Americano 35,000` + `Happy Hour Beverage −3,500` line, total 31,500 → checkout cash → DB `orders.promotion_total = 3500` + 1 row `promotion_applications` snapshot description
- [ ] **POS Free Gift VIP** : attach VIP → tap items 110k → cart auto-add `Croissant ×1 @ 0` with PROMO badge → checkout → DB `order_items` row `is_promo_gift=true`, `promotion_id` set, `unit_price=0`
- [ ] **POS Free Gift removal** : retirer un item passe sous 100k → toast "Free croissant removed (condition no longer met)" → cart line gift removed
- [ ] **POS Stacking** : seeded 2 promos non-stackable simultanément applicables → seul le `priority` highest s'applique
- [ ] **POS Stacking + manual** : promo `stackable_with_manual=true` + manual cart discount 10% → both appliqués (in NET: items - manual - promo)
- [ ] **POS Server validation** : pseudo "promo expirée" — client cache promo encore active mais DB end_at déjà passé → checkout RAISE `check_violation: Promotion expired: <slug>` → POS toast erreur, pas de checkout
- [ ] **DB iso-comportement v7 vs v6** : pgTAP test (3-items checkout sans promotions) → output strictly identical to v6 ground truth
- [ ] **Backoffice CRUD** : login MANAGER → /backoffice/promotions list → create percentage cart 5% min_total 50k → list montre nouvelle promo "active" → toggle Inactive → list montre inactive → SUPER_ADMIN soft-delete → list filtré "non-supprimé" ne la montre plus
- [ ] **Backoffice RBAC denial** : login CASHIER → tente d'accéder /backoffice/promotions → redirect dashboard (pas de menu, route protégée)

---

## 7. Risques et garde-fous

| Risque | Mitigation |
|---|---|
| **Server re-eval drift** : le client a peut-être evalué à 17h59:50 et le checkout arrive à 18h00:05 (Happy Hour vient de finir) | RPC v7 fail avec check_violation, POS toast user "Promotion expired during checkout, please retry". Acceptable — edge case rare en POS où checkout est instantané |
| **Free product gift et stock** : gift consomme du stock comme un item normal | RPC v7 stock-check inclut les gifts (déjà via le main loop) — si stock insuffisant pour le gift, RAISE P0002. Acceptable, message UI toaste. Promo non-appliquée alors |
| **Bogo qty matching** : 5 croissants achetés, BOGO buy 2 get 1 → ratio 5/2 = 2 free, mais reward_qty=1 → ambigu | Décision : v1, **applique BOGO autant de fois que les triggers permettent** (min(floor(trigger_count/trigger_qty), available_reward_count)). Document en code, edge case déférable session 11 si confusion |
| **Promotion_id FK avec ON DELETE RESTRICT** : impossible de hard-delete une promo référencée | Volontaire — soft-delete only (UPDATE deleted_at). Hard-delete jamais |
| **Promo + customer attach après items** : user adds 5 items, then attach VIP customer triggering Free Gift promo | Re-eval doit se faire sur attachCustomer aussi. Couvert par P13 |
| **Tax recompute** : recalcule sur post-promo total — différent de session 6 où tax était sur post-discount-pre-redemption | Documenté dans P5 et P16. Aligné PB1 tax-inclusive : tax = round_idr(final_total * 0.10 / 1.10) |
| **Realtime cache invalidation** : un manager update une promo → POS cache stale | `usePromotionsRealtime` subscribe Postgres changes channel + invalidate react-query cache. Reconnect si déconnexion (built-in supabase-js) |
| **Gift product retiré accidentellement** : user remove gift line → recalcul → si conditions encore met, gift réajouté immédiatement (loop) | Cart store : track `dismissedGiftPromotionIds` Set. Si user remove gift, ajoute à set, re-eval skippe ce promo_id. Reset à clearCart |

---

## 8. Roadmap session 10+

| Session | Module |
|---|---|
| 10 | Split payment (multi-method same order) + refund/void (manager-PIN cancel item après send + post-checkout refund) |
| 11 | Backoffice CRUD étendu (products + categories + suppliers + customers + customer_categories + tables + combos + discounts CRUD complet) — promotions CRUD est déjà en session 9 |
| 12 | Customer display (deuxième écran) + QR scan loyalty + recipes/BOM tracking |
| 13 | B2B customers + credit + invoicing |
| 14 | Reports v1 (sales by day/week, promo effectiveness, top products, employee performance) |
| 15 | Settings (business_config CRUD, tax rate, hours, holidays) + idle PIN re-prompt + hub-printing |
| 16+ | Coupons / promo codes nominatifs, multi-tier promotions, A/B tests, etc. |
