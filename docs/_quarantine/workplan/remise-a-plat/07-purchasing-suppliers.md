# Module 07 — Achats & fournisseurs

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 7. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** La doc **surclame nettement** ce module. Le socle (fournisseurs, cycle PO, réception partielle, stock+WAC auto, paiements partiels, audit) est réel et câblé, mais **le contrôle qualité article par article et les retours fournisseurs n'existent nulle part** (confirmé), les bons de commande n'ont **ni remises ni frais de livraison**, le cycle de statuts réel est `pending → partial → received` (pas de brouillon effectif, ni « envoyé », ni « confirmé »), et il n'y a **aucune pièce jointe** sur les paiements.

## A. Ce qui fonctionne réellement (code vérifié)

- **Répertoire fournisseurs** [UI câblée] : table `suppliers` — `code`, `name`, `contact_phone/email`, `address`, `payment_terms_days` (0–365, défaut 30), `notes`, soft-delete (`supabase/migrations/20260513000001:4-17`). Pages `/backoffice/suppliers[/:id]` gatées `suppliers.read` (`apps/backoffice/src/routes/index.tsx:379-394`), recherche libre nom/code (`features/suppliers/hooks/useSuppliersList.ts:4,18`), CRUD via `SupplierFormModal` (terms 0–365 j, `SupplierFormModal.tsx:195-198`), import en masse (`suppliers/import/suppliersImportDef.ts`, RPC `20260706000025`).
- **Historique de la relation** [UI câblée] : KPIs calculés côté client depuis les PO — dépenses totales, montant impayé, délai moyen de livraison (`features/suppliers/hooks/useSupplierMetrics.ts:11-50`), `SupplierAnalyticsTab`, distribution des paiements, **évolution des prix d'achat** (`SupplierPriceEvolutionTab` + `useSupplierPurchaseItems`).
- **Cycle PO** [UI câblée] : `create_purchase_order_v2` (`20260701000018` — lignes `product_id/quantity/unit/unit_cost/unit_factor_to_base`, TVA paramétrable, idempotency, garde **matières premières uniquement** `product_not_raw_material`, statut créé toujours `'pending'`:160) ; `update_purchase_order_v1` (`20260701000016`, éditable seulement `pending` sans GRN ni paiement) ; `cancel_purchase_order_v1` (`20260517000114`) ; `receive_purchase_order_v2` (`20260701000011`, réception **partielle ligne à ligne** via `received_quantity`, GRN `goods_receipt_notes`, idempotency-replay, création de lots `create_stock_lot_v1`:187, conversion coût → unité de base `20260706000012`). Statuts en base : `draft/pending/partial/received/cancelled` (`20260517000110:44-45`) mais **aucun RPC ne pose `draft`**. Pages `/purchasing/purchase-orders[/new|/:id]` gatées `purchasing.po.*` (`routes/index.tsx:395-426`), timeline de statut sur le détail.
- **Stock + prix de revient auto à réception** : mouvement `purchase` + lot + trigger WAC `products.cost_price` (`20260521000013`) + JE fournisseur automatique (trigger `20260517000113`, redesign PPN foldée `20260701000015`).
- **Paiements fournisseurs partiels** [UI câblée] : table `purchase_payments` (`20260701000012`, `outstanding = total_amount − Σ amount`, jamais stocké), RPC `record_po_payment_v1` (`20260701000013`) + mapping banque (`…014`), UI `RecordPaymentDialog` + `usePoPayments`. **Aucune colonne / aucun code de pièce jointe** (grep `attach|upload|photo` : 0 hit dans `features/purchasing` et les migrations purchase).
- **Audit** : `create/receive/cancel/record_po_payment` écrivent l'audit-log (5 writes dans receive v2, 3 dans payment, 1 dans cancel — grep migrations).
- **Impression** : `POPrintView` (vue imprimable navigateur) — pas de PDF EF ni d'envoi (cohérent avec le « à venir » de la doc).
- **Achat dépannage** : depuis le module stock, `useRecordDirectPurchase` chaîne create→receive→pay en un geste (`features/inventory/hooks/useRecordDirectPurchase.ts:93-134`).
- **EN PLUS de la doc** : import d'achats **historiques** avec flag dédié et blocage de paiement sur PO historique (`20260708000010/11`, `purchasing/import/purchasesImportDef.ts`) ; rapports achats câblés `/reports/purchase-items`, `/reports/purchase-by-date`, `/reports/purchase-by-supplier` (`routes/index.tsx:811-834`, RPCs `20260624000012..14`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Répertoire fournisseurs : recherche, **catégories**, conditions de paiement (comptant, 7/14/30/60 j), **identifiant fiscal**, historique relation (dépenses, impayés, délais).
- B1.2 Bon de commande ligne par ligne **avec remises et frais de livraison** ; cycle **brouillon → envoyé → confirmé → reçu partiellement → reçu**.
- B1.3 Réception avec **contrôle qualité article par article** ; article refusé ⇒ **retour fournisseur** automatique.
- B1.4 Stock et prix de revient mis à jour automatiquement à la réception.
- B1.5 Paiements partiels ou totaux + **pièces jointes** (facture, bon de livraison, photos).
- B1.6 Chaque action horodatée et signée dans un journal inviolable.
- (Liens) B1.7 Les alertes de stock bas **peuvent générer un bon de commande pré-rempli**.

