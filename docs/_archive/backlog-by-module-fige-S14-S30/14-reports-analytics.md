# Travail — Reports & Analytics

> Last updated: 2026-05-03
> Référence : `docs/reference/04-modules/14-reports-analytics.md` (à créer)
> Sources d'audit : `docs/audit/04-reports-testing-audit.md` (Quinn — 0 P0, 3 P1, 6 P2, 5 P3 ; 53 reports actifs ; 87 components 0 tests), `docs/audit/00-executive-summary.md` (Reports P0-1 à P0-4 perf : O(n^2), .limit() manquant), `docs/audit/IMPLEMENTATION_PLAN.md` Phase 4

## Objectifs du module

1. **Performance reports** : éliminer les O(n²) client-side, ajouter `.limit()` partout, déplacer les agrégats lourds en RPC ou matview.
2. **Standardisation timezone** : tous les filtres de date utilisent `toLocalDateStr()` (Asia/Makassar) — fini le mélange UTC.
3. **Permissions granulaires** : `reports.sales` / `reports.inventory` / `reports.financial` / `reports.audit` (au lieu d'une permission unique pour 53 rapports).
4. **Couverture exports** : tous les top-level tabs ont CSV+PDF cohérents (rounding IDR à 100, headers, totaux).
5. **Filtres globaux unifiés** : un seul `<DateRangePicker>` cohérent toutes pages, comparaison période précédente.
6. **Tests reports** : passer de 0 à 87 smoke tests minimum (un par tab) — c'est le plus gros gap audit.

## Tâches

### TASK-14-001 — Déplacer DuplicateTransactionsTab O(n²) vers RPC DB [P0] [OBSOLETE]
**Status note (2026-05-14)** : V2 `DuplicateTransactionsTab` does not exist in V3 — superseded by build-from-scratch Reports module (Phase 2.B + 6.A) where every tab is backed by a server-side RPC by design (no client-side O(n²)). If duplicate-detection is desired in V3, a new RPC must be designed (not a port). Reclassify as new feature TASK-14-xxx if needed.
**Contexte** : Quinn P0-1 (cf. `00-executive-summary.md`) — `DuplicateTransactionsTab` exécute un algorithme O(n²) côté client pour détecter les doublons. Sur > 1000 orders, freeze browser. Optimisation `04-09` audit l'a partiellement amélioré mais c'est encore client-side.
**Critère d'acceptation** :
- [ ] RPC `detect_duplicate_transactions(p_start_date, p_end_date, p_threshold_minutes INT default 5)` retourne les paires d'orders suspectes (même customer + même montant + écart < N min).
- [ ] `DuplicateTransactionsTab` consomme la RPC ; supprime tout le code de détection client.
- [ ] Test RPC sur 5000 orders : retourne en < 500ms.
- [ ] Pagination : `LIMIT 100 OFFSET p_offset`.
- [ ] Index composite `idx_orders_duplicate_detection (customer_id, total, created_at)` pour perf.
**Fichiers concernés** : migration RPC + index, `src/pages/reports/components/DuplicateTransactionsTab.tsx`, hook.
**Dépend de** : aucune
**Estimation** : M
**Risques** : RPC mal indexée → timeout. Bench obligatoire.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 4.1.

### TASK-14-002 — Ajouter `.limit(5000)` sur AuditTab + ProductPerformance + DiscountsVoids [P0] [OBSOLETE]
**Status note (2026-05-14)** : V2 unbounded queries do not exist in V3 — Phase 2.B Audit RPC (`20260517000076_paginate_audit_log_rpc.sql`) uses cursor-based pagination with server-side clamp `LIMIT LEAST(GREATEST(p_limit,1), 200)`. Other report RPCs (`get_sales_by_*_v1`) are aggregated server-side so unbounded reads are impossible by construction. No centralised `MAX_REPORT_ROWS = 5000` exists but the architectural intent is satisfied differently.
**Contexte** : Quinn P0-2/P0-3/P0-4 — plusieurs queries sont unbounded : `AuditTab` lit tout `audit_logs` (potentiellement 100k+ lignes), `ProductPerformanceTab` tire 30k+ rows avec joins, `DiscountsVoidsTab` idem. Risque OOM browser.
**Critère d'acceptation** :
- [ ] Toutes les queries reports passent par `.limit(5000)` par défaut + `Notice` UI si la limite est atteinte ("Affinez la période, > 5000 résultats").
- [ ] Pagination server-side dans 3 reports les plus gros (`AuditTab`, `ProductPerformanceTab`, `StockMovementTab`).
- [ ] Test : période 1 an sur AuditTab → pas de crash, message "Plus de 5000 résultats".
- [ ] Documentation : convention `MAX_REPORT_ROWS = 5000` centralisée dans `src/services/reporting/constants.ts`.
**Fichiers concernés** : `src/services/reporting/reportingSalesService.ts`, `reportingInventoryService.ts`, `reportingFinancialService.ts`, plusieurs report tabs.
**Dépend de** : aucune
**Estimation** : M
**Risques** : si seuil trop bas, certains reports légitimes coupés — calibrer.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 4.2/4.3.

### TASK-14-003 — Standardiser `toLocalDateStr()` (timezone fix) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.B. V3 evidence: `packages/domain/src/reports/toLocalDateStr.ts` + co-located test, consumed by all BO report pages (`CashFlowPage.tsx`, `ProfitLossPage.tsx`, etc.). Matviews bucket via `business_config.timezone` (`Asia/Makassar` default) so date boundaries are timezone-correct (cf. `20260517000070_init_materialised_views.sql`). Commit `bdf21aa`.
**Contexte** : Quinn P1-1 — mix `toISOString()` (UTC) et `toLocalDateStr()` (local). En Indonésie (UTC+8), une commande à 23h locale a une date UTC du lendemain → omise/mal-incluse selon le report. Touche `getProductPerformance`, `getSalesByCategory`, `getSalesByCustomer`, `getCancellations`.
**Critère d'acceptation** :
- [ ] Helper `toLocalDateBoundary(date, 'start' | 'end')` qui retourne `YYYY-MM-DDTHH:mm:ss+08:00` (start = 00:00:00, end = 23:59:59).
- [ ] Toutes les queries reports utilisent ce helper, plus aucune occurrence de `.toISOString()` brute dans `src/services/reporting/*`.
- [ ] Tests : commande à 23:30 locale du 30/04 inclus dans report 30/04, pas 01/05.
- [ ] Mise à jour `reportingInventoryService.test.ts` ligne 105-106 (assertion ISO actuelle est WRONG).
**Fichiers concernés** : `src/utils/dateHelpers.ts` (extension), reporting services, tests.
**Dépend de** : aucune
**Estimation** : M
**Risques** : drift temporaire si déployé sans la mise à jour des tests.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 4.4.

### TASK-14-004 — Granulariser permissions reports [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.B (4 perms) + Phase 6.A (financial gate). V3 evidence: Wave 2 deviation log seeds `reports.sales.read`, `reports.inventory.read`, `reports.audit.read`, `reports.financial.read` (granted to ADMIN+MANAGER); Phase 6.A guards P&L / BS / Cash Flow routes via `reports.financial.read` PermissionGate per `D-W6-6A-3`. Audit-only Reports default to admin-only.
**Contexte** : Quinn P1-2 — TOUTE la page Reports gardée par `reports.sales`. Caissier ayant accès aux ventes peut voir VAT, P&L, audit logs (void abuse, ghost stock, permission changes). Permissions `reports.inventory` / `reports.financial` définies mais non enforced.
**Critère d'acceptation** :
- [ ] Component `ReportPermissionGuard category="financial"` qui check la permission appropriée selon la catégorie du report.
- [ ] `ReportsConfig.tsx` ajoute `permission: 'reports.financial' | 'reports.inventory' | 'reports.sales' | 'reports.audit'` par report.
- [ ] `ReportsPage.tsx` filtre la sidebar selon les permissions du user (n'affiche que les catégories autorisées).
- [ ] Catégorie `Audit & Logs` (10 reports) → `reports.audit` (nouvelle permission, attribuée admin only par défaut).
- [ ] Tests permission guard.
**Fichiers concernés** : `src/pages/reports/ReportsPage.tsx`, `ReportsConfig.tsx`, RBAC seed, nouvelles permissions DB.
**Dépend de** : aucune
**Estimation** : M
**Risques** : utilisateurs existants avec rôle "Caissier" peuvent perdre accès → communiquer + roll-out staged.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 4.5.

### TASK-14-005 — Filtres globaux unifiés (DateRangePicker partout) [P2] [PARTIAL]
**Status note (2026-05-14)** : Partially delivered — `apps/backoffice/src/features/reports/components/DateRangePicker.tsx` is shared across all date-ranged pages. MISSING: comparison toggle ("vs previous period"), `<UnifiedReportFilters>` wrapper with extra dimensions (category/terminal/customer), localStorage persistence. Still applicable, scheduled Session 14+.
**Status note (2026-05-24 S29)** : Compare toggle DONE. `<DateRangePickerWithCompare>` + `<DeltaPct>` component delivered and wired on 5 reports (P&L, BalanceSheet, CashFlow, SalesByHour, SalesByCategory) via 2 parallel React-Query fetches using `previousPeriod()` domain helper (calendar-aware: same-length-month vs n-day fallback). Domain helper TDD 9/9 PASS. MISSING (Vague B+C, S30+): `<UnifiedReportFilters>` with extra dims (category/terminal/customer), localStorage persistence for date range, 5 additional bakery reports (production cost trend, ingredient usage, category margin, recipe cost evolution, wastage analysis), drill-down modals, mobile responsive. Gap 14-3 (CSV/PDF uniforme) also DONE S29 — see `buildCsv` helper + `<ExportButtons>` wired 13 pages.
**Contexte** : `useDateRange` utilisé dans 48 reports, mais 1 utilise month/year (VAT), 4 sont snapshots sans date. Pas de comparaison période précédente partout. UX incohérente.
**Critère d'acceptation** :
- [ ] Composant `<UnifiedReportFilters>` : DateRange + ComparisonToggle ("vs previous period") + Filtres optionnels (catégorie produit, terminal, customer type).
- [ ] Tous les date-ranged reports l'adoptent ; queryKey inclut `previousPeriod` (fixe Quinn P3-1).
- [ ] Persistance localStorage : la dernière sélection est restaurée (par-user).
- [ ] Spec design : positionné en sticky-top de la page reports.
**Fichiers concernés** : `src/pages/reports/components/UnifiedReportFilters.tsx`, refactor de tous les tabs.
**Dépend de** : aucune
**Estimation** : L
**Risques** : énorme refactor cross-cut — déployer par catégorie (Sales d'abord).
**Notes** : Quinn P3-1 résolu indirectement (queryKey).

### TASK-14-006 — Smoke tests pour 87 report tabs [P1] [OBSOLETE]
**Status note (2026-05-14)** : The "87 V2 report tabs" universe does not exist in V3 — V3 Reports is built from scratch with ~10 pages so far (`SalesByHour/Category/Staff`, `StockVariance`, `Audit`, `ProfitLoss`, `BalanceSheet`, `CashFlow`, `BasketAnalysis`, `ReportsIndex`). Each delivered page already has a smoke test (cf. `apps/backoffice/src/features/reports/__tests__/*.smoke.test.tsx`). The V2 87-test target is no longer meaningful; future report additions should follow the same pattern.
**Contexte** : Quinn — coverage 0 sur 87 component reports. Le plus gros gap testing. Recommandation : "render each tab with mocked data and verify it doesn't crash".
**Critère d'acceptation** :
- [ ] Pattern de test partagé `renderReportTabSmoke(component, mockData)` qui mount + check `toMatchSnapshot()` simplifié + erreurs console.
- [ ] 87 tests créés (un par fichier dans `src/pages/reports/components/`).
- [ ] Mocks centralisés dans `src/test/mocks/reporting.ts`.
- [ ] Coverage cible : ~90% reports tabs (au moins le rendering).
- [ ] CI ajoute le run de cette suite.
**Fichiers concernés** : `src/pages/reports/components/__tests__/*.test.tsx` (87 nouveaux), `src/test/mocks/reporting.ts`.
**Dépend de** : `TASK-14-002` (limit fix sinon les tests timeout).
**Estimation** : XL — décomposer par catégorie de reports (Sales 12, Inventory 10, Financial 8, etc.).
**Risques** : tests trop superficiels = faux sens de sécurité ; quand même mieux que zéro.
**Notes** : reuse `vi.hoisted` pattern + `mock chains` déjà en place.

### TASK-14-007 — Custom report builder (drag&drop fields) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no custom-report builder or `custom_reports` table in V3. Still applicable, scheduled Session 14+.
**Contexte** : Audit produit Gap "ability to build ad-hoc reports". Aujourd'hui, ajouter un report = code TS + ReportsConfig. Utilisateur métier ne peut pas explorer librement.
**Critère d'acceptation** :
- [ ] Page `/reports/custom-builder` (permission `reports.audit` ou nouvelle `reports.custom`).
- [ ] UI drag&drop : sélectionner table source (orders / order_items / customers / stock_movements), colonnes, filtres, group by, agrégations.
- [ ] Génère SQL SELECT + exécute (whitelist tables/colonnes pour anti-injection).
- [ ] Sauvegarde en `custom_reports(name, definition_jsonb, owner_id, shared)`.
- [ ] Export CSV/PDF.
**Fichiers concernés** : nouvelle table custom_reports, page builder, RPC `execute_custom_report` (avec safety).
**Dépend de** : `TASK-14-004` (permissions granulaires).
**Estimation** : XL — décomposer.
**Risques** : injection SQL + perf — whitelist obligatoire.
**Notes** : commencer par read-only sur 5 tables max, étendre après.

### TASK-14-008 — Scheduled reports email (envoi auto hebdo/mensuel) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `report_schedules` table or `send-scheduled-reports` Edge Function in V3. Still applicable, scheduled Session 14+.
**Contexte** : Owner veut recevoir P&L mensuel + sales weekly directement par email sans cliquer. Pas d'automation today.
**Critère d'acceptation** :
- [ ] Table `report_schedules(report_id, frequency: daily/weekly/monthly, recipients[], format: pdf/csv, last_run_at, is_active)`.
- [ ] Edge Function `send-scheduled-reports` (CRON daily) génère et envoie.
- [ ] UI Settings `/settings/scheduled-reports` CRUD.
- [ ] Audit log envoi.
**Fichiers concernés** : migration, Edge Function, page settings.
**Dépend de** : aucune
**Estimation** : L
**Risques** : génération PDF en série lourde — file d'attente jobs.
**Notes** : reuse `send-test-email` Edge Function pour delivery.

### TASK-14-009 — Drilldown navigation cohérente [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no shared `<DrilldownLink>` component in V3. Still applicable, scheduled Session 14+.
**Contexte** : Quelques reports ont drill-down (ProductionReportTab) mais inconsistant. Cliquer sur un montant agrégé doit ouvrir le détail (orders qui composent).
**Critère d'acceptation** :
- [ ] Pattern partagé `<DrilldownLink target="/orders" filter={{ ... }} />` pour les chiffres cliquables.
- [ ] `OverviewTab` : KPI Revenue cliquable → `/reports/sales` filtré sur période.
- [ ] `ProductPerformanceTab` : ligne produit cliquable → liste orders avec ce produit.
- [ ] `B2BReceivablesTab` : ligne client → `/b2b/clients/:id`.
- [ ] Convention navigation : `?from=report&filter=...` pour breadcrumb retour.
**Fichiers concernés** : composant DrilldownLink, ~10 reports tabs prioritaires.
**Dépend de** : aucune
**Estimation** : M
**Risques** : trop de drill-down = surcharge ; cibler les chiffres "intuitivement cliquables".
**Notes** : tester avec utilisateur réel pour calibrer.

### TASK-14-010 — Mobile-friendly reports layout [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — V3 BO report pages are desktop-first per Session 14 spec D5. Still applicable; aligned with Session 14 UX completion target (desktop polish first, mobile later).
**Contexte** : Audit Sally Responsive 7.5/10 — reports surtout pensés desktop. Owner consulte parfois en mobile/tablet (Lombok → terrain).
**Critère d'acceptation** :
- [ ] Reports critiques (`OverviewTab`, `SalesTab`, `B2BReceivablesTab`) responsive : tableaux deviennent cards en < md.
- [ ] Charts Recharts gardent leur lisibilité (font scaling).
- [ ] Filtres en bottom-sheet sur mobile au lieu de sticky-top.
- [ ] Tests visual responsive (Playwright snapshots à 375px / 768px / 1280px).
**Fichiers concernés** : layouts reports, composants tableaux.
**Dépend de** : `TASK-14-005` (UnifiedReportFilters bottom-sheet).
**Estimation** : L
**Risques** : effort important — prioriser les 5 reports les plus consultés.
**Notes** : audit Sally signale l'écart desktop/mobile sur back-office.

### TASK-14-011 — Performance large queries via matviews [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.B. V3 evidence: `supabase/migrations/20260517000070_init_materialised_views.sql` creates `mv_sales_daily`, `mv_stock_variance`, `mv_pl_monthly` with UNIQUE indexes; `20260517000071_pg_cron_refresh_mv.sql` schedules `REFRESH MATERIALIZED VIEW CONCURRENTLY` via pg_cron. Note: P&L RPC live-queries instead of consuming `mv_pl_monthly` (deviation `D-W6-6A-1`); MV is retained for future BO dashboards. Commit `bdf21aa`.
**Contexte** : Quinn P3 — certains reports (`getProductPerformance`) chargent tous les order_items en plage et agrègent client-side. Pour analyses sur 1 an = lent.
**Critère d'acceptation** :
- [ ] Matviews `mv_product_sales_daily`, `mv_sales_by_category_daily`, `mv_customer_orders_summary`.
- [ ] REFRESH MATERIALIZED VIEW CONCURRENTLY toutes les 6h via Edge Function CRON.
- [ ] Reports updated pour lire les matviews quand range >= 30j (sinon temps réel sur orders).
- [ ] Pitfall CLAUDE.md "matview privileges" : utiliser `has_table_privilege` et non `information_schema.role_table_grants`.
**Fichiers concernés** : migrations matviews + permissions, Edge Function refresh, services updated.
**Dépend de** : `TASK-14-002`.
**Estimation** : L
**Risques** : staleness 6h acceptable pour analytics, pas pour live monitoring.
**Notes** : pitfall CLAUDE.md sur trigger functions ne s'applique pas ici (matviews ≠ triggers).

### TASK-14-012 — Service barrel cleanup (extraire les bypass dans des hooks) [P2] [OBSOLETE]
**Status note (2026-05-14)** : V2 reporting service bypass patterns (`RevenueForecastTab`, `ProfitLossTab`, `VATReportTab`, `ProductionReportTab` direct Supabase calls + `as never` cast) do not exist in V3 — built from scratch with `useXxx` hooks per page (e.g. `useProfitLoss.ts`, `useBalanceSheet.ts`, `useCashFlow.ts`). Generated types include the new RPCs (regen'd at end of Wave 6).
**Contexte** : Quinn P2-1/P2-2 — `RevenueForecastTab`, `ProfitLossTab`, `VATReportTab`, `ProductionReportTab` font des appels Supabase directs (bypass `ReportingService`). Inconsistance + tests difficiles. Plus le `as never` cast sur `view_daily_kpis`.
**Critère d'acceptation** :
- [ ] Toutes les queries Supabase report-related passent par un service ou un hook (`useDailyKpis`, `useProfitLoss`, etc.).
- [ ] Plus aucun `as never` dans reports → ajouter les views manquantes à `database.generated.ts` via `/gen-types`.
- [ ] Tests services pour les 4 fichiers concernés.
**Fichiers concernés** : 4 reports tabs, services reporting, regen types.
**Dépend de** : aucune (mais `/gen-types` à exécuter).
**Estimation** : M
**Risques** : si types générés incluent les vues, attention casts existants ailleurs.
**Notes** : audit Amelia signale plus largement le pattern bypass — ce report n'est qu'un sous-ensemble.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/_archive/objectif-travail-v2/REPORTS.md` §15 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). KDS Service Speed est couvert par TASK-04-009 (cascade KDS), B2B Self-Approval Risk par TASK-09-010, Customer Cohort par TASK-08-009 (cascade Customers), Promotion Effectiveness par TASK-13-006.

### TASK-14-013 — Report "Unusual Transaction Patterns" [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `get_unusual_transactions` RPC or audit page in V3. Still applicable, scheduled Session 14+ once history volume permits calibration.
**Contexte** : aucun mécanisme automatique de détection de patterns suspects (transactions hors horaires, montants aberrants, splits cash juste sous un seuil).
**Bénéfice attendu** : repérer automatiquement les transactions anormales — anti-fraude proactif.
**Critère d'acceptation** :
- [ ] RPC `get_unusual_transactions(p_start, p_end)` détecte : transactions hors horaires d'ouverture, montants > 3σ moyenne staff, splits cash < 100k juste sous un seuil 1M (anti-blanchiment).
- [ ] Page `/reports/audit/unusual-transactions` avec liste + scoring sévérité.
- [ ] Drill-down → modale détail order + audit log.
- [ ] Export CSV / PDF.
**Dépend de** : volume historique 3 mois minimum pour calibrer les seuils.
**Estimation** : L
**Risques** : faux positifs élevés au début — itérer les règles avec retour terrain.
**Notes** : couplable avec TASK-09-010 (self-approval B2B) et TASK-12-008 (dual auth variance).

### TASK-14-014 — Report "Basket Analysis" (associations produits) [P3] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.A. V3 evidence: `supabase/migrations/20260517000213_create_basket_analysis_rpc.sql` provides associations RPC; UI in `apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx` + hook `useBasketAnalysis.ts` + smoke test `BasketAnalysisPage.smoke.test.tsx`. Gated via `reports.sales.read` per `D-W6-6A-3`. Commit `bdf21aa`.
**Contexte** : aucun moyen d'identifier les produits souvent achetés ensemble.
**Bénéfice attendu** : créer des combos pertinents + recommendations upsell (TASK-02-026) basées sur les vraies associations historiques.
**Critère d'acceptation** :
- [ ] RPC `compute_product_associations(p_start, p_end, p_min_support)` retourne paires (A, B) avec support (% commandes contenant les deux), confidence (P(B|A)), lift.
- [ ] Page `/reports/sales/basket-analysis` : matrice des top associations + filtres catégorie.
- [ ] Drill-down → liste des commandes contenant l'association.
- [ ] Export CSV / PDF.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : performance sur grand volume — précalcul matview rafraîchie quotidiennement.
**Notes** : source pour TASK-02-026 (Smart upsell POS).

### TASK-14-015 — Report "Peak Hour Staffing" (recommandations planning) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `compute_peak_hour_staffing` RPC or page in V3. Still applicable, scheduled Session 14+.
**Contexte** : pas de recommandation staff basée sur la charge horaire historique. Sur-staffing ou sous-staffing au feeling.
**Bénéfice attendu** : recommander le nombre de cashiers / serveurs nécessaires par tranche horaire selon historique.
**Critère d'acceptation** :
- [ ] RPC `compute_peak_hour_staffing(p_lookback_weeks)` : retourne pour chaque (day_of_week, hour) le volume moyen + recommandation staff selon ratio commandes/staff cible.
- [ ] Page `/reports/operations/peak-hour-staffing` : heatmap + table recommandations.
- [ ] Export PDF formaté pour affichage planning équipe.
**Dépend de** : volume 4+ semaines.
**Estimation** : M
**Risques** : recommandations naïves si peu de données — fallback "moyenne mobile" + warning si confidence basse.
**Notes** : utile pour le manager de salle hebdomadaire.

### TASK-14-016 — Report "Perishable Turnover" (rotation périssables) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `compute_perishable_turnover` RPC in V3. Phase 1.C delivered `stock_lots` + expiring-lots RPC (`get_expiring_lots`) which provides the data foundation, but the turnover-rate report itself remains TODO. Still applicable, scheduled Session 14+.
**Contexte** : aucun suivi de la rotation des produits périssables (jours moyens en stock avant vente ou casse).
**Bénéfice attendu** : identifier les produits dont la rotation est trop lente → réduire le waste.
**Critère d'acceptation** :
- [ ] RPC `compute_perishable_turnover(p_start, p_end)` : pour chaque produit flaggé périssable, retourne avg_days_in_stock + % vendu vs casse.
- [ ] Page `/reports/inventory/perishable-turnover` avec table sortable + couleurs (vert/orange/rouge selon ratio).
- [ ] Drill-down → liste des batches concernés.
- [ ] Export CSV / PDF.
**Dépend de** : flag `products.is_perishable` + tracking dates production/réception (couplé TASK-06-001 expiry tracking).
**Estimation** : M
**Risques** : sans tracking expiry, calcul approximatif — bien afficher la confiance.
**Notes** : KPI critique boulangerie.

### TASK-14-017 — Report "Table Turnover" (rotation tables dine-in) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `compute_table_turnover` RPC or `tables.assigned_at/cleared_at` tracking in V3. Still applicable, scheduled Session 14+.
**Contexte** : pas de mesure de la durée moyenne d'occupation table ni du taux de rotation.
**Bénéfice attendu** : optimiser la capacité dîner — comprendre les tables lentes, les heures de saturation.
**Critère d'acceptation** :
- [ ] Tracking `tables.assigned_at` + `tables.cleared_at` sur chaque cycle de service.
- [ ] RPC `compute_table_turnover(p_start, p_end)` : durée moyenne par table + ticket moyen + nombre rotations/jour.
- [ ] Page `/reports/operations/table-turnover` avec breakdown par section / capacité.
- [ ] Export CSV / PDF.
**Dépend de** : tracking heures occupation table (existe ou à instrumenter).
**Estimation** : M
**Risques** : si tracking incomplet, périodes manquantes biaisent les moyennes — exclure.
**Notes** : utile pour le maitre d'hôtel et l'optimisation capacité.

### TASK-14-018 — Report "Sales By Brand" [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `brands` table or `products.brand_id` in V3. V2 placeholder did not carry over. Still applicable, scheduled Session 14+ if brand-level reporting is required.
**Contexte** : placeholder déjà câblé. Aucun découpage CA par marque pour les rayons multi-marques (ex: café Synesso vs Stumptown).
**Bénéfice attendu** : suivre la performance par marque chez les fournisseurs multi-marques.
**Critère d'acceptation** :
- [ ] Champ `products.brand_id` (FK table `brands` à créer si absent).
- [ ] Page `/reports/sales/by-brand` : classement CA par marque + part de marché interne.
- [ ] Export CSV / PDF.
**Dépend de** : modèle `brands` à valider.
**Estimation** : S
**Risques** : taxonomie marques non maintenue — UI CRUD légère dans Settings.
**Notes** : placeholder existant à compléter.

### TASK-14-019 — Report "Purchase Returns" (suivi retours fournisseurs) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `get_purchase_returns` RPC or returns page in V3. Phase 3.A delivered PO core (create/receive/cancel) but not returns flow. Still applicable, scheduled Session 14+.
**Contexte** : placeholder déjà câblé. Aucun suivi consolidé des retours fournisseurs (volume, motifs, fournisseur).
**Bénéfice attendu** : identifier les fournisseurs problématiques et chiffrer la valeur des retours.
**Critère d'acceptation** :
- [ ] RPC `get_purchase_returns(p_start, p_end, p_supplier_id)` : retours, motifs, montants.
- [ ] Page `/reports/purchases/returns` avec breakdown supplier × motif.
- [ ] Drill-down → détail retour + lien PO source.
- [ ] Export CSV / PDF.
**Dépend de** : `TASK-07-013` (avoir comptable sur retour) pour cohérence.
**Estimation** : S
**Risques** : aucune.
**Notes** : placeholder existant à compléter.

### TASK-14-020 — Report "Outgoing Stocks" (vue agrégée sorties) [P3] [TODO]
**Contexte** : placeholder déjà câblé. Aucune vue agrégée des sorties de stock (ventes + casse + transferts) sur une période.
**Bénéfice attendu** : vision consolidée "où part mon stock" pour audit + comprehension flux.
**Critère d'acceptation** :
- [ ] RPC `get_outgoing_stocks(p_start, p_end, p_product_id)` : sorties par type (sale, waste, transfer_out, production_consumption).
- [ ] Page `/reports/inventory/outgoing-stocks` avec donut par type + table détaillée.
- [ ] Drill-down → liste des mouvements concernés.
- [ ] Export CSV / PDF.
**Dépend de** : aucune.
**Estimation** : S
**Risques** : aucune.
**Notes** : placeholder existant à compléter.

---

## S30 updates (2026-05-24) — Vague B : 5 bakery reports delivered

**S30 update (2026-05-24)** : Wastage & Spoilage report delivered — `get_wastage_report_v1(text, text)` RPC + `WastagePage` BO + CSV/PDF export. Réutilise `stock_movements` (waste/manual_waste) + `stock_lots.expires_at` proxy pour périmés. Hub card promu Soon → active. Closes G11 partiel.

**S30 update (2026-05-24)** : Payment by Method report delivered — `get_payments_by_method_v1(text, text)` RPC + `PaymentByMethodPage` BO + CSV/PDF export. Split cash/card/qris/edc/transfer/store_credit + pivot by_day. Hub card promu Soon → active.

**S30 update (2026-05-24)** : VAT/PB1 Report (NON-PKP) delivered — `get_pb1_report_v1(int, int)` RPC mensuel + `Pb1ReportPage` BO + CSV/PDF export. Réutilise helpers S26 `current_pb1_rate()` + `calculate_pb1_payable_v1`. `balance_account_code='2110'` (PB1 Payable). Hub card promu Soon → active.

**S30 update (2026-05-24)** : Stock Movement History report delivered — `get_stock_movements_v1` cursor-paginé + `StockMovementHistoryPage` BO + CSV-only (PDF déféré Vague C). Infinite query pattern. Hub card promu Soon → active.

**S30 update (2026-05-24)** : Perishable Turnover report delivered — `get_perishable_turnover_v1(text, text)` RPC + `PerishableTurnoverPage` BO + CSV/PDF export. Score vélocité 1–5 buckets par produit. Nouvelle card ajoutée au hub. Closes G11 partiel.

**Hub state post-S30** : 18 active cards (was 13 post-S29). 6 Soon cards restantes (Daily Sales, Purchase×3, Staff Performance, Production Report/Efficiency, Price Changes, Permission Change Log).

**Hors scope S31+** : compare toggle sur ces 5 reports (Vague C), drill-down TASK-14-009, UnifiedReportFilters extra dims, mobile responsive, PDF StockMovementHistory. Backlog Vague D+ : TASK-14-007 custom report builder, TASK-14-008 scheduled email, TASK-14-013 unusual transactions.
