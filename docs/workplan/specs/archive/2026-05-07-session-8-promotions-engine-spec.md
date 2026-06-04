# The Breakery — Session 8 Spec : Promotions Engine

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
> **Module de référence associé** : [`../../reference/04-modules/13-promotions-discounts.md`](../../reference/04-modules/13-promotions-discounts.md).

> **Date** : 2026-05-07
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter un engine de promotions auto-évaluées (4 forms : `percentage_off`, `fixed_off`, `bogo`, `free_product`) qui matche les items du cart + customer + temps contre des règles définies en DB, et applique automatiquement la meilleure promo eligible (best-only) en parallèle des manual discounts (session 6) et redemption loyalty (session 3).

---

## 0. Contexte

Session 7 a livré customer categories pricing + combos v1 (fixed combos sans choix).
Session 8 ajoute :
- **Engine `evaluate_promotions`** : RPC Postgres qui prend les items + customer + ts, évalue toutes les promos actives selon leurs `conditions` (AND-only, 9 types), calcule le potentiel discount par promo eligible, retourne la meilleure (best-only) + ses items à auto-ajouter (free product / BOGO get-row).
- **Schéma `promotions`** : enum `promotion_action_type` + table `promotions` (action_type + JSONB conditions + JSONB action_params) + table `order_promotions` (audit cart-level/item-level avec metadata snapshot).
- **Persistance order** : `order_items.promotion_id` + `order_items.promotion_discount` + `order_items.is_free_from_promo`. `orders.promotion_total_amount`. Table `order_promotions`.
- **POS UI live preview** : RPC appelé en debounced (300 ms) sur cart change → `PromotionsSummary` dans `ActiveOrderPanel`, `PromotionBadge` sur `CartItemRow`, `FreeItemRow` pour items auto-add, breakdown enrichi dans `PaymentTerminal`.
- **Tablet** : create_tablet_order évalue + freeze les promos. `pay_existing_order` ne re-évalue pas (P10 freeze).
- **5 promos seedées** couvrant tous les action_types et tous les condition_types.

