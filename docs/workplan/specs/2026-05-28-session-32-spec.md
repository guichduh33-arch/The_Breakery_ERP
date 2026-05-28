# Session 32 — POS Service Polish (Spec)

> **Date** : 2026-05-28
> **Branche cible** : `swarm/session-32`
> **Base** : `master` après merge S31
> **Effort estimé** : ~5-8 jours wall-time (L)
> **Status** : draft pour ratification user
> **Predecessor** : [`./2026-05-28-session-31-spec.md`](./2026-05-28-session-31-spec.md) — S32 enchaîne les findings *Major polish* après les *Critical fixes* de S31.
> **Audit source** : [`../../../outputs/audit-pos-2026-05-28.md`](../../../outputs/audit-pos-2026-05-28.md)

---

## 1. Contexte

Après le rempart Critical fermé en S31, le POS reste **fonctionnel mais inconfortable** pour le cashier en rush, le client au comptoir, et le manager. S32 ferme les 5 findings Major polish + 5 Minor bundlés :

- **F-003 (🔴 reporté de S31)** : Held orders DB-backed avec status `held`
- **F-005 (🟠)** : `VirtualKeypadProvider` + `QwertyLayout` pour input texte tactile
- **F-007 (🟠)** : Customer Display live cart mirror via BroadcastChannel
- **F-009 (🟠)** : POSSettingsPage — livrer minimalement les 3 onglets stub (Printing, KDS & Display, Devices)
- **F-014 (🟠)** : Lock Terminal feature
- **F-015 (🟡)** : Print server URL configurable (couvert par F-009 Printing tab)
- **F-016 (🟡)** : SideMenuDrawer callbacks `onOpenHeldOrders`/`onOpenCustomers` câblés
- **F-019 (🟡)** : Customer Debts "Pay" inline (pas de redirection)
- **F-022 (🟡)** : sessionStorage cart 2h TTL surfacé en UI
- **F-024 (🟡)** : Test smoke print modifiers coverage

**Hors scope S32** (→ Backlog stratégique S33+) :
- F-010 (scan QR/barcode caméra) — effort M, intégration html5-qrcode
- F-011 (ComboSelectorModal) — effort L, refacto cart line schema
- F-012 (vente au poids) — effort L, intégration balance USB/serial
- F-013 (Stripe Terminal pre-auth dine-in) — effort L, partenariat externe
- F-020 (doublon CartItemRow/CartLineRow) — refacto cosmétique
- F-021 (`'postgres_changes' as never`) — résolu naturellement à la prochaine regen types
- F-023 (NPWP sur receipt) — dépend de validation fiscale NON-PKP

---

## 2. Architecture

### 2.1 F-003 — Held orders DB-backed

**Choix structurant** : Pattern snapshot-at-hold (sur le modèle de S15 recipe_versions, S28 expense thresholds_snapshot). Le panier complet est gelé en JSONB dans une **table dédiée** `held_orders` (pas un row `orders` avec status='held' — éviter les pollutions du flux orders et les `IF status != 'held'` partout).

**Justification de `held_orders` table dédiée vs ALTER TYPE order_status** :
- Pro `ALTER TYPE` : un seul concept "ordre".
- Contra `ALTER TYPE` : les triggers comptables, KDS, stock, fidélité sur `orders` doivent tous être guarded `WHEN status != 'held'`. Risque de leak comptable.
- Choix : **table dédiée `held_orders`** avec FK `pos_session_id` + JSONB snapshot. Restore = INSERT INTO orders depuis le snapshot. Cleaner.

**Tables nouvelles** :
- `held_orders(id UUID PK, pos_session_id UUID FK, cashier_id UUID FK, customer_id UUID FK NULLABLE, cart_snapshot JSONB NOT NULL, table_number TEXT NULL, notes TEXT NULL, total NUMERIC(14,2) NULL, item_count INT NULL, created_at TIMESTAMPTZ DEFAULT now(), restored_at TIMESTAMPTZ NULL)`
- RLS : SELECT par tous authenticated dans le même `pos_session_id` ; INSERT/UPDATE/DELETE via RPCs SECURITY DEFINER

