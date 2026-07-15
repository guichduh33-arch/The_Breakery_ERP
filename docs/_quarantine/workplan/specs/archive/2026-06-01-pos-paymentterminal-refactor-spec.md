# Spec — POS PaymentTerminal refactor (sous la barre des 500 lignes) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-paymentterminal-refactor`
- **Type** : refactor iso-comportement (hors cycle session numéroté)
- **Branche cible suggérée** : `refactor/pos-payment-terminal`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **M** (~1-2 jours — extraction + re-câblage + non-régression via tests existants)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P2 « PaymentTerminal monolithique > 500 lignes »**

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

`apps/pos/src/features/payment/PaymentTerminal.tsx` fait **633 lignes** (mesuré 2026-06-01), au-dessus de la règle CLAUDE.md « Keep files under 500 lines ». Le composant mélange plusieurs responsabilités dans une seule fonction `PaymentTerminal()` (`PaymentTerminal.tsx:56-627`) :

- **Sélecteur de stores** (lignes 57-75) : 11 sélecteurs `usePaymentStore` + cart/auth/checkout/fireToStations/presets.
- **Logique de calcul** (lignes 77-117) : totaux, promotions, `remaining`, draft tender, change, `draftValid`, `fastPathReady`, `canProcess`.
- **State UI local** (lignes 119-131) : `success`, `lastError`, `lastTendersShipped`, `splitOpen`.
- **Handlers** (lignes 133-256) : `handleAddTender`, `handleProcess` (lignes 149-225, le plus gros — checkout + retry classification + fire-to-stations), `handleRetry`, `handleDismissAlreadyPaid`, `handleNewOrder`, `handleSplitComplete`.
- **Rendering** (lignes 257-627) : early returns success/split + le gros JSX (grille de méthodes lignes ~321+, lignes de tender ~345+, retry banner ~515+).
- Helper `formatLabel` en fin de fichier (ligne 628).

Aucun bug fonctionnel ici — c'est une dette de **lisibilité / maintenabilité** : tout consommateur qui touche au flux paiement doit naviguer un fichier de 633 lignes mêlant state, logique métier et rendu.

---

## 2. Architecture / approche proposée

**Refactor strictement iso-comportement** : aucune modification de logique observable. Extraire en unités cohérentes pour passer chaque fichier sous 500 lignes (idéalement < 300).

**Extraction 1 — hook `usePaymentFlowLogic`** (`apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts`, NEW) :
- Encapsule les sélecteurs de stores + les dérivations de calcul (totaux, `remaining`, `draftTenderAmount`, `cashChange`, `draftValid`, `fastPathReady`, `canProcess`) + le state local retry (`lastError`, `lastTendersShipped`) + les handlers `handleProcess`/`handleAddTender`/`handleRetry`.
- Retourne un objet `{ totals, remaining, draftValid, canProcess, success, lastError, handleProcess, handleAddTender, handleRetry, ... }`.
- Reste dans `apps/pos` (pas dans `packages/domain` — il consomme stores/hooks IO, donc pas IO-free). Les **calculs purs** déjà dans `@breakery/domain` (`calculateTotals`, `sumTenders`, `computeRemaining`) restent là où ils sont.

**Extraction 2 — composants de présentation** (`apps/pos/src/features/payment/components/`, NEW) :
- `PaymentMethodGrid.tsx` — la grille de méthodes (sélection method, props : `methods`, `selectedMethod`, `onSelect`).
- `TenderRow.tsx` — une ligne de tender accumulé (montant, méthode, bouton remove).
- `RetryBanner.tsx` — le bandeau d'erreur/retry (props : `error`, `onRetry`, `onDismiss`).
- (Optionnel) `CashReceivedInput.tsx` / `PaymentTerminalFooter.tsx` si nécessaire pour repasser sous 500.

**`PaymentTerminal.tsx` devient un orchestrateur mince** : consomme `usePaymentFlowLogic`, compose `<PaymentMethodGrid>`, `<TenderRow>`, `<RetryBanner>`, gère les early returns (`<SuccessState>`/split) et le câblage `<SplitPaymentFlow>`/`<SuccessModal>`.

**Invariant** : `formatLabel` (`PaymentTerminal.tsx:628`) peut migrer dans un util local ou rester ; les noms de props publiques de `PaymentTerminal` ne changent pas ; les `data-testid` / labels accessibles consommés par les tests existants doivent être **préservés à l'identique** (sinon les smokes cassent).

---

## 3. Critères d'acceptation

- [ ] `PaymentTerminal.tsx` < 500 lignes (cible < 300).
- [ ] Chaque nouveau fichier extrait < 500 lignes.
- [ ] **Comportement strictement inchangé** : tous les tests paiement existants passent **sans modification** (ou avec adaptations purement mécaniques d'import).
- [ ] `data-testid` et labels accessibles (Numpad group, boutons Verify/method, etc.) préservés.
- [ ] Pas de calcul dupliqué : les fonctions pures restent dans `@breakery/domain`.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

## 4. Tests attendus

**Couverture par les tests existants** (le refactor doit les laisser verts sans changer leur logique) :
- `apps/pos/src/features/payment/__tests__/PaymentTerminal.idempotency.test.tsx` (retry réutilise la même idempotency key).
- `apps/pos/src/features/payment/split/__tests__/SplitPaymentFlow.smoke.test.tsx` (flux split).
- `apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx` + `receipt-targets-cashier.smoke.test.tsx` (S34).

Tests nouveaux (optionnels, si extraction le permet) :
- `usePaymentFlowLogic` unit (calculs `remaining`/`draftValid`/`fastPathReady`/`canProcess`) — value-add bonus rendu possible par l'extraction.
- `PaymentMethodGrid` / `RetryBanner` render smokes.

Non-régression : `pnpm --filter @breakery/app-pos test payment`.

## 5. Hors scope

- Tout changement de logique paiement (retry classification, fire-to-stations, split flow) — pur refactor.
- Migration des calculs vers `@breakery/domain` (ils y sont déjà : `calculateTotals`/`sumTenders`/`computeRemaining`).
- Refonte UX / restyle du PaymentTerminal.
- Dé-doublonnage CartItemRow/CartLineRow (F-020 backlog S35+) — composant différent.

## 6. Risques / dépendances

- **Risque principal** : casser un test smoke en déplaçant un `data-testid` ou un label accessible. Mitigation : extraire d'abord, lancer les tests existants à chaque étape, ne renommer aucun sélecteur consommé par un test.
- **Risque secondaire** : `handleProcess` (lignes 149-225) capture beaucoup de state — l'extraction en hook doit préserver l'ordre des effets et le lifecycle de l'idempotency key (régénérée seulement sur close/reset via le store). Vérifier `PaymentTerminal.idempotency.test.tsx` reste vert.
- Aucune migration DB / RPC / EF.
