# Module 9 — Clients professionnels (B2B)

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 9. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le socle financier (plafond TOCTOU, allocations par facture, annulation contrepassée, aging POS==BO) est réel et solide, mais la doc surclame trois choses centrales : il n'existe **ni prix négocié**, **ni cycle de livraison** (encore moins partiel), ~~**ni facture PDF**~~ — la « facture » est une commande interne sans document ni série légale.
>
> **⚠️ Mise à jour S68 (2026-07-08) — B1.4 facture PDF LIVRÉE.** La facture PDF B2B existe désormais : série de numérotation dédiée annuelle continue `INV/YYYY/NNNNN` (`create_b2b_order_v4`, migrations `_129..134`), RPC de lecture `get_b2b_invoice_v1`, template EF `b2b_invoice` (**aucune ligne PB1** — B2B NON-PKP), bouton « Invoice PDF » dans l'onglet Invoices BO. Reste surclamé : **prix négociés** (D3) et **cycle de livraison** (D3). Détail : [`../plans/2026-07-08-session-68-INDEX.md`](../plans/2026-07-08-session-68-INDEX.md).
>
> **✅ Mise à jour S69 (2026-07-08) — B1.1 PRIX NÉGOCIÉ B2B LIVRÉ.** Le prix négocié B2B **par client** existe désormais : nouvelle table **`customer_product_prices`** (client × produit × prix), permission dédiée **`customer_prices.manage`**, RPCs `upsert/delete_customer_product_price_v1`. La résolution du prix est **serveur** via le helper interne `_resolve_b2b_line_price_v1` (**négocié client > prix catégorie > retail**), câblée dans **`create_b2b_order_v4 → v5`** — le `unit_price` envoyé par le client est **ignoré** (credit-check et facturation sur le prix résolu), pattern S51 « prix canonique serveur ». BO : `NegotiatedPricesSection` sur la fiche client + prefill du modal B2B. Le verdict C-B1.1 ci-dessous passe donc de 🔴 MANQUANT à ✅ CONFORME (S69). Reste seul surclamé : **cycle de livraison** (D3.1). Détail : [`../plans/2026-07-08-session-69-INDEX.md`](../plans/2026-07-08-session-69-INDEX.md). — corps figé ci-dessous NON réécrit (`5b0fa92`).
> **🚫 Mise à jour 2026-07-10 — CYCLE DE LIVRAISON B2B HORS PÉRIMÈTRE (décision propriétaire).** The Breakery **ne gère pas de livraisons B2B**. Le verdict 🔴 MANQUANT de **B1.3** (cycle confirmée→préparation→prête→livrée + livraisons partielles) et le chantier **D3.1 (cycle de livraison)** sont donc **ANNULÉS** — le modèle actuel (commande `b2b_pending` → `paid`/`voided`, **stock déduit à la création**) est le comportement retenu, pas une lacune. L'item dépendant **D-B2.4 (avoirs officiels)** tombe également. Côté doc v1.3 : **retirer** la revendication de livraison (module 09-B1.3) au lieu de la reformuler « À venir ». Le fait générateur de la JE AR (module 10) reste « à la création ». Corps figé ci-dessous NON réécrit.

## A. Ce qui fonctionne réellement (code vérifié)

