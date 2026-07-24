# SPEC 013x — Exécution ADR-013 (void/refund/remise + avoir client)

Statut : vivante. À SUPPRIMER à la livraison complète ; résiduel → ADR-013.
Réfère : ADR-013 (décisions D1–D16). Source de vérité = code live + ADR-013.

Règle transverse : toute retouche du corps d'une RPC publiée = BUMP (_vN+1 +
DROP _vN dans la même migration), corps de départ = `pg_get_functiondef` live,
REVOKE trio + GRANT rôle d'origine, types régénérés. Aucun BEGIN/COMMIT interne.
Une branche = un lot. Tests exécutés (pgTAP en enveloppe BEGIN/ROLLBACK via MCP)
AVANT de clore un lot. Reviewer contexte vierge (diff + invariants), boucle
impl↔review plafonnée à 1.

---

## Lot 1 — Correction comptable reversal (le plus urgent : GL live faux)

Décisions : D2, D3(a).
- Trigger `fn_create_je_for_refund` : (a) `RETURN NEW` si `NEW.is_full_void` (D2 :
  le JE `sale_void` du trigger `create_sale_journal_entry` est la seule
  contre-passation). (b) `CASE` méthode aligné sur l'enum RÉEL
  (`cash|qris|card|edc|transfer|store_credit|gopay|ovo|dana`) et sur le mapping
  du JE de vente ; supprimer `debit_card`/`credit_card`. `store_credit` reste
  temporairement sur SALE_PAYMENT_CASH jusqu'au Lot 4 (avoir socle).
- Idéal : extraire un helper de mapping partagé vente/reversal (une seule source).
Fichiers : nouvelle migration trigger (numéro monotone le plus haut).
Tests : `net_revenue_full_void`, `pb1_dedup_void_refund`, + nouveau
`reversal_je_single_and_method_mapping.test.sql` (void = 1 JE ; refund card→Bank,
transfer→Transfer, qris→QRIS).
Gate : Trial Balance équilibré + soldes Revenue/Cash corrects sur un void.

## Lot 2 — Intégrité void + remise + idempotence

Décisions : D1, D9, D10, D12, D13.
- `void_order_rpc_v6` : garde D1 (refuser si `EXISTS refund non-full-void`) ;
  wrap idempotence `unique_violation`+re-read (déjà présent, conserver).
- `pay_existing_order_v14` : consommer nonce `discount_authorizations`
  (`p_discount_auth_id`) comme complete_order ; wrap `unique_violation`. (D9, D12)
- `refund_order_rpc_v7`, `add/update/remove_order_item` : wrap `unique_violation`
  +re-read → enveloppe replay. (D12)
- EF `process-payment` : retirer le fallback `body.discount_authorized_by` (D10) ;
  clé d'idempotence stable, non régénérée sur échec retryable (D13, `paymentStore`
  + `usePaymentFlowLogic`). EF passe la clé en header `x-idempotency-key`.
Fichiers : migrations RPC (bumps) + `supabase/functions/process-payment` +
`apps/pos/.../paymentStore.ts`, `usePaymentFlowLogic.ts`.
Tests : `pay_existing_discount_gate` (étendu nonce), nouveau
`void_blocked_after_partial_refund.test.sql`, `idempotency_hardening`
(replay concurrent → enveloppe), smoke POS paiement.
Gate : remise pay_existing sans nonce refusée ; void post-refund refusé ;
double-submit concurrent → enveloppe, pas 23505.

## Lot 3 — Totaux panier + durcissements

Décisions : D11, D14, D15.
- D11 : injecter `cart.promotionTotal` avant `calculateTotals` sur les 4 call-sites
  (`usePaymentFlowLogic`, `ActiveOrderPanel`, `BottomActionBar`, `useCartBroadcast`) ;
  vérifier l'ordre serveur identique ; corriger le plafond de rachat de points.
- D14 : migration forward-only ré-appliquant le corps single-statement de
  `get_orders_list_v2` (numéro le plus haut).
- D15 : `search_path = public, pg_temp` (bumps `complete_order`→v20,
  `pay_existing`, `void`, `_record_sale_stock_v1`) ; `add_order_item_v2` tarife les
  modificateurs serveur ; les 4 EF money-path via `_shared/error-redact.ts` ;
  nonce discount de process-payment minté dans la barrière d'idempotence.
Tests : domaine `calculateTotals` (promo+remise%), `orders_list_v2`,
`order_edit_items` (modifiers pricés), typecheck.
Gate : total affiché POS == total débité serveur sur promo+remise% ;
`get_orders_list_v2` OK sur rebuild à blanc.

## Lot 4 — Avoir client : socle comptable + ledger (chantier lourd)

Décisions : D4, D5, D6, D7, D8, D3(b).
- Migration COA : compte `2220 Customer Store Credit Payable (Avoir client)`
  (passif, postable) + clé mapping `SALE_PAYMENT_STORE_CREDIT → 2220`. Repointer
  le JE de vente ET le reversal `store_credit` vers 2220 (symétrie D3b).
- Table `customer_store_credit_ledger` (append-only, RLS révoque UPDATE/DELETE,
  écritures via RPC SECURITY DEFINER). Colonnes : customer_id, delta (signé),
  balance_after, source (`refund|manager_grant|loyalty_conversion|expiry|spend`),
  reference_type/id, expires_at, created_by, idempotency_key.
- RPC : `grant_store_credit_v1` (PIN manager + motif), `spend_store_credit_v1`
  (gate solde suffisant sous verrou, pattern `validate_b2b_credit_limit_v1`),
  `convert_loyalty_to_store_credit_v1` (DR 2210 / CR 2220), `expire_store_credit_v1`
  (job idempotent, DR 2220 / CR produit « avoirs périmés »).
- Refund émis en avoir : option dans `refund_order_rpc` (tender `store_credit` →
  CR 2220 au lieu de Caisse) alimentant le ledger.
- Gate paiement D8 : `store_credit` exige client rattaché + solde ≥ montant, vérifié
  serveur (complete_order / pay_existing).
- Réglage expiration en `business_config` (D7).
- UI : BO (solde + historique d'avoir par client, grant manager), POS (paiement par
  avoir, affichage solde). Réfère skill `b2b-credit` (patron AR inversé) + `accounting`.
Invariant clé : `SUM(soldes clients) = solde compte 2220` (réconciliation), solde
jamais négatif.
Tests : `store_credit_reconciliation.test.sql` (Σ = 2220), `store_credit_spend_gate`,
`store_credit_expiry_reprise_produit`, `loyalty_to_store_credit_je`.
Gate : réconciliation 2220 verte ; impossible de dépenser plus que le solde ;
expiration reprise en produit équilibrée.

## Lot 5 — Doc + reprises historiques (Mamat + à cadrer)

Décisions : D16 + résiduel.
- Réconciliations doc (Mamat édite) : seuil remise (POS.md:110), comptes PB1
  (ACCOUNTING.md:51), versions RPC (glossaire).
- Reprise JE historiques où `store_credit` fut imputé Caisse (volume à mesurer via
  MCP avant décision ; solde Caisse historique concerné). Non bloquant pour Lot 4.

---

## Ordre de livraison
Lot 1 → Lot 2 → Lot 3 → Lot 4 → Lot 5. Chaque lot = branche `fix/` ou `feat/`
dédiée + PR. Lot 4 peut être sous-découpé (socle compta / ledger+RPC / UI).

## Suppression de cette spec
À la clôture du Lot 4 (avoir livré) et des Lots 1-3, supprimer ce fichier ;
reporter tout résiduel non livré dans ADR-013 § Conséquences.
