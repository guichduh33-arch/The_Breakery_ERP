# Travail — Payments & Split

> Last updated: 2026-05-03
> Référence : `docs/reference/04-modules/03-payments-split.md` (à créer)
> Audits sources : `02-accounting-business-audit.md`, `04-reports-testing-audit.md`, `05-uiux-design-audit.md`, `08-operations-lan-audit.md`

## Objectifs du module

1. **Idempotence stricte** : aucun doublon de paiement même en cas de double-clic, perte réseau, retry. Critère : test unitaire couvrant 10 appels concurrents → 1 seul order créé.
2. **Gestion d'erreur partielle propre** : si un paiement passe et l'autre échoue dans un split, l'utilisateur sait quoi faire (retry, void, escalate). Critère : flow d'erreur testé en E2E.
3. **Méthodes de paiement modernes Indonésie** : QRIS Indonésien (GoPay, OVO, DANA, ShopeePay) supporté nativement, pas seulement « card ». Critère : QRIS avec QR scannable et confirmation auto.
4. **Receipt printing post-split** : un seul reçu agrégé après split, ou un par méthode au choix. Critère : configurable via settings.

---

## Tâches

### TASK-03-001 — Idempotence split en cas de double-clic [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A + 4.A. V3 evidence: `supabase/migrations/20260517000015_bump_complete_order_v9.sql` adds `p_idempotency_key UUID` (returns existing order if key matches); `apps/pos/src/features/payment/hooks/useCheckout.ts:85` passes `p_idempotency_key`; `__tests__/PaymentTerminal.idempotency.test.tsx` covers retry semantics. Commit `bdf21aa` (squashed PR #13).
**Contexte** : `complete_order_with_payments` RPC est atomique, mais le bouton « Confirm payment » côté UI n'est pas disabled le temps de la roundtrip. Double-clic possible → 2 RPCs envoyées avec les mêmes payloads. La RPC peut accepter le 2e en créant un nouvel order_id. Source : `CLAUDE.md` Pitfalls (split RPC) + revue code `PaymentModal`.
**Critère d'acceptation** :
- [ ] Génération d'un `idempotency_key` côté UI (UUIDv4) à l'ouverture de la modale paiement.
- [ ] RPC modifiée pour accepter et stocker `idempotency_key` ; second appel avec même clé → return du résultat précédent au lieu de re-créer.
- [ ] Bouton Confirm `disabled` pendant l'inflight (loading state).
- [ ] Tests : 10 appels concurrents avec même clé → 1 seul order créé, 9 réponses identiques.
- [ ] Index unique sur `(order_id, idempotency_key)` dans `order_payments`.
**Fichiers concernés** : `src/services/pos/orderService.ts`, `src/stores/paymentStore.ts`, RPC `complete_order_with_payments`, nouvelle migration index.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Briser l'atomicité existante. Tester avec `pgbench` ou script Node concurrent.

### TASK-03-002 — Retry logic `complete_order_with_payments` (network glitch) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 4.A. V3 evidence: `apps/pos/src/features/payment/PaymentTerminal.tsx:122-203` (`lastError`, `dispatchCheckout`, `handleRetry`, retry banner + `already_paid` banner); error classifier `classifyCheckoutError` in `@breakery/domain`; `OrderRetryBanner.tsx` for the order-history surface backed by RPC `retry_sale_journal_entry_v1` (migration `…000140`). Commit `bdf21aa`.
**Contexte** : Si la requête RPC timeout (réseau Lombok parfois flaky), l'UI montre une erreur mais le serveur peut avoir effectivement créé l'order. Sans idempotency, retry crée un doublon ; avec idempotency (TASK-03-001), retry est sûr. Inferred from `CURRENT_STATE.md` C7 (Realtime retry exponential backoff existe déjà).
**Critère d'acceptation** :
- [ ] Wrapper retry exponential (3 tentatives, 1s/2s/4s) sur `complete_order_with_payments`.
- [ ] Réutilise l'`idempotency_key` de TASK-03-001 → safe.
- [ ] UI : spinner « Processing... » avec compteur tentatives visible.
- [ ] Si 3 échecs → erreur claire « Payment may have succeeded, check order #XXX before retrying ».
- [ ] Test : mock supabase timeout → retry réussi.
**Fichiers concernés** : `src/services/pos/orderService.ts`, `src/utils/retryWithBackoff.ts` (à créer si absent).
**Dépend de** : `TASK-03-001`
**Estimation** : `M`
**Risques** : User confusion si retry montre des erreurs intermédiaires. UI claire.

