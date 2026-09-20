# Catalogue cible de rapports — référentiel de gap analysis (fourni par Mamat, 2026-08-16)

Liste de rapports que Mamat veut voir couverts par le module reports, issue de sa
pratique des POS du marché. Usage : à l'étape « État des lieux » d'une gap analysis,
confronter ce catalogue à l'existant du module (`grep supabase.rpc` dans
`features/reports/hooks/`) et au schéma réel — un rapport du catalogue n'est
pertinent que si la donnée existe dans le système (ex. pas de canal Grab →
pas de rapport Grab tant que le canal n'existe pas).

La liste est organisée par domaine et dédupliquée ; les libellés d'origine sont
conservés (c'est le vocabulaire de Mamat), avec une glose quand le nom seul est
ambigu.

## Ventes — synthèses
- **All in 1 Sales Summary Report** — la synthèse totale (CA, remises, annulations, encaissements) sur une période.
- **Sales By Date** / **Sales Items By Date** — ventes par jour, au grain commande et au grain ligne.
- **Sales Details** — détail complet des ventes (drill-down au ticket).
- **Detail Sales Backdate** — ventes saisies/modifiées à une date antérieure (contrôle).
- **Sales Details By Hours** — détail par heure (existe : famille get_sales_by_hour ; l'enrichir plutôt que doublonner).
- **Sales By Customer** / **Sales Items By Customer** — ventes par client, au grain commande et ligne.
- **Sales by table number** — ventes par table (restaurant_tables).
- **Sales By Station** — ventes par terminal/station (pos_devices, origine de commande P/T1/T2/BO).
- **Sales Cash Balance** — solde de caisse issu des ventes (pont vers shifts/Z-reports).
- **Sales + Income/Expense** — ventes rapprochées des entrées/sorties (pont vers expenses).

## Ventes — canaux
- **Sales Details - Online Order** / **Food delivery** / **Marketplace** / **by Grab** —
  détail par canal de vente. Applicabilité à VÉRIFIER contre le schéma : n'a de sens
  que si le canal est tracé (origine de commande). Non tracé aujourd'hui = backlog
  produit, pas un rapport à inventer sur du vide.

## Ventes — impayés & encours
- **Sales Detail Unpaid POS** / **Sales Item Unpaid POS by Date** — commandes non payées (pending_payment, ardoises HELD).
- **Sales detail deposit** — ventes avec acompte/avoir (customer_store_credit_ledger).
- **Credit Sales Details** / **Credit Payments** — ventes à crédit (B2B/retail) et leurs règlements (b2b_payments, allocations).
- **Sales Items By Credit Payments** / **By Non Credit Payments** — lignes ventilées par nature de paiement.
- **Sale of overdue debt** — créances en retard (AR aging).
- **Outstanding Payment** — encours à régler (côté client ET côté fournisseur, préciser lequel à la conception).

## Ventes — remises, add-ons, combos
- **Discount Summary** / **Sales Item Discounts By Date** — remises accordées, synthèse et détail ligne.
- **Sales Item Add-ons By Date** / **Sales Addons per Item by Date** — modificateurs/suppléments vendus (product_modifiers sur order_items).
- **Combo Sales** / **Combo Sales Details** — ventes de combos, synthèse et composition (combo_groups).
- **Loyalti point Usage Details** — points fidélité émis/brûlés (loyalty_transactions).

## Annulations & retours
- **Sales Cancellation Details** / **Cancelled Items** / **Item POS cancelled** / **Detail pos unpaid void** — voids et annulations, au grain commande et ligne.
- **Sales Return Details** / **By Date** / **By Customer** — retours/remboursements (refunds, refund_lines).

## Achats & fournisseurs
- **Purchase Details** / **Purchase By Date** / **Purchase Items By Date** / **Purchase By Supplier** — bons de commande et lignes (partiellement existant : familles get_purchase_by_date / by_supplier / purchase_items).
- **Purchase Payment** (« Purchased Payment ») — règlements fournisseurs (purchase_payments).
- **Price Changes** — évolution des prix (d'achat ET de vente — préciser à la conception ; get_price_changes existe côté vente).

## Stock & produits
- **Product Qty Sold** — quantités vendues par produit.
- **Product Materials** — nomenclature matière d'un produit (recipes).
- **Qty stock by date** / **Product Stock Balance** — position de stock à date / solde courant (reconstruction depuis le ledger stock_movements, current_stock n'est qu'un cache).
- **Incoming Stocks** / **Outgoing Stocks** — entrées / sorties de stock par période et type de mouvement.
- **Movement Value by date** — valorisation des mouvements (qty × unit_cost en unité de base).

## Paiements & finance
- **Payment By Method** — encaissements par méthode (existe : famille get_payments_by_method ; l'enrichir plutôt que doublonner).
- **Sales By Customer Payment** — encaissements ventilés par client.
- **Expenses by Date** — dépenses par date (famille get_expenses_by_category existe par catégorie).
- **Profit Loss** — existe (famille get_profit_loss).