### B2. Annoncé « À venir »
- B2.1 PDF officiel du bon de commande + envoi auto e-mail/WhatsApp.
- B2.2 Rapport d'ancienneté des dettes fournisseurs (AP aging).
- B2.3 Répartition des frais de livraison dans le coût de revient.
- B2.4 Note de crédit automatique sur retour de marchandise déjà payée.
- B2.5 Circuit d'approbation pour les grosses commandes.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Répertoire : recherche, catégories, conditions, identifiant fiscal, historique | Recherche ✅, `payment_terms_days` libre 0–365 ✅ (couvre comptant/7/14/30/60), historique ✅ (client-side). **Pas de colonne catégorie**, **pas d'identifiant fiscal/NPWP** (`20260513000001:4-17`) | 🟠 PARTIEL |
| B1.2 | PO avec remises + frais de livraison ; cycle brouillon→envoyé→confirmé→partiel→reçu | `create_purchase_order_v2` n'a **aucun** arg remise/frais (`20260701000018:19-26,105-145`). Cycle réel : `pending → partial → received` (+`cancelled`) ; `draft` existe dans la CHECK mais n'est jamais posé ; « envoyé »/« confirmé » n'existent pas | 🟠 PARTIEL |
| B1.3 | QC article par article + retour fournisseur auto | **INEXISTANT** — aucun `reject/quality/return` dans `receive_purchase_order_v2` ni dans `features/purchasing` (grep exhaustif ; le scénario doc « refuse un sac abîmé » est impossible). Confirmé, comme la session précédente | 🔴 MANQUANT |
| B1.4 | Stock + coût de revient auto à réception | Mouvement + lot + WAC trigger + JE ✅ | ✅ CONFORME |
| B1.5 | Paiements partiels + pièces jointes | Paiements partiels ✅ (`purchase_payments`) ; **pièces jointes : rien** (ni colonne, ni bucket, ni UI) | 🟠 PARTIEL |
| B1.6 | Journal inviolable de chaque action | Writes audit dans create/receive/cancel/payment ✅ | ✅ CONFORME |
| B1.7 | Alerte stock bas ⇒ PO pré-rempli | Suggestions de réappro ✅ (`ReorderTab`), mais le lien pointe vers le dashboard produit, pas vers `/purchasing/purchase-orders/new` ; `NewPurchaseOrderPage` ne lit aucun query-param de pré-remplissage | 🔴 MANQUANT |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Import d'achats historiques + blocage de paiement dessus (`20260708000010/11`).
- 🔵 Garde « matières premières uniquement » sur les lignes PO (intégrité catalogue).
- 🔵 Verrou d'édition PO (interdite dès GRN ou paiement, `20260701000016:79-81`).
- 🔵 Idempotency sur create/receive/payment ; GRN persistés (`goods_receipt_notes`).
- 🔵 Onglet évolution des prix d'achat par fournisseur + 3 rapports achats.
- 🔵 Création de lots datés à la réception (voir module 6).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **PO pré-rempli depuis les alertes (B1.7)** : bouton « Créer un PO » dans `ReorderTab.tsx` → `/purchasing/purchase-orders/new?product=…&qty=…`, lecture des query-params dans `NewPurchaseOrderPage.tsx` (état initial `POFormDraftValue`). Done : navigation Alertes→PO avec lignes pré-remplies.
2. **Identifiant fiscal fournisseur** : migration `ALTER TABLE suppliers ADD COLUMN tax_id TEXT` + champ dans `SupplierFormModal.tsx` + regen types. Done : NPWP saisissable et affiché sur le détail.
3. **Nettoyage statut `draft`** : soit le retirer du type UI (`usePurchaseOrdersList.ts:10`) et de la CHECK, soit l'implémenter (voir D2.1) — trancher pour éviter le libellé « Drafted » trompeur de la timeline (`PurchaseOrderDetailPage.tsx:507`).

