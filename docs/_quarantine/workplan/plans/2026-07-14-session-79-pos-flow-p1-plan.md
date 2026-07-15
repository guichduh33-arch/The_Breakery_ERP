# Session 79 — Fixes P1 de l'audit POS flow (lot A intégrité money · lot B service en salle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date :** 2026-07-14 · **Branche :** `swarm/session-79` · **Source :** audit POS flow du 2026-07-14 (5 lectures profondes + vérifications DB live, session `933f16f1`)

**Goal:** Corriger les 5 findings P1 de l'audit du parcours commande→paiement : (A1) rotation de la clé d'idempotence qui ouvre un scénario de double-encaissement, (A2) moteur promo court-circuité par le cache client, (A3) fallback promo silencieux, (A4) hold/recall qui perd remises/redemption/composition de combo, (B1) panier tablette volatil + (B2/B3) tablette serveur impuissante sur une table occupée.

**Architecture:** Lot A = fixes client (stores + hooks POS) sauf A4 qui bump `hold_order_v1`/`restore_held_order_v1` → v2 avec un snapshot JSONB verbatim (`orders.held_cart_snapshot`) — RPCs de **draft uniquement**, hors money-path. Lot B = persistance zustand + une sheet « table occupée » sur la tablette qui réutilise 3 surfaces serveur existantes (`create_tablet_order_v4`, `transfer_order_table_v1`, `cancel_tablet_order`) — **zéro nouveau RPC**.

**Tech Stack:** React 18 + zustand (persist) + TanStack Query v5, Supabase cloud V3 dev `ikcyvlovptebroadgtvd` (MCP only, Docker retiré), pgTAP via `execute_sql` BEGIN/ROLLBACK, Vitest.

## Global Constraints

- **Money-path INTOUCHÉ** : `complete_order_with_payment_v17`, `pay_existing_order_v11`, EF `process-payment`, `fire_counter_order_v4` ne sont ni modifiés ni bumpés. Ancre `s44_money_gates` re-passée au closeout.
- **Migration** : prochain NAME-block = `20260714000168` (vérifier `ls supabase/migrations | sort | tail` avant — `_167` est le dernier au moment de la rédaction). Jamais de `BEGIN;`/`COMMIT;` dans le corps. Apply via `mcp__claude_ai_Supabase__apply_migration`.
- **DEV-S57-02** : tout bump v1→v2 part du corps **live** (`SELECT pg_get_functiondef('public.hold_order_v1(uuid,jsonb,text,text)'::regprocedure);`), jamais du fichier de migration d'origine.
- **RPC versioning monotone** : v2 + `DROP FUNCTION ... v1(<args exacts>)` dans la même migration ; trio REVOKE (`FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES`) sur chaque nouvelle fonction.
- **Types regen obligatoire** après la migration (`generate_typescript_types` → `packages/supabase/src/types.generated.ts`, commit) — cause n°1 de CI cassée.
- **DEV-S76-06** : passe `pnpm exec eslint <fichiers touchés>` avant chaque commit (la CI lint-ratchet est le seul filet).
- **pnpm 9.15 + turbo**, jamais npm. Tests co-localisés en `__tests__/`. Fichiers < 500 lignes.
- **UI** : primitifs `@breakery/ui` uniquement (Sheet/Dialog/Button existent ; PAS de Select exporté → fallback natif), tokens sémantiques, cibles tactiles ≥ 44 px.
- **Subagents** : ne peuvent PAS appeler le MCP Supabase — migrations/pgTAP/types regen restent sur le contrôleur.

---

## Contexte — les findings (preuves vérifiées le 2026-07-14)

