> 🗄️ **ARCHIVED / SUPERSEDED (banner added 2026-06-12).** This draft numbered the POS Critical Fixes as **Session 34** before the **Station Ticket Printing** track took the S34 slot (merged PR #54/#56). Never executed under this scope (no INDEX). Les findings se sont dissous ailleurs : **F-002/F-008 → S36** (PR #68), **F-006 PIN-en-body → PR #53**, **F-004 receipt/drawer → S35/S35a** (PR #62/#61), **F-001 Option B (draft-order RPCs) → abandonné** — le S35 INDEX l'acte comme « S34 draft-RPC myth » (DEV-S35-PLAN-01) ; les held orders ont shippé en Option A (`orders.is_held`, S35). Kept verbatim for history — do not act on the session number.

# Session 34 — POS Critical Fixes (Spec)

> **Date** : 2026-05-29
> **Branche cible** : `swarm/session-34`
> **Base** : `master` @ post-merge S33 PR (Orders v2 BO) — S34 dépend de S33 pour le helper `_recalc_order_totals` (réutilisé) et la convention de filtres realtime.
> **Effort estimé** : ~8-12 jours wall-time (L) — dominé par F-001 Option B (full draft-order flow). Les 5 autres findings sont S/XS et parallélisables.
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Source** : [`docs/audit/2026-05-28-pos-audit.md`](../../../audit/2026-05-28-pos-audit.md) — Couche 2 findings F-001, F-002, F-004, F-006, F-008 + minor F-016/F-017/F-018.
> **Decisions user (2026-05-29)** : (1) split en S34 Critical + S35 Polish ; (2) F-001 = **Option B** (full draft-order flow, pas le quick v10 bump) ; (3) full plan pour S34, spec-only pour S35.

---

## 1. Contexte

L'audit POS intégral du 2026-05-28 a relevé **4 dettes critiques cachées** + un lot de findings *Major/Minor*. S34 ferme la couche **critique** la plus dangereuse en production — celle qui casse des promesses métier ou ouvre une faille fraude/sécurité :

1. **F-001 🔴** — `useSendToKitchen` est un no-op client-side. Le KDS ne reçoit **jamais** les commandes prises au comptoir. La promesse `POS.md §6` (« envoyer au boulanger AVANT de payer ») est cassée.
2. **F-002 🔴** — drift `take_away`/`takeaway` vs enum DB `take_out` dans 5 fichiers POS → branches mortes silencieuses, snake_case affiché à l'écran client.
3. **F-004 🔴** — le ticket imprimé hardcode `payment.method: 'cash'` et le tiroir-caisse s'ouvre **inconditionnellement** quel que soit le mode de paiement → ticket faux + vulnérabilité fraude.
4. **F-006 🟠** — `useVoidOrder` et `useCancelOrderItem` envoient le `manager_pin` dans le **body JSON** → viole la convention S25 « PIN en header HTTP, jamais en body » (fuite logs).
5. **F-008 🟠** — `send_items_to_kitchen` a un `GRANT EXECUTE ... TO anon` → viole le défense-in-depth anon S20.
6. **Minor bundle** — F-016 (callbacks SideMenuDrawer non câblés), F-017 (seuil stock bas divergent doc/code), F-018 (toast « Recover not implemented »).

**F-003 (held orders DB-backed)** et le reste des *Major* (F-005 VirtualKeypad, F-007 live cart mirror, F-009 Settings tabs, F-014 Lock Terminal) sont renvoyés à **S35 — POS Service Polish**. Les *Major* externes (F-010 QR scan, F-011 ComboSelector, F-012 vente au poids, F-013 Stripe Terminal) restent **backlog S36+**.

---

## 2. Architecture (choix structurants)

### F-001 — Draft-order flow (Option B)

**Découverte clé (audit-grounding 2026-05-29)** : l'infrastructure de checkout *réutilise déjà un order existant* via `cartStore.pickedUpOrderId` + `pay_existing_order_v6` (chemin tablette, `useCheckout.ts:66-103`). `pay_existing_order_v6` **ne renvoie pas les items du cart** — il paie un order dont les `order_items` sont **déjà persistés** en DB. La table `order_items` est donc déjà dans la publication realtime (le flux tablette KDS marche), et le KDS lit `WHERE is_locked = true` (`useKdsOrders.ts:~108`).

➡️ **Option B ne nécessite PAS de `complete_order_with_payment_v10`.** Elle réutilise le chemin `pickedUpOrderId → pay_existing_order_v6`. Il manque uniquement le **côté "création/append du draft order"**, exactement comme `create_tablet_order_v2` le fait pour les tablettes.

**Choix 1 — 2 nouvelles RPCs draft-order (mirror `create_tablet_order_v2`)** :
- `create_draft_order_with_items_v1(p_session_id UUID, p_order_type order_type, p_table_number TEXT, p_customer_id UUID, p_items JSONB, p_client_uuid UUID)` → INSERT order `status='draft'`, `created_via='pos'` + INSERT order_items avec `is_locked=true, sent_to_kitchen_at=now(), kitchen_status='pending'` + `_recalc_order_totals` (helper S33) + idempotency-keyed (table dédiée). Retourne `{ order_id, order_number, item_ids JSONB }` mappant chaque `client_line_id` → `order_item_id`.
- `append_draft_order_items_v1(p_order_id UUID, p_items JSONB, p_lock BOOLEAN, p_client_uuid UUID)` → INSERT items additionnels à un order `status='draft'` existant. `p_lock=true` → envoie au KDS immédiatement (`is_locked=true, sent_to_kitchen_at=now()`). `p_lock=false` → items non envoyés (ajoutés mais pas en cuisine — auto-flush au checkout). Recalc totals. Retourne `{ item_ids JSONB }`.

**Choix 2 — DRY via helper interne `_insert_draft_order_items(p_order_id, p_items JSONB, p_lock BOOLEAN)`**. Extrait la boucle d'INSERT order_items + stock_movements + dispatch_station resolution partagée entre `create_draft_order_with_items_v1`, `append_draft_order_items_v1`, et (idéalement, refacto opportuniste) `create_tablet_order_v2`. SECURITY DEFINER, REVOKE all (helper interne, pattern S28 `_emit_expense_je`). **Refacto `create_tablet_order_v2` sur ce helper = optionnel** (si trop risqué, garder sa boucle propre et noter en déviation).

**Choix 3 — idempotency table dédiée `draft_order_idempotency_keys`** (PK `client_uuid UUID`, cols `order_id`, `result JSONB`, `created_at`). Pattern S25 flavor 2 (mirror `tablet_order_idempotency_keys`). REVOKE all from anon/authenticated, GRANT SELECT only. Concurrency race → `EXCEPTION WHEN unique_violation` re-read.

**Choix 4 — `cartStore.draftOrderId`** (nouveau champ, parallèle à `pickedUpOrderId`). `useSendToKitchen` réel :
- Si `draftOrderId == null` ET `pickedUpOrderId == null` → `create_draft_order_with_items_v1(unlockedItems)` → set `draftOrderId = order_id` + `markLocked(lineIds)` + stocke le mapping `client_line_id → order_item_id` dans `cartStore.serverItemIds`.
- Si `draftOrderId != null` → `append_draft_order_items_v1(p_lock=true, unlockedItems)` → `markLocked` + merge mapping.
- Si `pickedUpOrderId != null` (tablette pickup) → append sur l'order tablette (même RPC append).

**Choix 5 — checkout consomme `draftOrderId`** : dans `useCheckout`, la condition `if (pickedUpOrderId)` devient `const existingOrderId = pickedUpOrderId ?? draftOrderId; if (existingOrderId) { ... pay_existing_order_v6(p_order_id: existingOrderId) }`. **Auto-flush** : si `existingOrderId` est set ET il reste des `unlockedItems()` (items ajoutés mais jamais envoyés en cuisine), appeler `append_draft_order_items_v1(p_lock=false)` AVANT `pay_existing_order_v6` pour garantir zéro perte d'item. (`pay_existing_order_v6` ne lit pas le cart → tout item non persisté serait sinon perdu.)

**Choix 6 — `SendToKitchenButton` honnête** : toast `Sent N item(s) to kitchen` ne s'affiche qu'après succès RPC réel (déjà le cas via `mutateAsync` — le no-op devient un vrai appel). En cas d'erreur RPC → toast error (déjà géré).

**Choix 7 — KDS : zéro changement.** Les draft orders POS apparaissent automatiquement car `is_locked=true` à l'INSERT et `order_items` est déjà publié realtime. Wave 1.A **vérifie** la publication ; sinon migration conditionnelle `ALTER PUBLICATION`.

**Choix 8 — reset lifecycle.** `resetCartAfterCheckout()` et le "New Order" reset doivent clear `draftOrderId` + `serverItemIds`. Le `useRef(crypto.randomUUID())` du `client_uuid` est régénéré à chaque nouveau cart.

### F-002 — Enum label helper

**Choix 9 — helper pur dans `@breakery/domain`** : `ORDER_TYPE_LABELS: Record<OrderType, string>` + `orderTypeLabel(t: string): string`. Test type-level forçant la couverture complète de l'enum. Les 5 sites POS consomment uniquement ce helper. Supprime toute comparaison à `'take_away'`/`'takeaway'`.

### F-004 — Multi-tender receipt + conditional drawer

**Choix 10 — `ReceiptPayload.payment: ReceiptTender[]`** (breaking shape change du print payload). Chaque tender = `{ method: PaymentMethod; amount: number; cash_received?: number; change_given?: number; reference?: string }`. `buildReceiptPayload` lit `props.tenders` (nouvelle prop `SuccessModal`) au lieu du hardcode. `order_type` du payload accepte `OrderType` complet (`dine_in | take_out | delivery | b2b`), plus de coercition silencieuse.

**Choix 11 — drawer conditionnel** : `SuccessModal` `useEffect` → `void handlePrint(); if (tenders.some(t => t.method === 'cash')) void openCashDrawer();`. Plus de `Promise.all` inconditionnel.

**Choix 12 — receipt template print-server** : doc-only dans ce repo (le print-server est externe `localhost:3001`). Le payload multi-tender est rétro-compatible côté serveur si le template itère `payment[]` ; **noter** que le template print-server doit être mis à jour hors-repo. Test : smoke vérifie que le payload contient bien le array tenders + que `openCashDrawer` n'est PAS appelé pour QRIS-only.

### F-006 — PIN-en-header sweep

**Choix 13 — hard cutover S25 pattern** sur 2 EFs (`void-order`, `cancel-item`) : lecture via `getManagerPin(req)` helper (ou `req.headers.get('x-manager-pin')`), drop du champ body dans le même commit. Hooks POS `useVoidOrder` + `useCancelOrderItem` envoient le PIN via header `x-manager-pin`. Pas de dual-mode (seul le POS appelle ces EFs). `kiosk-issue-jwt` mutation paths : **hors scope S34** (pas de PIN manager — token JWT, sweep séparé backlog).

### F-008 — anon REVOKE

**Choix 14 — migration corrective** : `REVOKE EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) FROM anon, PUBLIC;` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` (template canonique S20/S25). **Sweep bonus** : grep des RPCs pré-S20 (`supabase/migrations/2026050*`) avec `TO ... anon` → liste en déviation, REVOKE par lot si trivial (sinon backlog).

### Minor

**Choix 15** — F-016 : câbler `onOpenHeldOrders`, `onOpenCustomers` (et `onLockTerminal` → no-op laissé à S35 F-014) dans `Pos.tsx` `<SideMenuDrawer>`. F-017 : aligner la **doc** (`POS.md`/module ref) sur le seuil `<= 3` réel (décision audit : 3 est correct pour la rotation boulangerie) + commentaire explicatif dans `ProductGrid.tsx`. F-018 : remplacer le toast `Recover shift not implemented yet` par soit un bouton désactivé avec tooltip "Coming soon", soit le retirer (décision : désactiver + tooltip).

---

## 3. DB changes (Wave 1)

Block `20260619000010..` (numérotation monotone post-S33 `20260618xxx`). **Vérifier `supabase/migrations/` avant de figer les numéros** (S33 a réservé `..024`).

| # | Migration | Action |
|---|---|---|
| `_010` | `create_draft_order_idempotency_keys_table` | `CREATE TABLE draft_order_idempotency_keys (client_uuid UUID PRIMARY KEY, order_id UUID NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` + RLS + REVOKE all anon/authenticated + GRANT SELECT authenticated |
| `_011` | `create_insert_draft_order_items_helper` | `_insert_draft_order_items(p_order_id, p_items JSONB, p_lock BOOLEAN)` SECURITY DEFINER + REVOKE all (helper interne) — boucle INSERT order_items (dispatch_station resolve, modifiers, line_total) + stock_movements `'sale'`. **NB** : ne décrémente PAS le stock au draft (la vente n'est pas finalisée). Décision : stock_movements émis seulement à `pay_existing_order_v6`. Donc `_insert_draft_order_items` n'insère QUE les order_items (pas stock_movements) ; voir §9 R-S34-2. |
| `_012` | `create_create_draft_order_with_items_v1_rpc` | SECURITY DEFINER + gate `sales.create` + INSERT order draft + appel helper (`p_lock=true`) + `_recalc_order_totals` (S33) + idempotency replay via `draft_order_idempotency_keys` + audit_log `order.draft_created` |
| `_013` | `revoke_anon_create_draft_order_with_items_v1` | REVOKE pair S25 canonique |
| `_014` | `create_append_draft_order_items_v1_rpc` | SECURITY DEFINER + gate `sales.create` + status check `WHERE status='draft'` + appel helper (`p_lock` param) + recalc + idempotency + audit_log `order.draft_appended` |
| `_015` | `revoke_anon_append_draft_order_items_v1` | REVOKE pair S25 |
| `_016` | `revoke_anon_send_items_to_kitchen` | **F-008** : `REVOKE EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) FROM anon, PUBLIC` + ALTER DEFAULT PRIVILEGES template |
| `_017` (cond.) | `alter_publication_realtime_order_items` | Si `order_items` PAS dans `supabase_realtime` (check Wave 1.A) : `ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items`. Sinon skip. |

**Block total : 7-8 migrations** (`_010..016` obligatoires + `_017` conditionnelle + correctives éventuelles).

### 3.1 — Dépendance S33

`_recalc_order_totals(p_order_id UUID)` est livré par **S33 Wave 1 (`20260618000015`)**. S34 le réutilise. Si S33 n'est pas mergé au démarrage de S34 → Wave 1.A le crée en préalable (copie depuis le spec S33 §3.3). Sinon réutilise tel quel.

### 3.2 — Types regen

Post-Wave 1 via MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`. Touche :
- `Tables['draft_order_idempotency_keys']` (nouvelle)
- `Functions['create_draft_order_with_items_v1']`, `Functions['append_draft_order_items_v1']`

---

## 4. POS hooks + domain + types (Wave 2 + 3)

### 4.1 — Domain (`@breakery/domain`) — F-002

`packages/domain/src/orders/orderTypeLabel.ts` (NEW) :

```ts
import type { OrderType } from '../types'; // ('dine_in' | 'take_out' | 'delivery' | 'b2b')

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b: 'B2B',
};

export function orderTypeLabel(t: string): string {
  return (ORDER_TYPE_LABELS as Record<string, string>)[t] ?? t;
}
```

Re-export depuis `packages/domain/src/index.ts`.

### 4.2 — cartStore (`apps/pos/src/stores/cartStore.ts`) — F-001

Champs ajoutés à `CartState` :
```ts
draftOrderId: string | null;                 // order_id du draft créé par Send-to-Kitchen
serverItemIds: Record<string, string>;       // client_line_id → order_item_id
clientUuid: string;                           // useRef-style UUID pour idempotency draft RPCs
```
Actions ajoutées :
```ts
setDraftOrder: (orderId: string, mapping: Record<string, string>) => void;  // merge mapping
mergeServerItemIds: (mapping: Record<string, string>) => void;
```
`resetCartAfterCheckout()` + le reset "New Order" clear `draftOrderId`, `serverItemIds`, régénèrent `clientUuid`.

### 4.3 — Hooks POS

| Hook | Type | Path | Notes |
|---|---|---|---|
| `useSendToKitchen` | **rewrite** | `apps/pos/src/features/cart/hooks/useSendToKitchen.ts` | create vs append selon `draftOrderId`. Vrai appel RPC. Set draftOrderId + mapping + markLocked. |
| `useCheckout` | **extend** | `apps/pos/src/features/payment/hooks/useCheckout.ts` | `existingOrderId = pickedUpOrderId ?? draftOrderId` ; auto-flush unlocked via append `p_lock=false` avant `pay_existing_order_v6`. |
| `useVoidOrder` | **edit** | `apps/pos/src/features/order-history/hooks/useVoidOrder.ts` | PIN body → header `x-manager-pin` (F-006). |
| `useCancelOrderItem` | **edit** | `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts` | PIN body → header `x-manager-pin` (F-006). |

### 4.4 — Print service types (F-004)

`apps/pos/src/services/print/printService.ts` :
```ts
export interface ReceiptTender {
  method: 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';
  amount: number;
  cash_received?: number;
  change_given?: number;
  reference?: string;
}
export interface ReceiptPayload {
  // ...
  order: { /* ... */ order_type: 'dine_in' | 'take_out' | 'delivery' | 'b2b' };
  payment: ReceiptTender[];   // was: { method: 'cash'; ... }
  // ...
}
```

---

## 5. UI changes (Wave 2 + 4 + 6)

### 5.1 — SendToKitchenButton (F-001)
`apps/pos/src/features/cart/SendToKitchenButton.tsx` : mettre à jour le commentaire (retirer le caveat v1), le toast reste mais reflète un vrai succès serveur. Pas de changement visuel.

### 5.2 — SuccessModal (F-004)
`apps/pos/src/features/payment/SuccessModal.tsx` :
- Nouvelle prop `tenders: ReceiptTender[]` (remplace `paymentMethod`/`cashReceived` au niveau receipt build ; garder `cashReceived`/`changeGiven` pour l'affichage UI summary).
- `buildReceiptPayload` lit `props.tenders`.
- `useEffect` : `void handlePrint(); if (props.tenders.some(t => t.method === 'cash')) void openCashDrawer();`
- Le call-site (`PaymentTerminal`/`SuccessModal` parent) doit fournir `tenders` depuis le `paymentStore`/résultat checkout.

### 5.3 — Enum drift sites (F-002)
5 fichiers consomment `orderTypeLabel` :
- `apps/pos/src/features/display/components/OrderQueueTicker.tsx:33`
- `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55`
- `apps/pos/src/features/order-history/OrderHistoryPanel.tsx:189`
- `apps/pos/src/features/cart/HeldOrdersModal.tsx:276` (cosmétique)
- fixture `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx:48` → `order_type: 'take_out'`

### 5.4 — Minor (Wave 6)
- `Pos.tsx:170-180` : câbler `onOpenHeldOrders`, `onOpenCustomers` au `<SideMenuDrawer>` (F-016).
- `ProductGrid.tsx:124` : commentaire explicatif seuil `<= 3` (F-017) + aligner doc.
- `Pos.tsx:196` : `onRecover` → bouton disabled + tooltip au lieu du toast (F-018).

---

## 6. Test plan (Wave 1.G + per-wave + Wave 6 sweep)

| Suite | Compte | Path |
|---|---|---|
| pgTAP `draft_order_flow` (create 5 + append 4 + idempotency 2 + helper 1) | ~12 | `supabase/tests/draft_order_flow.test.sql` |
| pgTAP `send_items_revoke` (anon REVOKE F-008) | ~2 | `supabase/tests/send_items_revoke.test.sql` |
| domain unit `orderTypeLabel` (+ type-level coverage) | ~4 | `packages/domain/src/orders/__tests__/orderTypeLabel.test.ts` |
| POS smoke `send-to-kitchen-persists` (create + append + KDS appears) | ~4 | `apps/pos/src/features/cart/__tests__/send-to-kitchen.smoke.test.tsx` |
| POS smoke `checkout-reuses-draft` (existingOrderId + auto-flush) | ~3 | `apps/pos/src/features/payment/__tests__/checkout-draft.smoke.test.tsx` |
| POS smoke `success-modal-tenders` (multi-tender payload + drawer conditional) | ~4 | `apps/pos/src/features/payment/__tests__/success-modal-tenders.smoke.test.tsx` |
| POS smoke enum drift (`OrderQueueTicker`/`CurrentOrderCard` label) | ~3 | existing extended |
| Vitest live EF `void-order` + `cancel-item` PIN header | ~4 | `supabase/tests/functions/pin-header-sweep.test.ts` |
| POS smoke `useVoidOrder`/`useCancelOrderItem` header | ~2 | existing extended |
| Non-regression : tablet flow (`create_tablet_order_v2` + `pay_existing_order_v6`) | ~4 | existing |
| `pnpm typecheck` (6 packages) | 6/6 | turbo |
| **Total** | **~46 tests** | |

### 6.1 — pgTAP `draft_order_flow` cases

- T1 `create_draft_order_with_items_v1` happy → order status='draft', created_via='pos', items is_locked=true + sent_to_kitchen_at set
- T2 perm gate (role sans `sales.create`) → 42501
- T3 idempotency replay (même client_uuid) → renvoie le même order_id, pas de doublon
- T4 totals recalc correct (subtotal/tax/total via `_recalc_order_totals`)
- T5 item_ids mapping retourné couvre tous les client_line_id
- T6 `append_draft_order_items_v1` happy `p_lock=true` → nouveaux items is_locked=true
- T7 append `p_lock=false` → items is_locked=false, sent_to_kitchen_at NULL
- T8 append sur order status='completed' → P0002 (statut invalide)
- T9 append recalc totals incrémental
- T10 helper `_insert_draft_order_items` REVOKE'd from authenticated (perm catalog assert)
- T11 KDS visibility : items du draft visibles via `WHERE is_locked=true` (SELECT count)
- T12 draft → `pay_existing_order_v6` transition status draft→completed (intégration légère)

---

## 7. Permissions

| Permission | Action | Roles |
|---|---|---|
| `sales.create` | reuse (gate des draft RPCs) | CASHIER+ existant |

Aucune nouvelle permission seedée — les draft RPCs réutilisent `sales.create` (même gate que `complete_order`/`create_tablet_order`). F-006/F-008 sont des durcissements, pas de nouvelle perm.

---

## 8. Migrations applied

Block `20260619000010..017` (7-8 migrations, dont 1 conditionnelle) — détaillé §3.

---

## 9. Risks & deviations to anticipate

| ID | Risk | Mitigation |
|---|---|---|
| R-S34-1 | S33 pas mergé → `_recalc_order_totals` absent | Wave 1.A : si absent, créer en préalable (copie spec S33 §3.3) |
| R-S34-2 | Stock double-décrément : si draft émet stock_movements ET pay_existing_order aussi | **Décision** : draft RPCs n'émettent PAS de stock_movements. Le décrément reste exclusivement dans `pay_existing_order_v6` (vérifier qu'il le fait pour les items déjà présents — sinon adapter). Wave 1.A vérifie le comportement stock de `pay_existing_order_v6` sur order tablette. |
| R-S34-3 | `pay_existing_order_v6` ne décrémente pas le stock des items draft (supposait insert tablette le faisait) | Wave 1.A audit. Si trou → corrective dans le helper ou bump pay_existing_order_v7. Tracker en déviation. |
| R-S34-4 | `order_items` pas publié realtime | `_017` conditionnel après check |
| R-S34-5 | Auto-flush append au checkout double les items si déjà lockés | Auto-flush ne flush QUE `unlockedItems()` (items jamais envoyés). Items lockés déjà persistés → exclus. |
| R-S34-6 | Refacto `create_tablet_order_v2` sur le helper casse le flux tablette | **Refacto optionnelle** — si risque, garder la boucle tablette propre, helper utilisé seulement par les 2 nouvelles RPCs. Noter déviation. |
| R-S34-7 | `SuccessModal` call-site ne dispose pas de `tenders[]` structurés | Vérifier `paymentStore`/résultat `useCheckout`. Si seul `paymentMethod` scalaire dispo en split-pay → reconstruire tenders depuis `TenderListBuilder` state. |
| R-S34-8 | Print-server externe template ne gère pas `payment[]` array | Doc-only : noter que le print-server hors-repo doit itérer `payment[]`. Payload rétro-compatible si template lit `payment[0]` en fallback. |
| R-S34-9 | EF `void-order`/`cancel-item` ont des callers externes inconnus | Audit : seul POS appelle. Hard cutover OK (convention S25). |
| R-S34-10 | F-008 sweep révèle N autres RPCs anon-granted pré-S20 | Lister en déviation. REVOKE par lot si trivial, sinon backlog `S36+ anon-sweep`. |

---

## 10. Acceptance criteria

- [ ] **Wave 1** : 7-8 migrations apply OK cloud V3 dev + types regen committée
- [ ] pgTAP `draft_order_flow` 12/12 PASS via cloud MCP
- [ ] pgTAP `send_items_revoke` 2/2 PASS
- [ ] **Wave 2** : `useSendToKitchen` rewrite (vrai RPC) + `cartStore.draftOrderId` + `useCheckout` reuse path + auto-flush
- [ ] POS smoke send-to-kitchen 4/4 + checkout-draft 3/3 PASS
- [ ] KDS reçoit bien une commande comptoir (smoke ou manuel runtime-verified via MCP Preview)
- [ ] **Wave 3** : `orderTypeLabel` helper + 5 sites migrés + fixture corrigée — domain unit 4/4 PASS
- [ ] **Wave 4** : `ReceiptPayload.payment: ReceiptTender[]` + drawer conditionnel — smoke 4/4 PASS, drawer NON appelé pour QRIS-only
- [ ] **Wave 5** : PIN-en-header `void-order` + `cancel-item` EFs + hooks — Vitest live 4/4 + smoke 2/2 PASS
- [ ] **Wave 6** : F-016/017/018 minor + sweep + INDEX
- [ ] Non-régression tablet flow ~4/4 PASS
- [ ] `pnpm typecheck` 6/6 PASS
- [ ] INDEX `2026-05-29-session-34-INDEX.md` créé + CLAUDE.md Active Workplan bumpé

---

## 11. Out of scope (S35 / backlog)

**S35 — POS Service Polish** : F-003 (held orders DB-backed), F-005 (VirtualKeypadProvider + QwertyLayout), F-007 (live cart mirror BroadcastChannel), F-009 (Printing settings tab → résout F-015), F-014 (Lock Terminal). Voir [`./2026-05-29-session-35-spec.md`](./2026-05-29-session-35-spec.md).

**Backlog S36+** : F-010 (QR/barcode scan), F-011 (ComboSelectorModal), F-012 (vente au poids), F-013 (Stripe Terminal pre-auth), F-019 (debts inline payment), F-020 (CartItemRow/CartLineRow dedup), F-021 (`useDisplayRealtime` typings), F-022 (cart TTL UX), F-023 (NPWP receipt), F-024 (modifier receipt test coverage), `kiosk-issue-jwt` PIN sweep, F-008 anon RPC global sweep.

**Décisions business à acter** : allergens receipt/display (`project_allergens_wontfix` — user-locked 2026-05-17), offline mode dégradé, Apple Pay/Google Pay.

---

## 12. Files touched (preview)

### DB + tests
- `supabase/migrations/20260619000010_create_draft_order_idempotency_keys_table.sql`
- `supabase/migrations/20260619000011_create_insert_draft_order_items_helper.sql`
- `supabase/migrations/20260619000012_create_create_draft_order_with_items_v1_rpc.sql`
- `supabase/migrations/20260619000013_revoke_anon_create_draft_order_with_items_v1.sql`
- `supabase/migrations/20260619000014_create_append_draft_order_items_v1_rpc.sql`
- `supabase/migrations/20260619000015_revoke_anon_append_draft_order_items_v1.sql`
- `supabase/migrations/20260619000016_revoke_anon_send_items_to_kitchen.sql`
- `supabase/migrations/20260619000017_alter_publication_realtime_order_items.sql` (conditionnel)
- `supabase/tests/draft_order_flow.test.sql`
- `supabase/tests/send_items_revoke.test.sql`
- `supabase/tests/functions/pin-header-sweep.test.ts`

### EF
- `supabase/functions/void-order/index.ts` (PIN body→header)
- `supabase/functions/cancel-item/index.ts` (PIN body→header)
- `supabase/functions/_shared/manager-pin.ts` (NEW helper `getManagerPin(req)` — optionnel, sinon inline)

### Domain
- `packages/domain/src/orders/orderTypeLabel.ts` (NEW)
- `packages/domain/src/index.ts` (re-export)

### POS hooks + store
- `apps/pos/src/stores/cartStore.ts` (draftOrderId + serverItemIds + clientUuid)
- `apps/pos/src/features/cart/hooks/useSendToKitchen.ts` (rewrite)
- `apps/pos/src/features/payment/hooks/useCheckout.ts` (reuse path + auto-flush)
- `apps/pos/src/features/order-history/hooks/useVoidOrder.ts` (PIN header)
- `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts` (PIN header)

### POS UI
- `apps/pos/src/features/cart/SendToKitchenButton.tsx` (comment + honest toast)
- `apps/pos/src/features/payment/SuccessModal.tsx` (tenders + conditional drawer)
- `apps/pos/src/services/print/printService.ts` (ReceiptTender[])
- `apps/pos/src/features/display/components/OrderQueueTicker.tsx` (orderTypeLabel)
- `apps/pos/src/features/display/components/CurrentOrderCard.tsx` (orderTypeLabel)
- `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` (orderTypeLabel)
- `apps/pos/src/features/cart/HeldOrdersModal.tsx` (orderTypeLabel)
- `apps/pos/src/pages/Pos.tsx` (F-016 callbacks + F-018 recover button)
- `apps/pos/src/features/products/ProductGrid.tsx` (F-017 comment)

### Types
- `packages/supabase/src/types.generated.ts` (regen post Wave 1)

### Workplan
- `docs/workplan/specs/2026-05-29-session-34-spec.md` (this file)
- `docs/workplan/plans/2026-05-29-session-34-plan.md`
- `docs/workplan/plans/2026-05-29-session-34-INDEX.md` (created at session close)