Cette session **ne touche pas** :
- CRUD admin promotions (form conditions builder) — session 10
- OR conditions (uniquement AND `{ all: [...] }` v1)
- Multi-promo stacking auto sur même item (best-only à l'item)
- Coupon codes manuels (déjà couvert par manual discount session 6)
- Promotion edits propagated to existing orders (immutable post-create)
- Reports analytics top-promos (session 13+)
- KDS modifs (le free product item est routé via category.dispatch_station existant)

---

## 1. Décisions actées (12 points)

| # | Décision | Choix |
|---|---|---|
| **P1** | Forms supportés v1 | percentage_off, fixed_off, bogo, free_product |
| **P2** | Stacking auto promos | **Best-only** (max discount client). Stackable avec manual + loyalty. Tie-break : priority DESC, created_at ASC |
| **P3** | Data model | Hybride : enum `action_type` colonne + JSONB `conditions` + JSONB `action_params` |
| **P4** | Trigger eval | Hybride : preview live (debounce 300 ms) au cart change + recompute server-side autoritaire au checkout RPC |
| **P5** | BOGO mechanic | **Lignes order_items distinctes** (qty=2 → 2 rows : 1 plein + 1 avec `is_free_from_promo=true` + `promotion_discount=prix`). v1 : `buy_qty=1, get_qty=1, get_discount_pct ∈ {50, 100}` |
| **P6** | Free product mechanic | **Auto-add au cart** par engine. RPC retourne `items_to_add[]`. POS affiche `FreeItemRow`, le row est inséré comme order_item normal au checkout |
| **P7** | Conditions v1 (9 types) | cart_total_min, product_in_cart, category_in_cart, customer_category_in, time_window, weekday_in, valid_dates, customer_in_loyalty_tier, first_order_only |
| **P8** | Combinaison conditions | **AND-only** (`{ all: [...] }`). OR → créer 2 promotions séparées |
| **P9** | Persistance order | Table dédiée `order_promotions` + `order_items.promotion_id` + `order_items.promotion_discount` + `order_items.is_free_from_promo`. `orders.promotion_total_amount` colonne plate (somme cumul). `metadata` JSONB sur `order_promotions` snapshot le `name`, `slug`, `action_type`, `action_params` au checkout time |
| **P10** | Tablet pickup | **Freeze à create time**. `pay_existing_order` lit les promos already-frozen, pas de re-évaluation |
| **P11** | CRUD admin | Out of scope v1, defer session 10. Seed-only (5 promos demo) |
| **P12** | Auto vs manual line | **Mutually exclusive sur même line**. Engine SKIP la promo auto si `order_items.discount_amount > 0` (manual line discount session 6) sur l'item ciblé |

**Stack order math** (subtotal → total final) :
1. Items + modifiers → `subtotal`
2. Auto promos (best-only) → `after_promos = subtotal − promotion_total_amount`
3. Loyalty redemption → `after_redemption = after_promos − redemption`
4. Manual discount session 6 (cart + line) → `total = after_redemption − manual_discount`
5. Earn loyalty calculé sur `total` final × tier_multiplier × category_multiplier

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | tout via Supabase RPC + JSONB + react-query existants |
| Domain `packages/domain/src/promotions/` | types + condition evaluators + action computeurs + selectBestPromotion |
| UI `packages/ui/src/components/PromotionLineRow.tsx` | row promo dans breakdown (réutilisé cart panel + payment terminal) |
| UI `packages/ui/src/components/PromotionBadge.tsx` | badge inline sur CartItemRow |
| UI `packages/ui/src/components/FreeItemRow.tsx` | variant CartItemRow pour items auto-add free/BOGO |

---

## 3. Schéma DB — additions

### 3.1 Enum `promotion_action_type`

```sql
CREATE TYPE promotion_action_type AS ENUM (
  'percentage_off',
  'fixed_off',
  'bogo',
  'free_product'
);
```

### 3.2 Table `promotions`

```sql
CREATE TABLE promotions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  action_type     promotion_action_type NOT NULL,
  action_params   JSONB NOT NULL DEFAULT '{}'::JSONB,
  conditions      JSONB NOT NULL DEFAULT '{"all": []}'::JSONB,
  priority        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CHECK (jsonb_typeof(action_params) = 'object'),
  CHECK (jsonb_typeof(conditions) = 'object'),
  CHECK (conditions ? 'all')
);

CREATE INDEX idx_promotions_active
  ON promotions(action_type)
  WHERE deleted_at IS NULL AND is_active;
```

`priority` : non-utilisé pour stacking (best-only), gardé pour tie-break si 2 promos donnent exactement le même discount → priority DESC gagne, puis created_at ASC.

### 3.3 `action_params` schemas (validation app-side)

| `action_type` | Shape `action_params` |
|---|---|
| `percentage_off` | `{ percentage: 0-100, target: 'cart' \| 'category' \| 'product', target_id?: UUID }` (target_id requis si target ∈ {category, product}) |
| `fixed_off` | `{ amount: number_idr, target: 'cart' }` (cart-level only v1) |
| `bogo` | `{ buy_product_id: UUID, buy_qty: int (=1 v1), get_qty: int (=1 v1), get_discount_pct: 0-100 }` (100 = free, 50 = half-price) |
| `free_product` | `{ product_id: UUID, qty: int }` |

### 3.4 `conditions.all` — types valides v1

```typescript
type PromotionCondition =
  | { type: 'cart_total_min'; value: number }                              // IDR
  | { type: 'product_in_cart'; product_id: string; min_qty: number }
  | { type: 'category_in_cart'; category_id: string; min_qty: number }
  | { type: 'customer_category_in'; category_ids: string[] }                // UUIDs
  | { type: 'time_window'; start: 'HH:MM'; end: 'HH:MM'; tz: 'Asia/Jakarta' }
  | { type: 'weekday_in'; days: number[] }                                  // 0=Sun..6=Sat (Postgres dow convention)
  | { type: 'valid_dates'; from: 'YYYY-MM-DD'; until: 'YYYY-MM-DD' }
  | { type: 'customer_in_loyalty_tier'; tiers: ('Bronze'|'Silver'|'Gold'|'Platinum')[] }
  | { type: 'first_order_only' };                                            // customer.lifetime_orders = 0
```

**AND-only** : toutes les conditions de l'array `all` doivent passer pour que la promo soit eligible. Pour OR, créer plusieurs promotions séparées.

### 3.5 Table `order_promotions`

```sql
CREATE TABLE order_promotions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id         UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  target               TEXT NOT NULL CHECK (target IN ('cart', 'item')),
  target_order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  discount_amount      DECIMAL(14,2) NOT NULL CHECK (discount_amount >= 0),
  free_item_added      BOOLEAN NOT NULL DEFAULT false,
  metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (target = 'cart' AND target_order_item_id IS NULL) OR
    (target = 'item' AND target_order_item_id IS NOT NULL)
  )
);

CREATE INDEX idx_order_promotions_order ON order_promotions(order_id);
CREATE INDEX idx_order_promotions_promotion ON order_promotions(promotion_id);
```

`metadata` snapshot au checkout time :

```json
{
  "name_snapshot": "Happy Hour Beverages 15% off",
  "slug_snapshot": "happy-hour-bev",
  "action_type_snapshot": "percentage_off",
  "action_params_snapshot": { "percentage": 15, "target": "category", "target_id": "..." }
}
```

### 3.6 ALTER `order_items`

```sql
ALTER TABLE order_items
  ADD COLUMN promotion_id        UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN promotion_discount  DECIMAL(14,2) NOT NULL DEFAULT 0
                                 CHECK (promotion_discount >= 0),
  ADD COLUMN is_free_from_promo  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_order_items_promotion
  ON order_items(promotion_id)
  WHERE promotion_id IS NOT NULL;
```

**Invariant cross-table P12** : `order_items.promotion_id IS NULL` quand `order_items.discount_amount > 0` (manual line discount session 6). Pas de CHECK constraint pour éviter couplage rétroactif. L'invariant est garanti par le RPC engine (skip auto si manual present) et testé en pgTAP.

### 3.7 ALTER `orders`

```sql
ALTER TABLE orders
  ADD COLUMN promotion_total_amount DECIMAL(14,2) NOT NULL DEFAULT 0
                                    CHECK (promotion_total_amount >= 0);
```

Total cumul des `order_promotions.discount_amount` pour cet order. Évite recomputing pour le breakdown PaymentTerminal + reports analytiques.

### 3.8 RPC `evaluate_promotions` (engine)

```sql
CREATE OR REPLACE FUNCTION evaluate_promotions(
  p_items          JSONB,                 -- [{product_id, qty, unit_price, modifier_total, manual_discount_amount}]
  p_customer_id    UUID DEFAULT NULL,
  p_evaluation_ts  TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  -- ...
BEGIN
  -- Returns:
  -- {
  --   "applied_promotion": {
  --     "promotion_id": uuid,
  --     "name": text,
  --     "action_type": text,
  --     "target": "cart" | "item",
  --     "target_product_id": uuid | null,
  --     "discount_amount": numeric,
  --     "items_to_add": [
  --       { "product_id": uuid, "qty": int, "unit_price": numeric,
  --         "promotion_discount": numeric, "is_free_from_promo": boolean }
  --     ]
  --   } | null,
  --   "skipped_promotions": [
  --     { "promotion_id": uuid, "reason": text }
  --   ]
  -- }
END $$;
```

**Logique pseudo-code** :

```
1. SELECT id, name, slug, action_type, action_params, conditions, priority
   FROM promotions
   WHERE deleted_at IS NULL AND is_active
   ORDER BY priority DESC, created_at ASC
2. Resolve : customer_category_id (NULL → default), tier (from lifetime_points),
            first_order (lifetime_orders = 0).
3. For each promo :
   a. Evaluate ALL conditions in promo.conditions.all (AND-logic). Each evaluator :
      - cart_total_min : Σ (item.qty × (item.unit_price + item.modifier_total) − item.manual_discount_amount) >= value
      - product_in_cart : Σ qty for matching product_id >= min_qty
      - category_in_cart : JOIN products → Σ qty for matching category_id >= min_qty
      - customer_category_in : resolved_customer_category_id IN (category_ids)
      - time_window : (p_evaluation_ts AT TZ tz)::time BETWEEN start AND end
      - weekday_in : EXTRACT(dow FROM p_evaluation_ts AT TZ Asia/Jakarta) IN (days)
      - valid_dates : DATE(p_evaluation_ts) BETWEEN from AND until
      - customer_in_loyalty_tier : resolved_customer_tier IN (tiers)
      - first_order_only : resolved_first_order = true
   b. If any condition fails → push { promotion_id, reason: 'condition_failed:<type>' } to skipped[].
   c. If ALL pass → check P12 :
      - If action_type='percentage_off' target='product' AND target_product line has manual_discount > 0 → skip
      - If action_type='percentage_off' target='category' AND ALL matching items have manual_discount > 0 → skip (best-effort : if some items free, others have manual, skip the whole promo)
      - If action_type='bogo' AND target_product line has manual_discount > 0 → skip
      - Reason : 'manual_discount_present'
   d. If pass P12 → compute potential_discount per action_type :
      - percentage_off cart : subtotal × pct/100 (rounded via round_idr)
      - percentage_off category/product : Σ matching items_subtotal × pct/100
      - fixed_off : MIN(amount, subtotal)
      - bogo : pairs = FLOOR(matching_qty / (buy_qty + get_qty)) → pairs × get_qty × unit_price × get_discount_pct/100
      - free_product : product.retail_price × qty
4. Pick promo with max(potential_discount). Tie-break : priority DESC, created_at ASC.
5. Build applied_promotion JSONB with target details + items_to_add[] for bogo/free_product.
   **Sémantique items_to_add** :
   - `split_from_existing: true` → l'item est **détaché d'une ligne existante** (BOGO). Le RPC réduit le qty de la ligne p_items source de `qty` et insère ce row séparément avec promotion_discount.
   - `split_from_existing: false` → l'item est **ajouté nouveau** au cart (free_product). Le RPC fait juste un INSERT supplémentaire.
   **Convention pricing** : `unit_price = retail_price` (PAS zéro), `promotion_discount = retail × discount_fraction`. Cela garantit que `items_total` de la RPC inclut la valeur des items ajoutés/split, et que `v_total = items_total − promotion_total_amount` retombe juste sur le prix payé.
   - bogo : items_to_add = [{ product_id: buy_product_id, qty: get_qty × pairs,
                              unit_price: buy_product.retail_price,
                              promotion_discount: round_idr(unit_price × get_discount_pct / 100),
                              is_free_from_promo: (get_discount_pct = 100),
                              split_from_existing: true }]
   - free_product : items_to_add = [{ product_id, qty,
                                      unit_price: product.retail_price,
                                      promotion_discount: product.retail_price,
                                      is_free_from_promo: true,
                                      split_from_existing: false }]
6. Return.
```

### 3.9 Extension RPC `complete_order_with_payment` v6

```sql
CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB,
  p_idempotency_key         UUID DEFAULT NULL,
  p_customer_id             UUID DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER DEFAULT 0,
  p_table_number            TEXT DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2) DEFAULT 0,
  p_discount_type           TEXT DEFAULT NULL,
  p_discount_value          DECIMAL(14,2) DEFAULT NULL,
  p_discount_reason         TEXT DEFAULT NULL,
  p_discount_authorized_by  UUID DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2) DEFAULT 1.0,
  p_evaluation_ts           TIMESTAMPTZ DEFAULT now()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_order_id            UUID;
  v_items_total         DECIMAL(14,2);
  v_redemption          DECIMAL(14,2) := 0;
  v_promo_result        JSONB;
  v_promo_total         DECIMAL(14,2) := 0;
  v_total               DECIMAL(14,2);
  v_tax                 DECIMAL(14,2);
  v_points_earned       INTEGER := 0;
  v_effective_items     JSONB;     -- p_items + items_to_add
BEGIN
  -- (idempotency, customer guard, redemption multiples-of-100 — inchangés v5)

  -- (1) Compute v_items_total from p_items (avant promo)
  -- (2) v_promo_result := evaluate_promotions(p_items, p_customer_id, p_evaluation_ts);
  -- (3) v_effective_items := p_items
  --     IF v_promo_result->'applied_promotion' IS NOT NULL :
  --       v_promo_total := (v_promo_result->'applied_promotion'->>'discount_amount')::DECIMAL;
  --       FOR each item in items_to_add[] APPEND to v_effective_items
  -- (4) v_redemption := p_loyalty_points_redeemed × 10
  -- (5) v_total := v_items_total - v_promo_total - v_redemption - p_discount_amount
  --     IF v_total < 0 → RAISE 'Discounts exceed items total' check_violation
  -- (6) v_tax := round_idr(v_total × 10/110)
  -- (7) INSERT orders (..., promotion_total_amount = v_promo_total, discount_amount, ..., table_number, ...)
  -- (8) INSERT order_items FROM v_effective_items :
  --     - Pour bogo (split_from_existing=true) : la qty source dans p_items est REDUCED de
  --       items_to_add[i].qty avant insert, et items_to_add[i] est inséré comme row séparée avec
  --       promotion_id + promotion_discount + is_free_from_promo. La row split_from_existing
  --       respecte les modifiers/notes de la source originelle (copy).
  --     - Pour free_product (split_from_existing=false) : insert NOUVEAU row order_items pour items_to_add.
  --     - Pour percentage_off / fixed_off : pas de items_to_add, target_product_id (si item-level)
  --       reçoit promotion_id + promotion_discount sur la ligne existante.
  --     - P12 : si p_items[i].manual_discount_amount > 0 → ne PAS set promotion_id sur cette ligne
  -- (9) INSERT order_promotions (1 row si target=cart, 1 row par target_order_item si target=item)
  --     metadata = jsonb_build_object('name_snapshot', ..., 'slug_snapshot', ...,
  --                                    'action_type_snapshot', ..., 'action_params_snapshot', ...)
  --     free_item_added = (action_type IN ('bogo','free_product'))
  -- (10) INSERT order_payments
  -- (11) JE balanced (NET method, cohérent session 6) :
  --      DR CASH p_payment.amount
  --      CR SALES (v_total - v_tax)
  --      CR TAX_PAYABLE v_tax
  --      IF v_redemption > 0 :
  --        DR LOYALTY_LIABILITY v_redemption
  --        CR SALE_DISCOUNT v_redemption
  --      (PAS de JE séparée pour v_promo_total ni p_discount_amount — net method)
  -- (12) Earn loyalty avec multiplier (cumul tier × category déjà session 7) :
  --      v_points_earned := FLOOR(v_total × p_loyalty_multiplier / 1000)
  -- (13) RETURN v_order_id
END $$;
```

### 3.10 Extension RPC `pay_existing_order` v3

```sql
CREATE OR REPLACE FUNCTION pay_existing_order(
  p_order_id                UUID,
  p_payment                 JSONB,
  p_customer_id             UUID DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER DEFAULT 0,
  p_idempotency_key         UUID DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2) DEFAULT 0,
  p_discount_type           TEXT DEFAULT NULL,
  p_discount_value          DECIMAL(14,2) DEFAULT NULL,
  p_discount_reason         TEXT DEFAULT NULL,
  p_discount_authorized_by  UUID DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2) DEFAULT 1.0
) RETURNS UUID
```

**P10 freeze : pas de re-évaluation des promos**. Lit les valeurs déjà persistées :
- `v_promo_total := orders.promotion_total_amount` (déjà set par `create_tablet_order`)
- Math : `v_total = v_items_total − v_promo_total − v_redemption − p_discount_amount`
- JE balanced (mêmes règles que v6 complete_order)
- Earn loyalty calculé sur v_total final

### 3.11 Extension RPC `create_tablet_order`

```sql
CREATE OR REPLACE FUNCTION create_tablet_order(
  p_session_id      UUID,
  p_table_number    TEXT,
  p_items           JSONB,
  p_customer_id     UUID DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_evaluation_ts   TIMESTAMPTZ DEFAULT now()
) RETURNS UUID
```

Logique post-INSERT order + order_items existant :
- Appelle `evaluate_promotions(p_items, p_customer_id, p_evaluation_ts)`
- Si applied_promotion :
  - APPEND items_to_add à order_items (BOGO get / free_product)
  - UPDATE order_items.promotion_id + promotion_discount + is_free_from_promo selon target
  - INSERT order_promotions row(s) avec metadata snapshot
  - UPDATE orders.promotion_total_amount

Le `pay_existing_order` lit ces valeurs au pickup sans re-évaluer (P10).

### 3.12 RLS

```sql
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_active" ON promotions FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
-- Pas de WRITE policy v1 — seed-only. RPC SECURITY DEFINER écrit indirectement via order_promotions.

ALTER TABLE order_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_promotions FOR SELECT
  USING (is_authenticated());
-- Pas de WRITE policy : insert via RPC SECURITY DEFINER uniquement.
```

### 3.13 Seed 5 promos (acceptance surface)

```sql
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
   jsonb_build_object('buy_product_id', (SELECT id FROM products WHERE sku='SKU-CROISSANT'),
                      'buy_qty', 1, 'get_qty', 1, 'get_discount_pct', 100),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'product_in_cart',
                        'product_id', (SELECT id FROM products WHERE sku='SKU-CROISSANT'),
                        'min_qty', 2)
   )), 8),

  ('Free Americano on 100k+', 'free-americano-100k', 'free_product',
   jsonb_build_object('product_id', (SELECT id FROM products WHERE sku='SKU-AMERICANO'), 'qty', 1),
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
```

### 3.14 Migrations à créer

```
20260510000001_init_promotions.sql                  # enum + table promotions + RLS + indexes
20260510000002_init_order_promotions.sql            # table order_promotions + RLS + FK + indexes
20260510000003_add_order_items_promotion_cols.sql   # ALTER order_items + ALTER orders
20260510000004_evaluate_promotions_rpc.sql          # engine RPC
20260510000005_extend_complete_order_rpc_v6.sql     # complete_order_with_payment v6 avec promos
20260510000006_extend_pay_existing_order_rpc_v3.sql # pay_existing_order v3 (lit promo frozen)
20260510000007_extend_create_tablet_order_rpc.sql   # create_tablet_order évalue + freeze promos
20260510000008_seed_5_demo_promotions.sql           # 5 promos demo
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
promotions/
├── types.ts                          # Promotion, PromotionCondition, PromotionAction, AppliedPromotion, ItemToAdd
├── conditions/
│   ├── isPromotionEligible.ts        # client-side preview helper (mirror engine, AND-logic)
│   ├── evaluators.ts                 # 9 evaluators : evaluateCartTotalMin, ...
│   └── __tests__/
├── actions/
│   ├── computePotentialDiscount.ts   # math discount par action_type
│   └── __tests__/
├── selectBestPromotion.ts            # max discount + tie-break priority/created_at
├── validateActionParams.ts           # action_type vs params shape (pre-insert future admin)
└── index.ts

cart/
├── calculateTotals.ts                # EXTEND : after_promos = subtotal − promotion_total_amount
└── __tests__/

types/
└── orderItem.ts                      # EXTEND : promotion_id, promotion_discount, is_free_from_promo
```

**Types principaux** (`packages/domain/src/promotions/types.ts`) :

```ts
export type PromotionActionType = 'percentage_off' | 'fixed_off' | 'bogo' | 'free_product';

export interface Promotion {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  action_type: PromotionActionType;
  action_params: Record<string, unknown>;
  conditions: { all: PromotionCondition[] };
  priority: number;
  is_active: boolean;
}

export type PromotionCondition =
  | { type: 'cart_total_min'; value: number }
  | { type: 'product_in_cart'; product_id: string; min_qty: number }
  | { type: 'category_in_cart'; category_id: string; min_qty: number }
  | { type: 'customer_category_in'; category_ids: string[] }
  | { type: 'time_window'; start: string; end: string; tz: string }
  | { type: 'weekday_in'; days: number[] }
  | { type: 'valid_dates'; from: string; until: string }
  | { type: 'customer_in_loyalty_tier'; tiers: ('Bronze'|'Silver'|'Gold'|'Platinum')[] }
  | { type: 'first_order_only' };

export interface AppliedPromotion {
  promotion_id: string;
  name: string;
  action_type: PromotionActionType;
  target: 'cart' | 'item';
  target_product_id: string | null;
  discount_amount: number;
  items_to_add: ItemToAdd[];
}

export interface ItemToAdd {
  product_id: string;
  qty: number;
  unit_price: number;
  promotion_discount: number;
  is_free_from_promo: boolean;
}

export interface SkippedPromotion {
  promotion_id: string;
  reason: string;
}

export interface EvaluationResult {
  applied_promotion: AppliedPromotion | null;
  skipped_promotions: SkippedPromotion[];
}
```

**Note client-side** : `isPromotionEligible` côté domain est utilisé pour **preview UX uniquement** (ex : afficher "ajoute 1 item de plus pour débloquer BOGO"). L'autoritaire reste le RPC `evaluate_promotions`. Aucune logique de calcul sécuritaire en client.

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `PromotionLineRow.tsx` | row promo dans breakdown PaymentTerminal + ActiveOrderPanel. Props : `{ name: string; discount_amount: number; subtitle?: string; className?: string }`. Icon `Tag`, name + amount IDR formaté, style `text-success-fg` |
| `PromotionBadge.tsx` | badge inline `CartItemRow` quand `item.promotion_id` set. Props : `{ promotionName: string; discountAmount: number; isFree: boolean }`. Pill `bg-success-bg text-success-fg`. `−15% Happy Hour` ou `BOGO Free` si `isFree` |
| `FreeItemRow.tsx` | variant CartItemRow pour items auto-add. Props : `{ productName: string; promotionName: string }`. Affiche product + badge `FREE` proéminent + nom promo subtitle. Pas de tap-to-modify |

### 4.3 POS app `apps/pos/src/`

```
NEW features/promotions/
├── components/
│   └── PromotionsSummary.tsx         # mini-section ActiveOrderPanel : header "Promotions" + N x PromotionLineRow
└── hooks/
    ├── usePromotions.ts               # query promotions (cached 60s, is_active+deleted_at NULL)
    ├── useEvaluatePromotionsLive.ts   # debounced 300ms RPC sur cart change. Returns EvaluationResult
    └── usePromotionsPreview.ts        # consolide eligible + applied pour UI

MODIFY:
apps/pos/src/stores/cartStore.ts
  # + appliedPromotion: AppliedPromotion | null
  # + previewItems: ItemToAdd[]      (items_to_add affichés en preview, séparés du cart.items principal)
  # setAppliedPromotion(p), clearAppliedPromotion(), setPreviewItems(items)
  # resetCartAfterCheckout clears promo + previewItems
  # addItem/removeItem/updateQty/setAttachedCustomer triggers debounced evaluate via subscribe handler

apps/pos/src/features/cart/CartItemRow.tsx
  # render <PromotionBadge> si item.promotion_id set
  # prix barré + nouveau prix quand discount item-level

apps/pos/src/features/cart/ActiveOrderPanel.tsx
  # mount <PromotionsSummary> sous items, au-dessus de manual discount section
  # render <FreeItemRow> pour chaque cartStore.previewItems

apps/pos/src/features/payment/PaymentTerminal.tsx
  # extend breakdown : ligne "Promo: <name>" entre Subtotal et Loyalty redemption
  # show "Free product included" en italique si applied_promotion has items_to_add

apps/pos/src/features/payment/hooks/useCheckout.ts
  # forward p_evaluation_ts = new Date().toISOString() au RPC complete_order_with_payment
  # NE PAS forward applied_promotion (re-eval server-side autoritaire)
```

**Live evaluation flow** :

```
addItem | removeItem | updateQty | attachCustomer | detachCustomer
  → cartStore subscribe handler
  → debounce 300ms
  → rpc.call('evaluate_promotions', {
       p_items: cartItems.map(...),
       p_customer_id: attachedCustomer?.id ?? null,
       p_evaluation_ts: new Date().toISOString()
     })
  → setAppliedPromotion(result.applied_promotion)
  → setPreviewItems(result.applied_promotion?.items_to_add ?? [])
  → UI re-render
```

### 4.4 Tablet app `apps/tablet/src/`

```
MODIFY:
apps/tablet/src/features/cart/TabletCart.tsx
  # même flow live evaluation que POS (réutilise useEvaluatePromotionsLive)

apps/tablet/src/features/cart/hooks/useTabletCheckout.ts
  # forward p_evaluation_ts = new Date().toISOString() à create_tablet_order RPC

apps/tablet/src/features/cart/components/TabletCartSummary.tsx
  # affiche <PromotionsSummary> dans le summary panel
```

Le tablet a la **même live evaluation** que POS pour preview UX. Au `submit` (create_tablet_order), le RPC freeze les promos. Au pickup côté POS, `pay_existing_order` ne re-évalue pas (P10).

### 4.5 PaymentTerminal breakdown enrichi

Best-only (P2) : **une seule** ligne `Promo: <name>` au max. Le breakdown ci-dessous illustre les 4 forms sur 4 carts différents.

**Cas A — `percentage_off` cart-level** (VIP 20% off cart, customer VIP, cart Beverages 50k) :

```
Items total                IDR  50 000
Modifiers                   IDR       0
────────────────────────
Subtotal                   IDR  50 000
Promo: VIP Birthday (-)    IDR  10 000   −20% cart
────────────────────────
After promos               IDR  40 000
Loyalty redeem (-)         IDR   2 000   ( 80 pts)
Manual discount (-)        IDR   1 900   ( 5% off)
────────────────────────
Total                      IDR  36 100
Tax (PB1 incl)             IDR   3 282
────────────────────────
Net sales                  IDR  32 818

Points to earn (Gold 1.1× × VIP 1.2×): 47
```

**Cas B — `bogo`** (BOGO Croissant, 2 Croissants à 35k chacun) :

```
Croissant                  IDR  35 000   (qty 1, paid)
Croissant [BOGO Free]      IDR  35 000 → 0   (qty 1, split, promotion_discount=35k)
────────────────────────
Subtotal                   IDR  70 000   (somme unit_price × qty avant promo)
Promo: BOGO Croissant (-)  IDR  35 000   (1 get free)
────────────────────────
After promos               IDR  35 000
Total                      IDR  35 000
```

**Cas C — `free_product`** (Free Americano on 100k+, cart 105k initial + Americano auto-ajouté) :

```
[items originaux]          IDR 105 000
Americano [FREE]           IDR  35 000 → 0   (auto-add, promotion_discount=35k)
────────────────────────
Subtotal                   IDR 140 000   (105k + 35k retail Americano)
Promo: Free Americano (-)  IDR  35 000
────────────────────────
After promos               IDR 105 000
Total                      IDR 105 000
```

**Cas D — `fixed_off`** (Spend 50k Get 5k off, cart 60k) :

```
Items total                IDR  60 000
────────────────────────
Subtotal                   IDR  60 000
Promo: Spend 50k Get 5k(-) IDR   5 000   (cart fixed)
────────────────────────
After promos               IDR  55 000
Total                      IDR  55 000
```

**Note d'implémentation uniforme** : pour les **4 forms**, l'`After promos` line subtract le `promotion_total_amount` du `Subtotal`. La cohérence math vient du fait que pour BOGO/free_product, l'`unit_price` du row split/added est `retail_price` (donc inclus dans le Subtotal), et le `promotion_discount` est appliqué via la `Promo:` line. Le PaymentTerminal n'a PAS besoin de distinguer les 4 forms pour le breakdown — il affiche toujours la même structure (Subtotal − promotion_total_amount = After promos). Les `is_free_from_promo` rows reçoivent un styling spécifique dans la liste d'items (badge FREE, prix barré).

### 4.6 KDS impact

**Aucune modification KDS v1**. Les `order_items` insérés (incluant free products auto-add) ont déjà `category_id` (via products) → routing dispatch normal via `category.dispatch_station` (session 4 KDS). Le bar voit l'Americano gratuit comme un item à préparer.

Side-effect optionnel défer : badge `FREE` dans `KitchenOrderCard` quand `is_free_from_promo=true` (out of scope v1, défer si trop long).

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `promotions/conditions/evaluators` | 9 evaluators × cas pass/fail. cart_total_min : 49999 fail, 50000 pass. time_window : 13:59 fail, 14:00 pass, 17:00 pass, 17:01 fail. weekday_in : dow conversions Postgres correctes. valid_dates : bornes inclusives. customer_category_in : NULL → default. first_order_only : 0 pass, > 0 fail |
| domain `promotions/actions/computePotentialDiscount` | percentage_off cart, percentage_off category, percentage_off product, fixed_off (+ clamp à subtotal), bogo (1 paire, 2 paires, overflow), free_product (single + multi qty) |
| domain `promotions/selectBestPromotion` | tie-break priority DESC, tie-break created_at ASC, no eligible → null, single eligible → returned |
| domain `promotions/conditions/isPromotionEligible` | AND-logic : all pass → true, 1 fail → false, empty conditions → true |
| domain `cart/calculateTotals` (EXTEND) | promo cart-level seul, promo item-level seul, promo + redemption + manual cumul, promo + manual line-level même item → manual gagne (P12) |
| ui `PromotionLineRow` | render name + amount, formatage IDR, success color |
| ui `PromotionBadge` | render percentage badge, render "FREE" si isFree, fallback no promo |
| ui `FreeItemRow` | render product + FREE pill + promo subtitle, pas de tap handler |
| pgTAP `evaluate_promotions` | 5 promos seedées, eval avec différents items/customer/ts → applied_promotion correcte. Best-only (multi-eligibles → max discount). P12 skip si manual_discount_amount > 0 sur item ciblé. customer NULL → default category resolved. Skipped reasons populated |
| pgTAP `complete_order_with_payment` v6 | promo cart appliquée → orders.promotion_total_amount set, order_promotions row inserted, JE balanced (NET method), earn computed sur v_total final. BOGO → 2 order_items rows (1 plein 1 free). free_product → 1 order_item supplémentaire is_free_from_promo=true. Idempotency. Promo + manual + redemption cumul. Math negative → check_violation |
| pgTAP `pay_existing_order` v3 | promos already-frozen lues depuis order_promotions, pas de re-eval, JE balanced |
| pgTAP `create_tablet_order` (extend) | promo evaluée + frozen au create. order_promotions rows présentes au create time. items_to_add insérés en order_items |
| Vitest smoke `promotion-percentage-cart.smoke.test.tsx` | seed promo "VIP 20% off cart" + cart 50000 + customer VIP → PaymentTerminal affiche "Promo VIP Birthday: −10000". Checkout → orders.promotion_total_amount=10000. order_promotions row target=cart |
| Vitest smoke `promotion-bogo.smoke.test.tsx` | seed BOGO Croissant + 2 Croissants → live preview "BOGO Free" → 2 order_items (1 plein 35k, 1 free promotion_discount=35k is_free_from_promo=true) |
| Vitest smoke `promotion-free-product.smoke.test.tsx` | cart 100000 → engine ajoute Americano gratuit en FreeItemRow → checkout → 1 order_item supplémentaire is_free_from_promo=true unit_price=35000 promotion_discount=35000 |
| Vitest smoke `promotion-best-only.smoke.test.tsx` | cart où Happy Hour Bev (-3k) et Spend50k (-5k) sont eligibles → engine prend Spend50k (max), Happy Hour dans skipped[] avec reason 'not_best' |
| Vitest smoke `promotion-stack-with-manual-loyalty.smoke.test.tsx` | cart 50k tous Bev (Happy Hour 15% target=category eligible) + redeem 100 pts (1k off) + manual cart 5% → ordre stack math : 50k → −7500 promo → 42500 → −1000 redemption → 41500 → −2075 manual = 39425. JE balanced |
| Vitest smoke `promotion-vs-manual-line.smoke.test.tsx` (P12) | 2 Croissants + manual line 20% sur ligne 1 → BOGO skipped. Cart shows manual badge sur ligne 1 only. order_items.promotion_id IS NULL pour les Croissants |
| Vitest smoke `promotion-customer-target.smoke.test.tsx` | VIP customer attach + cart 35000 → engine applique "VIP Birthday 20% off" (−7000). Detach → engine re-eval → promo disparaît côté UI |
| Vitest smoke `promotion-tablet-freeze.smoke.test.tsx` (P10) | tablet à 16:55 mardi create avec 2 Bev → order_promotions rows insérées avec Happy Hour. POS pickup à 17:05 → PaymentTerminal affiche promo Happy Hour, paie −15% (frozen) |
| Vitest smoke `promotion-time-out-of-window.smoke.test.tsx` | tablet à 17:05 mardi (HH expired) → pas de promo frozen → pay normal sans Happy Hour |

---

## 6. Critères d'acceptation session 8

- [ ] Migrations 20260510000001 → 20260510000008 passent
- [ ] Seed insère 5 promotions (Happy Hour Bev, Spend50k-5k, BOGO Croissant, Free Americano 100k+, VIP 20% off)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 600+ tests passent
- [ ] **POS Live preview Happy Hour** : à 14:05 mardi → ajouter Americano au cart → `PromotionsSummary` affiche "Happy Hour Beverages 15% off : −5 250" sous le cart
- [ ] **POS Live preview Happy Hour out-of-window** : à 13:59 → pas de promo affichée. À 14:00 (refetch ou re-trigger) → promo apparaît
- [ ] **POS BOGO** : 2 Croissants au cart → CartItemRow ligne 2 affiche `PromotionBadge` "BOGO Free" + prix barré → checkout → DB : 2 order_items (1 plein 35k, 1 promo_discount=35k is_free_from_promo=true), 1 order_promotions row target=item, target_order_item_id pointe la ligne free
- [ ] **POS Free product auto-add** : cart 105 000 → `FreeItemRow` "Americano FREE" affichée sous items → checkout → 1 order_item supplémentaire is_free_from_promo=true unit_price=35000 promotion_discount=35000
- [ ] **POS Best-only** : cart où Happy Hour Bev (-3k) et Spend50k (-5k) sont tous deux eligibles → engine applique Spend50k (max), `PaymentTerminal` affiche 1 seule promo (la fixed). Happy Hour dans skipped[] avec reason 'not_best'
- [ ] **POS Stack avec manual + loyalty** : cart 50k tous Bev (Happy Hour 15% target=category eligible) + redeem 100 pts (1k off) + manual cart 5% → math : 50k → −7500 → 42500 → −1000 → 41500 → −2075 = 39425. JE balanced
- [ ] **POS P12 conflict** : 2 Croissants + manual line discount 20% sur ligne 1 → BOGO skipped (engine return skipped reason 'manual_discount_present'). Cart shows manual badge sur ligne 1 only
- [ ] **POS Customer category target** : VIP customer attach + cart 35 000 → engine applique "VIP Birthday 20% off" (−7000). Detach customer → engine re-eval → promo disparaît
- [ ] **POS Customer NULL → default** : pas de customer attach → engine resolve default category (Retail) → promos ciblant Retail eligible. Promos VIP-only skipped avec reason 'condition_failed:customer_category_in'
- [ ] **Tablet freeze (P10)** : tablet à 16:55 mardi create 2 Bev → order_promotions rows insérées avec Happy Hour. POS pickup à 17:05 → `PaymentTerminal` affiche promo, paie −15% (frozen, pas de re-eval)
- [ ] **Tablet out-of-window** : tablet à 17:05 mardi → pas de promo frozen → pay normal sans Happy Hour
- [ ] **DB JE balanced complete_order v6** : cart 50k − promo 5k − redeem 1k − manual 2k = 42k payment. JE : DR Cash 42k, CR Sales (42k − tax), CR Tax_Payable (42k×10/110), DR Loyalty_Liability 1k, CR Sale_Discount 1k. Sum DR = Sum CR
- [ ] **DB constraint violations** : insert promotion avec conditions sans `all` → CHECK fails. order_items.promotion_id pointing inactive promo via update → SET NULL si delete
- [ ] **DB negative total guard** : promo + redemption + manual > items_total → complete_order RAISE 'Discounts exceed items total' check_violation

---

## 7. Roadmap session 9+

| Session | Module |
|---|---|
| 9 | Split payment + refund/void (manager-PIN cancel item après send, partial refunds) |
| 10 | Backoffice CRUD : products + categories + suppliers + customers + customer_categories + tables + combos admin + discounts admin + **promotions admin** (form conditions builder) |
| 11 | Customer display + QR scan loyalty + recipes/BOM |
| 12 | B2B customers + credit + invoicing |
| 13+ | Reports (top promos by revenue), settings, hub-printing, idle PIN re-prompt, OR conditions, multi-promo stacking auto |
