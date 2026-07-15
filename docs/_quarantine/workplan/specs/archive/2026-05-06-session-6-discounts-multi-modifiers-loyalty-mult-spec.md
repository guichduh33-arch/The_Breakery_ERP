# The Breakery — Session 6 Spec : Discounts + Multi-select Modifiers + Loyalty Multipliers

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Voir aussi** pour la spec complète (4 parties) :
> - Discounts (manuels + engine) → [`../../reference/04-modules/13-promotions-discounts.md`](../../../reference/04-modules/13-promotions-discounts.md)
> - Loyalty multipliers & tiers → [`../../reference/04-modules/08-customers-loyalty.md`](../../../reference/04-modules/08-customers-loyalty.md)
> - Multi-select modifiers → [`../../reference/04-modules/05-products-categories.md`](../../../reference/04-modules/05-products-categories.md)

> **Date** : 2026-05-06
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter les discounts manuels (cart-level + line-level avec manager-PIN), supporter les modifier groups multi-select (toppings…), et appliquer le multiplier de tier loyalty au earn rate.

---

## 0. Contexte

Session 5 a livré tablet ordering vertical (waiter PIN, separate cart, Realtime inbox, pickup → pay_existing_order).
Session 6 ajoute :
- **Discounts manuels** : cashier saisit % ou montant fixe en cart-level OU line-level. Au-delà d'un seuil (10% v1), manager-PIN requis. Reason text obligatoire. JE en NET method (sales credités post-discount, `orders.discount_amount` capturé pour reporting)
- **Multi-select modifiers** : extension session 2 — `product_modifiers.group_type='multi_select'` était en schéma mais inutilisé. ModifierModal supporte les checkboxes (sélection multiple) sur ces groupes
- **Loyalty multipliers** : extension session 3 — TIERS Silver 1.05x, Gold 1.1x, Platinum 1.2x appliqués au earn rate. `earnPointsFor(amount, tier)` = `Math.floor(amount × multiplier / 1000)`

Cette session **ne touche pas** :
- Customer categories pricing (retail/wholesale/discount/custom) — session 7
- Combos (`products.product_type='combo'` + `combo_items`) — session 7
- Promotions engine auto-évalué (BOGO, %off catégorie) — session 8
- Split payment / refund / void — session 9
- Backoffice CRUD discounts — session 10+

## 1. Décisions actées (12 points)

