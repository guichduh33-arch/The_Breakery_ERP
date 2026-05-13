# The Breakery — Session 3 Spec : Customer + Loyalty + Receipts

> **Date** : 2026-05-05
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter l'attache customer au POS, le programme fidélité (earn / redeem) avec JE, et l'impression du reçu thermique via le print server local.

---

## 0. Contexte

Session 2 a livré modifiers + send-to-kitchen + KDS.
Session 3 ajoute :
- attache **customer** (search par phone / name, quick-create inline) sur un order POS
- **loyalty** v1 : earn 1 pt / 1 000 IDR à la complétion, redeem 100 pts = 1 000 IDR discount cart, tiers read-time
- **receipt** thermique 80 mm via `POST localhost:3001/print/receipt` (auto après cash success + bouton Reprint)

Cette session **ne touche pas** :
- `customer_categories` pricing (retail seulement en v1) — session 5 (discounts/promotions)
- B2B (`customer_type='b2b'`, credit_balance, payment_terms) — session 9
- split payment, refund/void — session 6
- loyalty QR scan — session 8 (customer display)
- Edge Function `send-to-printer` (fallback remote) — session 4
- backoffice CRUD customers — session 7
- multipliers earn (`category.points_multiplier`, `tier.points_multiplier`) — session 5

## 1. Décisions actées (12 points)

| # | Décision | Choix |
|---|---|---|
| **C1** | Customer search modal | **phone (substring) OR name (ilike)**. QR scan reporté à session 8 |
| **C2** | Customer attach scope | **Optional** — cart anonyme reste valide (sans loyalty earn) |
| **C3** | Customer DB schema | sous-ensemble V2 : `id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, created_at, updated_at, deleted_at`. `customer_type` enum mais **seul `retail` accepté en v1** |
| **C4** | Customer create | **Inline** depuis CustomerSearchModal si no-match → quick-create form (name + phone obligatoires, email optionnel). Pas de redirect backoffice |
| **L1** | Earn rate | **Fixe 1 pt / 1 000 IDR** via `FLOOR(amount / 1000)`. Multipliers reportés à session 5 |
| **L2** | Earn trigger | **Application code** après `complete_order_with_payment` success (mutation `useAddLoyaltyPoints`). Pas de SQL trigger |
| **L3** | Tier calc | **Read-time** depuis `lifetime_points`, constants TS dans `@breakery/domain/loyalty/tiers.ts`. Pas de table `loyalty_tiers` en v1 (la denormalisation `customers.loyalty_tier` n'est pas écrite) |
| **L4** | Redeem rate | **Fixe 100 pts = 1 000 IDR**. Min redeem = 100 pts (multiples de 100). Cap = solde dispo |
| **L5** | JE redemption | extension `complete_order_with_payment` : si `p_loyalty_redemption_amount > 0` → ligne supplémentaire **DR LOYALTY_LIABILITY (2210), CR SALE_DISCOUNT (4900)** dans le même JE atomique |
| **R1** | Print server | `POST http://localhost:3001/print/receipt` avec payload JSON (le serveur formate ESC/POS). 5 s timeout. Pas de Capacitor native print en v1 |
| **R2** | Print fallback | Si `/health` 2 s timeout OR `/print/receipt` fail → toast warning "Print server unreachable — receipt not printed". **L'order reste `completed`**. Pas de retry queue v1 |
| **R3** | Receipt trigger | **Auto après `payment_status='paid'` cash success**. Bouton "Reprint" sur `SuccessModal`. Drawer kick `POST /drawer/open` parallèle |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package npm — Supabase JS realtime + react-query déjà installés | print server = simple `fetch()` |
| Service `apps/pos/src/services/print/printService.ts` | wrappers typés `checkPrintServer`, `printReceipt`, `openCashDrawer` |
| Domain `packages/domain/src/loyalty/` | calculs earn / redeem / tier |
| Domain `packages/domain/src/customers/` | types Customer + CustomerSearch |

---

## 3. Schéma DB — additions

### 3.1 Nouvelle table `customers`

```sql
CREATE TYPE customer_type AS ENUM ('retail', 'b2b');
-- v1 utilise UNIQUEMENT 'retail'. 'b2b' reservé pour session 9.

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type NOT NULL DEFAULT 'retail'
                  CHECK (customer_type = 'retail'),  -- v1 guard
  loyalty_points  INTEGER NOT NULL DEFAULT 0
                  CHECK (loyalty_points >= 0),
  lifetime_points INTEGER NOT NULL DEFAULT 0
                  CHECK (lifetime_points >= 0),
  total_spent     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_visits    INTEGER NOT NULL DEFAULT 0,
  last_visit_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_customers_phone        ON customers(phone)          WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_name_trgm    ON customers USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_loyalty_pts  ON customers(loyalty_points DESC) WHERE deleted_at IS NULL AND loyalty_points > 0;

-- Ensure pg_trgm exists (likely already from session 1)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 3.2 Nouvelle table `loyalty_transactions`

Ledger immutable des points (append-only).

```sql
CREATE TYPE loyalty_txn_type AS ENUM ('earn', 'redeem', 'adjust');
-- v1 : earn (auto) + redeem (auto) + adjust (manager manuel — UI session 7)

CREATE TABLE loyalty_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
  transaction_type     loyalty_txn_type NOT NULL,
  points               INTEGER NOT NULL,            -- positif pour earn, négatif pour redeem
  points_balance_after INTEGER NOT NULL,            -- snapshot post-application
  order_amount         DECIMAL(14,2),               -- pour earn : montant qui a généré les pts
  description          TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_loyalty_txn_customer    ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_txn_order       ON loyalty_transactions(order_id) WHERE order_id IS NOT NULL;
```

### 3.3 Modifications sur tables existantes

```sql
-- orders : attache customer + redemption snapshot
ALTER TABLE orders
  ADD COLUMN customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN loyalty_points_earned    INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_earned >= 0),
  ADD COLUMN loyalty_points_redeemed  INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_redeemed >= 0),
  ADD COLUMN loyalty_redemption_amount DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (loyalty_redemption_amount >= 0);

