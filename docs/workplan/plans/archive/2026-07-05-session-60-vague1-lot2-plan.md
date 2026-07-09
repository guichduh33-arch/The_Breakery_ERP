# Session 60 — Remise à plat Vague 1, lot 2 : quick wins sous règle money-path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les 6 quick wins « sous règle money-path » du lot 2 (`docs/workplan/remise-a-plat/00-INDEX.md` §3) : paiement direct ardoise (02 D1.1), `reason_code` dans `CashInOutModal` + montage du modal orphelin (12 D1.1), note d'écart enforced serveur via `close_shift_v3` (12 D1.4), lignes promo sur ticket + détail BO (13 D1.1/D1.2), « All ready » bump en masse KDS via `kds_bump_order_v1` (04 D1.2), `x-idempotency-key` sur le void BO (02b D1.1).

**Architecture:** Deux migrations DB seulement (`_105` bump `close_shift_v3`, `_106` nouveau `kds_bump_order_v1`), tout le reste est du câblage client sur des RPCs/hooks existants. Le verrou money-path est LEVÉ (S58) ; les ancres concernées sont re-passées en fin de session. Exécution : 1 subagent implémenteur + 1 revue par tâche, branche `swarm/session-60` (base `origin/master` = `e8bcd28`).

**Tech Stack:** pnpm 9.15 + turbo, React/TS (apps/pos, apps/backoffice), Supabase cloud V3 `ikcyvlovptebroadgtvd` via MCP (`apply_migration`/`execute_sql`/`generate_typescript_types`), pgTAP via `execute_sql` BEGIN…ROLLBACK, Vitest/RTL smoke.

## Global Constraints

