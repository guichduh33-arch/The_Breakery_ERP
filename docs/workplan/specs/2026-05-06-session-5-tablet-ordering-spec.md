# The Breakery — Session 5 Spec : Tablet Ordering

> **Date** : 2026-05-06
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter une route `/tablet/*` avec un order capture surface dédié waiter, un store cart séparé, et un flow `tablet send → POS pickup → cashier payment` orchestré par Supabase Realtime.

---

## 0. Contexte

Session 4 a livré held orders + floor plan + item served.
Session 5 ajoute :
- **Tablet routes** : `/tablet/order` (capture) + `/tablet/orders` (history des orders envoyés par ce waiter, read-only)
- **Tablet layout** : PIN waiter gate (réutilise auth flow session 1)
- **Tablet cart store** séparé du `cartStore` POS — items + modifiers + tableNumber + orderType seulement
- **Order propagation** : Supabase Realtime sur `orders` (pas de LAN — reporté session 15)
- **POS hub inbox** : modal "Tablet Orders" avec compte badge, liste pending_payment, action "Pickup" qui charge l'order dans cartStore pour paiement
- **3 nouveaux RPCs atomiques** : `create_tablet_order`, `pickup_tablet_order`, `pay_existing_order`

Cette session **ne touche pas** :
- LAN architecture (BroadcastChannel, hub-client) — session 15
- Customer attach + loyalty sur tablet — possible session ultérieure
- Notes per item sur tablet — defer
- Capacitor native build / kiosk mode — defer
- Tablet PIN re-prompt sur idle — defer
- Status follow-up KDS → tablet toast (waiter notified item ready) — **inclus en v1** : Realtime subscription côté tablet sur ses orders envoyés (toast côté tablet)

## 1. Décisions actées (15 points)

| # | Décision | Choix |
|---|---|---|
| **A1** | Tablet auth | Reuse `auth-verify-pin` EF + `authStore` (sessionStorage). Pas de duplication |
| **A2** | Tablet gate | `TabletLayout` PIN modal sur mount. Si déjà authentifié comme waiter → skip |
| **A3** | Waiter role | Nouveau seed user "Waiter Demo" (PIN 5678) avec role `waiter` (perm: `sales.create` uniquement, pas `payments.process` ni `pos.access`) |
| **A4** | Tablet vs POS access | `/tablet/*` requiert `sales.create`. `/pos` requiert `pos.access` (cashier+) |
| **R1** | Routes | `/tablet/order` + `/tablet/orders` dans apps/pos. POS routes inchangées |
| **R2** | Auto-redirect | Si waiter login PIN → redirect vers `/tablet/order` au lieu de `/pos`. Si cashier → `/pos` |
| **C1** | `tabletCartStore` | Zustand store distinct du `cartStore`. Pas de persist (cart éphémère par session de capture) |
| **C2** | tablet cart features | items (avec modifiers via `ModifierModal` existant) + tableNumber + orderType (`dine_in` / `take_out`). **Pas** de customer/loyalty/redeem/holds en v1 |
| **C3** | Items dedup | merge même `product_id + signature(modifiers)`. Notes per-item = defer |
| **O1** | Propagation tablet → POS | **Supabase Realtime** sur `orders` filter `created_via='tablet' AND status='pending_payment'`. Pas de LAN |
| **O2** | `created_via` column | Nouvelle colonne `orders.created_via TEXT NOT NULL DEFAULT 'pos'`. Values v1 : `'pos'` ou `'tablet'`. CHECK constraint |
| **O3** | `pending_payment` status | extend enum `order_status` avec `'pending_payment'`. Lifecycle : `pending_payment → draft (pickup) → paid (cashier)` ou `pending_payment → voided` (cancel tablet) |
| **O4** | `create_tablet_order` RPC | atomic INSERT orders (status=pending_payment, created_via='tablet', waiter_id, table_number) + INSERT order_items (is_locked=true, sent_to_kitchen_at=now(), dispatch_station, modifiers JSONB). Pas de payment, pas de JE, pas de stock movement |
| **O5** | KDS visibility tablet items | items lockés et envoyés cuisine immédiatement (déjà supporté session 2 par dispatch_station + idx_oi_kds_station). KDS voit ces items même avant payment |
| **P1** | POS hub inbox | Modal "Tablet Orders" avec badge count. Liste triée `sent_to_kitchen_at DESC`. Card row : order_number, table, items count, age timer, waiter name, total estimé |
| **P2** | `pickup_tablet_order` RPC | UPDATE orders SET status='draft', pos_session_id=current. Guard WHERE status='pending_payment'. Race → 0 rows → P0012 already_picked_up |
| **P3** | Pickup → cart load | client charge l'order dans cartStore avec `lockedItemIds = all`, `customerId = null`, `loyaltyPointsToRedeem = 0`. Cashier peut attach customer + redeem AVANT checkout |
| **P4** | `pay_existing_order` RPC | Sibling de `complete_order_with_payment` v4. Accepte `p_order_id` + `p_payment` + `p_customer_id?` + `p_loyalty_points_redeemed?`. Pose JE balanced + stock movements + status='paid'. Idempotency key supportée |
| **P5** | Cancel tablet order | Bouton "Cancel" sur tablet `/tablet/orders` row si status=pending_payment (avant pickup). RPC `cancel_tablet_order(p_order_id)` → status='voided'. Après pickup, cancel via POS session 7 |
| **N1** | Tablet KDS notification | Tablet `/tablet/orders` subscribe Realtime sur ses orders. Quand `kitchen_status` d'un item passe à `ready` → toast "Order #N — item ready" |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Pas de nouveau package | tout via Supabase + react-query + Zustand existants |
| Pas de Capacitor en v1 | tablet routes fonctionnent dans browser standard. Capacitor native plus tard |