CREATE INDEX idx_orders_customer ON orders(customer_id) WHERE customer_id IS NOT NULL;
```

### 3.4 Calcul de prix avec redemption

PB1 reste inchangée (`tax_amount = ROUND(total × 10/110)` extracted).

```
items_total              = Σ line_total (avec modifiers)        -- inchangé session 2
loyalty_redemption_amount = points_redeemed × 10                -- 100 pts → 1 000 IDR (rate fixe v1)
total                    = items_total - loyalty_redemption_amount
tax_amount               = ROUND(total × 10/110)
```

Contrainte : `total >= 0` (jamais négatif). Si `loyalty_redemption_amount > items_total` → erreur UI avant submit.

### 3.5 Extension RPC `complete_order_with_payment`

Signature étendue avec `p_customer_id` + `p_loyalty_points_redeemed` :

```sql
CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB,
  p_idempotency_key         UUID DEFAULT NULL,
  p_customer_id             UUID DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER DEFAULT 0
) RETURNS UUID AS $$
DECLARE
  v_order_id              UUID;
  v_items_total           DECIMAL(14,2);
  v_redemption_amount     DECIMAL(14,2) := 0;
  v_total                 DECIMAL(14,2);
  v_loyalty_balance       INTEGER;
  v_points_earned         INTEGER := 0;