**RPCs (3)** :
- `hold_order_v1(p_cart_snapshot JSONB, p_table_number TEXT, p_notes TEXT) RETURNS UUID`
- `restore_held_order_v1(p_held_order_id UUID) RETURNS JSONB` — retourne le snapshot + soft-delete le row (`restored_at`)
- `discard_held_order_v1(p_held_order_id UUID, p_reason TEXT) RETURNS VOID`

**Permissions** : nouvelle `sales.hold` (read+write) à seeder. Cashier + manager.

### 2.2 F-005 — VirtualKeypadProvider

**Choix structurant** : Context React + Portal overlay. L'overlay numpad/qwerty s'ouvre quand un `<input>` à l'intérieur de `/pos` reçoit focus si l'attribut `data-vkp` ≠ "off".

**Composants nouveaux** dans `packages/ui/src/components/virtual-keypad/` :
- `VirtualKeypadProvider.tsx` — context + portal mount
- `VirtualKeypadOverlay.tsx` — overlay tactile (numpad/qwerty selon `inputmode`)
- `QwertyLayout.tsx` — clavier QWERTY 26+10+espace
- `useVirtualKeypad.ts` — hook côté input pour opt-in/out
- Réutilise `Numpad.tsx` existant pour numpad branch

**Approche** : intercepte le `focus` event natif sur `<input>` / `<textarea>` enfants ; quand ouvert, blur l'input natif et écoute le keypad. Backspace, validation (Enter), close (Escape).

### 2.3 F-007 — Customer Display live cart mirror

**Choix structurant** : `BroadcastChannel` API (déjà partiellement référencée dans `02-pos-cart-orders.md` §32.5).

- Émetteur : `apps/pos/src/features/display/hooks/useCartBroadcast.ts` — wraps `cartStore` subscriber, post un message `{ type: 'cart_update', cart, totals, customer }` à chaque change
- Récepteur : `apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts` — écoute le channel, expose le live cart
- Display composant : `apps/pos/src/features/display/CDActiveCartView.tsx` — affiche les items + total côté gauche du Customer Display, à côté de la queue ticker existante

**Trade-off** : BroadcastChannel ne fonctionne que dans le même origin (même URL) et même device. Pour multi-device LAN, il faut LAN hub (déjà en place via `useLanHub`). On peut éventuellement étendre via `LanHubMessageType.CART_UPDATE`. Pour V1 S32, on reste sur BroadcastChannel same-device — le display est typiquement sur le même iPad/PC que le POS.

### 2.4 F-009 — POSSettingsPage tabs livrés

**Choix structurant** : 3 onglets minimaux fonctionnels, pas placeholders.

- **Printing tab** :
  - Print server URL (input texte, default `localhost:3001`)
  - Auto-print on/off
  - Auto-open-drawer on/off (couvre F-004 belt-and-suspenders)
  - Receipt footer custom text
  - Bouton "Test print" qui envoie un ticket dummy
- **KDS & Display tab** :
  - Auto-send-KDS toggle (gated F-001 Option B future)
  - Customer Display pairing code (R/O depuis kiosk_devices)
  - Live cart mirror enable toggle (F-007 dépendance)
- **Devices tab** :
  - Print server health badge (vert/rouge basé sur `checkPrintServer`)
  - LAN hub heartbeat status
  - Terminal name + ID display

Les sous-onglets (Automation, Advanced, Behavior) restent stub — à arbitrer en session ultérieure.

### 2.5 F-014 — Lock Terminal

**Choix structurant** : nouveau store `terminalLockStore` + composant overlay `TerminalLocked`.