---

## 3. Schéma DB — additions

### 3.1 Modifications sur tables existantes

```sql
-- orders : created_via + waiter_id
ALTER TABLE orders
  ADD COLUMN created_via TEXT NOT NULL DEFAULT 'pos'
    CHECK (created_via IN ('pos', 'tablet')),
  ADD COLUMN waiter_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_pending_tablet
  ON orders(sent_to_kitchen_at DESC)
  WHERE status = 'pending_payment' AND created_via = 'tablet';
```

### 3.2 Extension enum `order_status`

```sql
-- Si TYPE: ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pending_payment';
-- Si CHECK: drop + recreate. Vérifier la contrainte existante en session 1+
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_status_check;
-- Re-add avec pending_payment inclus. Lecture des valeurs existantes
-- depuis 20260503000003_init_pos.sql avant write.
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'pending_payment', 'paid', 'voided', 'completed'));
```

### 3.3 Seed waiter role + user

```sql
-- Role
INSERT INTO roles (name, slug, description) VALUES
  ('Waiter', 'waiter', 'Floor staff — capture orders on tablet, no payments')
ON CONFLICT (slug) DO NOTHING;

-- Permission link (waiter has only sales.create)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.slug = 'waiter' AND p.code = 'sales.create'
ON CONFLICT DO NOTHING;

-- Waiter Demo user (PIN 5678 hashed via crypt)
INSERT INTO user_profiles (display_name, role_id, pin_hash, is_active) VALUES
  ('Waiter Demo',
   (SELECT id FROM roles WHERE slug = 'waiter'),
   crypt('5678', gen_salt('bf')),
   true)
ON CONFLICT DO NOTHING;
```

### 3.4 RPC `create_tablet_order`

```sql
CREATE FUNCTION create_tablet_order(
  p_waiter_id    UUID,
  p_table_number TEXT,
  p_order_type   order_type,
  p_items        JSONB                  -- même shape que complete_order_with_payment.p_items
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  -- order_number auto-généré par trigger session 1 si présent ; sinon généré ici.
  INSERT INTO orders (
    order_type, status, created_via, waiter_id, table_number, sent_to_kitchen_at
  ) VALUES (
    p_order_type, 'pending_payment', 'tablet', p_waiter_id, p_table_number, now()
  ) RETURNING id INTO v_order_id;

  -- INSERT order_items pour chaque item du JSONB
  --   - is_locked = true
  --   - kitchen_status = 'pending'
  --   - sent_to_kitchen_at = now()
  --   - dispatch_station from products.category → categories.dispatch_station
  --   - modifiers JSONB + modifiers_total per item
  -- (mirror la logique de complete_order_with_payment.session-3 sans payment/JE/stock)

  RETURN v_order_id;
END $$;
```