- **Création de commande B2B** via `create_b2b_order_v3` (`supabase/migrations/20260710000075_create_b2b_order_v3.sql`) : statut `b2b_pending`, garde stock flag-aware (`allow_negative_stock`, l.101-143), déduction stock **immédiate à la création** via `_record_sale_stock_v1` (display-aware — les articles vitrine décrémentent `display_stock`, l.207-231), JE auto DR AR / CR revenue (l.238-249), `audit_logs`, idempotence `p_idempotency_key`. [UI câblée : `CreateB2bOrderModal` ouvert depuis `B2BDashboardPage` (`apps/backoffice/src/pages/btob/B2BDashboardPage.tsx:36,76`), gate RPC `pos.sale.create`]
- **Plafond de crédit re-vérifié après `FOR UPDATE`** (TOCTOU fermé S52) : lock du client puis `validate_b2b_credit_limit_v1` sur le solde verrouillé (`_075` l.164-176) ; erreur `credit_limit_exceeded` P0011 avec payload `would_exceed_by` affiché dans le modal (`CreateB2bOrderModal.tsx:9-10,68`).
- **Encaissement facture par facture** : `record_b2b_payment_v2` (`20260710000067`) écrit des allocations réelles dans `b2b_payment_allocations` (table append-only `20260710000065`), ciblage `p_invoice_ids` en respectant l'ordre du tableau + FIFO en repli, pose `orders.paid_at`+`status='paid'` au solde complet, gate dédié `b2b.payment.record`, idempotence. [UI câblée : `RecordB2bPaymentModal` avec multi-sélection de factures — ordre de coche = ordre d'allocation ; pré-rempli depuis Outstanding/Invoices (`B2BPaymentsPage.tsx:59-63`)]
- **Annulation propre d'une facture non réglée** : `cancel_b2b_order_v1` (`20260710000068`) — contrepasse la JE (`b2b_order_cancel`), restitue le stock (`sale_void`), rembourse le solde client, **bloqué si une allocation existe**, motif ≥ 3 caractères, gate `b2b.order.cancel`, idempotent. [UI câblée : `CancelB2bOrderModal` depuis l'onglet Invoices (`B2bInvoicesTab.tsx`)]
- **Vues AR** : `view_b2b_invoices` / `view_ar_aging` reconstruites sur `outstanding = total − Σ amount_applied`, exclusion `voided`, buckets `current / 31-60 / 61-90 / 90+` (`20260710000070`). [UI câblée : onglet « Invoices » (`B2bInvoicesTab.tsx`, badge unpaid/partial/paid) ; aging KPI du dashboard (`useB2bDashboard.ts:132-134`)]
- **Parité caisse↔bureau** : `get_pos_b2b_debts_v3` (`20260710000071`) dérive le `paid` B2B des allocations ; consommé côté POS par `apps/pos/src/features/customers/hooks/useOutstandingDebts.ts:47`.
- **Pages BO routées et gatées** `b2b.read` : `/b2b` (dashboard), `/b2b/payments` (4 onglets received/outstanding/invoices/aging), `/b2b/settings` (`apps/backoffice/src/routes/index.tsx:500-521`).
- **Fiche client B2B** : `b2b_company_name`, `b2b_tax_id`, `b2b_payment_terms_days`, `b2b_credit_limit`, `b2b_current_balance` (`apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx:12-16`).
- **En plus (non exposé)** : `reconcile_b2b_balance_v1` (`20260710000072`, alerte drift cache↔ledger) et `adjust_b2b_balance_v2` (`20260710000058`, JE+PIN) existent en base mais **aucun call-site UI** dans `apps/` (grep `reconcile_b2b|adjust_b2b` → 0 fichier). [RPC seul]

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Créer une commande professionnelle avec **application automatique du prix négocié** du client.
- B1.2 Plafond de crédit vérifié au moment décisif de la validation, robuste à deux commandes simultanées.
- B1.3 Suivre le **cycle complet** (confirmée → en préparation → prête → livrée, avec **livraisons partielles**) ; stock déduit automatiquement à la sortie, y compris articles vitrine.
- B1.4 Générer une **facture officielle en PDF avec numérotation légale**.
- B1.5 Encaisser les paiements **facture par facture** (coche dans l'ordre voulu, ou FIFO automatique).
- B1.6 Annuler proprement une facture non réglée (JE + stock contrepassés, opération protégée).
- B1.7 Impayés par ancienneté (à jour/30/60/90+) — **caisse et bureau affichent le même encours**.

### B2. Annoncé « À venir »
- B2.1 Relances automatiques des retards de paiement.
- B2.2 Commandes récurrentes (hebdo hôtel).
- B2.3 Étape « devis » avant commande ferme.
- B2.4 Avoirs officiels (retour/casse à la livraison).
- B2.5 Garde-fou contre l'auto-validation commercial (SOD).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Prix négocié appliqué automatiquement | ~~**Aucun mécanisme de prix négocié**~~ **LIVRÉ S69** : table `customer_product_prices` (client × produit × prix) + perm `customer_prices.manage` + RPCs `upsert/delete_customer_product_price_v1` ; résolution **serveur** `_resolve_b2b_line_price_v1` (négocié client > catégorie > retail) dans `create_b2b_order_v5` — le `unit_price` client est **ignoré**. UI `NegotiatedPricesSection` sur la fiche client. *(Constat figé `5b0fa92` : à cette date le prix était librement éditable et le serveur facturait le `unit_price` client via `_075` — corrigé S69, pattern POS S51.)* | ✅ CONFORME (S69) |
| B1.2 | Plafond vérifié au moment décisif, concurrence-proof | Re-check après `FOR UPDATE` sur la ligne client (`_075` l.164-176), erreur P0011 avec payload | ✅ CONFORME |
| B1.3 | Cycle confirmée→préparation→prête→livrée + livraisons partielles ; stock déduit à la sortie | **Aucun cycle de livraison** : la commande naît `b2b_pending` et ne connaît que `paid`/`voided`. Pas de statuts intermédiaires, pas de livraisons partielles ; le stock est déduit **à la création**, pas à la livraison ; `p_delivery_date` n'est même pas persistée sur `orders` (seulement dans `audit_logs.metadata`, `_075` l.267). Seule la sous-partie « y compris vitrine » est vraie (v3 display-aware) | 🔴 MANQUANT |
| B1.4 | Facture officielle PDF, numérotation légale | ~~Aucun template facture~~ **LIVRÉ S68** : template `b2b_invoice` dans `generate-pdf` (v4) + série dédiée **annuelle continue** `INV/YYYY/NNNNN` (table `invoice_sequences`, `orders.invoice_number`, attribuée à la création par `create_b2b_order_v4`) + RPC lecture `get_b2b_invoice_v1` + bouton BO. **Aucune ligne PB1** (B2B NON-PKP, décision propriétaire). Numérotation continue mais **non fiscale-faktur** (NON-PKP) | ✅ CONFORME (S68) |
| B1.5 | Paiement facture par facture (coche ordonnée / FIFO) | `record_b2b_payment_v2` + `b2b_payment_allocations` + multi-sélection UI, ordre de coche respecté, FIFO en repli | ✅ CONFORME |
| B1.6 | Annulation propre protégée (JE+stock contrepassés) | `cancel_b2b_order_v1`, bloqué si allocation, gate `b2b.order.cancel`, motif requis | ✅ CONFORME |
| B1.7 | Aging 4 buckets, POS == BO | `view_ar_aging` (current/31-60/61-90/90+) ; `get_pos_b2b_debts_v3` dérivé des mêmes allocations | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 `reconcile_b2b_balance_v1` (détection de drift solde cache ↔ ledger) — mais non exposé en UI.
- 🔵 `adjust_b2b_balance_v2` (ajustement manuel avec JE + PIN manager) — non exposé en UI.
- 🔵 Page B2B Settings (`update_b2b_settings_v1`) non mentionnée par la doc.
- 🔵 Idempotence complète (création, paiement, annulation).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Persister `delivery_date` sur `orders`** (colonne + affichage dans B2bInvoicesTab) au lieu du seul audit metadata. Fichiers : nouvelle migration, `useCreateB2bOrder.ts`, `B2bInvoicesTab.tsx`. Done = la date saisie au modal est visible sur la facture listée.
- **Câbler `reconcile_b2b_balance_v1`** en bandeau d'alerte sur le B2B Dashboard (drift ≠ 0 → warning). Fichiers : nouveau hook + `B2BDashboardPage.tsx`. Done = drift visible sans SQL.
- **D4 immédiat** : amender la doc (voir D4) — c'est le correctif le plus honnête à court terme pour B1.1/B1.3/B1.4.

### D2. Chantiers moyens (1 session, plan requis)
- ✅ **Facture PDF B2B — SOLDÉ (S68, 2026-07-08)** : template `b2b_invoice` + bouton dans `B2bInvoicesTab` ; numérotation = série dédiée `invoice_sequences` **annuelle continue** `INV/YYYY/NNNNN`, attribuée à la création (`create_b2b_order_v4`) + backfill. Aucune ligne PB1 (NON-PKP). Cf. [`../plans/2026-07-08-session-68-INDEX.md`](../plans/2026-07-08-session-68-INDEX.md).
- **Exposer `adjust_b2b_balance_v2`** (modal PIN-gated sur la fiche client B2B) pour les corrections d'encours.

### D3. Chantiers lourds (spec dédiée avant code)
- **Cycle de livraison + livraisons partielles** : statuts de commande B2B, bons de livraison, déduction stock **à la livraison** (et non à la création) — impacte le stock, la compta (moment de reconnaissance du revenu/AR) et l'annulation. Spec obligatoire.
- ✅ **Prix négociés par client — SOLDÉ (S69, 2026-07-08)** : table `customer_product_prices` (client × produit × prix), résolution **côté serveur** `_resolve_b2b_line_price_v1` (négocié > catégorie > retail) dans `create_b2b_order_v5` (le `unit_price` client est ignoré, pattern S51 « prix canonique serveur »). Cf. [`../plans/2026-07-08-session-69-INDEX.md`](../plans/2026-07-08-session-69-INDEX.md).
- **Avoirs officiels** (B2.4) — dépend du cycle de livraison.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.1 → reformuler : « le prix est proposé au prix catalogue et ajustable manuellement à la commande » (ou déplacer « prix négocié » en À venir).
- B1.3 → reformuler : « la commande est créée et son stock déduit immédiatement ; le cycle de livraison détaillé (préparation, livraison partielle) est À venir ».
- B1.4 → déplacer intégralement en À venir (aucun PDF, pas de série légale).

## E. Dépendances croisées
- **Module 6 (Stock)** : déduction à la livraison (D3) suppose de déplacer l'appel `_record_sale_stock_v1`.
- **Module 10 (Comptabilité)** : la JE AR est posée à la création — un cycle de livraison réel repose la question du fait générateur ; l'annulation contrepasse déjà proprement.
- **Module 8 (Clients)** : fiche B2B (plafond, conditions) portée par `customers`.
- **Module 14 (Rapports)** : aging et ventes par client lisent les vues du module.
- **Module 25 (Sécurité)** : B2.5 (SOD commercial) rejoint le pattern SOD déjà implémenté côté dépenses (`approve_expense_v3`).