- Action `lockTerminal()` : pousse l'état locked, conserve `useShiftStore` intact, pousse l'auth vers un "minimal user picker"
- Overlay `<TerminalLocked>` : affiche le UserPicker + PinPad ; valide via la même EF `auth-verify-pin` existante
- À déverrouillage : restaure le full auth state, **conserve la cart en l'état**

### 2.6 Migration block réservé

`20260710000010..030` (buffer). Allocations :
- `_010` : `held_orders` table + indexes
- `_011` : `hold_order_v1` RPC + REVOKE pair
- `_012` : `restore_held_order_v1` RPC + REVOKE pair
- `_013` : `discard_held_order_v1` RPC + REVOKE pair
- `_014` : seed permission `sales.hold`
- `_015..020` buffer

---

## 3. Détail F-003 — held_orders DB

### 3.1 Schema

```sql
CREATE TABLE held_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_session_id  UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  cashier_id      UUID NOT NULL REFERENCES profiles(id),
  customer_id     UUID NULL REFERENCES customers(id) ON DELETE SET NULL,
  cart_snapshot   JSONB NOT NULL,
  table_number    TEXT NULL,
  notes           TEXT NULL,
  total           NUMERIC(14,2) NULL,
  item_count      INTEGER NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at     TIMESTAMPTZ NULL,
  discarded_at    TIMESTAMPTZ NULL,
  discard_reason  TEXT NULL
);

CREATE INDEX idx_held_orders_session_active ON held_orders(pos_session_id, created_at DESC)
  WHERE restored_at IS NULL AND discarded_at IS NULL;
```

### 3.2 RLS

```sql
ALTER TABLE held_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "held_orders read same session"
  ON held_orders FOR SELECT
  USING (
    is_authenticated()
    AND pos_session_id IN (
      SELECT id FROM pos_sessions WHERE status = 'open' AND id = pos_session_id
    )
  );

-- INSERT/UPDATE/DELETE via SECURITY DEFINER RPCs only.
REVOKE INSERT, UPDATE, DELETE ON held_orders FROM authenticated, anon;
```

### 3.3 cart_snapshot JSON shape

Le snapshot doit être self-suffisant pour reconstruire le cart sans réseau :

```json
{
  "version": 1,
  "items": [{
    "product_id": "...",
    "name": "...",
    "unit_price": 25000,
    "quantity": 2,
    "modifiers": [{ "option_label": "Almond milk", "price_adjustment": 5000 }],
    "modifiers_total": 5000,
    "total_price": 60000,
    "dispatch_station": "barista"
  }],
  "order_type": "dine_in",
  "table_number": "T12",
  "customer_id": "...",
  "applied_promotions": [...],
  "cart_discount": null,
  "loyalty_points_to_redeem": 0
}
```

### 3.4 RPC signatures

- `hold_order_v1(p_cart_snapshot JSONB, p_table_number TEXT, p_notes TEXT) RETURNS UUID` — gate `sales.hold` ; emit `audit_logs action='order.held'`
- `restore_held_order_v1(p_held_order_id UUID) RETURNS JSONB` — gate `sales.hold` ; sets `restored_at = now()` ; returns the `cart_snapshot`
- `discard_held_order_v1(p_held_order_id UUID, p_reason TEXT) RETURNS VOID` — gate `sales.hold` + reason ≥ 5 chars ; sets `discarded_at, discard_reason`

### 3.5 POS hooks

- `useHeldOrders()` — `useQuery(['held-orders'])` + realtime subscribe `postgres_changes` sur table
- `useHoldOrder()` — replaces local hold flow ; calls `hold_order_v1` RPC
- `useRestoreHeldOrder(id)` — calls RPC + rehydrate cart via `cartStore.restoreCart(snapshot)`
- `useDiscardHeldOrder()` — calls discard RPC + invalidate query

Drop `useHeldOrdersStore` Zustand local — migration data path : à l'initialisation S32, lire le `localStorage['held-orders']` legacy → POST chaque entry via `hold_order_v1` → clear localStorage. One-shot migration sur `App` mount.

