# Session 31 — POS Critical Fixes (Spec)

> **Date** : 2026-05-28
> **Branche cible** : `swarm/session-31`
> **Base** : `master` après merge S30 (PR #38 pending — si pas mergé au démarrage, base directe `swarm/session-30` @ `6431e6a`)
> **Effort estimé** : ~3-5 jours wall-time (M)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-24-session-30-spec.md`](./2026-05-24-session-30-spec.md)
> **Audit préparatoire** : [`../../../outputs/audit-pos-2026-05-28.md`](../../../outputs/audit-pos-2026-05-28.md) — 4 Critical + 6 Major scoped S31 (les autres → S32 / backlog).
> **Companion spec** : [`./2026-05-28-session-32-spec.md`](./2026-05-28-session-32-spec.md) — S32 enchaîne avec les findings *Major* polish (hold orders DB, VirtualKeypad, customer display, Settings tabs, Lock terminal).

---

## 1. Contexte

L'audit POS du 2026-05-28 (`outputs/audit-pos-2026-05-28.md`) a identifié **4 Critical + 10 Major + 10 Minor**. Cette session ferme la totalité des Critical (F-001 → F-004) et les Major sécurité/anon (F-006, F-008) + 2 Minor légers (F-017, F-018) qui peuvent être bundlés sans surcharge. Le scope est volontairement étroit pour livrer rapidement le rempart minimal :

- **F-001 (🔴)** : `useSendToKitchen` no-op + `complete_order_v9` n'active pas `is_locked` → KDS ne reçoit jamais les commandes POS comptoir. Option A retenue (bump RPC) — Option B (draft orders persistés) reportée backlog.
- **F-002 (🔴)** : drift `take_away`/`takeaway` vs enum DB `take_out` dans 5 fichiers → dead branches.
- **F-003 (🔴)** : held orders en `localStorage` uniquement, statut `held` absent enum DB → reporté **S32** (effort M, refacto store + 3 RPCs). Ce n'est pas dans S31.
- **F-004 (🔴)** : ticket hardcode `payment.method: 'cash'` + `openCashDrawer()` inconditionnel → faux ticket pour QRIS/Card, risque fraude tiroir.
- **F-006 (🟠)** : `useVoidOrder` + `useCancelOrderItem` envoient PIN en body JSON (viole S25 pattern).
- **F-008 (🟠)** : RPC `send_items_to_kitchen` `GRANT ... TO anon` viole S20 anon defense-in-depth.
- **F-017 (🟡)** : stock low threshold `<= 3` vs doc `<10` — arbitrage : on garde `<= 3` (cohérent bakery rotation rapide), aligner la doc.
- **F-018 (🟡)** : bouton "Recover shift" affiche un toast "not implemented" — soit livrer la feature simple, soit retirer le bouton.

**Hors scope S31** (→ S32 ou backlog) :
- F-003 (hold orders DB) — `ALTER TYPE` + 3 RPCs + refacto store, effort M, mieux séparer
- F-005 (VirtualKeypad Qwerty) — effort M, design dépendant
- F-007 (live cart mirror Customer Display) — effort M
- F-009 (Settings tabs Printing/KDS/Devices) — effort M, dépend en partie de F-015
- F-014 (Lock Terminal) — effort S, mais regroupé avec F-009 pour cohérence UX
- F-010 / F-011 / F-012 / F-013 (scan QR, combo selector, vente au poids, pre-auth) — backlog stratégique
- F-015 / F-016 / F-019 / F-020 / F-021 / F-022 / F-023 / F-024 → S32 polish bundle

---

## 2. Architecture

### 2.1 Choix structurants

1. **F-001 Option A** retenue : bump `complete_order_with_payment_v10` qui INSERT order_items avec `is_locked=true, kitchen_status='pending', sent_to_kitchen_at=now()` pour les items issus du POS standard. Pattern monotonique S26+ (drop v9 dans la même migration). Aucun changement de wire-protocol côté `useCheckout`.
   - **Justification** : Option B (draft orders persistés + RPC `create_draft_order_items` + refacto Send-to-Kitchen ≠ Checkout) est un refacto L (1-2 sem) qui touche cart store + KDS + checkout. Option A débloque immédiatement le KDS ; Option B reste backlog si la séparation "envoi cuisine avant paiement" devient prioritaire métier.
   - **Trade-off** : avec Option A, "Send to Kitchen" en pré-paiement reste cosmétique (le KDS ne voit la commande qu'au checkout). Si métier le confirme acceptable (la majorité des commandes POS comptoir sont payées immédiatement, le café est prêt en < 30s), on reste sur Option A. Si le boulanger veut commencer à 8h avant que le client paie son café à 8h05, **Option B obligatoire** dans une future session.

2. **F-002 enum drift** : introduire un helper `orderTypeLabel(t: string): string` dans `@breakery/domain` + table de constants `ORDER_TYPE_LABELS`. Tous les sites `'take_away'`/`'takeaway'` deviennent `'take_out'` ou utilisent le helper. Test type-level (`asserts ORDER_TYPE_LABELS satisfies Record<OrderType, string>`) qui casse si l'enum est étendu sans label ajouté.

3. **F-004 receipt + drawer** : `ReceiptPayload.payment` devient `payment: ReceiptTender[]` (array). `SuccessModal` lit `tenders` depuis `usePaymentStore`. `openCashDrawer()` conditionné à `tenders.some(t => t.method === 'cash')`.

4. **F-006 PIN-en-header sweep** : pattern S25 (`x-manager-pin` header, `getManagerPin(req)` helper partagé). Mêmes EFs concernés : `void-order`, `cancel-item`, `kiosk-issue-jwt` (mutation paths). Hard cutover (drop body field same commit).

5. **F-008 REVOKE sweep** : 1 migration corrective `REVOKE EXECUTE ON FUNCTION send_items_to_kitchen FROM anon, PUBLIC` + `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE`. Bonus audit : grep migrations S2-S5 (avant S20) pour autres RPCs avec `GRANT ... TO anon` → batch sweep en backlog si > 5 trouvés, sinon inclus.

### 2.2 Migration block réservé

`20260628000010..030` (mid-day buffer pour correctives). Allocations :
- `_010` : bump `complete_order_with_payment_v10` (F-001)
- `_011` : REVOKE pair v10
- `_012` : REVOKE corrective `send_items_to_kitchen` (F-008)
- `_013..017` : éventuels REVOKE sweep autres RPCs anon-granted (si trouvés)
- `_018..020` : correctives discovery time

### 2.3 EFs touchées

- `supabase/functions/void-order/index.ts` — header read
- `supabase/functions/cancel-item/index.ts` — header read
- `supabase/functions/kiosk-issue-jwt/index.ts` — header read si applicable
- `supabase/functions/_shared/manager-pin.ts` — **nouveau helper** (mirror du pattern `_shared/idempotency.ts` S25)

### 2.4 Permissions

**Aucune nouvelle permission seedée.** Toutes les EFs sont déjà gatées via leur RPC backend (`refund_order_rpc_v2`, etc.) ou via leur logique interne. Le header `x-manager-pin` valide juste la possession du secret, pas l'autorisation.

---

## 3. Détail RPC F-001 — `complete_order_with_payment_v10`

### 3.1 Signature

Identique à v9 (17 args). Aucun changement de wire-protocol côté POS — `useCheckout.ts` ne touche pas.

### 3.2 Body change minimal

Dans le bloc INSERT order_items (actuellement lignes 375-392 du `20260517000015_bump_complete_order_v9.sql`), ajouter 3 colonnes :

```sql
INSERT INTO order_items (
  order_id, product_id, name_snapshot, unit_price, quantity, line_total,
  modifiers, modifiers_total, dispatch_station,
  discount_amount, discount_type, discount_value, discount_reason,
  is_promo_gift, promotion_id,
  -- F-001 fix : POS comptoir doit aussi marquer items envoyés en cuisine
  is_locked, kitchen_status, sent_to_kitchen_at
)
SELECT
  v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
  v_modifiers, v_modifiers_total, v_dispatch_station,
  v_line_discount,
  NULLIF(v_item->>'discount_type', ''),
  CASE WHEN ... END,
  NULLIF(v_item->>'discount_reason', ''),
  v_item_is_gift,
  v_item_promo_id,
  -- F-001 fix
  true, 'pending', now()
FROM products p WHERE p.id = v_product_id;
```

### 3.3 Pourquoi pas un trigger AFTER INSERT

Option envisagée : trigger `AFTER INSERT ON order_items WHEN (NEW.is_locked = false) SET is_locked = true`. Refusée :
- Le pickup tablet flow (`pay_existing_order_v6`) ne doit PAS retoucher `is_locked` — l'item est déjà locké par `create_tablet_order_v2`.
- Un trigger global déclencherait des side-effects sur les drafts/historiques.
- Modifier la RPC `complete_order` est plus explicite et tracé.

### 3.4 Test pgTAP T1-T6

- T1 : `complete_order_with_payment_v10` insère order_items avec `is_locked=true`
- T2 : `kitchen_status='pending'` après insert
- T3 : `sent_to_kitchen_at` ≈ now (within 5s)
- T4 : KDS query `WHERE is_locked=true AND kitchen_status IN ('pending','preparing','ready')` retourne les items
- T5 : v9 dropped (signature plus dispo : `SELECT proname FROM pg_proc WHERE proname='complete_order_with_payment_v9'` → 0 row)
- T6 : `pay_existing_order_v6` (tablet pickup) ne casse pas (test happy path conservé)

### 3.5 Smoke test POS

- `apps/pos/src/features/payment/__tests__/PaymentTerminal.kdsHandoff.smoke.test.tsx` — call complete_order_v10 mocked, vérifier que le retour `order_id` existe et que le helper de query KDS le sourcerait
- Pas de e2e Playwright (deferred infra)

---

## 4. Détail F-002 — Helper `orderTypeLabel`

### 4.1 Domaine

Dans `packages/domain/src/orders/order-type.ts` (nouveau fichier) :

```ts
import type { OrderType } from './types';

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b: 'B2B',
};