BEGIN
  -- ... idempotency check inchangé ...

  -- v1 redeem rate fixe : 100 pts = 1 000 IDR
  IF p_loyalty_points_redeemed > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Cannot redeem points without customer attached'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_loyalty_points_redeemed % 100 <> 0 THEN
      RAISE EXCEPTION 'Points must be a multiple of 100'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT loyalty_points INTO v_loyalty_balance FROM customers WHERE id = p_customer_id;
    IF v_loyalty_balance < p_loyalty_points_redeemed THEN
      RAISE EXCEPTION 'Insufficient loyalty points (balance: %)', v_loyalty_balance
        USING ERRCODE = 'P0010';
    END IF;
    v_redemption_amount := p_loyalty_points_redeemed * 10;
  END IF;

  -- ... calcul items_total + insert order_items inchangé (session 2) ...

  v_total := v_items_total - v_redemption_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Redemption exceeds order total' USING ERRCODE = 'check_violation';
  END IF;

  -- INSERT orders (customer_id, loyalty_*, total, tax_amount, ...)
  -- INSERT order_payments
  -- UPDATE pos_session.cash_total
  -- INSERT stock_movements
  -- INSERT journal_entries lignes :
  --     DR CASH (1110) v_payment.amount
  --     CR SALES (4100) v_total
  --     CR TAX_PAYABLE (2110) tax_amount
  --     [si v_redemption_amount > 0] DR LOYALTY_LIABILITY (2210), CR SALE_DISCOUNT (4900) v_redemption_amount

  -- Decrement points
  IF p_loyalty_points_redeemed > 0 THEN
    UPDATE customers SET loyalty_points = loyalty_points - p_loyalty_points_redeemed
      WHERE id = p_customer_id;
    INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by)
    VALUES (p_customer_id, v_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || v_order_id::text, auth.uid());
  END IF;

  -- Earn (1 pt / 1 000 IDR du v_total POST-redemption — convention V2)
  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    v_points_earned := FLOOR(v_total / 1000);
    IF v_points_earned > 0 THEN
      UPDATE customers SET
        loyalty_points  = loyalty_points + v_points_earned,
        lifetime_points = lifetime_points + v_points_earned,
        total_spent     = total_spent + v_total,
        total_visits    = total_visits + 1,
        last_visit_at   = now()
      WHERE id = p_customer_id;
      INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points,
        points_balance_after, order_amount, description, created_by)
      VALUES (p_customer_id, v_order_id, 'earn', v_points_earned,
        (SELECT loyalty_points FROM customers WHERE id = p_customer_id),
        v_total, 'Earned on order ' || v_order_id::text, auth.uid());
      UPDATE orders SET loyalty_points_earned = v_points_earned WHERE id = v_order_id;
    ELSIF v_total > 0 THEN
      -- visit count even if no points earned
      UPDATE customers SET
        total_spent   = total_spent + v_total,
        total_visits  = total_visits + 1,
        last_visit_at = now()
      WHERE id = p_customer_id;
    END IF;
  END IF;

  RETURN v_order_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
```

Note d'implémentation : earn et redeem sont dans le **même** RPC atomique (pas de mutation app séparée comme V2 utilise — simplification v1). Le wrapper `useAddLoyaltyPoints` n'existe pas en v1 ; tout passe par `complete_order_with_payment`.

### 3.6 RLS additions

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON customers FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

-- Quick-create depuis POS : tout user authentifié peut créer un customer retail
CREATE POLICY "auth_insert_retail" ON customers FOR INSERT
  WITH CHECK (is_authenticated() AND customer_type = 'retail');

-- Update via RPC seulement (loyalty_points / total_spent gérés par SECURITY DEFINER)
-- Pas de policy UPDATE direct user en v1. CRUD complet = session 7

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_own_view" ON loyalty_transactions FOR SELECT
  USING (is_authenticated());
-- INSERT via SECURITY DEFINER RPC seulement
```

### 3.7 Plan comptable — ajouts

```sql
-- chart_of_accounts (créé session 1) :
INSERT INTO chart_of_accounts (code, name, type, normal_side) VALUES
  ('2210', 'Loyalty Liability', 'liability', 'credit'),
  ('4900', 'Sales Discounts',   'revenue',   'debit')
ON CONFLICT (code) DO NOTHING;
```

### 3.8 Seed — customers de démo

```sql
INSERT INTO customers (name, phone, loyalty_points, lifetime_points) VALUES
  ('Walk-in Demo',          '+62811111111',   0,    0),
  ('Loyal Bronze Customer', '+62822222222',  120,  120),
  ('Loyal Gold Customer',   '+62833333333', 2500, 2500);
```

### 3.9 Migrations à créer

```
20260505010001_init_customers.sql              # customers + RLS + index
20260505010002_init_loyalty_transactions.sql   # loyalty_transactions + RLS + index
20260505010003_extend_orders_loyalty.sql       # orders.customer_id + loyalty_* fields
20260505010004_extend_complete_order_rpc.sql   # RPC v3 (modifiers + customer + loyalty)
20260505010005_seed_loyalty_accounts.sql       # plan comptable 2210 + 4900
20260505010006_seed_demo_customers.sql         # ou inline dans seed.sql
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
customers/
├── types.ts              # Customer, CustomerSearchResult
└── index.ts

loyalty/
├── types.ts              # LoyaltyTier, LoyaltyTxnType
├── tiers.ts              # TIERS constant + tierFromLifetime(pts) → LoyaltyTier
├── earnPoints.ts         # earnPointsFor(amount) = floor(amount/1000)
├── redeemValue.ts        # pointsToValue(pts) = pts * 10
├── validateRedeem.ts     # validate(pts, balance, items_total) → ValidationError[]
├── index.ts
└── __tests__/
```