### TASK-03-003 — Gestion erreur partielle (1 paiement OK, autre KO) [P1] [TODO]
**Status note (2026-05-14)** : Genuinely undone — depends on external gateway integration which V3 has not built. No QRIS/Midtrans/Xendit adapter exists (`supabase/functions/process-payment/index.ts` treats `qris` as a generic method name only). The error-classification half is in place (Phase 4.A retry banner) but the "1 tender confirmed, other failed" partial-state UX is moot until an external gateway is wired.
**Contexte** : Dans un split (ex : 50k cash + 30k QRIS), si la portion QRIS échoue côté gateway externe alors que cash est déjà comptabilisé, état incohérent. Actuellement `complete_order_with_payments` est tout-ou-rien (atomique DB), mais si le QRIS dépend d'une intégration externe, l'atomicité DB ne suffit pas. Inferred from code review.
**Critère d'acceptation** :
- [ ] Documenter le flow split : DB tout-ou-rien, mais gateways externes (QRIS) sont confirmés AVANT l'appel RPC final.
- [ ] Pre-validation : chaque paiement non-cash est confirmé par le gateway, puis le RPC commit en DB.
- [ ] Si un gateway échoue : afficher modal « Partial payment received, options: retry remaining / void all / pay rest in cash ».
- [ ] Audit log de chaque tentative (succès/échec, méthode, montant).
- [ ] Tests : mock gateway QRIS qui échoue à mi-chemin.
**Fichiers concernés** : `src/services/payment/`, `src/components/pos/modals/PaymentModal.tsx`, `src/components/pos/modals/SplitByItemModal.tsx`.
**Dépend de** : `TASK-03-001`
**Estimation** : `L`
**Risques** : Complexité importante. Bien spec avant implémentation. Couvre aussi le cas reçu papier vs DB.

### TASK-03-004 — Tip handling [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `orders.tip_amount` column added in Session 13 (grep across `supabase/migrations/` returns 0 hits for `tip_amount`). Carry-over.
**Contexte** : Bakery sur Lombok = pourboire pas systématique mais touristes en laissent. Pas de support tip dans le panier actuel. Inferred from product backlog (gap signalé en discussion).
**Critère d'acceptation** :
- [ ] Settings `pos_config.enable_tip` (default false).
- [ ] Si activé : étape « Add tip » dans le checkout (5 / 10 / 15 % ou montant custom).
- [ ] Tip stocké en colonne `orders.tip_amount` (nouvelle migration).
- [ ] Affichage séparé sur reçu et reports.
- [ ] Comptabilisation : compte 4111 sales OU compte dédié 4112 « Tips received » (à arbitrer avec comptable).
**Fichiers concernés** : nouvelle migration `orders.tip_amount`, `src/services/pos/cartCalculations.ts`, `src/components/pos/modals/PaymentModal.tsx`, `src/services/accounting/accountingEngine.ts` (nouveau wrapper).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Régression fiscale si tip est inclus dans le calcul PB1 (ne devrait pas). Cf. Mary's audit pour tax policy.

### TASK-03-005 — QRIS Indonésien natif (GoPay/OVO/DANA/ShopeePay) [P2] [BLOCKED]
**Status note (2026-05-14)** : Decision D6 (Decision Pack 2026-05-13) locked Xendit as provider but explicitly deferred adapter to "Phase 4 if capacity allows; otherwise QRIS defers to Phase 7". No `qris-webhook` EF or Xendit SDK integration shipped in Session 13. Carry-over to Session 17+ (B2B/payment-provider waves) or whenever a Xendit merchant account exists.
**Contexte** : Actuellement payment_method `qris` existe mais semble être traité comme un « card » générique. Indonésie utilise QRIS unifié (Bank Indonesia standard) avec QR statique ou dynamique. Vrais usages : GoPay, OVO, DANA, ShopeePay scannent le QR du marchand. Source : revue produit + `CLAUDE.md` (mention `1115 QRIS Receivable`).
**Critère d'acceptation** :
- [ ] Settings : QR statique (PNG affiché) ou dynamique (gateway intégré, ex : Midtrans, Xendit).
- [ ] Si dynamique : génération du QR avec montant à l'opening de la modale, polling status.
- [ ] Webhook handler (Edge Function) pour confirmer paiement automatiquement.
- [ ] Fallback manuel : « QRIS confirmed (paid)» si pas de webhook (mode statique).
- [ ] Reçu indique le wallet utilisé (GoPay vs OVO etc.) si dispo dans webhook.
**Fichiers concernés** : nouveau service `src/services/payment/qrisService.ts`, nouveau Edge Function `qris-webhook`, settings page, modale paiement.
**Dépend de** : `TASK-03-001` (idempotence)
**Estimation** : `XL`
**Risques** : Intégration externe (Midtrans/Xendit) = compte commerçant requis, frais, KYC. Décider avec business avant.