export function orderTypeLabel(t: string): string {
  if (Object.prototype.hasOwnProperty.call(ORDER_TYPE_LABELS, t)) {
    return ORDER_TYPE_LABELS[t as OrderType];
  }
  return t; // fallback for unknown values during enum migration
}
```

Export dans `packages/domain/src/index.ts`.

### 4.2 Sites à corriger

| Fichier | Avant | Après |
|---|---|---|
| `apps/pos/src/features/display/components/OrderQueueTicker.tsx:33` | `if (orderType === 'take_away') return 'Pickup';` | `if (orderType === 'take_out') return tableNumber ? \`Pickup\` : orderTypeLabel(orderType);` |
| `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55` | `: order.order_type === 'take_away'` | `: order.order_type === 'take_out'` |
| `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx:48` | `order_type: 'take_away'` | `order_type: 'take_out'` |
| `apps/pos/src/features/order-history/OrderHistoryPanel.tsx:189` | `row.order_type === 'takeaway' ? 'Takeaway' : row.order_type === 'dine_in' ? 'Dine-in' : row.order_type` | `orderTypeLabel(row.order_type)` |
| `apps/pos/src/features/cart/HeldOrdersModal.tsx:276` | `filter === 'dine_in' ? 'dine-in' : 'takeaway'` | `orderTypeLabel(filter).toLowerCase()` |