---

## 4. Détail F-005 — VirtualKeypadProvider

### 4.1 Provider mount

`apps/pos/src/App.tsx` :

```tsx
<VirtualKeypadProvider>
  <BrowserRouter>...</BrowserRouter>
</VirtualKeypadProvider>
```

### 4.2 Layout switch

`useVirtualKeypad` détecte automatiquement le bon layout depuis l'`<input>` :
- `type="number"` ou `inputmode="numeric"` → `<Numpad>` (existant)
- `inputmode="decimal"` → Numpad avec `.` activé
- default → `<QwertyLayout>` nouveau composant 26 lettres + chiffres-row + espace + backspace

### 4.3 Opt-out

Tout `<input data-vkp="off">` ne déclenche pas l'overlay (e.g., dans modales déjà à clavier intégré comme PinPad).

### 4.4 Tests

- `packages/ui/src/components/virtual-keypad/__tests__/VirtualKeypadProvider.test.tsx` — 4 cas
- `packages/ui/src/components/virtual-keypad/__tests__/QwertyLayout.test.tsx` — 3 cas
- `apps/pos/src/__tests__/virtual-keypad-integration.smoke.test.tsx` — 2 cas (input focus opens, opt-out works)

---

## 5. Détail F-007 — Live cart mirror

### 5.1 Émetteur

`apps/pos/src/features/display/hooks/useCartBroadcast.ts` :

```ts
export function useCartBroadcast() {
  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);

  useEffect(() => {
    const channel = new BroadcastChannel('breakery-pos-cart');
    channel.postMessage({
      type: 'cart_update',
      payload: { cart, attachedCustomer, appliedPromotions, totals: ... },
      timestamp: Date.now(),
    });
    return () => channel.close();
  }, [cart, attachedCustomer, appliedPromotions]);
}
```

Mount dans `pages/Pos.tsx`.

### 5.2 Récepteur

`apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts` :

```ts
export function useCartBroadcastReceiver() {
  const [livecart, setLivecart] = useState<LiveCart | null>(null);
  useEffect(() => {
    const channel = new BroadcastChannel('breakery-pos-cart');
    channel.onmessage = (e) => {
      if (e.data.type === 'cart_update') setLivecart(e.data.payload);
    };
    return () => channel.close();
  }, []);
  return livecart;
}
```

### 5.3 Display composant

`apps/pos/src/features/display/CDActiveCartView.tsx` — panneau gauche du `CustomerDisplayPage` :
- Affiche items en cours
- Total live (highlight gold à chaque update)
- Customer name + tier badge si attaché
- Empty state "Welcome — your order will appear here"

Splitscreen avec `OrderQueueTicker` à droite.

### 5.4 Toggle Settings

F-009 Printing tab expose un toggle "Live cart mirror" qui désactive l'émetteur (utile en dev).

---

## 6. Détail F-009 — POSSettingsPage tabs

### 6.1 Printing tab

`apps/pos/src/features/settings/components/PrintingTab.tsx` (new) :

- Input "Print server URL" → setting `print_server_url`
- Toggle "Auto-print receipt" → setting `print_auto_on_checkout`
- Toggle "Auto-open cash drawer (cash tenders)" → setting `drawer_auto_on_cash`
- Input "Receipt footer text" → setting `receipt_footer_text`
- Bouton "Test print" → envoie ticket dummy via `printService.printReceipt`

Settings persistés via `set_setting_v1` existant (cf. usePOSPresets pattern S14).

### 6.2 KDS & Display tab

`apps/pos/src/features/settings/components/KdsDisplayTab.tsx` (new) :
- Toggle "Auto-send to KDS on checkout" — informationnel, lié à `complete_order_v10` qui force `is_locked=true`
- Pairing code display (R/O depuis `kiosk_devices`) + bouton "Generate new"
- Toggle "Live cart mirror" → setting `display_live_cart_enabled` (gate F-007 émetteur)

