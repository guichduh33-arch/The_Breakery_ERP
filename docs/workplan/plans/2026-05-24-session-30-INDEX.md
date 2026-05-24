# Session 30 — Vague B : 5 bakery reports — INDEX

> **Date** : 2026-05-24
> **Branche** : `swarm/session-30` (15 commits) ✓ ready to merge
> **Base** : `master` @ `d14cf9b` (post-merge S29 PR #37)
> **Spec** : [`../specs/2026-05-24-session-30-spec.md`](../specs/2026-05-24-session-30-spec.md)
> **Plan** : [`./2026-05-24-session-30-plan.md`](./2026-05-24-session-30-plan.md)
> **Effort réel** : ~1 séance (6 waves chaînées via subagent-driven-development)
> **Status** : 6/6 waves DONE — prêt à merger

---

## 1. Résumé exécutif

Session 30 livre **Vague B** du module 14 Reports & Analytics : 5 nouveaux reports métier bakery promus depuis les "Soon" cards du hub vers des pages actives. Réutilise intégralement l'infra S29 (`<ExportButtons>`, EF `generate-pdf` 12→17 templates, helpers `buildCsv`/`downloadCsv`/`previousPeriod`).

**Wastage & Spoilage** : Report consolidé des pertes via `stock_movements` (type `waste` + `manual_waste`) + agrégation périmés depuis `stock_lots.expires_at` pour les lots non consommés. Retourne `period`, `summary` (total_qty, total_cost, line_count), `by_product[]` (top gaspilleurs), `lines[]` (détail 500 lignes max). Gated `reports.inventory.read`.

**Payment by Method** : Split par méthode (cash/card/qris/edc/transfer/store_credit) depuis `order_payments`. Retourne `period`, `summary`, `by_method[]` (total + share_pct par méthode), `by_day[]` (pivot 8 colonnes : 6 méthodes + total + day). Gated `reports.financial.read`.

**VAT/PB1 Report** (NON-PKP) : Report mensuel réutilisant les helpers S26 (`current_pb1_rate()` + `calculate_pb1_payable_v1`). Retourne `period` (month/year), `pb1_rate`, `taxable_base`, `pb1_collected`, `pb1_payable`, `balance_account_code` = '2110' (PB1 Payable), `by_day[]`. Validation mois 1–12, rejection `22023` si invalide. Gated `reports.financial.read`.

**Stock Movement History** : Requête cursor-paginée sur `stock_movements` avec filtres `product_id`, `movement_type`, date range, `p_cursor TIMESTAMPTZ`. Retourne `lines[]` (50–200 max) + `next_cursor`. Gated `reports.inventory.read`. UI BO implémentée en `useInfiniteQuery` pattern S13 AuditLog. CSV-only (PDF déféré Vague C — pagination makes single-render impractical).

**Perishable Turnover** : Score de vélocité 1–5 buckets par produit, calculé depuis `avg_days_in_stock` (estimé via `stock_lots.updated_at` proxy) + `shelf_life_p50` (estimé à 7 jours par défaut, extensible). `waste_pct = expired/(consumed+expired)*100`. Retourne `period`, `by_product[]` avec `velocity_score IN [1..5]`. Gated `reports.inventory.read`.

**Tests** : pgTAP 15/15 PASS + BO smoke 5/5 PASS + régressions S29 (14/14) + S28 (18/18) PASS + typecheck 6/6 PASS.

---

## 2. Commits (15)

| # | Wave | SHA | Description |
|---|---|---|---|
| 1 | W0 | `28856c0` | docs(s30): wave 0 — session 30 spec + plan |
| 2 | W1.A.1 | `a79cb6e` | feat(db): session 30 — wave 1.A.1 — get_wastage_report_v1 + REVOKE pair |
| 3 | W1.A.2 | `7fcc49e` | feat(db): session 30 — wave 1.A.2 — get_stock_movements_v1 (cursor-paginated) + REVOKE pair |
| 4 | W1.A.3 | `28d01d1` | feat(db): session 30 — wave 1.A.3 — get_perishable_turnover_v1 + REVOKE pair |
| 5 | W1.B.1 | `19d385e` | feat(db): session 30 — wave 1.B.1 — get_payments_by_method_v1 + REVOKE pair |
| 6 | W1.B.2 | `0eb0972` | feat(db): session 30 — wave 1.B.2 — get_pb1_report_v1 (monthly NON-PKP) + REVOKE pair |
| 7 | W2 | `07f235e` | test(db): session 30 — wave 2 — pgTAP bakery_reports 15/15 PASS via cloud MCP |
| 8 | W3.1 | `c61d4fb` | feat(ef): session 30 — wave 3.1 — 5 nouveaux PDF templates (wastage, payment_by_method, pb1, stock_movements, perishable_turnover) |
| 9 | W3.2 | `59d1fd3` | feat(ef): session 30 — wave 3.2 — extend pdf-templates registry to 17 + re-deploy generate-pdf EF + update BO PdfTemplate type |
| 10 | W4.1 | `bdab21a` | feat(backoffice): session 30 — wave 4.1 — 5 hooks for bakery reports |
| 11 | W4.2 | `e286223` | feat(backoffice): session 30 — wave 4.2 — 5 new report pages (wastage, payment-by-method, pb1, stock-movement-history, perishable-turnover) |
| 12 | W4.3 | `01ccb8e` | test(backoffice): session 30 — wave 4.3 — 5 smoke tests for bakery report pages |
| 13 | W4.4 | `3c3cd65` | feat(backoffice): session 30 — wave 4.4 — wire 5 new report routes + fix typecheck |
| 14 | W5 | `032a313` | feat(backoffice): session 30 — wave 5 — promote 5 Soon cards to active + 5 sidebar entries |
| 15 | W6.A | `7da9c5e` | feat(types): session 30 — wave 6.A — regen types post S30 (5 new RPCs typed) |

Wave 6 (closeout : pgTAP sweep + typecheck + INDEX + CLAUDE.md + PR) est un commit séparé de documentation non compté dans les 15 commits features.

---

## 3. Migrations livrées (10)

Block `20260615000010..019` (inventory RPCs, timestamps cloud-assignés) + block `20260524231049..124` (finance RPCs, timestamps horloge locale — conservés pour matcher `schema_migrations.version`).

| # | Version cloud | Fichier local | Description |
|---|---|---|---|
| 1 | `20260615000010` | `_create_get_wastage_report_v1_rpc.sql` | `get_wastage_report_v1(p_start TEXT, p_end TEXT) RETURNS JSONB` SECURITY DEFINER. Gate `reports.inventory.read`. Agrège `stock_movements` types `waste`/`manual_waste` + périmés via `stock_lots.expires_at < p_end`. Retourne `{ period, summary: { total_qty, total_cost, line_count }, by_product[], lines[] }`. LIMIT 500 lignes. |
| 2 | `20260615000011` | `_revoke_pair_get_wastage_report_v1.sql` | REVOKE EXECUTE FROM `anon` + ALTER DEFAULT PRIVILEGES pour ROLE postgres (S25 canonical pair). |
| 3 | `20260615000016` | `_create_get_stock_movements_v1_rpc.sql` | `get_stock_movements_v1(p_start TEXT, p_end TEXT, p_product_id UUID, p_movement_type TEXT, p_limit INT, p_cursor TIMESTAMPTZ) RETURNS JSONB` SECURITY DEFINER. Gate `reports.inventory.read`. Cursor-pagination via `created_at > p_cursor`. LIMIT clampé à 200. Retourne `{ lines[], next_cursor }`. |
| 4 | `20260615000017` | `_revoke_pair_get_stock_movements_v1.sql` | REVOKE pair `get_stock_movements_v1`. |
| 5 | `20260615000018` | `_create_get_perishable_turnover_v1_rpc.sql` | `get_perishable_turnover_v1(p_start TEXT, p_end TEXT) RETURNS JSONB` SECURITY DEFINER. Gate `reports.inventory.read`. Score vélocité 1–5 buckets par produit basé sur `avg_days_in_stock` estimé via `stock_lots.updated_at` proxy + `waste_pct`. Retourne `{ period, by_product[] }`. `velocity_score IN [1..5]` garanti. |
| 6 | `20260615000019` | `_revoke_pair_get_perishable_turnover_v1.sql` | REVOKE pair `get_perishable_turnover_v1`. |
| 7 | `20260524231049` | `_create_get_payments_by_method_v1_rpc.sql` | `get_payments_by_method_v1(p_start TEXT, p_end TEXT) RETURNS JSONB` SECURITY DEFINER. Gate `reports.financial.read`. Pivot 6 méthodes (cash/card/qris/edc/transfer/store_credit) depuis `order_payments`. Retourne `{ period, summary, by_method[], by_day[] }`. `by_day` : 8 clés (6 méthodes + total + day). |
| 8 | `20260524231054` | `_revoke_pair_get_payments_by_method_v1.sql` | REVOKE pair `get_payments_by_method_v1`. |
| 9 | `20260524231118` | `_create_get_pb1_report_v1_rpc.sql` | `get_pb1_report_v1(p_month INT, p_year INT) RETURNS JSONB` SECURITY DEFINER. Gate `reports.financial.read`. Validation `p_month IN [1..12]` → RAISE `22023` si invalide. Réutilise `current_pb1_rate()` + `calculate_pb1_payable_v1(DATE, DATE)` helpers S26. Retourne `{ period: { month, year }, pb1_rate, taxable_base, pb1_collected, pb1_payable, by_day[], balance_account_code: '2110' }`. |
| 10 | `20260524231124` | `_revoke_pair_get_pb1_report_v1.sql` | REVOKE pair `get_pb1_report_v1`. |

---

## 4. RPCs livrées (5)

| RPC | Signature | Gate | Notes |
|---|---|---|---|
| `get_wastage_report_v1` | `(p_start TEXT, p_end TEXT) RETURNS JSONB` | `reports.inventory.read` | LIMIT 500 lignes. REVOKE pair migration `_011`. |
| `get_stock_movements_v1` | `(p_start TEXT, p_end TEXT, p_product_id UUID, p_movement_type TEXT, p_limit INT, p_cursor TIMESTAMPTZ) RETURNS JSONB` | `reports.inventory.read` | Cursor-paginated, LIMIT clampé à 200. Overload pre-existante — tests avec explicit casts (DEV-S30-1.A-04). REVOKE pair `_017`. |
| `get_perishable_turnover_v1` | `(p_start TEXT, p_end TEXT) RETURNS JSONB` | `reports.inventory.read` | `velocity_score IN [1..5]` garanti. REVOKE pair `_019`. |
| `get_payments_by_method_v1` | `(p_start TEXT, p_end TEXT) RETURNS JSONB` | `reports.financial.read` | Pivot 6 méthodes + by_day. REVOKE pair `_054`. |
| `get_pb1_report_v1` | `(p_month INT, p_year INT) RETURNS JSONB` | `reports.financial.read` | Validation mois 22023. Réutilise helpers S26 NON-PKP. `balance_account_code='2110'`. REVOKE pair `_124`. |

---

## 5. Edge Function update (generate-pdf v2)

EF `generate-pdf` re-déployé sur V3 dev `ikcyvlovptebroadgtvd` avec 5 nouveaux templates dans `supabase/functions/_shared/pdf-templates/` :

| Template | Fichier | Clé registry | Gate |
|---|---|---|---|
| Wastage & Spoilage | `wastage.ts` | `wastage` | `reports.inventory.read` |
| Payment by Method | `payment_by_method.ts` | `payment_by_method` | `reports.financial.read` |
| VAT/PB1 | `pb1.ts` | `pb1` | `reports.financial.read` |
| Stock Movements | `stock_movements.ts` | `stock_movements` | `reports.inventory.read` |
| Perishable Turnover | `perishable_turnover.ts` | `perishable_turnover` | `reports.inventory.read` |

Registry étendu de 12 (S29) → 17 templates. Type `PdfTemplate` BO mis à jour pour inclure les 5 nouvelles valeurs.

---

## 6. BackOffice livrés

### Hooks (5 nouveaux)

| Hook | Fichier | Description |
|---|---|---|
| `useWastageReport(range)` | `features/reports/hooks/useWastageReport.ts` | React-Query, gate `reports.inventory.read`. `(supabase as any).rpc(...)` — types pre-regen. |
| `usePaymentsByMethod(range)` | `features/reports/hooks/usePaymentsByMethod.ts` | React-Query, gate `reports.financial.read`. |
| `usePb1Report(month, year)` | `features/reports/hooks/usePb1Report.ts` | React-Query, params `month: number, year: number`. Gate `reports.financial.read`. |
| `useStockMovementsReport(filters)` | `features/reports/hooks/useStockMovementsReport.ts` | `useInfiniteQuery` cursor pattern (S13 AuditLog). `fetchNextPage` sur `next_cursor`. Gate `reports.inventory.read`. |
| `usePerishableTurnover(range)` | `features/reports/hooks/usePerishableTurnover.ts` | React-Query, gate `reports.inventory.read`. |

### Pages (5 nouvelles)

| Page | Route | Gate perm | Export |
|---|---|---|---|
| `WastagePage` | `/reports/wastage` | `reports.inventory.read` | CSV + PDF (via `<ExportButtons>`) |
| `PaymentByMethodPage` | `/reports/payment-by-method` | `reports.financial.read` | CSV + PDF |
| `Pb1ReportPage` | `/reports/pb1` | `reports.financial.read` | CSV + PDF |
| `StockMovementHistoryPage` | `/reports/stock-movement-history` | `reports.inventory.read` | CSV only (DEV-S30-4.X-01) |
| `PerishableTurnoverPage` | `/reports/perishable-turnover` | `reports.inventory.read` | CSV + PDF |

### Routes (5 nouvelles)

5 `<Route>` dans `apps/backoffice/src/routes/index.tsx`, chacun enveloppé dans `<PermissionGate permission="reports.inventory.read">` ou `<PermissionGate permission="reports.financial.read">` selon le report.

### Sidebar (5 nouvelles entrées)

Entrées ajoutées dans le groupe Reports de `AppSidebar`, indent 1, gated par la permission correspondante :
- Wastage & Spoilage (icône `Trash2`)
- Payment by Method (icône `CreditCard`)
- PB1 Report (icône `Receipt`)
- Stock Movement History (icône `ArrowUpDown`)
- Perishable Turnover (icône `Timer`)

### Hub ReportsIndexPage (cards promoted)

4 Soon cards promues → actives + 1 nouvelle card Perishable Turnover ajoutée :

| Card | Avant | Après |
|---|---|---|
| Wastage & Spoilage | `status: 'soon'` | active, lien `/reports/wastage` |
| Payment by Method | `status: 'soon'` | active, lien `/reports/payment-by-method` |
| PB1 Report | `status: 'soon'` | active, lien `/reports/pb1` |
| Stock Movement History | `status: 'soon'` | active, lien `/reports/stock-movement-history` |
| Perishable Turnover | nouvelle card | active, lien `/reports/perishable-turnover` |

**Hub state** : 13 → 18 active cards. Soon cards restantes : 6 (Daily Sales, Purchase×3, Staff Performance, Production Report, Production Efficiency, Price Changes, Permission Change Log — certains fusionnent).

---

## 7. Tests

### pgTAP (1 fichier, 15/15 PASS via cloud MCP)

`supabase/tests/bakery_reports.test.sql` :

- **T1** — `get_wastage_report_v1` MANAGER happy path → 4-key JSONB (`period`, `summary`, `by_product`, `lines`).
- **T2** — `get_wastage_report_v1` CASHIER → 42501 `insufficient_privilege`.
- **T3** — `get_wastage_report_v1` empty period (1900) → `total_qty=0`, `line_count=0`.
- **T4** — `get_payments_by_method_v1` MANAGER happy path → 4-key JSONB (`period`, `summary`, `by_method`, `by_day`).
- **T5** — `get_payments_by_method_v1` CASHIER → 42501.
- **T6** — `get_payments_by_method_v1` `by_day` shape : si non-vide, chaque entrée a 8 clés (6 méthodes + total + day) ; vacuously true si vide.
- **T7** — `get_pb1_report_v1` happy month 5/2026 → 8-key JSONB avec `balance_account_code='2110'`.
- **T8** — `get_pb1_report_v1` CASHIER → 42501.
- **T9** — `get_pb1_report_v1` `p_month=13` → `22023` (`invalid_parameter_value`).
- **T10** — `get_stock_movements_v1` happy paginate → `{ lines[], next_cursor }`.
- **T11** — `get_stock_movements_v1` filtre `movement_type='waste'` → toutes les lignes sont `waste`.
- **T12** — `get_stock_movements_v1` `p_limit=999` → `jsonb_array_length(lines) <= 200` (clamp).
- **T13** — `get_perishable_turnover_v1` happy → `{ period, by_product[] }` de type array.
- **T14** — `get_perishable_turnover_v1` `velocity_score IN [1..5]` sur chaque row (vacuously true si vide).
- **T15** — `get_perishable_turnover_v1` CASHIER → 42501.

### BO smoke (5 fichiers nouveaux, 5/5 PASS)

| Fichier | Tests | Couvre |
|---|---|---|
| `reports/__tests__/WastagePage.smoke.test.tsx` | 1 | Renders waste table heading |
| `reports/__tests__/PaymentByMethodPage.smoke.test.tsx` | 1 | Renders payment method table |
| `reports/__tests__/Pb1ReportPage.smoke.test.tsx` | 1 | Renders PB1 report title |
| `reports/__tests__/StockMovementHistoryPage.smoke.test.tsx` | 1 | Renders stock movement history title |
| `reports/__tests__/PerishableTurnoverPage.smoke.test.tsx` | 1 | Renders perishable turnover heading |

### Régressions (PASS)

- pgTAP S29 `zreports.test.sql` : **14/14 PASS** via cloud MCP.
- pgTAP S28 `expense_governance.test.sql` : **18/18 PASS** via cloud MCP.
- BO smoke sweep complet : **365/365 PASS** (112 fichiers, 1 skipped pre-existing supplier-crud).

### Typecheck

- `pnpm typecheck` : **6/6 packages PASS** (avant et après regen types).

---

## 8. Permissions seedées

Aucune nouvelle permission seedée. Réutilise les permissions existantes :

| Permission | Reports couverts | Migration origine |
|---|---|---|
| `reports.inventory.read` | Wastage, Stock Movement History, Perishable Turnover | S29 (déjà seedée) |
| `reports.financial.read` | Payment by Method, PB1 Report | S29 (déjà seedée) |

---

## 9. Hub state post-S30

**Avant S30** : 13 active cards + 11 Soon cards (dont Perishable Turnover n'existait pas encore).

**Après S30** : 18 active cards + 6 Soon cards restantes.

Soon cards restantes (Vague C ou backlog) :
1. Daily Sales Report
2. Purchase Analysis
3. Staff Performance
4. Production Report / Production Efficiency
5. Price Changes Log
6. Permission Change Log

---

## 10. Closes officiels

- **Hub G4** partiel — 5 nouveaux reports promus ; 6 Soon cards restantes (Vague C).
- **Hub G11** partiel — Wastage + Perishable Turnover livrés ; 4 autres reports bakery backlog (Vague D+).
- **Hub G12** partiel — hub passe de 11 → 6 disabled/soon cards.
- **DEV-S30-4.X-02** (types regen `(supabase as any)` casts) — **DONE** : regen effectuée en Wave 6.A, 5 RPCs correctement typées, typecheck 6/6 PASS.

---

## 11. Hors scope (renvoyé Vague C / backlog)

**Vague C (S31+)** :
- Compare toggle sur ces 5 nouveaux reports (pattern `<DateRangePickerWithCompare>` + `previousPeriod()` de S29).
- Drill-down navigation cohérente `<DrilldownLink>` (TASK-14-009).
- UnifiedReportFilters extra dims : category, terminal, customer_type.
- Mobile responsive reports layout (TASK-14-010).
- Reports hub mini-KPI bar (trending arrows sur tiles).
- Favoris/pinning reports.

**Vague D+ (backlog)** :
- Scheduled email reports TASK-14-008 (EF CRON + pg_net).
- Unusual Transactions detection TASK-14-013.
- Custom report builder TASK-14-007 (drag&drop, XL effort).
- 6 Soon cards restantes (Daily Sales, Purchase×3, Staff Performance, Production Report).
- PDF pour StockMovementHistoryPage (DEV-S30-4.X-01 — pagination makes single-render impractical, cursor-based multi-page PDF à concevoir).

---

## 12. Déviations log

| ID | Wave | Description | Sévérité | Status |
|---|---|---|---|---|
| DEV-S30-1.A-01 | 1.A | `stock_lots.expired_at` n'existe pas — utilise `stock_lots.expires_at` comme proxy pour détecter les périmés dans `get_wastage_report_v1`. Sémantique identique (`expires_at < now()` + non consommé = périmé). | Informationnel | Accepté |
| DEV-S30-1.A-02 | 1.A | `stock_lots.consumed_at` n'existe pas — utilise `stock_lots.updated_at` comme proxy pour la date de consommation dans `get_perishable_turnover_v1`. Precision réduite mais suffisante pour le score de vélocité. | Informationnel | Accepté |
| DEV-S30-1.A-03 | 1.A | `stock_lots.status` est TEXT et non un ENUM typé. Comparaisons via `= 'expired'` / `= 'consumed'` — pas de type safety DB mais fonctionnel. | Informationnel | Accepté |
| DEV-S30-1.A-04 | 1.A | `get_stock_movements_v1` avait une overload pre-existante (différente signature). Tests pgTAP T10–T12 utilisent des casts explicites (`NULL::uuid`, `NULL::text`, `50::int`, `NULL::timestamptz`) pour résoudre l'ambiguïté de surcharge. | Informationnel | Accepté |
| DEV-S30-1.B-01 | 1.B | `calculate_pb1_payable_v1` a une signature `(DATE, DATE)` et non `(TEXT, TEXT)` comme supposé initialement. Appel adapté dans `get_pb1_report_v1` avec cast explicite des bornes date. | Informationnel | Accepté |
| DEV-S30-2.A-01 | 2 | Tests pgTAP nécessitent des casts de type explicites sur les arguments NULL positionnels à cause de l'ambiguïté d'overload de `get_stock_movements_v1`. Pattern documenté dans le fichier test (T10 header). | Informationnel | Accepté |
| DEV-S30-4.X-01 | 4 | `StockMovementHistoryPage` implémenté CSV-only (pas de bouton PDF). La pagination cursor-based rend le rendu PDF single-pass impractical — nécessiterait un PDF multi-page avec curseur chaîné. Déféré Vague C. | Informationnel | Déféré Vague C |
| DEV-S30-4.X-02 | 4 | Les 5 hooks bakery utilisaient `(supabase as any).rpc(...)` car les types n'avaient pas encore été regen au moment de l'implémentation Wave 4. **Résolu en Wave 6.A** : types regen effectuée, 5 RPCs correctement typées, typecheck 6/6 PASS. | Informationnel | Résolu W6.A |

---

## 13. Métriques

- **Commits S30** : 15 (1 Wave 0 docs + 6 DB migrations + 1 pgTAP + 2 EF + 5 BO + 1 types regen wave 6.A + 1 closeout docs).
- **Migrations** : 10 (block `20260615000010..019` + block `20260524231049..124` ; 0 correctives DB).
- **Tables créées** : 0 (réutilise le schéma existant).
- **RPCs livrées** : 5 (`get_wastage_report_v1`, `get_payments_by_method_v1`, `get_pb1_report_v1`, `get_stock_movements_v1`, `get_perishable_turnover_v1`).
- **EF mise à jour** : 1 (`generate-pdf` v2 — registry 12→17 templates).
- **Templates PDF ajoutés** : 5 (wastage, payment_by_method, pb1, stock_movements, perishable_turnover).
- **Permissions seedées** : 0 (réutilise `reports.inventory.read` + `reports.financial.read` de S29).
- **Hooks BO livrés** : 5.
- **Pages BO livrées** : 5.
- **Routes ajoutées** : 5.
- **Sidebar entries ajoutées** : 5.
- **Hub cards** : 4 Soon → active + 1 nouvelle = +5 active (13→18).
- **Tests** : pgTAP 15/15 + BO smoke 5/5 + régressions 14+18 = **52 assertions vérifiées**.
- **Déviations** : 8 entrées (0 medium, 7 informationnelles acceptées, 1 résolu W6.A).

---

## 14. PR

**Title** : `Session 30 — Vague B: 5 bakery reports`

**Branch** : `swarm/session-30` → `master`

**Spec** : `docs/workplan/specs/2026-05-24-session-30-spec.md`
**Plan** : `docs/workplan/plans/2026-05-24-session-30-plan.md`