### 4.3 Test type-level

`packages/domain/src/orders/__tests__/order-type.test.ts` :

```ts
import type { OrderType } from '../types';
import { ORDER_TYPE_LABELS } from '../order-type';

// Compile-time check: if OrderType is extended without updating the labels map, this fails.
const _exhaustive: Record<OrderType, string> = ORDER_TYPE_LABELS;
void _exhaustive;

test('every OrderType has a label', () => {
  expect(ORDER_TYPE_LABELS.dine_in).toBe('Dine-in');
  expect(ORDER_TYPE_LABELS.take_out).toBe('Takeaway');
  expect(ORDER_TYPE_LABELS.delivery).toBe('Delivery');
  expect(ORDER_TYPE_LABELS.b2b).toBe('B2B');
});

test('fallback for unknown returns raw value', () => {
  expect(orderTypeLabel('unknown_value')).toBe('unknown_value');
});
```

---

## 5. Détail F-004 — Receipt + drawer multi-tender

### 5.1 Domaine — type `ReceiptTender`

`packages/domain/src/payments/receipt-tender.ts` :

```ts
import type { PaymentMethod } from './types';

export interface ReceiptTender {
  method: PaymentMethod;
  amount: number;
  cash_received?: number; // only for cash
  change_given?: number;  // only for cash
  reference?: string;     // edc / qris / transfer ref number
}
```