### TASK-03-006 — Receipt printing post-split (configurable) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. V3 ships single-receipt `SuccessModal.tsx` only; no `pos_config.receipt_split_mode` setting, no per-method receipt template. Carry-over.
**Contexte** : Après un split, comportement actuel pas clair (1 reçu agrégé ? 1 par méthode ?). Customer peut vouloir reçu séparé pour son comptable. Inferred from code review printService.
**Critère d'acceptation** :
- [ ] Settings `pos_config.receipt_split_mode` : `single` / `per-method` / `ask`.
- [ ] Mode `ask` : modal post-paiement « Print 1 receipt or N receipts? ».
- [ ] Reçu per-method affiche : montant payé + méthode + référence (ex : QRIS txn id).
- [ ] Total order total + sous-total par paiement toujours visible.
- [ ] Tests sur mode `single`, `per-method`, `ask`.
**Fichiers concernés** : `src/services/print/printService.ts`, `src/services/print/receiptFormatter.ts`, settings page, modale post-paiement.
**Dépend de** : `TASK-03-001`
**Estimation** : `M`
**Risques** : Confusion comptable si reçus séparés mal libellés. Valider avec comptable.

### TASK-03-007 — Store credit JE handling (redemption non couverte) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. The Phase 1.A refactor of `create_sale_journal_entry` (`supabase/migrations/20260517000010_*.sql`) routes ALL sale cash to `SALE_PAYMENT_CASH` mapping regardless of tender method — no `SALE_PAYMENT_STORE_CREDIT` mapping key exists in `accounting_mappings`. Per-tender-method JE routing remains a gap to fix in a future accounting phase.
**Contexte** : Quand un store credit est utilisé en paiement d'une nouvelle vente, aucune JE ne débite Store Credit Liability (2200) et crédite Revenue. Le trigger sale traite `store_credit` comme un card payment (mappe vers 1114). Source : `docs/audit/02-accounting-business-audit.md§P2-1`.
**Critère d'acceptation** :
- [ ] Trigger `create_sale_journal_entry` : détecter méthode `store_credit` → DR 2200 (Store Credit Liability) au lieu de 1114.
- [ ] Idempotence préservée.
- [ ] Tests : vente 100k payée 50k cash + 50k store credit → JE balanced (DR 1113 50k + DR 2200 50k / CR 4111 91k + CR 2143 9k).
- [ ] Documenter le mapping `SALE_PAYMENT_STORE_CREDIT` → 2200.
- [ ] Migration nouveau mapping si nécessaire.
**Fichiers concernés** : `supabase/migrations/YYYYMMDD_fix_store_credit_je.sql`, `src/services/accounting/accountingEngine.ts` (vérifier postPOSOutstandingJE aussi).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Régression sur ventes existantes. Tester sur staging avec migration backfill optionnel.

---

## Notes transverses

- **RPC canonique** : `complete_order_with_payments(order_id, payments[]) → JSON` (cf. `CLAUDE.md`). Toujours passer par cette RPC pour split, jamais createOrder + processPayment séparés.
- **Tax policy** : PB1 10 % inclusif `total × 10/110`. Aucune nouvelle méthode payment ne doit modifier ce calcul.
- **Audit comptable** : Mary a fixé les triggers en 2026-04-09. Toute nouvelle méthode payment doit avoir son mapping `SALE_PAYMENT_*` seedé.
- **idempotency_key** : convention UUID côté UI ; index unique côté DB sur `(order_id, idempotency_key)`.
