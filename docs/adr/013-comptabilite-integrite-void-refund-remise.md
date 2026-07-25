# ADR-013 — Comptabilité et intégrité des void / refund / remise, et avoir client (post-audit Order)

Date : 2026-07-25
Statut : accepté
Complète : ADR-009 (cycle de vie des commandes). Ne le remplace pas.
Supersede : la note « store_credit → cash, pas de ledger d'avoirs V1, assumé »
            de 20260628000011_fix_sale_je_method_mapping.sql:79.

## Contexte

Audit à l'aveugle du module Order (RPC money-path, EF, front+domain) confronté à
la doc de vérité. Toute la mécanique fine void/refund (sale_void/sale_refund,
is_full_void, plafonds, mapping compte↔méthode) ne vivait que dans _quarantine :
aucune décision de vérité ne la gouvernait. `store_credit` était encaissable comme
moyen de paiement mais imputé à la Caisse faute de ledger d'avoirs. Cet ADR tranche
l'intégrité void/refund/remise ET crée le suivi d'avoir client.

## Décisions

### A — Intégrité void / refund

1. **D1 — Void INTERDIT sur une commande déjà partiellement remboursée.**
   `void_order_rpc` (bump) lève une erreur explicite si un `refunds`
   non-`is_full_void` existe pour l'ordre ; le reliquat se rembourse via refund
   partiel. Invariant : `SUM(refunds.total) ≤ orders.total` toujours vrai. (Clôt C1.)

2. **D2 — Un void émet EXACTEMENT UNE contre-passation.** Le JE canonique est
   `sale_void` (émis sur `status → voided`). La ligne `refunds(is_full_void=true)`
   reste un miroir audit mais N'ÉMET AUCUN JE : `fn_create_je_for_refund` ignore
   les lignes `is_full_void=true`. (Clôt C2 ; aligne POS.md:234 « une écriture ».)

3. **D3 — Mapping méthode→compte des reversals identique à la vente, piloté par
   l'enum Postgres réel.** `fn_create_je_for_refund` mappe
   `cash, qris, card, edc, transfer, store_credit, gopay, ovo, dana` — jamais
   `debit_card`/`credit_card` (inexistants). Vente et reversal partagent le même
   helper pour ne plus diverger. (Clôt C3.)

### B — Avoir client (store_credit) — nouveau suivi

4. **D4 — Compte de contrôle dédié `2220 — Customer Store Credit Payable (Avoir
   client)`** (passif, postable, à côté de 2210 Loyalty Liability). `store_credit`
   cesse d'être imputé à la Caisse. Changement SYMÉTRIQUE vente + reversal :
   nouvelle clé `SALE_PAYMENT_STORE_CREDIT → 2220`. Paiement par avoir = DR 2220
   (on éteint la dette) ; émission d'avoir = CR 2220.