### 5.2 Print service — body shape

`apps/pos/src/services/print/printService.ts` :

```ts
export interface ReceiptPayload {
  // ... business, order (drop the strict 'dine_in' | 'take_out' literal — use string)
  order: {
    order_number: string;
    created_at: string;
    cashier_name: string;
    order_type: string; // <-- relaxed: any enum value, label resolved by printer template
  };
  // ...
  payment: ReceiptTender[]; // <-- breaking shape change v1 → v2
  // ...
}
```

Le print server (Node side, hors monorepo) doit aussi être mis à jour pour itérer sur `payment[]` au lieu de lire `payment.method`/`payment.amount`/etc.

> **Hors scope direct S31** : le print server externe n'est pas dans `apps/pos/`. À documenter en deviation INDEX et notifier l'ops qui le gère.

### 5.3 SuccessModal — drawer conditionné

`apps/pos/src/features/payment/SuccessModal.tsx` :

```tsx
const tenders = usePaymentStore((s) => s.tenders); // au lieu de hardcoder cash

function buildReceiptPayload(props: SuccessModalProps): ReceiptPayload {
  return {
    business: BUSINESS,
    order: {
      order_number: props.orderNumber,
      created_at: new Date().toISOString(),
      cashier_name: props.cashierName,
      order_type: props.cart.order_type, // relaxed
    },
    // ...
    payment: tenders.map((t) => ({
      method: t.method,
      amount: t.amount,
      ...(t.method === 'cash' ? {
        cash_received: t.cash_received ?? 0,
        change_given: t.change_given ?? 0,
      } : {}),
      ...(t.reference ? { reference: t.reference } : {}),
    })),
    // ...
  };
}

useEffect(() => {
  if (!open) return;
  const hasCash = tenders.some((t) => t.method === 'cash');
  void Promise.all([
    handlePrint(),
    hasCash ? openCashDrawer() : Promise.resolve({ success: true }),
  ]);
}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

### 5.4 Smoke tests

- `print.smoke.test.tsx` étendu :
  - T1 : cash-only → `payment: [{ method: 'cash', amount, cash_received, change_given }]` + `openCashDrawer` appelé 1×
  - T2 : qris-only → `payment: [{ method: 'qris', amount }]` + `openCashDrawer` **non appelé**
  - T3 : split cash+card → `payment: [{ cash, ... }, { card, ... }]` + `openCashDrawer` appelé 1×

---

## 6. Détail F-006 — PIN-en-header sweep

### 6.1 Helper partagé

`supabase/functions/_shared/manager-pin.ts` :

```ts
export class MissingManagerPinError extends Error {
  constructor() { super('manager_pin_required'); }
}
export class InvalidManagerPinError extends Error {
  constructor() { super('manager_pin_invalid_format'); }
}

const PIN_REGEX = /^\d{4,8}$/;

