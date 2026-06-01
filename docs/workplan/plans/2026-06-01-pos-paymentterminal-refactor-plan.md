# Plan — POS PaymentTerminal refactor (sous la barre des 500 lignes) (V1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Ce refactor est iso-comportement** : la garantie de non-régression repose entièrement sur les tests existants — ne JAMAIS adapter la logique d'un test pour le faire passer, seulement les imports si un fichier bouge.

**Goal:** Faire passer `apps/pos/src/features/payment/PaymentTerminal.tsx` (**633 lignes**, mesuré 2026-06-01) sous la barre des 500 lignes (cible < 300) sans modifier le moindre comportement observable, en extrayant (1) la logique de flux dans un hook `usePaymentFlowLogic` et (2) les sous-blocs de présentation dans des composants dédiés.

**Type:** refactor iso-comportement, hors cycle session numéroté.

**Spec:** [`../specs/2026-06-01-pos-paymentterminal-refactor-spec.md`](../specs/2026-06-01-pos-paymentterminal-refactor-spec.md)
**Branch:** `refactor/pos-payment-terminal` (à créer depuis `master` @ `70c5cf1`)
**Effort:** M (~1-2 jours)
**Aucune migration / RPC / EF.** Aucun changement DB.

---

## Invariants non négociables (lire avant de toucher quoi que ce soit)

Ces invariants sont la définition même d'« iso-comportement ». Toute violation = régression.

1. **`data-testid` préservés à l'identique** — les tests les consomment :
   - `payment-retry-banner`, `payment-retry-button` (`PaymentTerminal.tsx:426,440`)
   - `payment-already-paid-banner`, `payment-already-paid-dismiss` (`:453,466`)
   - `pay-cash-exact` (`:483`), `pay-split-entry` (`:499`)
   - `pay-method-${m.value}` (`:526`), `pay-add-tender` (`:595`)
2. **Labels accessibles préservés** — le test `PaymentTerminal.idempotency.test.tsx` cible le bouton via `getAllByRole('button', { name: /Process Payment/i })[0]` (`:109`). Le footer "Process Payment" (`:619`) et son `disabled={!canProcess || checkout.isPending}` doivent rester intacts (même nom, même condition).
3. **Chemins d'import des hooks consommés par les mocks de test** — `PaymentTerminal.idempotency.test.tsx:32` mocke `'../hooks/useCheckout'` (chemin relatif depuis le fichier de test = `apps/pos/src/features/payment/hooks/useCheckout`). Le nouveau hook `usePaymentFlowLogic` DOIT continuer d'importer `useCheckout` depuis `./useCheckout` (résolu au même module) pour que le mock prenne. Idem `useFireToStations` (`PaymentTerminal.tsx:29`) — le test ne le mocke pas explicitement, donc le hook réel est chargé : préserver le chemin `@/features/cart/hooks/useFireToStations` pour ne pas casser la résolution.
4. **Lifecycle de l'idempotency key inchangé** — la clé vit dans `paymentStore` et n'est régénérée que sur `close`/`reset` (`PaymentTerminal.tsx:233-237,242-243`). `dispatchCheckout` (`:183`) mémorise `lastTendersShipped` pour que `handleRetry` (`:226`) renvoie le même payload + la même clé. Cette mécanique doit rester strictement équivalente — c'est exactement ce que vérifie le test (assertion `idempotencyKey` inchangée `:132`).
5. **Ordre des effets dans `dispatchCheckout`** — `setLastError(null)` puis `setLastTendersShipped(...)` puis `checkout.mutateAsync` puis fire-to-stations non-bloquant `.then/.catch` (`:184-203`) puis `setSuccess(...)` (`:205`). Le fire-to-stations ne doit JAMAIS bloquer l'écran succès. Ordre et non-blocage préservés.
6. **`@breakery/domain` reste IO-free** — `usePaymentFlowLogic` reste dans `apps/pos` (il consomme stores + React Query). Les fonctions pures (`calculateTotals`, `sumTenders`, `computeRemaining`, `validateTenders`, `classifyCheckoutError`, `earnPointsForCustomer`, `tierFromLifetime`) restent dans le domaine — **ne pas dupliquer**.
7. **Aucun nouveau fichier > 500 lignes.**

---

## File Structure (overview)

### New (hook)
```
apps/pos/src/features/payment/hooks/
  usePaymentFlowLogic.ts                       (NEW — stores + dérivations + handlers)
  __tests__/usePaymentFlowLogic.test.ts        (NEW — bonus unit, value-add)
```