### 6.3 Devices tab

`apps/pos/src/features/settings/components/DevicesTab.tsx` (new) :
- Card "Print server" — health badge depuis `checkPrintServer()` polled 30s
- Card "LAN hub" — heartbeat status depuis `useLanHeartbeat`
- Card "Terminal" — name + ID + last opened shift

### 6.4 Wire dans POSSettingsPage

`apps/pos/src/features/settings/POSSettingsPage.tsx` :

```tsx
{topTab === 'printing' && <PrintingTab readOnly={!canEdit} />}
{topTab === 'kds' && <KdsDisplayTab readOnly={!canEdit} />}
{topTab === 'devices' && <DevicesTab readOnly={!canEdit} />}
```

(Remplace les `PlaceholderSection`.)

---

## 7. Détail F-014 — Lock Terminal

### 7.1 Store

`apps/pos/src/stores/terminalLockStore.ts` (new) :

```ts
interface TerminalLockState {
  locked: boolean;
  lockedAt: number | null;
  lockedByUserId: string | null;
  lock: (userId: string) => void;
  unlock: () => void;
}
```

### 7.2 Overlay component

`apps/pos/src/features/auth/TerminalLockedOverlay.tsx` (new) :
- Affichage plein écran
- UserPicker (réutilise le composant existant)
- PinPad
- Sur PIN valide via `auth-verify-pin` EF → `unlock()` + restore auth

### 7.3 Mount dans App

`apps/pos/src/App.tsx` :
```tsx
const locked = useTerminalLockStore((s) => s.locked);
return (
  <>
    <BrowserRouter>...</BrowserRouter>
    {locked && <TerminalLockedOverlay />}
  </>
);
```

### 7.4 Wire dans SideMenuDrawer

`apps/pos/src/pages/Pos.tsx:170-180` :
```tsx
<SideMenuDrawer
  ...
  onLockTerminal={() => useTerminalLockStore.getState().lock(user!.id)}
  ...
/>
```

---

## 8. Permissions

- **`sales.hold`** (read+write) — seedée pour cashier, waiter, manager, admin, super_admin (cashier doit pouvoir hold ses propres commandes)

---

## 9. Tests

### 9.1 pgTAP

- **`held_orders.test.sql`** (15 cas) — F-003 :
  - T1-T5 : hold_order_v1 happy + perm gate + snapshot shape
  - T6-T10 : restore_held_order_v1 sets restored_at + returns snapshot + idempotency
  - T11-T13 : discard_held_order_v1 reason ≥ 5 chars + audit
  - T14-T15 : RLS — un cashier ne peut pas voir held_orders d'une autre session

### 9.2 Vitest live RPC

- `supabase/tests/functions/held-orders.test.ts` (5 cas — hold/restore/discard/RLS/idempotency)

### 9.3 POS smoke tests

- `apps/pos/src/features/heldOrders/__tests__/useHoldOrder.smoke.test.tsx` (3 cas)
- `apps/pos/src/features/heldOrders/__tests__/useRestoreHeldOrder.smoke.test.tsx` (3 cas)
- `apps/pos/src/__tests__/held-orders-migration.smoke.test.tsx` (2 cas — localStorage legacy → DB)
- `apps/pos/src/__tests__/virtual-keypad-integration.smoke.test.tsx` (2 cas)
- `apps/pos/src/features/display/__tests__/CDActiveCartView.smoke.test.tsx` (3 cas)
- `apps/pos/src/features/settings/__tests__/PrintingTab.smoke.test.tsx` (3 cas)
- `apps/pos/src/features/auth/__tests__/TerminalLockedOverlay.smoke.test.tsx` (3 cas)

### 9.4 UI unit

- `packages/ui/src/components/virtual-keypad/__tests__/QwertyLayout.test.tsx` (3 cas)
- `packages/ui/src/components/virtual-keypad/__tests__/VirtualKeypadProvider.test.tsx` (4 cas)