Permissions : `sales.create`. Le waiter peut INSERT sur orders + order_items via cet RPC SECURITY DEFINER.

### 3.5 RPC `pickup_tablet_order`

```sql
CREATE FUNCTION pickup_tablet_order(p_order_id UUID, p_session_id UUID)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_row orders;
BEGIN
  UPDATE orders
    SET status         = 'draft',
        pos_session_id = p_session_id
    WHERE id = p_order_id
      AND status = 'pending_payment'
      AND created_via = 'tablet'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Order already picked up or not pending_payment'
      USING ERRCODE = 'P0012';
  END IF;
  RETURN v_row;
END $$;
```

### 3.6 RPC `pay_existing_order`

```sql
CREATE FUNCTION pay_existing_order(
  p_order_id                UUID,
  p_payment                 JSONB,
  p_customer_id             UUID DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER DEFAULT 0,
  p_idempotency_key         UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_order            orders;
  v_items_total      DECIMAL(14,2);
  v_redemption       DECIMAL(14,2) := 0;
  v_total            DECIMAL(14,2);
  v_tax              DECIMAL(14,2);
  v_loyalty_balance  INTEGER;
  v_points_earned    INTEGER := 0;
BEGIN
  -- Idempotency check (mirror v3/v4 pattern)
  -- Load order + items, verify status='draft', else raise check_violation
  -- Compute v_items_total from order_items (already inserted by create_tablet_order)
  -- Apply same loyalty redeem + earn logic as complete_order_with_payment v4
  -- INSERT order_payments
  -- INSERT journal_entries lines (CASH/SALES/TAX_PAYABLE +/- LOYALTY_LIABILITY/SALE_DISCOUNT)
  -- INSERT stock_movements (one per order_item)
  -- UPDATE orders SET status='paid', paid_at=now(), customer_id, loyalty_*, total, tax_amount
  -- UPDATE pos_session.cash_total
  -- Apply earn (FLOOR(v_total/1000)) si p_customer_id IS NOT NULL
  RETURN p_order_id;
END $$;
```

Note d'implémentation : la logique JE + stock + loyalty est dupliquée avec `complete_order_with_payment` v4. Pour v1, accepter cette duplication. Une refacto future extrairait le bloc dans une function helper `_finalize_order_payment(p_order_id, p_payment, …)` appelée par les deux RPCs. **À noter dans le rapport mais pas réalisé en v1.**

### 3.7 RPC `cancel_tablet_order`

```sql
CREATE FUNCTION cancel_tablet_order(p_order_id UUID)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_row orders;
BEGIN
  UPDATE orders
    SET status = 'voided'
    WHERE id = p_order_id
      AND status = 'pending_payment'
      AND created_via = 'tablet'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Cannot cancel — order not pending_payment'
      USING ERRCODE = 'P0013';
  END IF;
  RETURN v_row;
END $$;
```

### 3.8 RLS additions

```sql
-- orders SELECT: waiter peut voir SES orders pending (par waiter_id),
-- cashier peut voir les pending_payment du shop pour pickup
CREATE POLICY "tablet_waiter_own_pending" ON orders FOR SELECT
  USING (
    is_authenticated()
    AND created_via = 'tablet'
    AND (waiter_id = auth.uid() OR has_permission('payments.process'))
  );

-- order_items SELECT: même règle propagée via order_id
-- (la policy session 1 "auth_read" sur order_items reste en place)
```

### 3.9 Migrations à créer

```
20260507000001_extend_orders_tablet.sql              # created_via + waiter_id + index + status enum extend
20260507000002_seed_waiter_role.sql                  # role + permissions + Waiter Demo user
20260507000003_create_tablet_order_rpc.sql
20260507000004_pickup_tablet_order_rpc.sql
20260507000005_pay_existing_order_rpc.sql
20260507000006_cancel_tablet_order_rpc.sql
20260507000007_tablet_rls.sql                        # SELECT policies pour waiter own
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
tablet/
├── types.ts                    # TabletCart, TabletOrderEntry (read view)
├── buildSubmitPayload.ts       # tabletCart → create_tablet_order RPC payload
├── calculatePreview.ts         # estimate items_total + tax (pas total final, pas de redeem)
├── index.ts
└── __tests__/
```