5. **D5 — Ledger d'avoirs par client** (`customer_store_credit_ledger`,
   append-only, sibling inversé de l'AR B2B). Invariant de réconciliation :
   `SUM(soldes clients) = solde du compte de contrôle 2220`. Solde jamais négatif.
   Écritures via RPC SECURITY DEFINER uniquement (jamais d'INSERT direct).

6. **D6 — Trois sources d'alimentation, chacune avec son JE :**
   - **Refund émis en avoir** : au lieu de cash/transfer → CR 2220 (au lieu de
     CR Caisse). C'est la raison d'être de store_credit.
   - **Grant manager manuel** : PIN manager + motif obligatoires, tracé audit,
     un manager ne s'auto-crédite pas sans PIN. JE : DR charge commerciale / CR 2220.
   - **Conversion points fidélité** : DR 2210 Loyalty Liability / CR 2220
     (transfert entre deux dettes clients).

7. **D7 — Expiration configurable.** Durée en `business_config` (ex. N mois).
   À expiration, le passif est repris en produit : DR 2220 / CR produit
   (« avoirs périmés »). Job d'expiration idempotent.

8. **D8 — Paiement par avoir gaté serveur.** `store_credit` comme moyen de
   paiement exige un client rattaché et un solde d'avoir suffisant, vérifié
   côté serveur sous verrou (pattern `validate_b2b_credit_limit_v1`).
   `unit_price`/solde client jamais crus depuis le client.

### C — Autorisation des remises

9. **D9 — Toute remise money-path exige le nonce PIN manager à usage unique.**
   `pay_existing_order` (bump) consomme un `discount_authorizations`
   (`p_discount_auth_id`) exactement comme `complete_order`. Suppression du
   contrôle `has_permission` nu. (Clôt E1 ; ratifie DESCRIPTION.md:67.)

10. **D10 — Fin du dual-mode.** Aucun money-path ne lit une identité
    d'autorisateur depuis le body JSON. Hard cutover (CLAUDE.md:123).

### D — Totaux panier

11. **D11 — Ordre canonique unique : items → promo → redemption → remise panier
    → taxe** (déjà codé dans `calculateTotals`, fait foi). Le POS injecte
    `cart.promotionTotal` AVANT l'appel sur les 4 call-sites (`usePaymentFlowLogic`,
    `ActiveOrderPanel`, `BottomActionBar`, `useCartBroadcast`) au lieu de
    soustraire la promo après coup. Le serveur applique le même ordre. (Clôt E2 +
    le plafond de rachat de points laxiste, même cause.)

### E — Idempotence

12. **D12 — Le contrat CLAUDE.md:106-110 est contraignant sur tous les RPC
    money-path et edit-items** : INSERT de clé enveloppé
    `EXCEPTION WHEN unique_violation THEN <re-read + enveloppe 1ʳᵉ exécution>`.
    Concernés : `complete_order`, `pay_existing`, `add/update/remove_order_item`,
    `refund_order_rpc` (`void` sert de modèle). (Clôt M4.)

13. **D13 — Clé d'idempotence stable tant que la tentative n'est pas soldée.**
    Un échec retryable conserve la clé ; `close()`/`open()` ne régénèrent pas tant
    qu'une bannière retryable subsiste. Aligne DESCRIPTION.md:113. (Clôt E3.)

### F — Hygiène migrations & durcissements

14. **D14 — `get_orders_list_v2` : état terminal correct en ordre de rejeu.**
    Le fix single-statement (CTE en scope) est ré-appliqué par une migration
    forward-only au numéro le plus haut (runbook DR:264-272). (Clôt M1.)

15. **D15 — Durcissements transverses :**
    - `SET search_path = public, pg_temp` sur `complete_order`, `pay_existing`,
      `void`, `_record_sale_stock_v1`. (M3)
    - Les 4 EF money-path passent par `_shared/error-redact.ts`. (M5)
    - `add_order_item` (bump) tarife les modificateurs serveur via le même
      résolveur que `complete_order`. (M2)
    - Le nonce discount de `process-payment` est minté dans la barrière
      d'idempotence / la TX RPC, pas avant. (faible)

### G — Réconciliations documentaires (Mamat édite, aucune touche au code)

16. **D16 :**
    - Seuil remise : DESCRIPTION.md:67 (« toute remise ») fait foi ; corriger
      POS.md:110.
    - Comptes PB1 : SETTINGS.md:169 (« 2110 seul ») fait foi ; corriger
      ACCOUNTING.md:51 (« 2110 / 2143 »).
    - Versions RPC : runbook (v19) fait foi ; V2_V3_GLOSSARY (v9/v6) périmé.

## Conséquences / résiduel

- Bumps RPC : `void_order_rpc_v6` (D1), `pay_existing_order_v14` (D9),
  `add_order_item_v2` (D15), `refund_order_rpc_v7` (D12), + retouche triggers
  `fn_create_je_for_refund` (D2/D3) et `create_sale_journal_entry` (D4). Chaque
  bump : DROP N-1 même migration, corps de départ = `pg_get_functiondef` live,
  types régénérés.