export function getManagerPin(req: Request, opts: { required?: boolean } = {}): string | null {
  const v = req.headers.get('x-manager-pin');
  if (!v) {
    if (opts.required !== false) throw new MissingManagerPinError();
    return null;
  }
  if (!PIN_REGEX.test(v)) throw new InvalidManagerPinError();
  return v;
}
```

Mirror du `_shared/idempotency.ts` S25.

### 6.2 EFs migrées

| EF | Changement |
|---|---|
| `void-order/index.ts` | `const pin = getManagerPin(req)` au lieu de `body.manager_pin`. Drop `manager_pin` du Zod schema body. |
| `cancel-item/index.ts` | Idem. |
| `kiosk-issue-jwt/index.ts` | À auditer en début de Wave — si pin path existe en body, migrer. |

### 6.3 POS hooks adaptés

| Hook | Avant | Après |
|---|---|---|
| `useVoidOrder.ts:46` | `body: JSON.stringify({ order_id, reason, manager_pin: managerPin })` | `headers: { ..., 'x-manager-pin': managerPin }` + body strip `manager_pin` |
| `useCancelOrderItem.ts:55` | Idem | Idem |

### 6.4 Tests live Vitest

- `supabase/tests/functions/void-order-pin-header.test.ts` (3 cas : valid PIN, missing PIN, invalid PIN format)
- Mêmes pour `cancel-item`

---

## 7. Détail F-008 — REVOKE sweep anon

### 7.1 Corrective immédiate

Migration `20260628000012_revoke_send_items_to_kitchen_anon.sql` :

```sql
REVOKE EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) FROM anon, PUBLIC;
-- Defense-in-depth: prevent default grants from re-creating the hole on re-deploy.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

### 7.2 Audit grep sweep

Commande de découverte (à passer en Wave 0 discovery) :

```bash
grep -rn "GRANT EXECUTE.*TO.*anon\|GRANT.*TO authenticated.*anon" supabase/migrations/ | grep -v "20260524000020\|S20"
```

Pour chaque résultat hors-S20, vérifier si la fonction est légitimement anon-callable (rare ici : kiosk JWT issuance). Sinon, REVOKE migration corrective.

**Préallocation** `_013..017` pour REVOKE des fonctions trouvées hors-S20.

---

## 8. Permissions

Aucun nouveau seed permission. Aucune nouvelle ligne `role_permissions`.

---

## 9. Tests

### 9.1 pgTAP

- **`pos_kds_handoff.test.sql`** (12 cas) — F-001 :
  - T1-T6 : invariants `complete_order_v10` insert order_items locked + KDS visible
  - T7-T8 : `pay_existing_order_v6` non-régression
  - T9-T10 : v9 dropped, signature manquante
  - T11-T12 : audit_logs non émis (pas de side-effect supplémentaire)
- **`pos_pin_header_sweep.test.sql`** (4 cas) — F-006 : pgTAP ne teste pas les headers HTTP, donc cases backend uniquement (`refund_order_rpc_v2` propagation déjà OK depuis S25)
- **`anon_revoke_send_items_to_kitchen.test.sql`** (2 cas) — F-008 : SET ROLE anon + tentative EXECUTE → P42501

### 9.2 Vitest live EF

- `supabase/tests/functions/void-order-pin-header.test.ts` (3 cas)
- `supabase/tests/functions/cancel-item-pin-header.test.ts` (3 cas)

### 9.3 POS smoke tests

- `apps/pos/src/features/payment/__tests__/print.smoke.test.tsx` étendu (3 cas T1-T3 split tender drawer)
- `apps/pos/src/features/payment/__tests__/SuccessModal.tenders.smoke.test.tsx` (2 cas tenders array shape)
- `apps/pos/src/features/order-history/__tests__/void-modal-pin-header.smoke.test.tsx` (2 cas)
- `apps/pos/src/features/cart/__tests__/cancel-item-pin-header.smoke.test.tsx` (2 cas)
- `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx` (refactor — `take_out` fixture)

### 9.4 Domain unit

- `packages/domain/src/orders/__tests__/order-type.test.ts` (3 cas type-level + runtime fallback)

### 9.5 Typecheck

`pnpm typecheck` 6/6 PASS attendu post-changes. La modification de `ReceiptPayload.payment` est breaking, donc tous les call sites (uniquement `SuccessModal` + `printService` interne) doivent typer.

---

## 10. Critères d'acceptation