- **DB cloud only** — jamais `supabase start`/`db reset`/`run_pgtap.sh` (Docker retiré). Migrations via MCP `apply_migration`, pgTAP via `execute_sql` enveloppe `BEGIN; … ROLLBACK;`.
- **Jamais de `BEGIN;`/`COMMIT;` dans le corps d'une migration** (le MCP wrappe déjà).
- **RPC versioning monotone** : ne jamais éditer une `_vN` publiée ; bump `_vN+1` + `DROP FUNCTION …vN(<old args>)` dans la MÊME migration.
- **DEV-S57-02** : tout bump part du corps **live** (`SELECT pg_get_functiondef('public.<fn>'::regprocedure)`), JAMAIS du fichier de migration d'origine (drift audit_log→audit_logs S56 avéré sur `close_shift_v2`).
- **Trio S20 anon defense-in-depth** sur toute nouvelle fonction : `REVOKE ALL … FROM PUBLIC` + `REVOKE ALL … FROM anon` + GRANT explicite ; `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`.
- **Numéros de migration réservés** : `20260710000105` (T3), `20260710000106` (T6). Vérifier qu'ils sont toujours libres avant apply.
- **Regen types après chaque migration** : MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`, commité.
- **Audit canonical** : écrire dans `audit_logs` (colonnes `action, entity_type, entity_id, metadata, actor_id`) — jamais `audit_log` (vue droppée S56).
- **Copy UI POS en anglais** (existant : « Start », « Bump Ready », « Mark Served »).
- **Tests co-localisés** dans `__tests__/` ; commandes ciblées `pnpm --filter @breakery/pos test <pattern>` etc. ; suite finale `pnpm typecheck && pnpm build && pnpm test`.
- **Commits conventionnels** + co-author Claude.
- **Règle money-path** : verrou levé (S58) ; en closeout, re-passer les ancres pgTAP touchées (`close_shift`/cash_register, `kds_bump_order`, + suites `users`/`expenses` inchangées) et le live-RPC `supabase/tests/functions/cash-register-close.test.ts` (repointé v3 par T3).

### Faits vérifiés en préparation (ne pas re-découvrir)

- `get_pos_b2b_debts_v3` renvoie tout order non-voided avec `outstanding > 0.001`, **y compris B2B** (`order_type='b2b'`, statut `b2b_pending`). Colonnes : `order_id, order_number, order_type, total, paid, outstanding, created_at, customer_id, customer_name, customer_phone, b2b_credit_limit, b2b_current_balance` (migration `20260710000071`).
- Garde de payabilité de `pay_existing_order_v11` (`20260710000096:153-157`) : `status='draft' OR (status='pending_payment' AND created_via='pos')`. Une ardoise caisse (`fire_counter_order_v4` → `pending_payment`+`created_via='pos'`) **passe** ; un order B2B **ne passe pas** (voulu — règlement B2B au BO via `record_b2b_payment_v2`).
- `reopen_held_order_v1` exige `is_held=true` → **inutilisable** pour l'ardoise. Pattern à mirroir : `usePickupTabletOrder` (SELECT `order_items` — colonne **`name_snapshot`**, PAS `name` — puis `restoreCart` + `markLocked` + `setPickedUpOrderId`).
- `useCheckout` aiguille vers `pay_existing_order_v11` ssi `pickedUpOrderId` non-null (l.84) ; l'append `fire_counter_order_v4` ne se déclenche que si `printedItemIds.length > 0` et seulement pour les lignes non encore envoyées.
- `CashInOutModal` est **orphelin** (aucun import dans apps/) ; le hook `useCashMovement` supporte déjà `reason_code?: 'apport_owner'|'bank_transfer'|'replenishment'|'misc'` et `idempotency_key?`. `record_cash_movement_v2` émet une JE pour `apport_owner` (DR 1110/CR 3100) et `bank_transfer` (in : DR 1110/CR 1112 ; out : DR 1112/CR 1110) ; `replenishment`/`misc`/NULL = pas de JE.
- `close_shift_v2(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` ne lit **jamais** `business_config.shift_variance_threshold_abs/pct` (defaults live 50000 / 0.0050) — l'obligation de note > seuil est UI-only (`CloseShiftModal` + `shouldShowWarning` de `VarianceWarningBadge.tsx:14-24`).
- pgTAP `supabase/tests/cash_register.test.sql` est **STALE** (T_SHIFT_03 asserte `record_cash_movement_v1`/`close_shift_v1`, droppées) — réparé par T3.
- `ReceiptPayload` (`printService.ts:54-80`) n'a aucun champ promo ; le rendu du ticket est fait par un **print-bridge externe** (hors repo) — le champ ajouté est transporté ; mode test `VITE_PRINT_MOCK` bufferise le payload. L'enveloppe v17 ne renvoie que `promotion_total` agrégé → la source des noms = `cartStore.appliedPromotions` (`AppliedPromotion { promotion_id, slug, name, type, amount, … }`, `packages/domain/src/promotions/types.ts:105-124`), encore présent dans le store pendant `SuccessModal` (reset seulement à `handleNewOrder`).
- `promotion_applications` (id, order_id, promotion_id, amount, description NOT NULL snapshot, created_at, UNIQUE(order_id,promotion_id)) : RLS SELECT `is_authenticated()` → lisible BO sans migration ; embed FK `promotion_applications_promotion_id_fkey` → `promotions(name)` existe mais RLS `promotions` filtre `deleted_at IS NULL` → **`description` = libellé primaire**, `promotions?.name` fallback.
- `useOrderDetail` (BO) est partagé par `OrderDetailPage` (bloc totaux l.161-178) et `OrderDetailDrawer` (l.165-180) — une seule modif de hook, deux rendus.
- KDS post-S59 : `KdsOrderCard({ items: KdsItemRow[] })`, CTAs par item via `ItemCta` ; `kds_bump_item_v1` exige `kitchen_status='preparing'` (P0011) → un « All ready » par boucle client ne couvre pas les `pending`. **Aucun RPC bump par commande n'existe** ; modèle atomique = `kds_recall_order_v1` (`20260517000151:216-274`, gate `kds.operate`).
- Void BO : `VoidOrderModal.tsx:19` génère `idem = useRef(crypto.randomUUID())` jamais transmis ; `useVoidOrder.ts` (BO) n'a ni `idempotencyKey` dans `VoidArgs` ni header ; l'EF `void-order` lit déjà `x-idempotency-key` (`index.ts:73-81`) et le propage à `void_order_rpc_v4`. Parité POS : `apps/pos/src/features/order-history/hooks/useVoidOrder.ts:43-44`. Commentaire stale `VoidOrderModal.tsx:4` (« PIN sent in body ») à corriger.

---

## Task 0 : Branche de session

- [ ] **Step 0.1 : créer la branche**

```bash
git fetch origin master
git checkout -b swarm/session-60 origin/master
```

Expected: branche `swarm/session-60` sur `e8bcd28`.

---

### Task 1 : POS — payer l'ardoise directement depuis `/pos/debts` (fiche 02 D1.1)

**Files:**
- Create: `apps/pos/src/features/customers/hooks/useLoadDebtOrder.ts`
- Create: `apps/pos/src/features/customers/__tests__/load-debt-order.smoke.test.tsx`
- Modify: `apps/pos/src/features/customers/CustomerDebtsPanel.tsx` (CTA Pay l.118-123 et 274-276, commentaire d'en-tête l.11-13)

**Interfaces:**
- Consumes: `useOutstandingDebts` (`OutstandingOrder { id, order_number, order_type, total, paid, due, … }`, `OutstandingDebt { customer_id, … }`) ; cartStore actions `restoreCart`, `markLocked`, `setPickedUpOrderId` (+ l'action de marquage « printed » utilisée par `useFireToStations` — vérifier le nom exact dans `cartStore.ts` avant usage) ; branche pay-existing de `useCheckout` (déclenchée par `pickedUpOrderId`).
- Produces: hook `useLoadDebtOrder(): { loadDebtOrder: (order: OutstandingOrder, customerId: string) => Promise<void>, isLoading: boolean }` — charge la commande dans le panier, pose `pickedUpOrderId`, attache le client, navigue vers `/pos`.

**Contraintes métier :**
- CTA « Pay » actif **uniquement** si `order.order_type !== 'b2b'` — pour les lignes B2B, remplacer le bouton par un hint texte « B2B invoice — settle in Backoffice » (la garde v11 les rejette, et le règlement B2B passe par les allocations S52).
- Mirror **exact** du pattern `usePickupTabletOrder` (`apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts`) : SELECT `order_items` avec `id, product_id, name_snapshot, unit_price, quantity, modifiers, is_cancelled` (⚠️ `name_snapshot`), filtrer `is_cancelled`, map → CartItem avec les **ids DB comme ids de ligne**, puis `restoreCart` + `markLocked(tous les ids)` + marquage printed (tous les ids — la commande a été counter-fired : restaurer l'état fired complet pour que l'append `useCheckout` ne renvoie rien en double) + `setPickedUpOrderId(order.id)`.
- Attache client best-effort via `get_customer_v3` (pattern `useReopenHeldOrder`) puis `attachCustomer` du cartStore.
- Ne PAS appeler `reopen_held_order_v1` ni `pickup_tablet_order` (gates incompatibles).
- Si le panier courant contient des lignes non vides, demander confirmation (window.confirm suffit, pattern existant du POS) avant d'écraser.

- [ ] **Step 1.1 : écrire le test smoke qui échoue**

`apps/pos/src/features/customers/__tests__/load-debt-order.smoke.test.tsx` — harnais : mirror de `apps/pos/src/__tests__/pickup-flow.smoke.test.tsx` (mock `@/lib/supabase` avec `rpc` + `from().select().eq()` chaînable). Cas :

```tsx
// T1: loadDebtOrder charge les items (name_snapshot), pose pickedUpOrderId et lock/print les lignes
// T2: un order B2B n'affiche pas de bouton Pay dans DebtOrderRow (hint "settle in Backoffice")
// T3: après loadDebtOrder, useCartStore.getState().pickedUpOrderId === order.id
```

- [ ] **Step 1.2 : lancer le test — il doit échouer** (`pnpm --filter @breakery/pos test load-debt-order`) — FAIL : hook inexistant.
- [ ] **Step 1.3 : implémenter `useLoadDebtOrder`** (mirror pickup) :

```ts
// apps/pos/src/features/customers/hooks/useLoadDebtOrder.ts
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import type { OutstandingOrder } from './useOutstandingDebts';

export function useLoadDebtOrder() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const loadDebtOrder = async (order: OutstandingOrder, customerId: string) => {
    const s = useCartStore.getState();
    if (s.cart.length > 0 && !window.confirm('Replace the current cart with this unpaid order?')) return;
    setIsLoading(true);
    try {
      // NB: colonne name_snapshot (PAS name) — cf. usePickupTabletOrder
      const { data: items, error } = await supabase
        .from('order_items')
        .select('id, product_id, name_snapshot, unit_price, quantity, modifiers, is_cancelled')
        .eq('order_id', order.id);
      if (error) throw error;
      const live = (items ?? []).filter((it) => !it.is_cancelled);
      if (live.length === 0) throw new Error('No payable items on this order');
      // map → CartItem : reprendre EXACTEMENT le mapping de usePickupTabletOrder (ids DB = ids de ligne)
      // puis : restoreCart(mapped) ; markLocked(ids) ; <markPrinted>(ids) ; setPickedUpOrderId(order.id)
      // puis attach client best-effort via get_customer_v3 (pattern useReopenHeldOrder)
      toast.success(`Order ${order.order_number} loaded — take payment to settle`);
      navigate('/pos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load order');
    } finally {
      setIsLoading(false);
    }
  };
  return { loadDebtOrder, isLoading };
}
```

(L'implémenteur lit `usePickupTabletOrder.ts` et `cartStore.ts` d'abord et aligne les noms d'actions réels — le mapping CartItem et le nom de l'action « printed » doivent être copiés du code, pas inventés.)

- [ ] **Step 1.4 : câbler `CustomerDebtsPanel`** — remplacer le `onPay` toast (l.118-123) par `loadDebtOrder(order, selected.customer_id)` ; dans `DebtOrderRow`, si `order.order_type === 'b2b'` rendre le hint au lieu du bouton ; corriger le commentaire d'en-tête (l.11-13) pour décrire le flux réel.
- [ ] **Step 1.5 : tests verts** — `pnpm --filter @breakery/pos test load-debt-order` PASS ; re-passer aussi `pnpm --filter @breakery/pos test pay-existing` (aiguillage inchangé).
- [ ] **Step 1.6 : commit** — `feat(pos): pay outstanding debt directly from /pos/debts via pay_existing flow`

---

### Task 2 : POS — `reason_code` dans `CashInOutModal` + montage du modal orphelin (fiche 12 D1.1)

**Files:**
- Modify: `apps/pos/src/features/shift/components/CashInOutModal.tsx`
- Modify: `apps/pos/src/features/nav/SideMenuDrawer.tsx` (montage — 2 entrées « Cash In » / « Cash Out » visibles si session ouverte)
- Create: `apps/pos/src/features/shift/__tests__/CashInOutModal.smoke.test.tsx`

**Interfaces:**
- Consumes: `useCashMovement` (`CashMovementInput { session_id, direction, amount, reason, reason_code?, idempotency_key? }`) — déjà prêt, ne pas le modifier ; `useCurrentShift` pour la session ouverte.
- Produces: modal complet avec sélecteur `reason_code`, monté et accessible depuis le menu latéral POS.

**Contraintes :**
- Pas de `Select` dans `@breakery/ui` → **`<select>` natif** stylé (pattern existant du projet).
- Options (labels anglais, valeur = `CashMovementReasonCode`) : `misc` (défaut, « Miscellaneous — no journal entry »), `apport_owner` (« Owner cash injection — posts JE 1110/3100 »), `bank_transfer` (« Bank transfer — posts JE 1110↔1112 »), `replenishment` (« Float rotation — no journal entry »).
- Ajouter une clé d'idempotence : `useRef(crypto.randomUUID())`, envoyée en `idempotency_key`, **rotée après succès et à la fermeture** (pattern S55 `VoidOrderModal` POS).
- Montage : dans `SideMenuDrawer`, section shift — deux items « Cash In » / « Cash Out » (testids `side-menu-cash-in`/`side-menu-cash-out`) qui ouvrent `CashInOutModal` avec la `sessionId` de `useCurrentShift` ; masqués/disabled sans session ouverte. Suivre le pattern du lien debts existant (`side-menu-outstanding-debts`, l.223).

- [ ] **Step 2.1 : test smoke qui échoue** — `CashInOutModal.smoke.test.tsx` (mock `@/lib/supabase.rpc`) :

```tsx
// T1: le select reason_code est rendu avec les 4 options, défaut 'misc'
// T2: submit avec apport_owner → rpc('record_cash_movement_v2', expect.objectContaining({
//       p_reason_code: 'apport_owner', p_idempotency_key: expect.any(String) }))
// T3: submit sans toucher le select → p_reason_code: 'misc' envoyé
// T4: la clé p_idempotency_key est STABLE sur retry (2 clics même modal) et ROTE après succès
```

- [ ] **Step 2.2 : FAIL confirmé** (`pnpm --filter @breakery/pos test CashInOutModal`).
- [ ] **Step 2.3 : implémenter** — dans `CashInOutModal` : state `reasonCode` (défaut `'misc'`), `<select>` natif + hint dynamique « posts a journal entry » pour apport_owner/bank_transfer ; `idemRef = useRef(crypto.randomUUID())` ; `mutateAsync({ …, reason_code: reasonCode, idempotency_key: idemRef.current })` ; rotation `idemRef.current = crypto.randomUUID()` en onSuccess et onClose.
- [ ] **Step 2.4 : monter le modal** dans `SideMenuDrawer` (state local `cashModal: 'in' | 'out' | null`) ; vérifier au passage le test existant `SideMenuDrawer.test.tsx` et l'étendre (T5 : les 2 entrées apparaissent avec une session ouverte).
- [ ] **Step 2.5 : tests verts** — `pnpm --filter @breakery/pos test CashInOutModal SideMenuDrawer`.
- [ ] **Step 2.6 : commit** — `feat(pos): expose reason_code + idempotency in CashInOutModal and mount it in the side menu`

---

### Task 3 : DB+POS — `close_shift_v3` : note d'écart obligatoire enforced serveur (fiche 12 D1.4) — migration `_105`

**Files:**
- Create: `supabase/migrations/20260710000105_close_shift_v3_enforce_variance_note.sql`
- Modify: `apps/pos/src/features/shift/hooks/useCloseShift.ts` (repoint v3 + mapping erreur)
- Modify: `supabase/tests/cash_register.test.sql` (réparer le STALE v1 + assertions v3)
- Modify: `supabase/tests/functions/cash-register-close.test.ts` (repoint v3)
- Create: `supabase/tests/close_shift_note_enforced.test.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen)