### 9.5 Typecheck

`pnpm typecheck` 6/6 PASS.

---

## 10. Critères d'acceptation

- [ ] F-003 : pgTAP `held_orders` 15/15 PASS. Hold sur terminal A visible sur terminal B (same session). Crash navigateur → hold persisté.
- [ ] F-005 : Tap dans `CustomerAttachModal` search input → QwertyLayout apparaît. Tap dans `DiscountModal` reason field → Qwerty. Tap dans `PinPad` → pas de Qwerty (opt-out).
- [ ] F-007 : Émetteur posté à chaque change cart. `/display` montre les items en cours en temps réel.
- [ ] F-009 : 3 onglets Settings opérationnels (no PlaceholderSection). Test print fonctionne. Toggle drawer-on-cash écouté par `SuccessModal`.
- [ ] F-014 : Bouton "Lock terminal" dans drawer câblé. Overlay s'affiche. PIN cashier déverrouille. Cart préservé.
- [ ] F-016 : Boutons Held Orders + Customers dans drawer non-disabled.
- [ ] F-019 : Bouton "Pay" dans `CustomerDebtsPanel` ouvre `PaymentTerminal` inline (pas de navigate to history).
- [ ] F-022 : Toast "Cart will be cleared after 2h inactivity" affiché à l'ouverture du POS si cart non vide.
- [ ] F-024 : Print smoke test modifiers présents dans payload.
- [ ] `pnpm typecheck` 6/6 PASS, `pnpm test` 0 régression.

---

## 11. Risques & rollback

| Risque | Probabilité | Mitigation |
|---|---|---|
| Migration localStorage → DB perd entries en cas d'échec partiel | Faible | Migration one-shot avec fallback : si POST échoue, on garde le localStorage ; retry au next App mount. Logs explicit. |
| `BroadcastChannel` non supporté sur Safari iOS (versions anciennes) | Moyenne | Polyfill ou fallback `localStorage` event-driven. Feature flag dans Settings (F-007 toggle). |
| `VirtualKeypadProvider` casse les tests existants qui taper via `userEvent` | Moyenne | Tests doivent passer `data-vkp="off"` sur les inputs sous test ; alternative : provider stubbed dans render helpers. |
| Lock Terminal interfère avec idle timeout S19 | Faible | Lock = pause idle timer. Clear logic. |
| PrintingTab toggle drawer cassé propage à `SuccessModal` | Moyenne | F-004 S31 a déjà introduit le bool tenders.some(cash) ; toggle ajoute juste un AND avec setting. |

**Rollback** : Each wave is git-revertible independently. Held orders RPCs peuvent être DROP + tables peut être renommée si migration data ne marche pas.

---

## 12. Hors scope explicite

**Reporté backlog stratégique S33+** :
- F-010 scan QR/barcode caméra (`html5-qrcode` integration)
- F-011 ComboSelectorModal (multi-step combo composer)
- F-012 vente au poids (Web Serial API balance integration)
- F-013 Stripe Terminal pre-auth dine-in
- Quick reorder (POS.md §18 🟠)
- Multi-language UI (Bahasa Indonesia)
- Apple Pay / Google Pay tap-to-pay

**Décisions business à acter** :
- Option B pour F-001 (draft orders persistés) — métier veut Send-to-Kitchen avant Checkout ?
- Print server externe — qui le maintient ? Absorption monorepo ?
- Allergens sur receipt/display — revisiter `project_allergens_wontfix` ?

---

## 13. Migration ordering

```
20260710000010_create_held_orders_table.sql            -- F-003
20260710000011_create_hold_order_v1_rpc.sql            -- F-003
20260710000012_create_restore_held_order_v1_rpc.sql    -- F-003
20260710000013_create_discard_held_order_v1_rpc.sql    -- F-003
20260710000014_seed_sales_hold_permission.sql          -- F-003 perm seed
20260710000015..020 buffer correctives
```