| # | Finding | Preuve |
|---|---|---|
| A1 | `close()`/`open()` régénèrent `idempotencyKey` : réponse EF perdue après commit serveur + fermeture du modal + ré-encaissement = 2ᵉ commande réelle | `apps/pos/src/stores/paymentStore.ts:47-61` |
| A2 | Si le fetch client des promos échoue/est vide, l'effet `return` AVANT d'appeler le RPC `evaluate_promotions_v2` → plein tarif silencieux | `apps/pos/src/features/promotions/hooks/usePromotionsAutoEval.ts:42-45` |
| A3 | Toute erreur RPC bascule silencieusement (console.warn seul) sur le fallback TS aveugle aux caps `max_uses` | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:213-230` |
| A4 | Le hold draft ne sérialise que `{product_id, quantity, unit_price, modifiers}` → au restore : remise ligne/panier, redemption et `combo_components` perdus sans warning | `HoldOrderButton.tsx:43-49`, `useRestoreHeldOrder.ts:43-50`, RPC `_20260620000011/13` |
| B1 | `tabletCartStore` sans `persist` : webview Capacitor tuée = commande en cours perdue | `apps/pos/src/stores/tabletCartStore.ts:24` |
| B2/B3 | Tap sur table occupée = early-return ; `useTableOrders` ne garde que la commande la plus récente par table ; transfert câblé POS seulement ; cancel inatteignable depuis la saisie | `FloorPlanView.tsx:98-99`, `useTableOrders.ts:50-53`, `TabletOrderPage.tsx:175-180` |

---

### Task 1 (A1) : clé d'idempotence stable jusqu'au succès confirmé

**Files:**
- Modify: `apps/pos/src/stores/paymentStore.ts`
- Modify: `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts` (~ligne 186, bloc succès de `dispatchCheckout`)
- Test: `apps/pos/src/stores/__tests__/paymentStore.idempotency.test.ts` (créer)

**Interfaces:**
- Produces: `usePaymentStore` gagne `rotateKey: () => void`. Sémantique : **une clé = une tentative de checkout jusqu'à succès confirmé**. `open()`/`close()` ne rotent PLUS jamais la clé ; rotation uniquement sur (a) succès confirmé (`rotateKey()` appelé dans `dispatchCheckout` juste après `checkout.mutateAsync` OK), (b) `reset()`.
- Pourquoi c'est sûr : v17 n'enregistre la clé qu'au **succès** — rejouer la même clé après un échec réel exécute un checkout frais (panier édité inclus) ; la rejouer après un succès à réponse perdue renvoie la commande déjà payée (protection double-charge). La rotation au succès empêche l'inverse (encaissement suivant avalé par un replay).

- [ ] **Step 1 : test rouge**

```ts
// apps/pos/src/stores/__tests__/paymentStore.idempotency.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePaymentStore } from '../paymentStore';

describe('paymentStore idempotency key lifecycle (S79 A1)', () => {
  beforeEach(() => usePaymentStore.getState().reset());

  it('keeps the SAME key across close → open (lost-response protection)', () => {
    usePaymentStore.getState().open();
    const key = usePaymentStore.getState().idempotencyKey;
    usePaymentStore.getState().close();
    usePaymentStore.getState().open();
    expect(usePaymentStore.getState().idempotencyKey).toBe(key);
  });

  it('rotates the key on rotateKey() (confirmed success)', () => {
    const key = usePaymentStore.getState().idempotencyKey;
    usePaymentStore.getState().rotateKey();
    expect(usePaymentStore.getState().idempotencyKey).not.toBe(key);
  });

  it('rotates the key on reset()', () => {
    const key = usePaymentStore.getState().idempotencyKey;
    usePaymentStore.getState().reset();
    expect(usePaymentStore.getState().idempotencyKey).not.toBe(key);
  });
});
```

- [ ] **Step 2 :** `pnpm --filter @breakery/app-pos test paymentStore.idempotency` → FAIL (`rotateKey` absent + close/open rotent).
- [ ] **Step 3 : implémentation**

Dans `paymentStore.ts` : retirer la ligne `idempotencyKey: crypto.randomUUID(),` des objets passés à `set` dans `open()` **et** `close()` (et leurs commentaires « New attempt → new key » / « Regenerate so… ») ; conserver celle de `reset()`. Ajouter à l'interface et au store :

```ts
  /** S79 A1 — rotate ONLY on confirmed success (or reset). One key = one attempt until success. */
  rotateKey: () => void;
...
  rotateKey: () => set({ idempotencyKey: crypto.randomUUID() }),
```

Mettre à jour le commentaire d'en-tête du fichier (lignes 10-11) : la clé n'est plus « regenerated on open/close/reset » mais « stable across open/close ; rotated on confirmed success (rotateKey) and reset — S79 A1, protège du double-encaissement à réponse perdue ».

Dans `usePaymentFlowLogic.ts`, juste APRÈS `const result = await checkout.mutateAsync({ cart, payment: tendersToShip });` (le succès est acquis) :

```ts
      // S79 A1 — the attempt succeeded server-side: retire this idempotency key
      // so the NEXT order can never be swallowed by a replay of this one.
      usePaymentStore.getState().rotateKey();
```

(`usePaymentStore` est déjà importé dans ce fichier ; sinon l'ajouter depuis `@/stores/paymentStore`.)

- [ ] **Step 4 :** re-run → PASS. Lancer aussi `pnpm --filter @breakery/app-pos test payment` (non-régression du flux).
- [ ] **Step 5 :** `pnpm exec eslint apps/pos/src/stores/paymentStore.ts apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts apps/pos/src/stores/__tests__/paymentStore.idempotency.test.ts` puis commit `fix(pos): S79 A1 — idempotency key stable jusqu'au succès confirmé (double-charge à réponse perdue)`.