**Interfaces:**
- Consumes: corps **live** de `close_shift_v2` (`SELECT pg_get_functiondef('public.close_shift_v2(uuid,numeric,text,uuid)'::regprocedure);` via MCP `execute_sql`) ; `business_config.shift_variance_threshold_abs/pct` (NOT NULL, defaults 50000/0.0050).
- Produces: `close_shift_v3(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` — même signature, même enveloppe retour, + garde : variance au-delà du seuil ET note vide → `RAISE EXCEPTION 'variance_note_required' USING ERRCODE='P0001'`. `DROP FUNCTION public.close_shift_v2(uuid,numeric,text,uuid);` dans la même migration.

**Procédure migration (DEV-S57-02, impératif) :**
1. Récupérer le corps live v2 via `pg_get_functiondef` (le fichier `20260606000015` est DRIFTÉ : il écrit `audit_log`, le live écrit `audit_logs`).
2. Renommer en `close_shift_v3`, insérer le bloc de garde **après** le calcul de la variance (variables du corps live : `v_expected`, `v_variance` — vérifier les noms exacts dans le functiondef) et **avant** l'émission de la JE d'écart :

```sql
  -- S60 (12 D1.4): variance note enforced server-side (was UI-only, bypassable via direct RPC)
  SELECT bc.shift_variance_threshold_abs, bc.shift_variance_threshold_pct
    INTO v_thr_abs, v_thr_pct
  FROM business_config bc
  LIMIT 1;
  IF ( ABS(v_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_thr_pct, 0.005)) )
     AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'variance_note_required'
      USING ERRCODE = 'P0001',
            DETAIL = format('variance %s exceeds threshold; a note is mandatory', v_variance);
  END IF;
```