`TabletCart` shape :
```ts
export interface TabletCart {
  items: CartItem[];                  // session 2 shape avec modifiers
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
}
```

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `TabletInboxRow.tsx` | row card pour inbox POS : order_number (mono), table badge, items count, age (count-up timer), waiter name, total estimé. Bouton "Pickup" |
| `TabletOrderCard.tsx` | card pour `/tablet/orders` history : order_number, time, items, table, status badge, items kitchen_status indicators, action "Cancel" si pending_payment |

(`TableSelectorModal` existant session 4 réutilisé. `ModifierModal` existant session 2 réutilisé.)

### 4.3 POS app `apps/pos/src/`

```
NEW pages/tablet/
├── TabletLayout.tsx              # PIN gate + bottom tabs (Order | Orders)
├── TabletOrderPage.tsx           # category nav + product grid + cart panel
└── TabletOrdersPage.tsx          # sent-orders history par waiter

NEW features/tablet/
├── components/
│   ├── TabletProductGrid.tsx
│   ├── TabletCartPanel.tsx       # items + total + Send-to-Kitchen CTA
│   └── TabletCheckoutButton.tsx  # "Send to Kitchen" → create_tablet_order
└── hooks/
    ├── useCreateTabletOrder.ts   # mutation RPC
    ├── useCancelTabletOrder.ts   # mutation RPC
    ├── useMyTabletOrders.ts      # query orders WHERE waiter_id = me
    └── useTabletOrderStatusListener.ts  # Realtime → toast item ready

NEW features/inbox/                 # POS hub side
├── components/
│   ├── TabletInboxButton.tsx     # badge count dans header POS
│   └── TabletInboxModal.tsx      # liste pending_payment
└── hooks/
    ├── usePendingTabletOrders.ts # query + Realtime
    └── usePickupTabletOrder.ts   # mutation RPC pickup → load into cartStore

NEW stores/
├── tabletCartStore.ts            # Zustand : items, tableNumber, orderType, addItem, updateQuantity, removeItem, setTableNumber, setOrderType, clearCart
└── (note: pas de tabletOrderStore Zustand côté hub — on utilise direct la query usePendingTabletOrders)

MODIFY routes/index.tsx           # ajouter /tablet/* derrière TabletLayout
MODIFY pages/Login.tsx            # post-login redirect : waiter → /tablet/order, cashier → /pos
MODIFY apps/pos/src/features/cart/ActiveOrderPanel.tsx  # mount TabletInboxButton dans header (visible aux cashiers)
```

### 4.4 Cart load après pickup

Après `pickup_tablet_order` succeeds, le client (POS):

```ts
const order = await pickupTabletOrder(orderId, currentSessionId);
const items = await fetchOrderItems(orderId);   // SELECT order_items WHERE order_id

cartStore.getState().restoreCart({
  items: items.map(toCartItem),
  customerId: null,
  loyaltyPointsToRedeem: 0,
  orderType: order.order_type,
  tableNumber: order.table_number,
});
cartStore.getState().lockAllItems(items.map(i => i.id));   // existing markLocked
```

Cashier voit cart locked (les items sont déjà sent-to-kitchen). Peut attach customer + redeem si désiré, puis CHECKOUT cash → `pay_existing_order` (au lieu de `complete_order_with_payment`).

### 4.5 useCheckout extension

Le hook `useCheckout` actuel appelle `complete_order_with_payment`. Il doit choisir le RPC selon contexte :

```ts
if (cartStore.pickedUpOrderId) {
  await payExistingOrder(cartStore.pickedUpOrderId, payment, customer_id?, loyalty_redeem?);
} else {
  await completeOrderWithPayment(items, payment, ...);
}
```