### New (présentation)
```
apps/pos/src/features/payment/components/
  PaymentMethodGrid.tsx                        (NEW — grille de méthodes)
  TenderDraftPanel.tsx                         (NEW — Enter Amount + preset + Numpad + Add Tender)
  RetryBanner.tsx                              (NEW — bandeaux retryable + already_paid)
  OrderSummaryPanel.tsx                        (NEW — colonne gauche : table items + totaux + loyalty)
  QuickPayRow.tsx                              (NEW — Cash Exact + Split by Item)
  __tests__/PaymentMethodGrid.smoke.test.tsx   (NEW — bonus)
  __tests__/RetryBanner.smoke.test.tsx         (NEW — bonus)
```

### Changed
```
apps/pos/src/features/payment/PaymentTerminal.tsx   (RÉDUIT — orchestrateur mince)
```

### Tests existants (doivent rester verts SANS changement de logique)
```
apps/pos/src/features/payment/__tests__/PaymentTerminal.idempotency.test.tsx
apps/pos/src/features/payment/split/__tests__/SplitPaymentFlow.smoke.test.tsx
apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx
apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx
```

---

## Phase 0 — branche + baseline verte (BLOQUANT)

- [ ] **P0.1** Créer `refactor/pos-payment-terminal` depuis `master` @ `70c5cf1` ; committer spec + plan (`docs(workplan): pos paymentterminal refactor — spec + plan`).
- [ ] **P0.2 — Capturer la baseline verte AVANT de toucher au code.** Lancer la suite paiement courante et noter le résultat exact :
  ```
  pnpm --filter @breakery/app-pos test payment
  ```
  Noter le compte de fichiers / tests PASS (et tout échec env-gated pré-existant `VITE_SUPABASE_URL Required`, baseline DEV-S25-2.A-02). C'est le **contrat de non-régression** : toute différence après refactor = régression à investiguer.
- [ ] **P0.3** `pnpm --filter @breakery/app-pos typecheck` — noter PASS de référence.

---

## Phase 1 — Extraction hook `usePaymentFlowLogic` (le gros morceau)

> Extraire d'abord la logique (state + dérivations + handlers), `PaymentTerminal.tsx` continue de rendre exactement le même JSX en consommant le hook. Lancer les tests après cette phase **avant** de toucher au JSX (isole la cause d'une régression éventuelle).

- [ ] **P1.1** Créer `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts`. Y déplacer **à l'identique** :
  - Les sélecteurs de stores (`PaymentTerminal.tsx:57-75`) : `isOpen`, `close`, `reset`, `selectedMethod`, `selectMethod`, `cashReceivedStr`, `setCashReceivedStr`, `tenders`, `addTender`, `removeTender` (paymentStore) ; `cart`, `attachedCustomer`, `appliedPromotions` (cartStore) ; `user` (authStore) ; `useCheckout()` ; `useFireToStations()` ; `usePOSPresets()`.
  - Les dérivations de calcul (`:77-117`) : `baseTotals`, `promotionTotal`, `total`, `tax_amount`, `totals`, `tenderedSum`, `remaining`, `draftAmount`, `isCashDraft`, `draftTenderAmount`, `cashChange`, `draftValid`, `fastPathReady`, `canProcess`. **Copier le code exact** — aucune simplification.
  - Le state local (`:119-131`) : `success`, `lastError`, `lastTendersShipped`, `splitOpen`.
  - Les handlers (`:133-254`) : `handleAddTender`, `handleProcess`, `dispatchCheckout`, `handleRetry`, `handleDismissAlreadyPaid`, `handleNewOrder`, `handleSplitComplete`. **Conserver l'ordre des effets de `dispatchCheckout` (Invariant 5)** et la mécanique idempotency (Invariant 4).
- [ ] **P1.2** Le hook retourne un objet typé regroupant tout ce que le JSX consomme. Exemple de shape (adapter aux usages réels) :
  ```ts
  return {
    // modal
    isOpen, close,
    // data
    cart, attachedCustomer, appliedPromotions, user, totals, tenderedSum,
    // draft / method
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    // tenders
    tenders, removeTender,
    // flow flags
    remaining, fastPathReady, canProcess,
    // ui state
    success, lastError, splitOpen, setSplitOpen,
    checkoutPending: checkout.isPending,
    // handlers
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  } as const;
  ```
  Ne PAS exposer de valeur dérivée que le JSX n'utilise pas. Garder `formatLabel` (`:628`) accessible : soit l'exporter d'un util local `apps/pos/src/features/payment/format.ts`, soit le laisser dans `PaymentTerminal.tsx` (le JSX l'utilise lignes 488/568/577 ; les sous-composants extraits en Phase 2 en auront besoin → préférer un util partagé `format.ts`).