---

### Task 2 (A2) : le RPC promo tourne même quand le cache client est vide

**Files:**
- Modify: `apps/pos/src/features/promotions/hooks/usePromotionsAutoEval.ts:36-45`
- Test: `apps/pos/src/features/promotions/__tests__/usePromotionsAutoEval.rpcAlways.test.tsx` (créer)

**Interfaces:**
- Consumes: `runEvaluation(cart, customer, dismissedIds)` de `useEvaluatePromotions` (RPC-first, retourne `[]` sur panier vide).
- Produces: comportement — le court-circuit ne dépend plus de `promotions.length` (cache client) mais de `cart.items.length` (panier vide). Le RPC serveur est TOUJOURS consulté dès qu'il y a des items.

- [ ] **Step 1 : test rouge** (⚠️ mémoire projet : les mocks de data en deps d'effet doivent être `vi.hoisted` à identité stable, sinon boucle de render)

```tsx
// apps/pos/src/features/promotions/__tests__/usePromotionsAutoEval.rpcAlways.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePromotionsAutoEval } from '../hooks/usePromotionsAutoEval';
import { useCartStore } from '@/stores/cartStore';

const { runEvaluationSpy, EMPTY_PROMOS } = vi.hoisted(() => ({
  runEvaluationSpy: vi.fn().mockResolvedValue([]),
  EMPTY_PROMOS: [] as unknown[],
}));
vi.mock('../hooks/useEvaluatePromotions', () => ({
  useEvaluatePromotions: () => ({ promotions: EMPTY_PROMOS, runEvaluation: runEvaluationSpy }),
}));
vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: EMPTY_PROMOS }),
}));

describe('usePromotionsAutoEval (S79 A2)', () => {
  beforeEach(() => {
    runEvaluationSpy.mockClear();
    useCartStore.getState().clear();
  });

  it('still calls the RPC evaluation when the client promo cache is EMPTY', async () => {
    useCartStore.setState((s) => ({
      cart: { ...s.cart, items: [{ id: 'l1', product_id: 'p1', name: 'Croissant', unit_price: 15000, quantity: 1, modifiers: [] }] },
    }));
    renderHook(() => usePromotionsAutoEval());
    await waitFor(() => expect(runEvaluationSpy).toHaveBeenCalled(), { timeout: 1500 });
  });

  it('does NOT evaluate an empty cart (clears applied promos instead)', async () => {
    renderHook(() => usePromotionsAutoEval());
    await new Promise((r) => setTimeout(r, 400)); // > DEBOUNCE_MS
    expect(runEvaluationSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 :** `pnpm --filter @breakery/app-pos test usePromotionsAutoEval.rpcAlways` → FAIL (1ᵉʳ cas : `runEvaluation` jamais appelé).
- [ ] **Step 3 : implémentation** — remplacer le bloc lignes 37-45 :

```ts
      // S79 A2 — the short-circuit used to gate on the CLIENT promo cache
      // (promotions.length), silently skipping the server RPC whenever the
      // table fetch failed → every order at full price. Gate on the CART
      // instead: an empty cart clears applied promos; anything else always
      // consults evaluate_promotions_v2 (RPC-first; the TS fallback inside
      // runEvaluation still handles an empty cache by returning []).
      if (cart.items.length === 0) {
        setAppliedPromotions([]);
        return;
      }
```

(`promotions` peut alors sortir des deps de l'effet s'il n'est plus lu — le retirer du tableau de deps SEULEMENT s'il n'est plus référencé, sinon eslint exhaustive-deps râlera.)

- [ ] **Step 4 :** re-run → PASS. Puis `pnpm --filter @breakery/app-pos test promotions` (non-régression gift sync).
- [ ] **Step 5 :** eslint sur les fichiers touchés, commit `fix(pos): S79 A2 — l'éval promo serveur ne dépend plus du cache client (plein tarif silencieux)`.

---

### Task 3 (A3) : fallback promo visible (toast dédupé)

**Files:**
- Modify: `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:213-230`
- Test: `apps/pos/src/features/promotions/__tests__/useEvaluatePromotions.fallbackToast.test.tsx` (créer)

- [ ] **Step 1 : test rouge**

```tsx
// apps/pos/src/features/promotions/__tests__/useEvaluatePromotions.fallbackToast.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { useEvaluatePromotions, __resetFallbackToastForTests } from '../hooks/useEvaluatePromotions';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom', code: '57014' } }) },
}));
vi.mock('../hooks/usePromotions', () => ({ usePromotions: () => ({ data: [] }) }));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }));

const CART = {
  items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 10000, quantity: 1, modifiers: [] }],
  order_type: 'take_out' as const,
};

describe('useEvaluatePromotions fallback visibility (S79 A3)', () => {
  beforeEach(() => { vi.mocked(toast.warning).mockClear(); __resetFallbackToastForTests(); });

  it('warns the cashier ONCE when the RPC fails and the TS fallback takes over', async () => {
    const { result } = renderHook(() => useEvaluatePromotions());
    await result.current.runEvaluation(CART, null);
    await result.current.runEvaluation(CART, null); // dans la fenêtre de dédup
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 :** run → FAIL (`__resetFallbackToastForTests` inexistant, aucun toast).
- [ ] **Step 3 : implémentation** — en scope module de `useEvaluatePromotions.ts` :

```ts
import { toast } from 'sonner';

/** S79 A3 — dedup window for the fallback warning (one toast per 30s, not per keystroke). */
const FALLBACK_TOAST_WINDOW_MS = 30_000;
let lastFallbackToastAt = 0;
/** Test seam — resets the dedup window. */
export function __resetFallbackToastForTests(): void { lastFallbackToastAt = 0; }
```

et dans le `catch (rpcErr)` existant, juste après le `console.warn` :

```ts
        // S79 A3 — the fallback engine is cap-blind (max_uses ignored, S57
        // A-D10): the cart can promise a discount the server will refuse at
        // checkout. Make the degraded mode visible instead of silent.
        const nowMs = Date.now();
        if (nowMs - lastFallbackToastAt > FALLBACK_TOAST_WINDOW_MS) {
          lastFallbackToastAt = nowMs;
          toast.warning(
            'Promotions non vérifiées serveur — remises provisoires, re-contrôle au paiement',
          );
        }
```

- [ ] **Step 4 :** re-run → PASS ; `pnpm --filter @breakery/app-pos test promotions`.
- [ ] **Step 5 :** eslint, commit `fix(pos): S79 A3 — le fallback promo TS signale le mode dégradé (toast dédupé 30s)`.

---

### Task 4 (A4) : hold/restore v2 — snapshot complet (remises, redemption, combos)

**Files:**
- Create: `supabase/migrations/20260714000168_hold_restore_v2_full_snapshot.sql` (⚠️ CONTRÔLEUR : apply via MCP, subagents ne peuvent pas)
- Modify: `packages/supabase/src/types.generated.ts` (regen MCP, commit)
- Modify: `apps/pos/src/features/heldOrders/hooks/useHoldOrder.ts` (rename RPC v2)
- Modify: `apps/pos/src/features/heldOrders/components/HoldOrderButton.tsx:37-52`
- Modify: `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts`
- Test: `supabase/tests/held_orders_v2_snapshot.test.sql` (créer) + `apps/pos/src/features/heldOrders/__tests__/holdRestore.roundtrip.test.tsx` (créer)

**Interfaces:**
- Produces (SQL): `hold_order_v2(p_client_uuid UUID, p_cart_payload JSONB, p_table_number TEXT, p_notes TEXT) RETURNS UUID` — même contrat que v1 + stocke `p_cart_payload` **verbatim** dans la nouvelle colonne `orders.held_cart_snapshot` ; `restore_held_order_v2(p_order_id UUID) RETURNS JSONB` — renvoie le snapshot verbatim (merged avec `order_id`/`tableNumber`/`notes`) quand il existe, sinon la reconstruction v1 (drafts pré-S79).
- Produces (client): le payload hold porte désormais par ligne `product_type? / discount? / combo_components?` et au niveau panier `cartDiscount? / loyaltyPointsToRedeem?`. Les lignes `is_promo_gift` sont **exclues** (re-générées par l'auto-eval au restore).
- Décision assumée : une remise restaurée reste portée par le panier ; si son nonce d'autorisation S55 a expiré, le checkout échoue avec son erreur intelligible et le manager ré-autorise — toast d'information au restore.

- [ ] **Step 1 : migration.** Récupérer les corps live (contrôleur) : `SELECT pg_get_functiondef('public.hold_order_v1(uuid,jsonb,text,text)'::regprocedure);` et idem `restore_held_order_v1(uuid)`. Écrire `20260714000168_hold_restore_v2_full_snapshot.sql` :

```sql
-- S79 A4 — hold/restore v2 : le draft persiste le panier COMPLET (remises,
-- redemption, combo_components) via un snapshot verbatim. Draft-only, hors money-path.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS held_cart_snapshot JSONB;
COMMENT ON COLUMN public.orders.held_cart_snapshot IS
  'S79 — verbatim client cart payload for is_held drafts; NULL otherwise. Consumed and cleared by restore_held_order_v2 (row deleted).';

-- hold_order_v2 : corps = pg_get_functiondef(hold_order_v1) live (DEV-S57-02), avec :
--   1. le nom/signature bumpés v2 ;
--   2. l'INSERT INTO orders gagne la colonne : `..., held_cart_snapshot) VALUES (..., p_cart_payload)` ;
--   3. la boucle de matérialisation SAUTE les lignes cadeaux :
--        IF COALESCE((v_item->>'is_promo_gift')::boolean, false) THEN CONTINUE; END IF;
--      (défense en profondeur — le client les filtre déjà) ;
--   4. rien d'autre ne change (idempotence, gate pos.sale.create, audit order.held).
CREATE OR REPLACE FUNCTION public.hold_order_v2(...) ...;  -- corps complet ici

-- restore_held_order_v2 : corps = pg_get_functiondef(restore_held_order_v1) live, avec :
--   1. SELECT ... INTO v_order gagne held_cart_snapshot ;
--   2. le RETURN devient :
--        IF v_order.held_cart_snapshot IS NOT NULL THEN
--          RETURN v_order.held_cart_snapshot || jsonb_build_object(
--            'order_id', v_order.id, 'tableNumber', v_order.table_number, 'notes', v_order.notes);
--        END IF;
--        RETURN <objet v1 inchangé>;  -- fallback drafts pré-S79
CREATE OR REPLACE FUNCTION public.restore_held_order_v2(p_order_id UUID) ...;

-- Versioning monotone : drop v1 (mêmes args), REVOKE trio sur les v2.
DROP FUNCTION public.hold_order_v1(UUID, JSONB, TEXT, TEXT);
DROP FUNCTION public.restore_held_order_v1(UUID);
REVOKE EXECUTE ON FUNCTION public.hold_order_v2(UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_order_v2(UUID, JSONB, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_order_v2(UUID, JSONB, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_held_order_v2(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_held_order_v2(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_held_order_v2(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

(Le fichier committé contient les DEUX corps complets recopiés du live — les `...` ci-dessus sont interdits dans le fichier final.) Apply via `mcp__claude_ai_Supabase__apply_migration` (name `hold_restore_v2_full_snapshot`).

- [ ] **Step 2 : pgTAP live.** Créer `supabase/tests/held_orders_v2_snapshot.test.sql` en reprenant le bloc fixture (mock claims + seed produit/user) de `supabase/tests/held_orders.test.sql` tel quel, puis assertions (pattern temp-table du projet — `execute_sql` ne remonte que la dernière ligne) :
  - T1 : `hold_order_v2` avec un payload contenant `items[0].discount` + `items[0].combo_components` + `cartDiscount` + `loyaltyPointsToRedeem` → `orders.held_cart_snapshot = payload` (verbatim, `is()` sur le JSONB).
  - T2 : une ligne `is_promo_gift:true` dans le payload n'est PAS matérialisée dans `order_items` (count).
  - T3 : `restore_held_order_v2` renvoie `->'items'->0->'discount'` et `->'cartDiscount'` non-NULL, puis le draft est supprimé (count orders = 0).
  - T4 : replay `hold_order_v2` même `p_client_uuid` → même `order_id` (idempotence conservée).
  - T5 : `SELECT throws_ok('SELECT public.hold_order_v1(...)')` — v1 bien droppée (`undefined_function`).
  Exécuter la suite via MCP `execute_sql` en enveloppe `BEGIN; ... ROLLBACK;` → 0 `not ok`.
- [ ] **Step 3 : types regen** (contrôleur) : `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`, diff-vérifier (sessions parallèles !), commit dédié `chore(types): regen post-_168`.
- [ ] **Step 4 : client — test rouge roundtrip**

```tsx
// apps/pos/src/features/heldOrders/__tests__/holdRestore.roundtrip.test.tsx
// Mock supabase.rpc : capture le payload de hold_order_v2, le renvoie verbatim
// (merged {order_id, tableNumber, notes}) au restore_held_order_v2 — miroir du serveur.
// Asserte qu'après restore, le cartStore contient : discount de ligne, combo_components,
// cartDiscount, loyaltyPointsToRedeem — et AUCUNE ligne is_promo_gift rejouée en dur.
```

Écrire le test complet sur ce modèle (helpers de mock existants dans `apps/pos/src/features/heldOrders/__tests__/`) ; il échoue tant que le client sérialise/réhydrate les 4 champs manquants.

- [ ] **Step 5 : client — implémentation.**
  - `useHoldOrder.ts` : `supabase.rpc('hold_order_v1', ...)` → `'hold_order_v2'`.
  - `HoldOrderButton.tsx` (remplace le `cartPayload` lignes 40-49) :

```ts
        cartPayload: {
          order_type: cart.order_type,
          customerId: attachedCustomer?.id ?? null,
          // S79 A4 — full-fidelity snapshot. Gift lines are excluded: the
          // promotions auto-eval regenerates them on restore.
          ...(cart.cartDiscount ? { cartDiscount: cart.cartDiscount } : {}),
          ...(cart.loyaltyPointsToRedeem ? { loyaltyPointsToRedeem: cart.loyaltyPointsToRedeem } : {}),
          items: cart.items
            .filter((i) => !i.is_promo_gift && !i.is_cancelled)
            .map((i) => ({
              product_id: i.product_id,
              name: i.name,
              quantity: i.quantity,
              unit_price: i.unit_price,
              modifiers: i.modifiers,
              ...(i.product_type ? { product_type: i.product_type } : {}),
              ...(i.discount ? { discount: i.discount } : {}),
              ...(i.combo_components ? { combo_components: i.combo_components } : {}),
            })),
        },
```

  - `useRestoreHeldOrder.ts` : rpc → `'restore_held_order_v2'` ; étendre `RestoredHeldOrder` (`items[].product_type?/discount?/combo_components?`, top-level `cartDiscount?/loyaltyPointsToRedeem?`) ; le mapping `items` recopie les nouveaux champs (spread conditionnel comme ci-dessus) ; le `cart` reconstruit gagne `...(payload.cartDiscount ? { cartDiscount: payload.cartDiscount } : {})` et idem `loyaltyPointsToRedeem` ; après `restoreCart`, si une remise (ligne ou panier) a été restaurée :

```ts
      toast.info('Remises restaurées — une ré-autorisation manager peut être demandée au paiement');
```

- [ ] **Step 6 :** `pnpm --filter @breakery/app-pos test heldOrders` → PASS ; `pnpm typecheck`.
- [ ] **Step 7 :** eslint, commit `feat(pos): S79 A4 — hold/restore v2, snapshot complet du panier (migration _168 + client)`.

---

### Task 5 (B1) : persistance du panier tablette

**Files:**
- Modify: `apps/pos/src/stores/tabletCartStore.ts`
- Test: `apps/pos/src/stores/__tests__/tabletCartStore.persist.test.ts` (créer)

- [ ] **Step 1 : test rouge**

```ts
// apps/pos/src/stores/__tests__/tabletCartStore.persist.test.ts
import { describe, it, expect } from 'vitest';
import { useTabletCartStore } from '../tabletCartStore';

const PRODUCT = { id: 'p1', name: 'Croissant', retail_price: 15000 } as never;

describe('tabletCartStore persistence (S79 B1)', () => {
  it('mirrors the cart into localStorage (survives a webview kill)', () => {
    useTabletCartStore.getState().addItem(PRODUCT);
    useTabletCartStore.getState().setTableNumber('T4');
    const raw = localStorage.getItem('pos:tabletCart');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: { items: unknown[]; tableNumber: string } };
    expect(persisted.state.items).toHaveLength(1);
    expect(persisted.state.tableNumber).toBe('T4');
  });

  it('clearCart clears the persisted mirror too', () => {
    useTabletCartStore.getState().clearCart();
    const persisted = JSON.parse(localStorage.getItem('pos:tabletCart')!) as { state: { items: unknown[] } };
    expect(persisted.state.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2 :** run → FAIL (rien en localStorage).
- [ ] **Step 3 : implémentation** — wrapper `persist` (⚠️ **localStorage**, pas sessionStorage : la webview Capacitor tuée en arrière-plan perd sessionStorage — c'est LE cas nominal visé) :

```ts
import { persist, createJSONStorage } from 'zustand/middleware';
// ...
export const useTabletCartStore = create<TabletCartState>()(
  persist(
    (set, get) => ({
      /* corps existant inchangé */
    }),
    {
      // S79 B1 — the tablet's job is order-taking on the floor; the webview is
      // routinely killed in the background. localStorage (NOT sessionStorage)
      // so a draft survives kill/refresh. Actions are re-attached on rehydrate.
      name: 'pos:tabletCart',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        items: s.items,
        tableNumber: s.tableNumber,
        orderType: s.orderType,
        notes: s.notes,
      }),
    },
  ),
);
```

- [ ] **Step 4 :** run → PASS ; `pnpm --filter @breakery/app-pos test tablet` (non-régression).
- [ ] **Step 5 :** eslint, commit `fix(pos): S79 B1 — panier tablette persisté en localStorage (webview Capacitor tuée)`.

---

### Task 6 (B2) : `useTableOrders` expose TOUTES les commandes ouvertes par table

**Files:**
- Modify: `apps/pos/src/features/tables/hooks/useTableOrders.ts`
- Test: `apps/pos/src/features/tables/__tests__/useTableOrders.all.test.tsx` (créer)

**Interfaces:**
- Produces: `TableOrderRef` gagne `created_at: string` et `status: string`. Nouveau hook `useTableOrdersAll(enabled?)` → `Record<string, TableOrderRef[]>` (tri décroissant par table). `useTableOrders` garde son contrat actuel (latest par table) — **aucun consumer existant ne casse** (FloorPlanModal/TableSelectorButton).
- Implémentation : un SEUL fetch partagé (`queryKey: TABLE_ORDERS_KEY`, queryFn retourne `{ latest, all }`) ; les deux hooks sélectionnent via l'option `select` de useQuery.

- [ ] **Step 1 : test rouge** — mock du client supabase (3 commandes, 2 sur `T1`, 1 sur `T2`) : `useTableOrdersAll` renvoie `T1` avec 2 refs ordonnées récent→ancien ; `useTableOrders` renvoie la plus récente seule (compat).
- [ ] **Step 2 :** run → FAIL.
- [ ] **Step 3 : implémentation** — étendre `select('id, order_number, table_number, created_at, status')`, construire les deux maps dans `fetchTableOrders`, retourner `{ latest, all }`, et :

```ts
export function useTableOrders(enabled = true) {
  return useQuery({
    queryKey: TABLE_ORDERS_KEY,
    queryFn: fetchTableOrders,
    staleTime: 15_000,
    enabled,
    select: (maps) => maps.latest,
  });
}

/** S79 B2 — every open order per table (a table can carry several rounds). */
export function useTableOrdersAll(enabled = true) {
  return useQuery({
    queryKey: TABLE_ORDERS_KEY,
    queryFn: fetchTableOrders,
    staleTime: 15_000,
    enabled,
    select: (maps) => maps.all,
  });
}
```

Supprimer le commentaire d'en-tête « la PLUS RÉCENTE gagne — limite v1 » (la limite tombe) et mettre à jour la doc du fichier.

- [ ] **Step 4 :** run → PASS ; `pnpm --filter @breakery/app-pos test tables`.
- [ ] **Step 5 :** eslint, commit `feat(pos): S79 B2 — useTableOrdersAll, toutes les commandes ouvertes par table`.

---

### Task 7 (B3) : sheet « table occupée » sur la tablette (voir / tournée / transfert / annuler)

**Files:**
- Modify: `apps/pos/src/features/tablet/FloorPlanView.tsx` (prop `onOccupiedTableTap`)
- Create: `apps/pos/src/features/tablet/OccupiedTableSheet.tsx`
- Modify: `apps/pos/src/features/tablet/TabletOrderPage.tsx` (wiring)
- Test: `apps/pos/src/features/tablet/__tests__/OccupiedTableSheet.smoke.test.tsx` (créer)

**Interfaces:**
- Consumes: `useTableOrdersAll` (Task 6), `useTransferOrderTable` (`{orderId, toTable}` → `transfer_order_table_v1`), `useCancelTabletOrder` (`orderId` → `cancel_tablet_order`), `useTabletCartStore.setTableNumber/setOrderType`.
- Produces: `FloorPlanViewProps` + `onOccupiedTableTap?: (tableName: string) => void` ; composant `OccupiedTableSheet({ open, onOpenChange, tableName, orders, tables, occupancy, onAddRound })`.
- Décision assumée (v1) : « Ajouter une tournée » = **nouvelle commande** `create_tablet_order_v4` sur la même table (ticket cuisine séparé — normal en salle) ; la consolidation de l'addition au paiement reste le modèle actuel (le POS encaisse chaque commande ; toutes visibles via Task 6). PAS de nouveau RPC.

- [ ] **Step 1 : FloorPlanView** — remplacer le early-return ligne 99 :

```ts
      if (occupied) {
        // S79 B3 — an occupied table is no longer a dead-end: surface the
        // running order(s) so the waiter can add a round / transfer / cancel.
        onOccupiedTableTap?.(table.name);
        return;
      }
```

(+ la prop optionnelle dans `FloorPlanViewProps` et la signature du composant ; deps du `useCallback`.)

- [ ] **Step 2 : test rouge smoke** — render `OccupiedTableSheet` avec 2 commandes mockées : les 2 `order_number` visibles ; tap « Add round » → callback `onAddRound('T1')` ; tap « Transfer » puis une table dispo → `transfer_order_table_v1` mocké appelé avec `{p_order_id, p_to_table}` ; tap « Cancel » puis confirmation → `cancel_tablet_order` mocké appelé. Boutons ≥ 44 px (`min-h-11`).
- [ ] **Step 3 : implémentation `OccupiedTableSheet`** — primitifs `@breakery/ui` (`Sheet`, `Button`, `Badge`) :
  - Liste des commandes ouvertes de `tableName` (`order_number`, ancienneté via `created_at`, badge `status`).
  - Par commande, 3 actions : **Add round** → `onAddRound(tableName)` ; **Transfer** → étape interne listant les tables **disponibles** (`tables` filtrées par `occupancy`) puis `useTransferOrderTable.mutateAsync({ orderId, toTable })`, toasts succès/erreur (`Table transférée`/message serveur) ; **Cancel** → confirmation deux-taps inline (« Confirmer l'annulation ? ») puis `useCancelTabletOrder.mutateAsync(orderId)`, toasts.
  - Après transfert/annulation réussis : invalidation déjà gérée par les hooks ; fermer la sheet.
  - États : liste vide (« Aucune commande ouverte — la table se libère bientôt »), pending (boutons disabled), erreurs toastées. Pas d'import `Select` (n'existe pas dans le kit).
- [ ] **Step 4 : wiring `TabletOrderPage`** :

```ts
  const [occupiedTable, setOccupiedTable] = useState<string | null>(null);
  const tableOrdersAll = useTableOrdersAll(view === 'floor-plan' || occupiedTable !== null);

  const handleAddRound = useCallback((name: string) => {
    setTableNumber(name);
    setOrderType('dine_in');
    setOccupiedTable(null);
    setView('menu');
    toast.info(`Nouvelle tournée — Table ${name} (ticket cuisine séparé)`);
  }, [setTableNumber, setOrderType]);
```

`<FloorPlanView ... onOccupiedTableTap={setOccupiedTable} />` + render de la sheet (`open={occupiedTable !== null}`, `orders={tableOrdersAll.data?.[occupiedTable ?? ''] ?? []}`). Mettre à jour le `subtitle` du floor plan : « Tap a table — available to start, occupied to manage. »

- [ ] **Step 5 :** `pnpm --filter @breakery/app-pos test tablet` + `OccupiedTableSheet.smoke` → PASS ; `pnpm typecheck`.
- [ ] **Step 6 :** eslint, commit `feat(pos): S79 B3 — sheet table occupée sur tablette (tournée/transfert/annulation)`.

---

### Task 8 : closeout de session

- [ ] **Vérifications** (superpowers:verification-before-completion) : `pnpm typecheck` (7/7) · `pnpm build` · `pnpm --filter @breakery/domain test` (cart/payment/promotions) · `pnpm --filter @breakery/app-pos test` ciblé (payment, promotions, heldOrders, tablet, tables, stores) — la suite POS complète timeout localement (D-5 S72), la CI est le filet full-suite.
- [ ] **Ancres money-path re-passées live via MCP** (BEGIN/ROLLBACK) : `s44_money_gates` (12) + `held_orders` + `held_orders_v2_snapshot` + `hold_fired_order_v1` → 0 `not ok`. v17/v11/EF non touchés — diff à l'appui.
- [ ] **pattern-guardian** sur le diff de branche (idempotency 2-flavors, REVOKE trio `_168`, RPC versioning, pas d'INSERT brut).
- [ ] **Docs** : créer `docs/workplan/plans/2026-07-14-session-79-INDEX.md` (résultats, déviations DEV-S79-*, dettes D-*) ; bandeau « Mise à jour S79 » sur les fiches 02 (D2.2 hold lossy partiellement, D2.5 résiduel non traité), 13 (robustesse éval), 17 (D2.3 transfert tablette ✅) ; CLAUDE.md « In flight » / « Merged (latest) » ; checklist anti-dérive de fin de session.
- [ ] **PR** : squash-merge `swarm/session-79` → master après CI verte (lint-ratchet : les fichiers de test touchés peuvent porter des erreurs préexistantes — corriger dans la PR le cas échéant).

## Self-review (faite à la rédaction)
- Couverture : les 6 findings P1 de l'audit ont chacun une task (A1→T1, A2→T2, A3→T3, A4→T4, B1→T5, B2/B3→T6+T7). Le P1 « fragmentation d'addition » est traité en visibilité (T6) + flux assumé (T7), la consolidation au paiement reste hors périmètre (noter en dette D-* à l'INDEX).
- Types cohérents : `rotateKey` (T1) n'est consommé qu'en T1 ; `TableOrderRef.created_at/status` (T6) consommés en T7 ; le payload hold (T4 step 5) et le retour RPC v2 (T4 step 1) portent les mêmes clés (`discount`, `combo_components`, `cartDiscount`, `loyaltyPointsToRedeem`).
- Placeholders : les deux corps SQL v2 sont à recopier du live (DEV-S57-02) — c'est une règle projet, pas un TBD ; tout le reste est du code concret.