- Nouveau socle avoir client (chantier dédié, sibling AR B2B) : compte 2220 +
  clé mapping, table `customer_store_credit_ledger`, RPC crédit/débit/expiration,
  gate paiement, UI BO (solde, historique) + POS (paiement par avoir). Spec
  d'exécution : `docs/specs/013x-void-refund-avoir.md`.
- Reprise historique : JE où `store_credit` fut imputé à la Caisse (comme la
  reprise PB1 fantôme du lot 6b) — volume à évaluer, solde Caisse concerné.
- Tests pgTAP à ajouter : void-après-refund bloqué (D1), void = 1 JE (D2),
  reversal non-cash sur bon compte (D3), réconciliation 2220 = Σ soldes (D5),
  expiration reprise en produit (D7), remise pay_existing sans nonce refusée (D9),
  replay concurrent renvoie l'enveloppe (D12).
- Hors périmètre (déjà tracé) : refund/cancel post-bascule tax_inclusive
  (SETTINGS.md:190-193), reprise JE historiques PB1 fantôme.

## Addendum 2026-07-25 — Livraison Lot 1 (ne révise aucune décision D1-D16)

Journal de mise en œuvre du Lot 1 (D2 + D3a). Découverte live qui précise
COMMENT D3 devient effectif ; les décisions restent inchangées.

- **D3a n'est pas qu'un problème de mapping, c'est un problème de TIMING.**
  Le CASE fautif (`debit_card`/`credit_card`) était en réalité du **code mort** :
  `trg_create_je_for_refund` était `AFTER INSERT ON refunds` (non déférable), or
  `refund_order_rpc` insère la ligne `refunds` PUIS les `refund_payments`
  (FK `refund_payments.refund_id → refunds.id` interdit l'ordre inverse). Au tir
  du trigger, `refund_payments` était vide → branche fallback
  `SALE_PAYMENT_CASH` systématique. **Preuve : 76/76 JE `sale_refund`
  historiques crédités `1110 Cash on Hand`, tous canaux confondus** — le CASE
  par tender n'avait jamais tourné.
- **Fix retenu (Option 1, validée par Mamat) :** trigger converti en
  `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED`. Il tire au COMMIT, quand
  `refund_payments` est peuplé → le mapping par canal devient effectif. Aligne
  les refunds sur les ventes (dont le trigger, immédiat, voyait déjà ses
  `order_payments` car insérés avant le passage `paid`).
- **Helper partagé vente/reversal (D3, « même helper pour ne plus diverger »)
  NON réalisé au Lot 1** : extraire le mapping toucherait `create_sale_journal_entry`
  (money-path de vente, blast radius). Au Lot 1, le CASE du reversal a été
  **réaligné à l'identique** sur celui de la vente. L'unification en un helper
  unique reste un résiduel (à faire quand le Lot 4 repointera `store_credit`
  vers 2220 des DEUX côtés — moment naturel pour factoriser).
- **`store_credit` reste imputé Caisse** jusqu'au Lot 4 (D4 : compte 2220).
- **Reprise historique élargie** : les 76 JE mal imputés ne concernent pas que
  `store_credit` mais **tous les refunds non-cash** (card/qris/transfer). Volume
  par canal à mesurer au **Lot 5** (le point « Reprise historique » ci-dessus
  s'entend donc au sens large, pas seulement store_credit).
- **Livré :** migration `20260725000221_fix_refund_je_d2_fullvoid_d3a_method_mapping.sql`
  (CREATE OR REPLACE de la fonction — trigger function, pas RPC versionné — +
  conversion du trigger) et test `reversal_je_single_and_method_mapping.test.sql`
  (8/8, vérifié live via MCP). Commit `e5aab329` sur `fix/refund-je-reversal-lot1`.
