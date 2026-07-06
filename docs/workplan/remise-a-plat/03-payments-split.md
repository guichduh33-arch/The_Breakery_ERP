# Module 03 — Encaissement & paiements

> ⚠️ **Mise à jour S64 (2026-07-06, `swarm/session-64`)** : les moyens de paiement présentés au terminal sont désormais **filtrés par `business_config.enabled_payment_methods`** (hook `useEnabledPaymentMethods`, fail-open = les 6, effet ≤ 60 s par polling) — grilles `PaymentMethodGrid` + `PerPayerMethodStep` + garde de désélection du draft. Enforcement UI v1 : l'EF `process-payment` accepte toujours les 6 (dette D-1 INDEX S64). Voir `docs/workplan/plans/2026-07-06-session-64-INDEX.md`.

> ⚠️ **Mise à jour S62 (2026-07-06, `swarm/session-62`)** : **D2.1 livré** — plafond de crédit ardoise retail contrôlé SERVEUR : colonne `customers.retail_credit_limit` (NULL = illimité) + gate d'encours live dans `attach_tab_customer_v1` (P0011 `credit_limit_exceeded`, DETAIL jsonb, anti-TOCTOU). Le gate joue à l'attache ; `pay_existing_order_v11` (money-path, intouchée) recalcule le total au paiement sans re-gater — design assumé (dette D-7 INDEX S62). Voir `docs/workplan/plans/2026-07-06-session-62-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 3. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel pour le quotidien ; partiel sur les paiements électroniques modernes
> **Verdict global de l'analyse :** Fidèle sur le cœur (multi-tender, split par convive, idempotence, discount sécurisé, taxe serveur) ; surclamation sur les moyens de paiement : il n'existe **ni tender « crédit professionnel » ni tender « ardoise »** au terminal, et le plafond de crédit n'est pas contrôlé pour le « payer plus tard » retail.

## A. Ce qui fonctionne réellement (code vérifié)

- **Money-path atomique** : le POS POSTe l'EF `process-payment` (`apps/pos/src/features/payment/hooks/useCheckout.ts:220`) qui appelle `complete_order_with_payment_v17` (`supabase/functions/process-payment/index.ts:265`) — commande + paiement(s) + stock + JE + fidélité + promos dans une transaction ; erreurs Postgres remappées en HTTP 4xx/409 (`index.ts:292-336`). Rate-limit durable 60 req/min/IP (`index.ts:134-141`). [EF + RPC]
- **6 moyens de paiement** : cash, card, qris, edc, transfer, store_credit (`apps/pos/src/features/payment/components/paymentMethods.ts:13-20` ; whitelist EF `index.ts:52`). Monnaie calculée automatiquement et **revalidée serveur** (`change_given != cash_received - amount` → exception, migration `20260710000092:542-546`) ; tiroir ouvert + reçu auto-imprimé si configuré (`apps/pos/src/features/payment/SuccessModal.tsx:8,137,168`). [UI câblée]
- **Paiement mixte (multi-tender)** : jusqu'à 5 tenders (`index.ts:53,181`), barre dû/payé/reste via `computeRemaining`/`sumTenders`, validation bloquée tant que `remaining > 0` (`apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts:76-103`) ; surpaiement cash autorisé uniquement sur le **dernier** tender (client `:126-129`, EF `index.ts:190-197`). [UI câblée]
- **Addition partagée par convive** : flux 3 modes — par articles / à parts égales / montants libres (`apps/pos/src/features/payment/split/types.ts:12,46-52`) ; assignation d'articles par payeur (`ItemAssignStep`), moyen de paiement **par payeur** (`PerPayerMethodStep`), cash par payeur (`PerPayerCashStep`) ; convergence en un tableau de tenders shippé au même RPC (`SplitPaymentFlow.tsx:184-200`) — un seul ticket. Les prix étant TTC, la taxe est mécaniquement répartie au prorata des parts. [UI câblée]
- **Payer plus tard (ardoise)** : commande fired laissée impayée, suivie dans `/pos/debts` (`get_pos_b2b_debts_v3`, `apps/pos/src/features/customers/hooks/useOutstandingDebts.ts:47`) et soldée via `pay_existing_order_v11` (`useCheckout.ts:169` ; hard-gate caps promo `_096`). [UI câblée]
- **Idempotence 2 saveurs (S25)** : clé de tentative `paymentStore.idempotencyKey` régénérée à l'ouverture/fermeture, forwardée en `p_idempotency_key` (`useCheckout.ts:159,212`) ; append de lignes fired protégé par `p_client_uuid` stable par tentative (`useCheckout.ts:109-117`) ; replay = même enveloppe + `idempotent_replay:true`. Remboursements/void : replay via `refunds.idempotency_key` / `order_items.cancel_idempotency_key` (S55, `_082`/`_083`). [UI + RPC]
- **Remise sécurisée** : PIN manager transmis uniquement en header `x-manager-pin` (`useCheckout.ts:225` — jamais en body JSON), vérifié **in-EF** (`index.ts:229-249`) avec lockout durable, permission `sales.discount` contrôlée, puis nonce single-use minté dans `discount_authorizations` (service-role only) et consommé atomiquement par v17 (`index.ts:252-262,289`) ; l'autorisateur est **dérivé du PIN vérifié**, le body client n'est pas cru (`index.ts:250-251`). [EF]
- **Taxe** : taux lu depuis `business_config.tax_rate` (hook `useTaxRate`, estimation pré-paiement `usePaymentFlowLogic.ts:67-74`) ; le serveur calcule `tax_amount = total × t/(1+t)` (`_092:518`) et le retourne dans l'enveloppe (lignes + subtotal serveur consommés par le reçu, S51). Isolation comptable par les triggers JE (PB1 NON-PKP). [RPC]
- **Gestion d'échec** : classification retryable/fatal/already_paid (`classifyCheckoutError`), bannière Retry avec re-ship des mêmes tenders + même clé (`usePaymentFlowLogic.ts:208-211`), gestion `account_locked` (5 PIN ratés). [UI câblée]
- **En plus de la doc** : `store_credit` comme moyen de paiement ; erreurs 409 dédiées combos/caps (`combo_invalid_component`, `promo_cap_exceeded`) ; fast-path un seul tender (`fastPathReady`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Encaisser en espèces (monnaie auto, tiroir ouvert), carte, virement, paiement mobile type QRIS, **crédit client professionnel ou ardoise**.
- B1.2 Paiement mixte avec barre « dû / payé / reste » temps réel ; validation impossible tant qu'il manque un centime.
- B1.3 Addition partagée par convive : chacun ses articles, chacun son moyen de paiement, taxe répartie au prorata.
- B1.4 Payer plus tard : créance sur le compte du client **(si son plafond de crédit le permet)**, visible jusqu'à règlement.
- B1.5 Double-clic / micro-coupure ne crée jamais deux encaissements ; idem remboursements.
- B1.6 Validation de remise sécurisée : le code ne circule jamais en clair.
- B1.7 Reçu imprimé automatiquement si configuré ; taxe locale 10 % (incluse) isolée automatiquement pour la comptabilité.

### B2. Annoncé « À venir »
- B2.1 Paiement mobile indonésien intégré (GoPay/OVO/DANA, confirmation auto — aujourd'hui pointage manuel).
- B2.2 Un reçu par payeur après addition partagée.
- B2.3 Distinction comptable du paiement en avoir.
- B2.4 Champ pourboires.
- B2.5 Conversion des devises étrangères.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Espèces/carte/virement/QRIS/**crédit pro ou ardoise** | cash+card+qris+edc+transfer+store_credit OK (monnaie auto, tiroir, `SuccessModal.tsx`) ; **aucun tender « crédit B2B » ni « ardoise »** dans la grille (`paymentMethods.ts:13-20`) — l'ardoise n'est pas un moyen de paiement mais l'absence de paiement ; le crédit pro se gère côté BO (`create_b2b_order_v3`), pas au terminal POS | 🟠 PARTIEL |
| B1.2 | Mixte + dû/payé/reste + validation bloquée | `computeRemaining`, `canProcess` ssi `remaining === 0` (`usePaymentFlowLogic.ts:103`), max 5 tenders, somme exacte revalidée serveur (`validateTenders` + v17) | ✅ CONFORME |
| B1.3 | Split par convive, moyens différents, taxe au prorata | 3 modes, méthode par payeur, un ordre + n tenders (`SplitPaymentFlow.tsx:184-200`) ; prix TTC → taxe répartie au prorata de fait (pas de calcul de taxe par payeur, ni reçu par payeur — assumé en B2.2) | ✅ CONFORME |
| B1.4 | Créance si plafond de crédit le permet | La créance existe (`/pos/debts`, `get_pos_b2b_debts_v3`) et reste visible jusqu'au solde ; **aucun contrôle de plafond** à l'ouverture d'une ardoise retail (le plafond n'est gaté que sur `create_b2b_order_v3`, flux BO) — le plafond est seulement affiché (`CustomerDebtsPanel.tsx:192-200`) | 🟠 PARTIEL (la parenthèse plafond surclame) |
| B1.5 | Idempotence encaissements + remboursements | 2 saveurs S25 câblées bout en bout (`useCheckout.ts:109-117,159` ; `_082`/`_083` pour void/refund/cancel) | ✅ CONFORME |
| B1.6 | Le code manager ne circule jamais en clair | PIN uniquement en header HTTPS (`x-manager-pin`), jamais en body/logs, vérifié in-EF, nonce single-use en DB (`index.ts:222-263`) ; « jamais en clair » = jamais hors TLS ni journalisé — exact au sens opérationnel | ✅ CONFORME |
| B1.7 | Reçu auto si configuré ; taxe 10 % isolée | `autoPrint` (`SuccessModal.tsx:137,168`) ; taux serveur `business_config.tax_rate` + `tax_amount` calculé/retourné par v17 (`_092:518`), JE de vente ventile la PB1 | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 `store_credit` (avoir) déjà encaissable comme tender (la doc ne le mentionne qu'en « à venir » comptable — B2.3 reste vrai pour la ventilation).
- 🔵 Rate-limit durable 60/min/IP sur l'EF paiement ; lockout PIN durable ; règle « surpaiement cash seulement sur le dernier tender » appliquée client ET serveur.
- 🔵 Enveloppe serveur riche (subtotal/lines/tax) consommée par le reçu — pas de recalcul client.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Documenter/renommer QRIS-EDC** : les tenders qris/edc sont du pointage manuel (aucune API PSP) — ajouter un libellé « (manuel) » ou un état de configuration dans `paymentMethods.ts` + doc. Done : plus d'ambiguïté caissier.
2. **Afficher l'encours/plafond du client attaché** dans le panneau panier (badge `CustomerBadge`) à partir de `get_pos_b2b_debts_v3` — pré-requis UX du gate D2.1. Done : le caissier voit le risque avant de laisser partir « je paie ce soir ».

### D2. Chantiers moyens (1 session, plan requis)
1. **Gate plafond de crédit pour l'ardoise retail** (partagé avec module 2 D2.1) : contrôle serveur de l'encours au fire sans paiement quand un client est lié ; erreur dédiée + override manager éventuel.
2. **Reçu par payeur (B2.2)** : le split connaît déjà les assignations par payeur (`SplitPayer.items`) — générer n reçus depuis ces données au `SuccessModal` (répartition de taxe par payeur à trancher : au prorata arrondi IDR).
3. **Champ pourboire (B2.4)** : tender `tip` ou champ sur `order_payments` + mapping comptable dédié ; toucher v17 (spec courte mais money-path → pgTAP obligatoire).
4. **Ventilation comptable du `store_credit` (B2.3)** : mapping `SALE_PAYMENT_STORE_CREDIT` vers un compte de passif avoir au lieu du compte de vente générique.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Intégration PSP QRIS/GoPay/OVO/DANA (B2.1)** : webhook de confirmation, états de paiement asynchrones, timeout/annulation — nouvelle surface EF + réconciliation ; spec dédiée impérative (money-path).
2. **Multi-devises (B2.5)** : taux, arrondis IDR, comptabilité de change — hors périmètre actuel.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.1 : retirer « crédit client professionnel » de la liste des moyens de paiement du POS (c'est un flux BO) et reformuler l'ardoise (cf. module 2 D4.2).
2. B1.4 : supprimer « si son plafond de crédit le permet » tant que D2.1 n'est pas livré.
3. Mentionner `store_credit` et EDC dans les moyens disponibles.

## E. Dépendances croisées
- **Module 2 (Panier)** : même flux checkout ; corrections ardoise/plafond communes.
- **Module 9 (B2B)** : le vrai contrôle de plafond vit dans `create_b2b_order_v3` — D2.1 doit s'en inspirer (TOCTOU `FOR UPDATE`).
- **Module 10 (Comptabilité)** : mappings de comptes pour tip/store_credit ; PB1.
- **Module 12 (Shifts)** : chaque tender alimente l'attendu de caisse (cash) et le Z-report (ventilation par méthode).
- **Module 13 (Promotions)** : caps hard-gatés dans v17 et `pay_existing_order_v11`.