Add `pickedUpOrderId: string | null` to `cartStore`. `restoreCart()` from pickup sets it. `resetCartAfterCheckout()` clears it.

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `tablet/buildSubmitPayload` | items mapped, modifiers preserved, tableNumber + orderType present |
| domain `tablet/calculatePreview` | sum items × qty + modifiers, tax PB1 |
| ui `TabletInboxRow` | render + age timer + pickup callback |
| ui `TabletOrderCard` | render + cancel callback + kitchen_status indicators |
| pgTAP `create_tablet_order` | inserts orders pending_payment + items locked, no JE, no stock |
| pgTAP `pickup_tablet_order` | pending → draft + session bound, double pickup → P0012 |
| pgTAP `pay_existing_order` | finalize with JE balanced + stock movements, idempotency key replay |
| pgTAP `cancel_tablet_order` | pending → voided, after pickup → P0013 |
| Vitest smoke `tablet-send.smoke.test.tsx` | tablet flow : login waiter → table T-03 → 2 items → Send → toast success → row in /tablet/orders |
| Vitest smoke `pickup-flow.smoke.test.tsx` | POS hub flow : badge inbox count → modal → Pickup tap → cart loaded locked → checkout cash → paid |
| Vitest smoke `pay-existing.smoke.test.tsx` | pay_existing_order JE balanced, customer attach pre-checkout earns points |

---

## 6. Critères d'acceptation session 5

- [ ] Migrations 20260507000001 → 20260507000007 passent
- [ ] Seed insère role 'waiter' + Waiter Demo (PIN 5678) avec perm `sales.create` only
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 360+ tests passent
- [ ] **Login** : PIN 5678 (waiter) → redirect `/tablet/order`. PIN existing cashier (e.g. 1234) → `/pos`
- [ ] **Tablet Order** : grille produits visible, sélection avec modifiers OK (réutilise ModifierModal session 2)
- [ ] **Tablet Order** : pick T-03 via TableSelectorModal, dine_in
- [ ] **Tablet Order** : tap "Send to Kitchen" → toast "Order #N sent" → cart cleared, redirect /tablet/orders
- [ ] **Tablet Orders** : la nouvelle order apparaît avec status pending_payment + items kitchen_status pending
- [ ] **KDS** (sur autre device) : voit immédiatement les items lockés via Realtime
- [ ] **POS** (sur 3e device, cashier authentifié) : badge "Tablet (1)" apparaît dans header. Tap → modal liste l'order
- [ ] **POS Pickup** : tap "Pickup" → cart se charge avec items lockés + table T-03 + dine_in. `cartStore.pickedUpOrderId` set
- [ ] **POS Pickup** : attach customer Gold (session 3 flow), redeem 200 pts → CHECKOUT cash
- [ ] **DB** : `pay_existing_order` finalize : `orders.status='paid'`, JE balanced incl LOYALTY_LIABILITY/SALE_DISCOUNT, stock_movements créés, customer.loyalty_points décremente puis incremente avec earn
- [ ] **Tablet** : reçoit Realtime status update → toast "Order #N — paid" (optional v1) ou "items now ready" quand KDS bump
- [ ] **Cancel pré-pickup** : sur tablet `/tablet/orders`, tap "Cancel" sur une nouvelle order → status voided, n'apparaît plus dans inbox POS
- [ ] **Cancel post-pickup** : RPC raise P0013, toast "Cannot cancel — already picked up"
- [ ] **Race pickup** : 2 cashiers tentent simultanément → 1 succès, l'autre P0012 toast "Already picked up"

---

## 7. Roadmap session 6+

(reprend la spec parent §11, modulo sessions 1-5 livrées)

| Session | Module |
|---|---|
| 6 | Discounts + promotions + combos (multi-select modifiers + loyalty multipliers + customer_categories) |
| 7 | Split payment + refund/void (cancel item après send avec manager-PIN) |
| 8 | Backoffice products CRUD + categories + suppliers + customers CRUD + tables CRUD (modifier override per-product, floor plan visuel x/y) |
| 9 | Customer display + QR scan loyalty |
| 10 | B2B customers + credit + invoicing |
| 11+ | Held orders DB-backed, hub-routed printing, idle PIN re-prompt, …  |