Constants :
```ts
export const POINTS_PER_AMOUNT = 1000;     // 1 pt / 1 000 IDR
export const REDEMPTION_RATE   = 10;       // 100 pts → 1 000 IDR
export const MIN_REDEEM        = 100;      // multiples de 100 obligatoires
export const TIERS = [
  { tier: 'bronze',   min: 0,    discount: 0,  label: 'Bronze'   },
  { tier: 'silver',   min: 500,  discount: 5,  label: 'Silver'   },
  { tier: 'gold',     min: 2000, discount: 8,  label: 'Gold'     },
  { tier: 'platinum', min: 5000, discount: 10, label: 'Platinum' },
] as const;
```

Note : `discount` est exposé pour future session 5 (multipliers) — **pas appliqué en v1**.

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `CustomerSearchModal.tsx` | full-screen modal, input phone/name, debounced query, list de cards (CustomerCard inline), bouton "+ New customer" en bas → switch vers QuickCreateForm |
| `LoyaltyBadge.tsx` | pill avec tier (Bronze/Silver/Gold/Platinum) + couleur + points (font-mono) |
| `RedeemPointsModal.tsx` | numpad pour saisir pts à redeem, validation min/multiples, affiche conversion IDR + nouveau total |

### 4.3 POS app `apps/pos/src/features/`

```
customers/
├── components/
│   ├── CustomerAttachButton.tsx       # button "Attach customer" dans cart panel
│   ├── CustomerAttachedBadge.tsx      # affiche customer attaché + bouton "Detach"
│   └── QuickCreateCustomerForm.tsx
├── hooks/
│   ├── useCustomerSearch.ts           # tanstack query, debounced 300ms
│   └── useCreateCustomer.ts           # mutation INSERT + invalidation
loyalty/
├── components/
│   ├── LoyaltyPointsLine.tsx          # ligne dans cart "Points to earn: 35"
│   └── RedeemButton.tsx               # bouton "Redeem points" si customer attaché ET balance >= 100
└── hooks/
    └── (rien — earn/redeem sont dans le RPC complete_order_with_payment)
print/
└── services/
    └── printService.ts                # checkPrintServer + printReceipt + openCashDrawer
```

### 4.4 Stores Zustand — extensions

```
apps/pos/src/stores/
├── cartStore.ts          # + customerId, attachCustomer, detachCustomer,
│                         #   loyaltyPointsToRedeem, setRedeemPoints, redemptionAmount (computed)
└── (no new store)
```

### 4.5 PaymentTerminal / SuccessModal extensions

- `PaymentTerminal.tsx` : si `cartStore.customerId` set, affiche `LoyaltyBadge` + `Points to earn: N`. Si `redemptionAmount > 0`, ligne discount visible
- `SuccessModal.tsx` : après cash success, **auto-call printService.printReceipt(orderData)**. Bouton "Reprint" + "Open drawer"

### 4.6 Receipt payload (POST localhost:3001/print/receipt)

```ts
interface ReceiptPayload {
  business: { name: string; address: string; phone?: string; tax_id?: string };
  order: {
    order_number: string;
    created_at: string;          // ISO
    cashier_name: string;
    order_type: 'dine_in' | 'take_out';
  };
  customer?: { name: string; loyalty_tier?: string };
  items: Array<{
    name: string;
    quantity: number;
    unit_price: number;
    modifiers?: Array<{ label: string; price_adjustment: number }>;
    line_total: number;
  }>;
  totals: {
    items_total: number;
    redemption_amount: number;   // 0 si pas de redeem
    total: number;
    tax_amount: number;          // PB1 incluse-extracted
  };
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  loyalty?: { points_earned: number; balance_after: number };
  footer?: string;               // "Thank you!" etc.
}
```