(+ `DECLARE v_thr_abs numeric; v_thr_pct numeric;`). Le prédicat est le miroir exact de `shouldShowWarning` (`VarianceWarningBadge.tsx:14-24`) : `abs>=thresholdAbs OR (expected>0 AND abs/expected>=thresholdPct)`.
3. ⚠️ La garde ne doit PAS s'appliquer à la branche **replay idempotent** (session déjà fermée → renvoyer l'enveloppe existante AVANT la garde, comme en v2).
4. Même fichier : `DROP FUNCTION public.close_shift_v2(uuid, numeric, text, uuid);` + trio S20 sur v3 (`REVOKE ALL FROM PUBLIC` + `FROM anon` + `GRANT EXECUTE TO authenticated` — le POS l'appelle en JWT direct) + `COMMENT ON FUNCTION` (mentionner S60, note enforced).

- [ ] **Step 3.1 : écrire le pgTAP qui échoue** — `supabase/tests/close_shift_note_enforced.test.sql`, enveloppe `BEGIN; SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`, exécuté via MCP `execute_sql`. Cas (fixtures : user admin + session `pos_sessions` ouverte, seed minimal comme dans les suites shift existantes) :

```sql
-- T1: has_function('close_shift_v3') + hasnt_function('close_shift_v2')
-- T2: throws_ok : close over-threshold (counted = expected + 100000) SANS note → 'variance_note_required'
-- T3: lives_ok  : même close AVEC p_notes='till was over, cash from event' → succès, JE d'écart émise
-- T4: lives_ok  : close variance nulle SANS note → succès (pas de note requise)
-- T5: replay idempotent : re-close même session avec p_idempotency_key → enveloppe renvoyée sans lever
```

- [ ] **Step 3.2 : FAIL confirmé** (v3 inexistante) via `execute_sql`.
- [ ] **Step 3.3 : appliquer la migration `_105`** via MCP `apply_migration` (name `close_shift_v3_enforce_variance_note`) construite selon la procédure ci-dessus ; écrire le même SQL dans `supabase/migrations/20260710000105_close_shift_v3_enforce_variance_note.sql`.
- [ ] **Step 3.4 : pgTAP vert** — la suite T1-T5 passe (`num_failed=0`) ; réparer aussi `supabase/tests/cash_register.test.sql` (T_SHIFT_03 : remplacer les assertions `record_cash_movement_v1`/`close_shift_v1` par `record_cash_movement_v2`/`close_shift_v3`) et la re-passer.
- [ ] **Step 3.5 : repoint clients** — `useCloseShift.ts` : `rpc('close_shift_v3', …)` + catch : si `error.message.includes('variance_note_required')` → `toast.error('A note is required: the variance is above the configured threshold')` ; `supabase/tests/functions/cash-register-close.test.ts` : repoint v3 ; grep final `close_shift_v2` = zéro hit exécutable (docs OK).
- [ ] **Step 3.6 : regen types** (MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`), `pnpm --filter @breakery/pos test CloseShiftModal useShiftCloseSummary` verts, `pnpm typecheck`.
- [ ] **Step 3.7 : commit** — `feat(db,pos): close_shift_v3 — variance note above threshold enforced server-side (drop v2)`

---

### Task 4 : POS — lignes promo nommées sur le ticket imprimé (fiche 13 D1.1)

**Files:**
- Modify: `apps/pos/src/services/print/printService.ts` (type `ReceiptPayload`, l.54-80)
- Modify: `apps/pos/src/features/payment/usePaymentFlowLogic.ts` (`PaymentSuccessState` l.28-43 + `dispatchCheckout` l.182-198)
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx` (threading prop, l.43-62)
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx` (props + `buildReceiptPayload` l.53-124)
- Modify: `apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx` (ou nouveau `receipt-promotions.smoke.test.tsx`)

**Interfaces:**
- Consumes: `cartStore.appliedPromotions: AppliedPromotion[]` (`{ promotion_id, name, type, amount, … }`) — encore présent au moment du succès (reset seulement à `handleNewOrder`).
- Produces: `ReceiptPayload.promotions?: { name: string; amount: number }[]` + `ReceiptPayload.totals.promotion_total?: number` — snapshotés dans `PaymentSuccessState.appliedPromotions` au `setSuccess`, threadés `PaymentTerminal → SuccessModal → buildReceiptPayload`.

**Contraintes :**
- Snapshot au moment du succès (`dispatchCheckout`), PAS de lecture du store dans `SuccessModal` (parité avec les autres champs figés de `PaymentSuccessState`).
- Filtrer les entrées `amount <= 0 && type !== 'free_product'` ; pour `free_product`, rendre `{ name: `${name} (free item)`, amount: 0 }` (le bridge affichera « −Rp 0 » sinon — libellé explicite).
- Le print-bridge est externe : le champ est transporté tel quel. **Consigner en dette de session** : « template du print-bridge à MAJ pour rendre `promotions[]` » (action utilisateur, INDEX closeout).

- [ ] **Step 4.1 : test qui échoue** — harnais existant `VITE_PRINT_MOCK` (copier `receipt-payment-method.smoke.test.tsx` : `vi.stubEnv('VITE_PRINT_MOCK','1')`, `clearMockPrintBuffer()`, rendre `<SuccessModal {...buildProps({ appliedPromotions: [{ promotion_id:'p1', slug:'happy-hour', name:'Happy Hour −15%', type:'percentage', amount:15000, description:'' }] })} />`, lire `getMockPrintBuffer().find(e => e.kind==='receipt').payload`) :

```tsx
// T1: payload.promotions === [{ name: 'Happy Hour −15%', amount: 15000 }]
// T2: payload.totals.promotion_total === 15000
// T3: sans promos → payload.promotions absent ou []
```

- [ ] **Step 4.2 : FAIL confirmé** (`pnpm --filter @breakery/pos test receipt`).
- [ ] **Step 4.3 : implémenter** — `PaymentSuccessState.appliedPromotions: AppliedPromotion[]` capturé dans `dispatchCheckout` depuis le store ; prop `appliedPromotions` sur `SuccessModal` ; dans `buildReceiptPayload` :

```ts
const promoLines = (props.appliedPromotions ?? [])
  .filter((ap) => ap.amount > 0 || ap.type === 'free_product')
  .map((ap) => ({ name: ap.type === 'free_product' ? `${ap.name} (free item)` : ap.name, amount: ap.amount }));
// payload: promotions: promoLines, totals: { …, promotion_total: promoLines.reduce((s, p) => s + p.amount, 0) }
```

- [ ] **Step 4.4 : tests verts** — `pnpm --filter @breakery/pos test receipt` (les smokes reçu existants restent verts).
- [ ] **Step 4.5 : commit** — `feat(pos): named promotion lines on the printed receipt payload`

---

### Task 5 : BO — détail des promos appliquées dans l'historique (fiche 13 D1.2)

**Files:**
- Modify: `apps/backoffice/src/features/orders/hooks/useOrderDetail.ts` (embed + interface + map)
- Modify: `apps/backoffice/src/pages/orders/OrderDetailPage.tsx` (bloc totaux l.161-178)
- Modify: `apps/backoffice/src/features/orders/components/OrderDetailDrawer.tsx` (bloc totaux l.165-180)
- Modify: `apps/backoffice/src/pages/orders/__tests__/OrderDetailPage.smoke.test.tsx`

**Interfaces:**
- Consumes: embed PostgREST `promotion_applications(amount, description, promotions(name))` (RLS OK authenticated, FK embed existant, **aucune migration**).
- Produces: `OrderDetail.promotions: { description: string; name: string | null; amount: number }[]`.

- [ ] **Step 5.1 : test qui échoue** — étendre le mock `useOrderDetail` du smoke existant avec `promotions: [{ description: 'Happy Hour −15%', name: 'Happy Hour', amount: 15000 }]` et asserter que la page rend le libellé et `−Rp 15,000` (ou format monétaire réel du fichier) sous la ligne Discount.
- [ ] **Step 5.2 : FAIL confirmé** (`pnpm --filter @breakery/backoffice test OrderDetailPage`).
- [ ] **Step 5.3 : implémenter** — dans `useOrderDetail` : ajouter l'embed au SELECT, champ interface, map `(row.promotion_applications ?? []).map(pa => ({ description: pa.description, name: pa.promotions?.name ?? null, amount: Number(pa.amount) }))` ; rendu : dans `OrderDetailPage` ET `OrderDetailDrawer`, entre Discount et PB1, une ligne par promo — libellé primaire `description` (snapshot, survit à la soft-delete), montant négatif, style muted cohérent avec les lignes existantes.
- [ ] **Step 5.4 : tests verts** — `pnpm --filter @breakery/backoffice test OrderDetailPage order-detail`.
- [ ] **Step 5.5 : commit** — `feat(backoffice): named promotion lines in order detail (page + drawer)`

---

### Task 6 : DB+POS — KDS « All ready » : bump en masse atomique (fiche 04 D1.2) — migration `_106`

**Files:**
- Create: `supabase/migrations/20260710000106_create_kds_bump_order_v1.sql`
- Create: `apps/pos/src/features/kds/hooks/useKdsBumpOrder.ts`
- Modify: `apps/pos/src/features/kds/components/KdsOrderCard.tsx` (bouton header)
- Create: `apps/pos/src/features/kds/__tests__/AllReadyButton.smoke.test.tsx` (ou dans `KdsOrderCard.test.tsx`)
- Create: `supabase/tests/kds_bump_order.test.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen)

**Interfaces:**
- Consumes: patterns de `kds_recall_order_v1`/`kds_bump_item_v1` (`20260517000151`) ; gate `kds.operate` ; `KdsOrderCard({ items })` — `order_id = items[0].order_id`.
- Produces: `kds_bump_order_v1(p_order_id uuid, p_idempotency_key uuid DEFAULT NULL) RETURNS integer` (nombre d'items bumpés) ; hook `useKdsBumpOrder` (mirror `useKdsBumpItem` : mint UUID par appel, invalide `['kds']`).

**Pourquoi un RPC et pas une boucle client :** `kds_bump_item_v1` exige `preparing` (P0011) — les items `pending` d'une carte ne passeraient pas ; N appels = non-atomique + N audits. Le RPC couvre `pending|preparing → ready` en un UPDATE.

**Corps SQL de la migration `_106`** (avant écriture : relire le corps live de `kds_bump_item_v1` via `pg_get_functiondef` et aligner l'INSERT audit exactement dessus) :

```sql
-- 20260710000106_create_kds_bump_order_v1.sql
-- S60 (04 D1.2): "All ready" — atomically bump every live pending/preparing item of an order.
-- Modeled on kds_recall_order_v1 (order-scope) + kds_bump_item_v1 (idempotent replay via audit_logs).

CREATE OR REPLACE FUNCTION public.kds_bump_order_v1(
  p_order_id uuid,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'kds.operate') THEN
    RAISE EXCEPTION 'Permission denied (kds.operate)' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT (a.metadata->>'bumped_count')::integer INTO v_count
    FROM audit_logs a
    WHERE a.action = 'kds.bump_order'
      AND a.metadata->>'idempotency_key' = p_idempotency_key::text
    LIMIT 1;
    IF FOUND THEN RETURN v_count; END IF;
  END IF;

  UPDATE order_items
     SET kitchen_status = 'ready', ready_at = NOW(), bumped_at = NOW()
   WHERE order_id = p_order_id
     AND kitchen_status IN ('pending', 'preparing')
     AND is_cancelled = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('kds.bump_order', 'order', p_order_id,
          jsonb_build_object('idempotency_key', p_idempotency_key, 'bumped_count', v_count),
          v_uid);

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.kds_bump_order_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_bump_order_v1(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_bump_order_v1(uuid, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.kds_bump_order_v1(uuid, uuid) IS
  'S60 (04 D1.2) — KDS "All ready": bumps all live pending/preparing items of an order to ready '
  'in one atomic UPDATE. Gate kds.operate. Idempotent replay via audit_logs kds.bump_order.';
```

(⚠️ vérifier le nom réel de la colonne d'annulation sur `order_items` — `is_cancelled` d'après la query KDS — et le type enum de `kitchen_status` ; ajuster si le live diffère.)

**UI :** bouton « All ready » dans le header de `KdsOrderCard`, rendu seulement si `items.some(i => !i.is_cancelled && (i.kitchen_status === 'pending' || i.kitchen_status === 'preparing'))` ; onClick → `bumpOrder.mutate({ orderId: head.order_id })` ; toast succès « N items ready ». **Pas d'undo groupé** (l'undo per-item `kds_undo_bump_v1` reste possible 60 s — les items bumpés en masse ont `bumped_at` posé — mais aucun toast masse n'est affiché ; consigner ce choix dans l'INDEX).

- [ ] **Step 6.1 : pgTAP qui échoue** — `supabase/tests/kds_bump_order.test.sql` (BEGIN/plan/ROLLBACK, fixtures order + 3 items pending/preparing/cancelled) :

```sql
-- T1: has_function kds_bump_order_v1(uuid,uuid)
-- T2: appel bump → RETURN 2 (pending + preparing bumpés, cancelled intact)
-- T3: les 2 items sont kitchen_status='ready' avec ready_at/bumped_at posés ; le cancelled inchangé
-- T4: replay même p_idempotency_key → RETURN 2 sans re-UPDATE (ready_at stable)
-- T5: item déjà 'ready' non retouché par un second bump sans clé (RETURN 0)
-- T6: grant check — function_privs_are anon = {} (trio S20)
```

- [ ] **Step 6.2 : FAIL confirmé** via `execute_sql`.
- [ ] **Step 6.3 : appliquer `_106`** via MCP `apply_migration` + écrire le fichier local ; pgTAP T1-T6 verts (`num_failed=0`) ; regen types.
- [ ] **Step 6.4 : test smoke UI qui échoue** — mirror `BumpButton.smoke.test.tsx` : bouton « All ready » visible ssi items actionnables, clic → `rpcMock('kds_bump_order_v1', { p_order_id: 'ord-1', p_idempotency_key: expect.any(String) })`, absent si tous items ready/cancelled.
- [ ] **Step 6.5 : implémenter le hook + bouton** — `useKdsBumpOrder` copié de `useKdsBumpItem` (mint UUID par appel, `invalidateQueries(['kds'])`) ; bouton header `KdsOrderCard` variant gold, `aria-label="Bump all items to ready"`.
- [ ] **Step 6.6 : tests verts** — `pnpm --filter @breakery/pos test kds` (toutes les suites KDS S59 restent vertes).
- [ ] **Step 6.7 : commit** — `feat(kds,db): "All ready" mass bump via new atomic kds_bump_order_v1`

---

### Task 7 : BO — câbler `x-idempotency-key` sur le void (fiche 02b D1.1) + commentaire stale

**Files:**
- Modify: `apps/backoffice/src/features/orders/hooks/useVoidOrder.ts`
- Modify: `apps/backoffice/src/features/orders/components/VoidOrderModal.tsx`
- Create: `apps/backoffice/src/features/orders/__tests__/void-idempotency-header.smoke.test.tsx`

**Interfaces:**
- Consumes: EF `void-order` (lit déjà `x-idempotency-key` via `getIdempotencyKey`, `index.ts:73-81` — **aucun changement EF/DB**) ; parité POS `apps/pos/src/features/order-history/hooks/useVoidOrder.ts:43-44`.
- Produces: `VoidArgs.idempotencyKey?: string` + header conditionnel ; clé `idem.current` du modal transmise, sticky sur retry, rotée après succès et à la fermeture.

- [ ] **Step 7.1 : test qui échoue** — harnais niveau hook (copier `order-detail-invalidation.smoke.test.tsx` : mock `@/lib/supabase.js` + `global.fetch`, session `{access_token:'tok'}`) — le C2 POS (modal NumpadPin) ne se copie PAS tel quel, l'API du modal BO diffère :

```tsx
// T1: useVoidOrder envoie x-idempotency-key + x-manager-pin en headers, body = { order_id, reason } seul
//     (inspecter fetchMock.mock.calls[0][1].headers — miroir C1 POS)
// T2: sans idempotencyKey fourni → pas de header x-idempotency-key
// T3 (modal): la clé envoyée est un UUID v4, STABLE sur 2 submits (retry), ROTÉE après succès et à close/reopen
```

- [ ] **Step 7.2 : FAIL confirmé** (`pnpm --filter @breakery/backoffice test void-idempotency`).
- [ ] **Step 7.3 : implémenter** — `useVoidOrder.ts` : `idempotencyKey?: string` dans `VoidArgs` +

```ts
// S55 parity: HTTP retry-safe idempotency — the EF forwards this to void_order_rpc_v4.
if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
```

`VoidOrderModal.tsx` : passer `idempotencyKey: idem.current` au `mutateAsync` (l.31) ; rotation à la fermeture en plus du succès (l.35) ; réécrire le commentaire stale l.4 : « PIN travels in the `x-manager-pin` header (S34); idempotency key in `x-idempotency-key` (S55 parity, S60) ».
- [ ] **Step 7.4 : tests verts** — `pnpm --filter @breakery/backoffice test void-idempotency order-detail-invalidation`.
- [ ] **Step 7.5 : commit** — `fix(backoffice): send x-idempotency-key on BO void (POS S55 parity) + fix stale PIN comment`

---

## Closeout (lead, après T1-T7)

- [ ] Suite monorepo complète : `pnpm typecheck && pnpm build && pnpm test` (exit 0 ; baseline env-gated live-RPC documentée = pas une régression).
- [ ] Re-passe des ancres money-path touchées via MCP `execute_sql` : `close_shift_note_enforced`, `cash_register` (réparée), `kds_bump_order`, + sanity `s44_money_gates` (aucun RPC de vente modifié — v17/v11 intacts).
- [ ] `git grep -n "close_shift_v2"` = zéro call-site exécutable ; `list_migrations` : repo == cloud sur `_105`/`_106`.
- [ ] Revue finale de branche (pattern-guardian sur le diff complet) puis PR squash vers `master`.
- [ ] INDEX de session `docs/workplan/plans/2026-07-05-session-60-INDEX.md` : livré/migrations/dettes (dont : template print-bridge externe à MAJ pour `promotions[]` ; pas d'undo groupé « All ready » ; montage CashInOutModal = choix SideMenuDrawer) + actions utilisateur.
- [ ] MAJ `docs/workplan/remise-a-plat/00-INDEX.md` (§3 lot 2 → soldé, §2.3 entrée #22 → câblée S60) + fiches 02/02b/04/12/13 (note de mise à jour en tête) + CLAUDE.md Active Workplan.