- [ ] **P1.3** `PaymentTerminal.tsx` : remplacer tout le bloc state/dérivations/handlers par `const flow = usePaymentFlowLogic();` + destructuration. **Ne pas encore extraire le JSX** — juste re-câbler sur `flow.*`. Le rendu reste byte-pour-byte équivalent.
- [ ] **P1.4** Vérif intermédiaire — la logique est isolée mais le JSX intact :
  ```
  pnpm --filter @breakery/app-pos typecheck
  pnpm --filter @breakery/app-pos test payment
  ```
  Doit matcher la baseline P0.2 exactement. Si un test casse ici → la cause est dans l'extraction du hook (pas le JSX), facile à isoler.

---

## Phase 2 — Extraction des sous-composants de présentation

> Extraire le JSX en blocs cohérents. Chaque sous-composant reçoit ses props du `flow` via `PaymentTerminal`. **Préserver tous les `data-testid` et labels (Invariants 1-2).** Extraire un composant à la fois, retester après chaque.

- [ ] **P2.1 `RetryBanner.tsx`** — extraire les deux bandeaux (`PaymentTerminal.tsx:419-473`). Props : `{ lastError: RetryClassification | null; checkoutPending: boolean; onRetry: () => void; onDismissAlreadyPaid: () => void; }`. **Conserver `data-testid` `payment-retry-banner` / `payment-retry-button` / `payment-already-paid-banner` / `payment-already-paid-dismiss` + `role="alert"`.** Retester `PaymentTerminal.idempotency.test.tsx`.
- [ ] **P2.2 `PaymentMethodGrid.tsx`** — extraire la grille `METHODS.map(...)` (`:511-533`). Déplacer la const `METHODS` + le type `IconComponent` ici (ou dans un module `paymentMethods.ts` co-localisé). Props : `{ selectedMethod: PaymentMethod | null; onSelect: (m: PaymentMethod) => void; }`. **Conserver `data-testid` `pay-method-${value}` + les classes focus-visible.** Retester.
- [ ] **P2.3 `TenderDraftPanel.tsx`** — extraire le bloc "Enter Amount" + preset grid + Numpad + bouton Add Tender (`:535-600`). Props : montants/handlers depuis `flow` (`cashReceivedStr`, `setCashReceivedStr`, `draftAmount`, `isCashDraft`, `cashChange`, `draftTenderAmount`, `remaining`, `quickAmounts`, `draftValid`, `onAddTender`). **Conserver `data-testid` `pay-add-tender` + le `<Numpad>` (label accessible "Cash Received").** Retester.
- [ ] **P2.4 `QuickPayRow.tsx`** — extraire la quick-pay row Cash Exact + Split (`:475-506`). Props : `{ fastPathReady, isCashDraft, selectedMethod, total, checkoutPending, cartEmpty, onProcess, onSplitOpen }`. **Conserver `data-testid` `pay-cash-exact` / `pay-split-entry`.** Retester (`SplitPaymentFlow.smoke` touche `pay-split-entry`).
- [ ] **P2.5 `OrderSummaryPanel.tsx`** — extraire la colonne gauche (`:307-382`) : table items + loyalty badge + lignes totaux/promo/discount/tax/total. Props : `{ cart, attachedCustomer, appliedPromotions, totals }`. C'est du rendu pur, pas de testid critique connu — vérifier qu'aucun test ne cible un libellé de cette colonne avant de renommer quoi que ce soit.
- [ ] **P2.6** `PaymentTerminal.tsx` devient l'orchestrateur mince : `usePaymentFlowLogic()` + early returns (`success` → `<SuccessModal>` `:256-272` ; `splitOpen` → `<SplitPaymentFlow>` `:274-285`) + `<FullScreenModal>` composant les 5 sous-composants + header/footer. **Footer "Process Payment" reste dans `PaymentTerminal.tsx`** (Invariant 2 — le test cible `getAllByRole(...)[0]`, garder ce bouton là où il est, condition `disabled` inchangée).
- [ ] **P2.7** Vérifier le compteur de lignes :
  ```
  # Windows PowerShell
  (Get-Content apps/pos/src/features/payment/PaymentTerminal.tsx).Count
  ```
  `PaymentTerminal.tsx` < 500 (cible < 300) ; chaque sous-composant < 500.

---

## Phase 3 — Non-régression + bonus tests