- [ ] F-001 : `pgTAP pos_kds_handoff` 12/12 PASS via cloud MCP. Une commande POS test créée via `complete_order_v10` apparait dans `useKdsOrders` (smoke test ou live verify).
- [ ] F-002 : 0 occurrence de `'take_away'`/`'takeaway'` dans `apps/pos/src/` (hors fichiers test fixtures explicitement renommés). `pnpm test` packages/domain PASS sur new label test.
- [ ] F-004 : Print smoke 3/3 PASS pour split tender + drawer conditionné. Migration print server (externe) trackée en deviation INDEX.
- [ ] F-006 : Vitest live PIN-header 6/6 PASS. Aucun PIN en body JSON dans les 3 EFs migrées.
- [ ] F-008 : pgTAP anon revoke PASS. Audit grep retourne 0 GRANT anon hors fichiers S20 explicitement annotés.
- [ ] F-017 : Doc `02-pos-cart-orders.md §34` corrigée pour `<= 3` au lieu de `<10`.
- [ ] F-018 : Bouton "Recover" retiré OU livré minimalement (revival d'une session crashed via `pos_sessions` row encore `open` mais sans cashier auth — query `useCurrentShift` étendue, UI ré-attache).
- [ ] `pnpm typecheck` 6/6 PASS.
- [ ] Migration block monotonique sans drift.
- [ ] Aucune régression POS smoke tests existants (~24 fichiers actuellement).

---

## 11. Risques & rollback

| Risque | Probabilité | Mitigation |
|---|---|---|
| Bump `complete_order_v9 → v10` casse un call externe non-monorepo | Faible | Wire-protocol identique. Audit `grep -r "complete_order_with_payment_v9" apps/ packages/ supabase/functions/` avant drop. |
| Print server externe pas mis à jour pour `payment[]` shape | Moyenne | Deviation INDEX + flag dans `usePOSPresets` `receipt_v2_enabled` toggle pour rollback. |
| EFs `void-order` / `cancel-item` ont des callers externes (mobile app ?) | Faible | Hard cutover S25-style. POS est le seul caller connu. |
| `kiosk-issue-jwt` migration casse le pairing display | Moyenne | Si la mutation path utilise déjà PIN, migrer. Sinon laisser. Test live `kiosk-issue-jwt.test.ts` regression-checked. |
| `pgTAP pos_kds_handoff` flaky sous cloud MCP | Faible | Pattern S29 — chaque T1-T12 isolé via GUC pour transition entre DO blocks |
| Discovery time block (correctives `_018..020`) insuffisant | Faible | Buffer existant. Au-delà, migration timestamps post-jour-J. |

**Rollback** : Si Wave 1 échoue (F-001), `DROP FUNCTION complete_order_with_payment_v10; CREATE FUNCTION complete_order_with_payment_v9 ...` (réimport depuis git history). Wire-protocol POS inchangé → rien à modifier côté apps.

---

## 12. Hors scope explicite

**Reporté S32** : F-003 (held orders DB), F-005 (VirtualKeypad), F-007 (live cart mirror), F-009 (Settings tabs), F-014 (Lock Terminal), F-015/F-016/F-019/F-020 (Minor bundle).

**Reporté backlog stratégique** : F-010 (scan QR caméra), F-011 (ComboSelectorModal), F-012 (vente au poids), F-013 (Stripe Terminal pre-auth).

**Décision business à acter (hors S31)** :
- Option B pour F-001 (draft orders persistés) — si métier veut vraiment "Send to Kitchen avant Checkout".
- Allergens sur receipt / display — revisiter `project_allergens_wontfix` ?
- Print server externe — qui le gère ? Doit-il être absorbé dans le monorepo (Node side-app) ?

---

## 13. Migration ordering

```
20260628000010_bump_complete_order_v10.sql           -- F-001
20260628000011_revoke_pair_complete_order_v10.sql    -- F-001 anon REVOKE pair canonique
20260628000012_revoke_send_items_to_kitchen.sql      -- F-008
20260628000013..017_revoke_<other_anon_grants>.sql   -- F-008 sweep (si discovery trouve > 0)
20260628000018..020 buffer correctives
```

EFs deployés via `mcp__plugin_supabase_supabase__deploy_edge_function` :
- `_shared/manager-pin.ts` (helper module, no deploy)
- `void-order` (re-deploy après header change)
- `cancel-item` (re-deploy après header change)
- `kiosk-issue-jwt` (re-deploy si mutation path migré)
