# Carte analytique du schéma — The Breakery V3 (relevée 2026-08-16)

Carte de LECTURE pour concevoir des rapports : quelles tables portent quelle
information analytique, et les pièges de lecture. Les noms de colonnes ne sont PAS
répertoriés ici volontairement : ils se vérifient au moment de concevoir
(`information_schema.columns` ou `SELECT * … LIMIT 3`) — une carte de colonnes
pourrirait au premier changement de schéma.

Base : projet dev `ikcyvlovptebroadgtvd` (the-breakery-v3-dev). **SELECT uniquement.**

## Pièges de lecture transverses

- **Fuseau** : la session PostgreSQL est en `Asia/Makassar` pour toute la base — un
  `::date` sur un `timestamptz` rend DÉJÀ le bon jour métier. Ne jamais « corriger »
  un décalage supposé sans l'avoir vérifié sur les données.
- **Ventes valides** : filtrer les commandes par statut payé (la référence du moment
  est le filtre des RPC `get_sales_*` live — les versions bumpent, vérifier le corps
  live via `pg_get_functiondef`, pas un fichier de migration).
- **RLS contournée** : le MCP interroge en service role. L'app, elle, passe par la
  gate `reports.read`. Ce que tu lis n'est pas la preuve que l'app le lira.
- **Volumes dev faibles** : la dev porte peu de lignes sur certaines tables (orders
  ~dizaines). Concevoir pour la forme, pas pour l'échantillon ; si une table est
  vide en dev, le prototype utilise des données synthétiques SIGNALÉES comme telles.
- **Soft delete** : plusieurs tables portent `deleted_at` — l'oublier gonfle les
  agrégats.

## Ventes & encaissements

| Table | Ce qu'elle sait dire |
|---|---|
| `orders` | Une ligne par commande : total, statut, origine (POS/tablet/BO), horodatage, client. La colonne de numérotation encode l'origine (P/T1/T2/BO). |
| `order_items` | Lignes de commande : produit, quantité, prix. Grain de toute analyse produit. |
| `order_payments` | Tenders (immutable, split possible) : méthode de paiement, montants. |
| `refunds`, `refund_lines`, `refund_payments` | Remboursements partiels et voids — à soustraire des ventes nettes selon la question posée. |
| `promotions`, `promotion_applications` | Promos appliquées par commande, description snapshotée — analysable même si la promo est supprimée. |
| `pos_sessions`, `z_reports` | Shifts de caisse et archives Z signées — cadre des analyses par shift/caissier. |

## Achats & fournisseurs

| Table | Ce qu'elle sait dire |
|---|---|
| `purchase_orders` | En-tête de bon de commande, statut draft→received. |
| `purchase_order_items` | Lignes de PO : article, quantité commandée vs reçue (les réceptions s'accumulent sur plusieurs GRN). **Grain de l'évolution du prix d'achat et des quantités achetées.** |
| `goods_receipt_notes` | Réceptions (GRN) — datent l'entrée réelle en stock, émettent le JE d'achat. |
| `purchase_payments` | Ledger append-only des règlements fournisseurs. |
| `suppliers` | Catalogue fournisseurs (~160 en dev). |

## Stock & inventaire

| Table | Ce qu'elle sait dire |
|---|---|
| `stock_movements` | Ledger append-only : chaque entrée/sortie avec type, quantité, coût unitaire **en unité de BASE**. Source de vérité des flux ; `products.current_stock` n'est qu'un cache. |
| `stock_lots` | Lots périssables (F1) : péremption, quantités restantes. |
| `inventory_counts`, `inventory_count_items` | Opnames : variance générée (counted − expected) — matière des rapports d'écart. |
| `display_stock`, `display_movements` | Vitrine POS — ledger séparé, PAS du stock BO. Ne jamais les additionner au stock général. |
| `unit_conversions`, `product_unit_alternatives` | Conversions d'unités — les quantités multi-unités se ramènent à l'unité de base avant agrégation. |

## Production & recettes

| Table | Ce qu'elle sait dire |
|---|---|
| `production_records`, `production_batches` | Batches de production : quoi, combien, quand, avec flags de cycle de vie. |
| `recipes`, `recipe_versions` | BoM vivante + snapshots append-only — l'historique de coût de recette se lit par version. |
| `margin_alerts` | Brèches de marge détectées (une alerte OPEN max par produit). |

## Finance & dépenses

| Table | Ce qu'elle sait dire |
|---|---|
| `journal_entries`, `journal_entry_lines` | Écritures équilibrées (debit XOR credit) — source des rapports comptables. Pour tout rapport comptable, charger AUSSI le skill `accounting`. |
| `accounts`, `accounting_mappings` | COA et mappings événement→compte. |
| `expenses`, `expense_categories` | Dépenses opérationnelles, workflow d'approbation, JE émis à l'approbation. |
| `fiscal_periods` | Périodes mensuelles draft→locked — borne les analyses comptables. |

## Clients & fidélité

| Table | Ce qu'elle sait dire |
|---|---|
| `customers` | Clients retail + B2B, compteurs de fidélité, `total_spent`/`total_visits` (caches maintenus par RPC). |
| `loyalty_transactions` | Ledger immutable des points. |
| `b2b_payments`, `b2b_payment_allocations` | Encaissements B2B et allocation FIFO sur factures — matière de l'AR aging. Pour le B2B, charger AUSSI `b2b-credit`. |
| `customer_store_credit_ledger` | Avoirs clients (ledger, somme = solde). |

## Opérationnel & audit

| Table | Ce qu'elle sait dire |
|---|---|
| `audit_logs` | Trail append-only (`metadata` = contexte, `payload` = diff — deux colonnes distinctes). |
| `pos_events` (partitionnée par mois) | Journal opérationnel POS — requêter la table mère, les partitions suivent. |
| `lan_devices`, `pos_devices` | Parc de terminaux. |