Côté serveur (out of repo) : un Express daemon expose `/print/receipt`, formate ESC/POS, envoie au TCP printer 192.168.1.x:9100. Ce repo ne fournit pas le serveur — voir doc V2 `05-integrations/06-print-server.md`.

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `loyalty/earnPoints` | floor(amount/1000), 0 if amount<1000, large numbers |
| domain `loyalty/redeemValue` | pts × 10 |
| domain `loyalty/validateRedeem` | ok / not multiple of 100 / exceeds balance / exceeds items_total / customer required |
| domain `loyalty/tiers` | bronze at 0/499, silver at 500/1999, gold at 2000/4999, platinum at 5000+ |
| ui `CustomerSearchModal` | query debounce, no-match → quick-create form, select customer fires onSelect |
| ui `RedeemPointsModal` | numpad input, validation errors, conversion IDR live update |
| ui `LoyaltyBadge` | rendering correct color per tier |
| pgTAP `complete_order_with_payment_v3` | order with customer earns FLOOR(total/1000), order without customer earns 0, redeem reduces total + creates JE LOYALTY_LIABILITY/SALE_DISCOUNT, insufficient points raises P0010, multiple-of-100 guard, idempotency key still works |
| EF `process-payment` | accepts customer_id + loyalty_points_redeemed in payload, propagates to RPC |
| Vitest smoke `apps/pos/__tests__/loyalty.smoke.test.tsx` | golden path : login → cart → attach customer → checkout cash → points earned visible in cart history (mocked Supabase) |
| Vitest smoke `apps/pos/__tests__/print.smoke.test.tsx` | mock fetch on localhost:3001/print/receipt, vérifier payload shape, fail path → toast warning, order still completed |

---

## 6. Critères d'acceptation session 3

- [ ] Migrations 010001 → 010006 passent sans erreur
- [ ] Seed insère 3 demo customers (Walk-in 0pts, Bronze 120pts, Gold 2500pts)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 200+ tests passent (couverture domain ≥ 90%)
- [ ] **POS** : tap "Attach customer" → `CustomerSearchModal` s'ouvre, taper "62833" → "Loyal Gold Customer" apparaît
- [ ] **POS** : sélection → cart affiche `LoyaltyBadge Gold · 2500 pts` + ligne "Points to earn: 35" (sur cart 35000 IDR)
- [ ] **POS** : tap "Redeem points" → `RedeemPointsModal`, saisir 500 → conversion 5 000 IDR affichée → confirm
- [ ] **POS** : cart total passe de 35000 à 30000, ligne discount visible "−5 000 (500 pts)"
- [ ] **POS** : CHECKOUT cash 30 000 → success
- [ ] **DB** : `orders.customer_id`, `loyalty_points_earned=30` (FLOOR(30000/1000)), `loyalty_points_redeemed=500`, `loyalty_redemption_amount=5000`
- [ ] **DB** : `customers.loyalty_points` Gold passe 2500 → 2030 (2500 - 500 + 30)
- [ ] **DB** : `customers.lifetime_points` passe 2500 → 2530 (earn ne décrémente pas)
- [ ] **DB** : 2 lignes `loyalty_transactions` créées (1 redeem -500, 1 earn +30) avec `order_id` lié
- [ ] **DB** : `journal_entries` balanced, lignes : DR CASH 30 000 / CR SALES 30 000 (post-redeem) / DR LOYALTY_LIABILITY 5 000 / CR SALE_DISCOUNT 5 000 / + tax PB1
- [ ] **Print** : print server local en marche → reçu imprimé auto avec items + customer + loyalty earned
- [ ] **Print** : print server down → toast warning rouge "Print server unreachable", order **reste completed**, bouton Reprint disponible
- [ ] Anonymous order (no customer) : earn = 0, pas de loyalty_transactions, total inchangé
- [ ] Tentative redeem sans customer attaché → bouton "Redeem points" disabled
- [ ] Tentative redeem 99 pts → erreur UI "Multiples of 100 only"

---

## 7. Roadmap session 4+

(reprend la spec parent §11, modulo session 3 livrée)

| Session | Module |
|---|---|
| 4 | Held orders + floor plan + tablet ordering (item served) |
| 5 | Discounts + promotions + combos (multi-select modifiers + loyalty multipliers + customer_categories) |
| 6 | Split payment + refund/void (cancel item après send avec manager-PIN) |
| 7 | Backoffice products CRUD + categories + suppliers + customers CRUD (modifier override per-product) |
| 8 | Customer display + QR scan loyalty |
| 9 | B2B customers + credit + invoicing |
| ... | (idem spec parent) |