### D2. Chantiers moyens (1 session, plan requis)
1. **Cycle de statuts réels (B1.2)** : implémenter `draft` (création sans engagement) et éventuellement `sent/confirmed` — ou décision inverse : simplifier la doc. Touche `create_purchase_order_v2 → v3`, transitions gatées, UI badge/timeline.
2. **Remises et frais de livraison sur PO (B1.2, prépare B2.3)** : colonnes `discount_amount`/`shipping_fee` sur `purchase_orders` (+ éventuel discount par ligne), répercussion subtotal/VAT/total, affichage POForm + détail. La répartition des frais dans le WAC reste B2.3 (D3).
3. **Pièces jointes paiements/PO (B1.5)** : bucket storage privé + table `purchase_attachments` (pattern policies `20260606000013`), upload dans `RecordPaymentDialog` et détail PO.
4. **AP aging (B2.2)** : RPC `get_ap_aging_v1` sur `purchase_orders`×`purchase_payments` (le miroir de `view_ar_aging` B2B existe déjà) + page rapport.

### D3. Chantiers lourds (spec dédiée avant code)
1. **QC réception + retours fournisseurs (B1.3) + note de crédit (B2.4)** : spec requise — modèle (`po_item_rejections` ou colonnes `rejected_quantity/rejection_reason` sur GRN), mouvement stock `return`/contre-passation, effet sur la dette fournisseur et le WAC, note de crédit si déjà payé, UI ReceiveDialog par article. C'est **l'écart le plus grave** du module (la doc décrit un flux complet qui n'existe pas).
2. **Répartition des frais de livraison dans le coût de revient (B2.3)** : dépend de D2.2 ; règle d'allocation (prorata valeur/quantité) impactant WAC et JE.
3. **Circuit d'approbation grosses commandes (B2.5)** : réutiliser le pattern seuils/SOD du module Dépenses (`expense-governance`).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. Retirer du « aujourd'hui » : contrôle qualité + retour fournisseur (B1.3 → « À venir »), remises/frais de livraison, pièces jointes, catégories fournisseurs, identifiant fiscal — ou les garder et prioriser D1–D3.
2. Reformuler le cycle : « commandé (pending) → reçu partiellement → reçu », annulation possible ; brouillon/envoyé/confirmé n'existent pas.
3. Corriger le scénario (le refus d'un sac abîmé au QC est aujourd'hui impossible ; l'opérateur devrait saisir 7 reçus et gérer le litige hors système).
4. Le lien « alerte ⇒ PO pré-rempli » est au futur tant que D1.1 n'est pas fait.

## E. Dépendances croisées
- **Module 6 (Stock)** : réception = mouvements + lots + WAC ; un chantier QC/retours (D3.1) crée une nouvelle famille de mouvements à mapper aussi côté JE.
- **Module 10 (Comptabilité)** : JE achat/paiement automatiques ; note de crédit (D3.1) et frais de livraison (D3.2) exigent de nouveaux mappings ; AP aging (D2.4) lit le ledger.
- **Module 11 (Dépenses)** : le circuit d'approbation (D3.3) doit réutiliser le moteur de seuils existant, pas le dupliquer.
- **Module 14 (Rapports)** : top fournisseurs / évolution des prix déjà servis ; AP aging à ajouter à l'index rapports.
- **Module 5 (Catalogue)** : garde raw-material sur lignes PO — toute évolution des `category_type` impacte la création de PO.