| # | Décision | Choix |
|---|---|---|
| **D1** | Discount scope | **Cart-level** (1 discount sur le total) **+ line-level** (1 discount par item). Cumulables |
| **D2** | Discount type | **percentage** (0-100%) OR **fixed_amount** IDR. Pas mix dans la même couche |
| **D3** | Manager-PIN threshold | Si `discount_amount / items_total > 0.10` (10%) en cart-level OU `> 0.10` en line-level → **manager-PIN required**. Hardcoded v1 (settings table = session 10+) |
| **D4** | Manager-PIN check | Réutilise `auth-verify-pin` EF avec param `required_permission='sales.discount'`. EF retourne `verified_user_id` si OK. Permission code `sales.discount` à seeder |
| **D5** | Reason required | Text input obligatoire `>= 5 chars` quand discount appliqué. Stored `orders.discount_reason` ou `order_items.discount_reason` |
| **D6** | JE method | **NET method** (Sales credités post-discount). Pas de JE line séparée pour discount. `orders.discount_amount` capturé pour analytical reports. Math : `total = items_total - redemption - manual_discount` |
| **D7** | Discount stacking | **Manual discount + loyalty redemption cumulables**. Manual discount appliqué APRÈS redemption (sur `items_total - redemption`). Earn calculé sur `total` final |
| **D8** | Cart discount UX | Bouton "Discount" dans cart panel → ouvre `DiscountModal`. Saisie type (% / amount) + valeur + reason. Si > seuil → trigger `PinVerificationModal` avant confirm |
| **M1** | Multi-select group_type | Le schéma session 2 a déjà l'enum `('single_select', 'multi_select')`. v1 active la branche multi_select dans `ModifierModal` (UI) + `validateSelections` (domain) |
| **M2** | Multi-select UI | Boutons checkboxes (au lieu de radio). Multiple options par groupe sélectionnables simultanément. `group_required=true` impose ≥ 1 sélection |
| **M3** | Multi-select pricing | `Σ price_adjustment` de toutes options sélectionnées dans le groupe (au lieu d'1 seule en single_select) |
| **L1** | Loyalty earn multiplier | `tier.points_multiplier` appliqué au earn : `floor(amount × multiplier / 1000)`. Bronze 1.0, Silver 1.05, Gold 1.1, Platinum 1.2 |
| **L2** | Multiplier appliqué dans RPC | `complete_order_with_payment` v5 + `pay_existing_order` v2 — `v_points_earned = FLOOR(v_total × tier_multiplier / 1000)`. Tier déterminé par `lifetime_points` du customer post-update |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | tout via Supabase + Zustand existants |
| Domain `packages/domain/src/discounts/` | calcul + validation manual discount |
| UI `packages/ui/src/components/DiscountModal.tsx` | modal cart-level / line-level discount |
| UI `packages/ui/src/components/PinVerificationModal.tsx` | reusable PIN re-verify modal (réutilisé futures sessions) |

---

## 3. Schéma DB — additions

### 3.1 Modifications sur tables existantes

```sql
-- orders : cart-level discount
ALTER TABLE orders
  ADD COLUMN discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN discount_type     TEXT
    CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed_amount')),
  ADD COLUMN discount_value    DECIMAL(14,2)        -- valeur saisie (ex: 10 si percentage, 5000 si fixed_amount)
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN discount_reason   TEXT,
  ADD COLUMN discount_authorized_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

-- order_items : line-level discount
ALTER TABLE order_items
  ADD COLUMN discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN discount_type     TEXT
    CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed_amount')),
  ADD COLUMN discount_value    DECIMAL(14,2)
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN discount_reason   TEXT;
```

### 3.2 Permission `sales.discount`

```sql
INSERT INTO permissions (code, name, description) VALUES
  ('sales.discount', 'Authorize discount', 'Manager can verify discounts beyond threshold')
ON CONFLICT (code) DO NOTHING;

-- Manager role gains sales.discount (assume manager role exists from session 1)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.slug = 'manager' AND p.code = 'sales.discount'
ON CONFLICT DO NOTHING;
```

### 3.3 Loyalty tiers — ajout `points_multiplier`

```sql
-- v1 garde TIERS en TS constant (pas de table loyalty_tiers DB).
-- Le multiplier vient des constants TS dans @breakery/domain/loyalty/tiers.ts.
-- DB-side il sera passé en paramètre RPC.
-- Pas de migration DB ici. Le RPC signature change pour accepter le multiplier.
```

### 3.4 Extension RPC `complete_order_with_payment` v5

Signature étendue avec discount params + tier_multiplier (computé côté client) :

```sql
CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,                -- chaque item peut avoir discount_amount/type/value/reason
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
  p_loyalty_multiplier      DECIMAL(4,2) DEFAULT 1.0
) RETURNS UUID AS $$
DECLARE
  v_order_id            UUID;
  v_items_total         DECIMAL(14,2);
  v_redemption          DECIMAL(14,2) := 0;
  v_total               DECIMAL(14,2);
  v_tax                 DECIMAL(14,2);
  v_points_earned       INTEGER := 0;
BEGIN
  -- (idempotency check, customer guard, redemption multiples-of-100 — inchangés v3/v4)

  -- INSERT order_items avec discount_amount / discount_type / etc per item
  -- Compute v_items_total = Σ (line_total - line_discount_amount)
  -- v_redemption = p_loyalty_points_redeemed × 10 (rate v1)
  v_total := v_items_total - v_redemption - p_discount_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts exceed items total' USING ERRCODE = 'check_violation';
  END IF;
  v_tax := round_idr(v_total * 10/110);

  -- INSERT orders (..., discount_amount, discount_type, discount_value, discount_reason,
  --                     discount_authorized_by, table_number, ...)
  -- INSERT order_payments
  -- JE balanced :
  --   DR CASH p_payment.amount
  --   CR SALES (v_total - v_tax)
  --   CR TAX_PAYABLE v_tax
  --   IF v_redemption > 0 :
  --     DR LOYALTY_LIABILITY v_redemption
  --     CR SALE_DISCOUNT v_redemption          (memo loyalty, conservation session 3)
  -- (PAS de JE line séparée pour p_discount_amount — net method)

  -- Earn loyalty avec multiplier
  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    v_points_earned := FLOOR(v_total * p_loyalty_multiplier / 1000);
    IF v_points_earned > 0 THEN
      -- INSERT loyalty_transactions earn + UPDATE customers (lifetime + balance + spent + visit)
    END IF;
  END IF;

  RETURN v_order_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3.5 Extension RPC `pay_existing_order` v2

Mêmes params discount + multiplier ajoutés. Mirror la logique de complete_order v5 pour la finalisation. Items sont déjà inserts (par `create_tablet_order`) — discount line-level est figé au create time, mais cart-level peut être ajouté à la pickup.

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

(Note de duplication v4/v5 toujours valide — refacto helper `_finalize_order_payment` reportée à session 9+.)

### 3.6 RPC `verify_discount_authorization` (helper)

Renvoie `true` si le user authentifié a `sales.discount` permission OU si le PIN fourni correspond à un user qui l'a.

```sql
CREATE FUNCTION verify_discount_authorization(p_pin TEXT, p_user_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Si p_user_id fourni: verify via verify_user_pin (existing session 1)
  -- Si NULL: utilise auth.uid() actuel
  -- Vérifie has_permission('sales.discount')
  -- Retourne le user_id verified, sinon NULL
END $$;
```

Alternative simpler v1 : laisser le client appeler `auth-verify-pin` EF directement avec `required_permission='sales.discount'`. **Préférence v1 = pas de nouveau RPC**, on étend l'EF existant.

### 3.7 Edge Function `auth-verify-pin` extension

Add optional `required_permission` field in request body. Si présent, l'EF :
1. Vérifie le PIN (existing)
2. SELECT user_profile + role + permissions
3. Vérifie que role.permissions inclut `required_permission`
4. Retourne 200 avec `verified_user_id` OU 403 avec `permission_denied`

### 3.8 Migrations à créer

```
20260508000001_add_discount_columns.sql                   # orders + order_items discount fields
20260508000002_seed_sales_discount_permission.sql         # permission + manager role link
20260508000003_extend_complete_order_rpc_v5.sql           # RPC v5 with discount + multiplier
20260508000004_extend_pay_existing_order_rpc_v2.sql       # RPC v2 with discount + multiplier
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
discounts/
├── types.ts                   # Discount (amount, type, value, reason)
├── calculateDiscountAmount.ts # type='percentage' → base * value/100, type='fixed_amount' → value
├── validateDiscount.ts        # value range, reason required, max <= base
├── thresholdGuard.ts          # isAboveThreshold(amount, base) = amount/base > 0.10
├── index.ts
└── __tests__/

loyalty/
├── tiers.ts                   # EXTEND TIERS avec points_multiplier (Silver 1.05, Gold 1.1, Platinum 1.2)
├── earnPoints.ts              # EXTEND signature: earnPointsFor(amount, multiplier=1.0) = floor(amount*multiplier/1000)
└── __tests__/                 # ajouter cases multiplier

modifiers/
├── validateSelections.ts      # EXTEND : multi_select group_required → check at least 1 selection
└── __tests__/                 # ajouter cases multi_select

cart/
├── calculateTotals.ts         # EXTEND : sum line_discounts + apply cart_discount, total = items - redemption - cart_discount
└── __tests__/
```

`Discount` type :
```ts
export interface Discount {
  type: 'percentage' | 'fixed_amount';
  value: number;          // pct (0-100) ou IDR
  amount: number;         // calculated absolute IDR
  reason: string;         // >= 5 chars
  authorized_by?: string; // user_id si > threshold
}
```

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `DiscountModal.tsx` | full-screen modal. Header "Apply discount". Tab toggle (% / IDR). Numpad input pour valeur. Reason textarea (req >= 5 chars). Footer total preview avant/après. Bouton "Confirm" disabled si invalid. Trigger `PinVerificationModal` si `isAboveThreshold` |
| `PinVerificationModal.tsx` | reusable PIN modal (réutilisable futures sessions). Props: `{ open, onClose, requiredPermission, onVerified(userId) }`. Numpad PIN input + "Verify" button. Calls EF `auth-verify-pin` avec `required_permission`. Toast errors |
| `ModifierModal.tsx` | EXTEND : si `group.group_type === 'multi_select'` → render checkboxes. validateSelections via domain. Live total update (Σ adjustments) |

### 4.3 POS app `apps/pos/src/`

```
NEW features/discounts/
├── components/
│   ├── DiscountButton.tsx       # cart-level "Discount" CTA dans ActiveOrderPanel
│   └── LineDiscountButton.tsx   # tap-to-discount sur CartItemRow (small icon button)
└── hooks/
    ├── useApplyCartDiscount.ts  # validate + apply to cartStore.cartDiscount
    └── useApplyLineDiscount.ts  # validate + apply to specific cart item

MODIFY:
apps/pos/src/stores/cartStore.ts        # + cartDiscount: Discount | null, + items[].discount: Discount | null
                                         # setCartDiscount(d), clearCartDiscount(),
                                         # setLineDiscount(itemId, d), clearLineDiscount(itemId)
                                         # resetCartAfterCheckout clears all discounts
apps/pos/src/features/cart/CartItemRow.tsx          # show line discount badge if set, tap LineDiscountButton
apps/pos/src/features/cart/ActiveOrderPanel.tsx     # mount DiscountButton, show discount line if any
apps/pos/src/features/payment/PaymentTerminal.tsx   # show discount breakdown : items_total, manual_discount, redemption, total
apps/pos/src/features/payment/hooks/useCheckout.ts  # forward discount + multiplier to RPC
apps/pos/src/features/products/ProductTapHandler.tsx  # detect multi_select groups, open ModifierModal in multi mode
apps/pos/src/features/products/hooks/useProductModifiers.ts  # already returns groups including group_type — verify
```

### 4.4 cartStore extensions

```ts
interface CartStore {
  // ... existing fields ...
  cartDiscount: Discount | null;
  setCartDiscount: (d: Discount | null) => void;

  // line discounts already accessed via items[].discount
  setLineDiscount: (itemId: string, d: Discount | null) => void;
}
```

`CartItem.discount?: Discount` ajouté au type domain.

### 4.5 PaymentTerminal breakdown

```
Items total           IDR 35 000
Modifiers              IDR  5 000
─────────────────────
Subtotal              IDR 40 000
Loyalty redeem (-)    IDR  5 000   (200 pts)
Manual discount (-)   IDR  3 000   (10% off)
─────────────────────
Total                 IDR 32 000
Tax (PB1 incl)        IDR  2 909
─────────────────────
Net sales             IDR 29 091

Points to earn (Gold 1.1x): 35
```

### 4.6 Multi-select ModifierModal UX

- Single-select (existant) : radio-style, tap remplace la sélection précédente du groupe
- Multi-select (nouveau) : checkbox-style, tap toggle l'option (add/remove)
- Validation `group_required` sur multi_select : au moins 1 option doit être cochée. Sinon erreur visible + bouton confirm disabled

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `discounts/calculateDiscountAmount` | percentage of base, fixed_amount, 0 base, 100% pct |
| domain `discounts/validateDiscount` | value range, reason required, fixed > base → error, negative → error |
| domain `discounts/thresholdGuard` | exactly 10% → false, 11% → true, 0% → false, 0 base → false |
| domain `loyalty/earnPoints` (EXTEND) | multiplier 1.0/1.05/1.1/1.2 cases, 0 amount, large amount |
| domain `modifiers/validateSelections` (EXTEND) | multi_select 0 sélection + group_required → fail, 1 sélection OK, 3 sélections OK |
| domain `cart/calculateTotals` (EXTEND) | items + redemption + manual cart_discount, line_discounts, combinations |
| ui `DiscountModal` | type toggle, numpad input, reason validation, threshold trigger PinVerificationModal, confirm fires onConfirm |
| ui `PinVerificationModal` | PIN input, verify success → onVerified(userId), wrong PIN → toast, missing permission → toast |
| ui `ModifierModal` (EXTEND) | multi_select checkbox interaction, multiple selections, group_required guard |
| pgTAP `complete_order_with_payment_v5` | discount line + cart, JE balanced, redemption + discount cumulables, multiplier earn correct, idempotency key |
| pgTAP `pay_existing_order_v2` | discount cart-level appliqué à pickup, JE balanced, multiplier earn |
| pgTAP `auth-verify-pin` (extend) | required_permission='sales.discount' → 200 if OK, 403 if missing |
| Vitest smoke `discount.smoke.test.tsx` | flow : ajouter items → cart-level discount 15% → manager-PIN modal → verify OK → CHECKOUT → orders.discount_amount set, JE balanced |
| Vitest smoke `multi-modifier.smoke.test.tsx` | tap product avec multi_select group → modal → cocher 2 options → confirm → cart line affiche les 2 + Σ price_adjustment |
| Vitest smoke `loyalty-multiplier.smoke.test.tsx` | Gold customer (lifetime 2500) → cart 35000 → checkout → earn = floor(35000 × 1.1 / 1000) = 38 |

---

## 6. Critères d'acceptation session 6

- [ ] Migrations 20260508000001 → 20260508000004 passent
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 420+ tests passent
- [ ] Permission `sales.discount` insérée + liée au role manager
- [ ] **Discount cart 5%** : ajouter cart 35 000 → tap "Discount" → 5% percentage + reason "Promotion staff" → confirm sans manager-PIN (sous seuil) → cart total 33 250
- [ ] **Discount cart 15%** : 15% percentage → modal ferme + `PinVerificationModal` ouvre → entrer PIN manager (1234 par défaut) → verified → discount appliqué → cart total 29 750
- [ ] **Discount cart 15% mauvais PIN** : entrer mauvais PIN → toast erreur "Wrong PIN", modal reste ouverte
- [ ] **Discount line 20% sur 1 item** : tap LineDiscountButton sur item 25 000 → 20% → manager-PIN → applied → CartItemRow affiche "−20%" badge, line_total -5 000
- [ ] **Cumul** : cart-level 5% + line-level 20% sur 1 item + redeem 200 pts → total = items_total − redemption − cart_discount, math OK, JE balanced
- [ ] **DB** : `orders.discount_amount`, `discount_type='percentage'`, `discount_value=15`, `discount_reason='Promotion staff'`, `discount_authorized_by` = manager UUID
- [ ] **Multi-select modifier** : produit avec group "Toppings" multi_select required → tap → checkboxes → cocher 2 (extra cheese 5000 + bacon 8000) → confirm → CartItemRow affiche les 2 modifiers + price_adj 13 000
- [ ] **Multi-select required guard** : 0 cochés sur required group → bouton confirm disabled
- [ ] **Loyalty Gold earn** : Gold customer, cart 35 000 (no discount) → CHECKOUT → orders.loyalty_points_earned = 38 (35000×1.1/1000 floor) — was 35 sans multiplier
- [ ] **Loyalty Bronze earn** : Bronze customer, cart 35 000 → earn = 35 (multiplier 1.0)
- [ ] **JE balance** : cart 40 000 + redeem 5 000 + manual discount 3 000 → total 32 000, tax 2 909, net 29 091, DR Cash 32000, CR Sales 29091, CR Tax 2909, DR LOYALTY_LIABILITY 5000, CR SALE_DISCOUNT 5000 = balanced

---

## 7. Roadmap session 7+

| Session | Module |
|---|---|
| 7 | Customer categories (retail/wholesale/discount/custom) + Combos (`product_type='combo'` + `combo_items`) |
| 8 | Promotions engine (BOGO, percentage off, fixed amount, free product, conditions temporelles) |
| 9 | Split payment + refund/void (manager-PIN cancel item après send, partial refunds) |
| 10 | Backoffice CRUD : products + categories + suppliers + customers + tables + discounts admin |
| 11 | Customer display + QR scan loyalty |
| 12 | B2B customers + credit + invoicing |
| 13+ | Reports, settings, hub-printing, idle PIN re-prompt, ... |
