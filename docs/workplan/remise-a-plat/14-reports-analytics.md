# Module 14 — Rapports & analyses

> **MAJ S63 (2026-07-06)** : Dashboard d'accueil câblé — `get_dashboard_overview_v1` (migrations `_113`+`_114`, gate `reports.read`) + hook `useDashboardOverview` (polling 60 s) + 5 panneaux réels (trend 30 j, donut par type, barres horaires, top produits, paiements). Le constat « stub à zéros » (§C, fin) et **D2.1 sont soldés**. Cf. `../plans/2026-07-06-session-63-INDEX.md`.
> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 14. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Largement fidèle — la surface de rapports est réelle et même plus vaste que la doc (33 cartes, 6 thèmes, exports, drill-down). Trois surclames ciblées : pas de rapport « valorisation du stock » ni « produits dormants », pas de tendance des écarts de caisse, la comparaison période précédente n'existe que sur 3 rapports sur ~30. Angle mort majeur non revendiqué par ce module mais adjacent : le Dashboard d'accueil est un stub à zéros.

## A. Ce qui fonctionne réellement (code vérifié)

- **Hub de rapports** `/backoffice/reports` avec 33 cartes réparties en 6 sections (Sales 5, Inventory 7, Purchases 4, Finance & Payments 7, Operations 3, Marketing 4, Logs & Audit 3), toutes cliquables — plus aucune tuile « Soon » désactivée — `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx:35-111` [UI câblée].
- **~30 pages de rapports routées et gatées** dans `apps/backoffice/src/routes/index.tsx:643-882`, chaque route derrière un `PermissionGate` granulaire : `reports.sales.read` (sales-by-hour/category/staff, basket, daily-sales, staff-performance), `reports.inventory.read` (stock-variance, stock-movements, wastage, perishable-turnover, production-report/-efficiency, purchase-*), `reports.financial.read` (profit-loss, gross-margin, balance-sheet, cash-flow, payment-by-method, pb1, operating-expenses, cost-spend, recipe-cost, price-changes), `reports.audit.read` (audit, permission-changes), `reports.read` (hub + 4 pages marketing) [UI câblée].
- **RPCs serveur tous existants en migrations** (vérifié un par un) : `get_sales_by_hour_v2` (`_052`, gaté), `get_sales_by_category_v1`, `get_sales_by_staff_v1`, `get_daily_sales_v1`, `get_basket_analysis_v1`, `get_staff_performance_v1`, `get_stock_variance_v1`, `get_wastage_report_v1`, `get_perishable_turnover_v1`, `get_purchase_items_v1`, `get_purchase_by_date_v1`, `get_purchase_by_supplier_v1`, `get_production_report_v1`, `get_production_efficiency_v1`, `get_profit_loss_v2` (`_081`), `get_balance_sheet_v2`, `get_cash_flow_v1`, `get_pb1_report_v1`, `get_expenses_by_category_v1`, `get_purchase_cogs_breakdown_v1`, `get_price_changes_v1`, `get_permission_changes_v1`, `get_audit_logs_v1`/`_v2` (liste des call-sites : `apps/backoffice/src/features/reports/hooks/`).
- **Marge brute par produit** : `get_gross_margin_by_product_v1` (migration `20260710000093`, gate `reports.financial.read`) + page `GrossMarginPage` (route `reports/gross-margin`, carte hub + sidebar) avec le caveat « COGS = WAC courant, pas un snapshot à la vente » affiché dans l'UI — `apps/backoffice/src/pages/reports/GrossMarginPage.tsx:1-7` [UI câblée].
- **Encaissements par moyen de paiement en fuseau local** : `get_payments_by_method_v2` (migration `20260710000094`, bucketing UTC → `business_config.timezone`), consommé par `usePaymentsByMethod.ts:29` → `PaymentByMethodPage` [UI câblée].
- **Anti-fraude par employé** : `StaffPerformancePage` expose `voids_count/value`, `refunds_count/value`, `discount_orders_count`, `discount_value` par employé — `apps/backoffice/src/features/reports/hooks/useStaffPerformance.ts:14-19` (RPC `get_staff_performance_v1`, migration `20260624000016`). Gate : `reports.sales.read` (pas `reports.audit.read`) [UI câblée].
- **Logs & audit** : `AuditPage` (viewer paginé par curseur sur `audit_logs` via `get_audit_logs_v1`), `PriceChangesPage`, `PermissionChangesPage` [UI câblées].
- **Exports CSV + PDF** : composant `ExportButtons` (CSV local via `buildCsv` de `@breakery/domain`, PDF via EF `generate-pdf` — `supabase/functions/generate-pdf/` déployée) présent sur **26 pages de rapports** — `apps/backoffice/src/features/reports/components/ExportButtons.tsx` [UI câblée + EF].
- **Comparaison période précédente** : `DateRangePickerWithCompare` + `DeltaPct`, câblé sur **3 pages seulement** : `SalesByCategoryPage`, `ProfitLossPage`, `CashFlowPage` (le PDF supporte `comparePrevious`) [UI câblée, partielle].
- **Drill-down transverse** : `buildDrilldownUrl` (11 entités : product, category, user, customer, order, order_list filtré, recipe, account, supplier, expense, purchase_order) + `DrilldownLink` sur les cellules — le scénario doc « catégorie → produit → jour » est réalisable — `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts` [UI câblée].
- **`ReportPage` avec `emptyState` canonique** (S57 D-D1) : décision unique « chargé, sans erreur, zéro ligne » → `<EmptyState>` — `apps/backoffice/src/features/reports/components/ReportPage.tsx:21-34`.
- **`useUrlState`** (filtres persistés dans l'URL) utilisé par **26 pages** de rapports — `apps/backoffice/src/hooks/useUrlState.ts`.
- **Parité hub ↔ sidebar** (S57) : les 6 sous-groupes de la sidebar « Reports » (`apps/backoffice/src/layouts/Sidebar.tsx:132-205`) couvrent les mêmes rapports que le hub, y compris Marketing et Margin Watch.
- **En plus de la doc** : rapports Marketing (cohortes de rétention, segments RFM, ROI promo, anniversaires — `pages/marketing/`), Basket Analysis (paires cross-sell par lift), Recipe Cost timeline par produit, Margin Watch, Cost & Spend Analytics, Operating Expenses, rapport PB1 mensuel dédié.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Des dizaines de rapports par thème : ventes (jour, heure, produit, catégorie, client), stock (valorisation, gâchis, dormants, rotation), finance (P&L, bilan, trésorerie, taxe, impayés), opérations (personnel, production), anti-fraude (abus annulations/remises par employé, tendance des écarts de caisse).
- B1.2 Encaissements par moyen de paiement calés sur l'heure locale du magasin.
- B1.3 Marge brute par produit (coût ingrédients déduit).
- B1.4 Comparaison avec la période précédente.
- B1.5 Export tableur/PDF.
- B1.6 Accès cloisonné : un caissier ne voit pas le P&L ; seuls les managers voient les rapports anti-fraude.
- B1.7 (Scénario) Drill-down catégorie → produit → jour précis.

### B2. Annoncé « À venir »
- B2.1 Coût figé au moment de la vente pour la marge par produit (snapshot COGS).
- B2.2 Détection des transactions inhabituelles (hors horaires, montants aberrants).
- B2.3 Envoi automatique par e-mail des rapports clés.
- B2.4 Recommandations de planning selon les heures de pointe.
- B2.5 Consultation confortable sur mobile.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1a | Ventes : jour, heure, produit, catégorie, client | Jour (`DailySalesPage`), heure (`SalesByHourPage`), catégorie (`SalesByCategoryPage`) ✓. **Par produit** : pas de rapport dédié — couvert indirectement par Gross Margin (revenu/qté par produit) et le dashboard produit (`get_product_analytics_v1`). **Par client** : aucun rapport — seulement l'onglet Analytics de la fiche client + segments marketing | 🟠 PARTIEL |
| B1.1b | Stock : valorisation, gâchis, dormants, rotation | Gâchis ✓ (`WastagePage`), rotation ✓ mais périssables uniquement (`PerishableTurnoverPage`). **Valorisation du stock (IDR)** : aucun rapport (Stock Variance = quantités attendues vs réelles, pas de valeur ; KPIs Inventory = compteurs). **Produits dormants** : aucun rapport | 🟠 PARTIEL |
| B1.1c | Finance : P&L, bilan, trésorerie, taxe, impayés | P&L ✓, BS ✓, Cash Flow ✓ (+ Cash Treasury compta), PB1 ✓. **Impayés** : AR aging existe (`view_ar_aging`) mais vit dans le module B2B (`B2BDashboardPage`), pas dans le hub Rapports | 🟠 PARTIEL |
| B1.1d | Opérations : personnel, production | `StaffPerformancePage`, `ProductionReportPage`, `ProductionEfficiencyPage` ✓ | ✅ CONFORME |
| B1.1e | Anti-fraude : abus annulations/remises par employé + tendance des écarts de caisse | Voids/refunds/discounts par employé ✓ (`useStaffPerformance.ts:14-19`). **Tendance des écarts de caisse : aucun rapport** — la variance n'est visible que Z-report par Z-report (`SignZReportModal`), pas de courbe agrégée | 🟠 PARTIEL |
| B1.2 | Paiements en heure locale | `get_payments_by_method_v2` (`_094`) bucketing sur `business_config.timezone` ✓ | ✅ CONFORME |
| B1.3 | Marge brute par produit | `get_gross_margin_by_product_v1` (`_093`) + `GrossMarginPage`, caveat WAC affiché ✓ | ✅ CONFORME |
| B1.4 | Comparaison période précédente | Câblée sur **3 pages sur ~30** (SalesByCategory, ProfitLoss, CashFlow). La formulation doc laisse croire que c'est général | 🟠 PARTIEL |
| B1.5 | Export tableur/PDF | `ExportButtons` (CSV + PDF EF) sur 26 pages ✓ | ✅ CONFORME |
| B1.6 | Accès cloisonné caissier/manager | Gates route granulaires ✓ (`reports.financial.read` sur P&L etc.). Nuance : le rapport voids/discounts par employé est sous `reports.sales.read`, pas sous `reports.audit.read` — un rôle « sales-reports only » verrait l'anti-fraude. Mapping rôles→perms exact : ⚠️ à confirmer en DB live | 🟠 PARTIEL |
| B1.7 | Drill-down catégorie → produit → jour | `buildDrilldownUrl` + `DrilldownLink` sur `SalesByCategoryPage` (et 20+ autres) ✓ | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 4 rapports Marketing (cohortes, segments RFM, promo ROI, anniversaires) — non mentionnés.
- 🔵 Basket Analysis (cross-sell par lift), Recipe Cost + timeline, Margin Watch, Cost & Spend Analytics, Operating Expenses.
- 🔵 Drill-down transverse sur 11 types d'entités ; filtres persistés en URL (`useUrlState`, 26 pages) ; empty-states canoniques (`ReportPage`).
- 🔵 Price Changes + Permission Changes en rapports d'audit dédiés.

**Constat hors-revendication (contexte module) :** le **Dashboard d'accueil** du BO est un stub — zéros codés en dur (`emptyOverview()`, `apps/backoffice/src/pages/Dashboard.tsx:52-61`), graphiques en `EmptyState` permanents. Le RPC `get_dashboard_overview_v1` évoqué en TODO (`Dashboard.tsx:16`) **n'existe ni dans les migrations ni dans `types.generated.ts`** (vérifié — il n'existe donc pas non plus en DB live) ; aucun hook `useDashboardOverview` n'existe. La doc v1.2 ne le revendique pas dans ce module, mais c'est la « vitrine » que le gérant voit en premier.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Exposer les impayés dans le hub Rapports** : carte « AR Aging / Impayés » dans la section Finance pointant vers la vue existante (`view_ar_aging` déjà consommée par `B2BDashboardPage`). Fichiers : `ReportsIndexPage.tsx`, `Sidebar.tsx`. Done : carte visible, navigation OK.
2. **Reclasser Staff Performance** (ou dupliquer une entrée « Fraud watch ») sous gate `reports.audit.read` pour honorer « seuls les managers voient l'anti-fraude ». Fichiers : `routes/index.tsx`, `Sidebar.tsx`, `ReportsIndexPage.tsx`. Done : route gatée `reports.audit.read`.
3. **Amender la doc** pour la comparaison de période (cf. D4) ou, côté code, étendre `DateRangePickerWithCompare` à Daily Sales et Payment by Method (composant déjà générique). Done : compare visible sur les 2 pages.

### D2. Chantiers moyens (1 session, plan requis)
1. ✅ **Câbler le Dashboard d'accueil — SOLDÉ (S63, 2026-07-06)** : `get_dashboard_overview_v1` créé (migrations `_113`+`_114`, gate `reports.read`, trio S20, tz-aware, net des refunds), hook `useDashboardOverview` (polling 60 s), `Dashboard.tsx` branché + 5 panneaux recharts/listes. pgTAP `dashboard_overview` 14/14 live, smoke 8/8. Cf. `../plans/2026-07-06-session-63-INDEX.md`.
2. **Rapport « Valorisation du stock »** : RPC `get_stock_valuation_v1` (qty × WAC par produit/catégorie/section) + page + carte hub/sidebar. Done : total IDR rapproché de `products.current_stock × cost_price`.
3. **Rapport « Écarts de caisse — tendance »** : agréger `z_reports` (variance par shift, par caissier, série temporelle). Done : page routée gate `reports.audit.read`.
4. **Rapport « Produits dormants »** : produits sans vente sur N jours avec stock > 0 (croisement `order_items`×`products`). Done : page + carte hub.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Snapshot COGS à la vente** (B2.1) — découplé des lots (abandonnés le 2026-07-04) : figer le coût (WAC) ligne à ligne au moment du paiement, faire basculer `get_gross_margin_by_product_v1` sur le snapshot.
2. **Détection d'anomalies** (B2.2) : transactions hors horaires, montants aberrants, patterns void/discount — nécessite définition des règles et du canal d'alerte.
3. **Envoi e-mail programmé des rapports** (B2.3) : dépend d'une infra d'envoi d'e-mails qui n'existe pas encore (cf. module 19 — templates non consommés).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.1 : retirer « valorisation » et « dormants » de la liste stock (ou les passer en « À venir ») ; préciser que la rotation ne couvre que les périssables ; préciser que les impayés se consultent dans le module B2B.
2. B1.1e : reformuler « tendance des écarts de caisse » en « écart par clôture de caisse » (la tendance n'existe pas).
3. B1.4 : préciser « sur les rapports P&L, ventes par catégorie et trésorerie » .
4. Ajouter aux « À venir » : câblage du tableau de bord d'accueil (aujourd'hui vide), rapports ventes par produit / par client dédiés.

## E. Dépendances croisées
- **Module 10 (Comptabilité)** : P&L/BS/TB/PB1 sont des lectures du ledger ; l'exclusion `year_close` (S54 `_081`) conditionne leur exactitude.
- **Module 6 (Stock)** et **15 (Production)** : la valorisation et le snapshot COGS (D3.1) reposent sur le WAC — le chantier lots est abandonné (décision 2026-07-04).
- **Module 12 (Caisse/shifts)** : le rapport tendance des écarts (D2.3) lit les Z-reports.
- **Module 19 (Réglages)** : `business_config.timezone` pilote le bucketing v2 ; l'envoi e-mail (D3.3) dépend de l'infra templates/notifications du module 19.
- **Module 20 (Employés & droits)** : le cloisonnement des rapports anti-fraude dépend du mapping rôles→`reports.audit.read`.
