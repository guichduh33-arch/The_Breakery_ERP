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

### TASK-14-001 — Déplacer DuplicateTransactionsTab O(n²) vers RPC DB [P0] [TODO]
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

### TASK-14-002 — Ajouter `.limit(5000)` sur AuditTab + ProductPerformance + DiscountsVoids [P0] [TODO]
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

### TASK-14-003 — Standardiser `toLocalDateStr()` (timezone fix) [P1] [TODO]
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

### TASK-14-004 — Granulariser permissions reports [P1] [TODO]
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

### TASK-14-005 — Filtres globaux unifiés (DateRangePicker partout) [P2] [TODO]
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

### TASK-14-006 — Smoke tests pour 87 report tabs [P1] [TODO]
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

### TASK-14-011 — Performance large queries via matviews [P2] [TODO]
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

### TASK-14-012 — Service barrel cleanup (extraire les bypass dans des hooks) [P2] [TODO]
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