- [ ] **P3.1 Non-régression (le critère central).** Relancer et comparer à la baseline P0.2 — **doit matcher exactement** :
  ```
  pnpm --filter @breakery/app-pos typecheck
  pnpm --filter @breakery/app-pos test payment
  ```
  Inclut : `PaymentTerminal.idempotency` (4 tests), `SplitPaymentFlow.smoke`, `checkout-autofire.smoke`, `receipt-targets-cashier.smoke`. Aucune adaptation de logique de test autorisée — seulement des corrections mécaniques d'import SI un test importait un symbole déplacé (peu probable, les tests importent `PaymentTerminal` et mockent `useCheckout`).
- [ ] **P3.2 Bonus — unit `usePaymentFlowLogic`** (value-add rendu possible par l'extraction, optionnel mais recommandé). Tester les dérivations pures isolément via `@testing-library/react` `renderHook` + stores stubbés : `remaining`, `draftValid`, `fastPathReady`, `canProcess` sur quelques scénarios (cash exact, non-cash exact, overpay cash, multi-tender en cours). Ne PAS re-tester ce que couvre déjà l'idempotency test.
- [ ] **P3.3 Bonus — render smokes** `PaymentMethodGrid` (sélection method appelle `onSelect`, testid présents) + `RetryBanner` (rend le bon bandeau selon `lastError.kind`, bouton appelle le bon handler).
- [ ] **P3.4 Sweep large** (confiance non-régression hors périmètre paiement) :
  ```
  pnpm --filter @breakery/app-pos test cart
  pnpm --filter @breakery/app-pos typecheck
  ```

---

## Phase 4 — Closeout

- [ ] **P4.1** INDEX léger `docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-INDEX.md` : Summary (fichier 633→N lignes), New files (hook + 5 composants), Files modified (PaymentTerminal), Tests run (tableau suite/count/status — baseline vs après), Deviations (le cas échéant), Acceptance checklist. **Pas de section Migrations/RPCs/Permissions** (refactor pur — l'écrire "N/A").
- [ ] **P4.2** CLAUDE.md : ce refactor est hors cycle session numéroté. Bump léger seulement si mergé indépendamment — ajouter une ligne courte sous "Active Workplan" notant le refactor `PaymentTerminal` livré sur `refactor/pos-payment-terminal`. Ne PAS toucher "Migration sequence active" (aucune migration).
- [ ] **P4.3** PR `refactor/pos-payment-terminal` → `master`. Titre : `refactor(pos): split PaymentTerminal (633→<300 lines) into usePaymentFlowLogic + presentation components`. Corps : lister les invariants préservés (testids, idempotency lifecycle, domain IO-free) + le diff de tests (baseline = après).

---

## Critères d'acceptation (miroir spec §3)

- [ ] `PaymentTerminal.tsx` < 500 lignes (cible < 300).
- [ ] Chaque nouveau fichier extrait < 500 lignes.
- [ ] Comportement strictement inchangé : tous les tests paiement existants passent **sans modification de leur logique** (diff baseline P0.2 = nul).
- [ ] `data-testid` et labels accessibles (Numpad, Verify/method, Process Payment, retry/already-paid banners, pay-cash-exact, pay-split-entry, pay-add-tender) préservés à l'identique.
- [ ] Pas de calcul dupliqué : fonctions pures restent dans `@breakery/domain`.
- [ ] `@breakery/domain` reste IO-free (le hook reste dans `apps/pos`).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

---

## Risques / mitigations (miroir spec §6)

| Risque | Mitigation matérialisée dans le plan |
|---|---|
| Casser un test smoke en déplaçant un `data-testid` / label | Invariants 1-2 listés explicitement ; extraction composant-par-composant avec retest après chacun (P2.1→P2.5) ; baseline capturée P0.2 |
| `dispatchCheckout` capture beaucoup de state → ordre des effets / lifecycle idempotency cassés | Invariants 4-5 ; Phase 1 isole la logique AVANT le JSX (P1.4 retest), donc une régression idempotency est attribuée au hook, pas au rendu |
| Mock de test résout un mauvais module après déplacement de `useCheckout`/`useFireToStations` | Invariant 3 : le hook importe `useCheckout` depuis `./useCheckout` (même module que le mock `'../hooks/useCheckout'`) ; `useFireToStations` garde son chemin `@/features/cart/hooks/useFireToStations` |
| Aucune migration / RPC / EF | N/A — refactor front pur |

---

## Hors scope (miroir spec §5)

- Tout changement de logique paiement (retry classification, fire-to-stations, split flow).
- Migration des calculs vers `@breakery/domain` (déjà là).
- Refonte UX / restyle du PaymentTerminal.
- Dé-doublonnage CartItemRow/CartLineRow (F-020 backlog S35+).
