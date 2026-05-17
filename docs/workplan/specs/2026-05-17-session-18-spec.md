# Session 18 — Spec (Recipe Cost History Report)

**Date:** 2026-05-17
**Branch:** `swarm/session-18` (off `4803429` master, post-S17 note-merge)
**INDEX:** [`../plans/2026-05-17-session-18-INDEX.md`](../plans/2026-05-17-session-18-INDEX.md) *(to be written by writing-plans next)*
**Migration block reserved:** `20260522000001..099`
**Approach:** Single-theme report session, 4 waves : DB (1 RPC) → UI (2 pages, parallel) → gate → closeout.

---

## 1. Goal global

Expose the immutable `recipe_versions` history (built in S15-S17) through two BackOffice Reports pages so operators can audit how the unit cost of every recipe has moved over a chosen window. Without this, the price-tracking chain delivered in S17 has no consumer — the snapshots exist but are invisible.

**Why now:** S17 closed the chain on the write side (PO → WAC → cost cascade → snapshots). S18 closes the read side so a user can actually answer « how much did this recipe cost on date X » and « which recipes drifted most this month ».

**In :**
- New RPC `recipe_cost_history_v1(p_from DATE, p_to DATE, p_product_id UUID DEFAULT NULL)` — dual-mode (overview vs drill-down), gated by `financial.read`.
- New BackOffice Reports page **RecipeCostOverviewPage** : table of every recipe-product with current cost, baseline cost (start of window), delta_pct, change_count, last_change_date. Sort default `|delta_pct|` DESC. Row click → drill-down. CSV export.
- New BackOffice Reports page **RecipeCostTimelinePage** : single product, recharts line chart (cost over time) + table of every version in the window with change_note and per-row delta vs prev. CSV export.
- Wiring : router routes, Sidebar entry, ReportsIndex tile.
- pgTAP (RPC math + permission gate + empty window) + Vitest live RPC + 2 BO smoke tests.

**Out :**
- Allergen module (DEV-S15-5.C-01) — wontfix per user decision 2026-05-17.
- DEV-S16-2.A-01 trigram predicate fix (separate session).
- DEV-S16-1.A-01 PR-time pgTAP gate (CI hardening).
- Session 13 deferred items.
- Per-product cost forecasting / what-if (BI feature, separate session).
- Cost report export to PDF (out — CSV only here ; PDF if/when invoice templates land).
- Backoffice flake stabilization (DEV-S17-3.A-01 candidate — separate session).

---

## 2. Scope — what's included

### 2.1 Phase 1.A — RPC + tests (Wave 1, solo)

Migration :

| # | File | Purpose |
|---|---|---|
| 10 | `20260522000010_create_recipe_cost_history_v1_rpc.sql` | New RPC `recipe_cost_history_v1(p_from DATE, p_to DATE, p_product_id UUID DEFAULT NULL)`. Returns one row shape across both modes (some columns NULL per mode). STABLE SECURITY DEFINER gated `financial.read`. Reads `recipe_versions` + `products` ; ignores legacy bare-array snapshots (`snapshot ? 'items' = false`). |

**Overview semantics (`p_product_id IS NULL`):**
- For each product with at least one recipe version row in the global universe :
  - `baseline_cost` = latest `(snapshot->>'product_cost_at_version')::NUMERIC` whose `created_at <= p_from` (i.e., the cost at the start of the window). NULL if no version existed before `p_from`.
  - `current_cost` = latest `(snapshot->>'product_cost_at_version')::NUMERIC` whose `created_at <= p_to` (i.e., the cost at the end of the window).
  - `last_change_date` = MAX(`created_at`) in `[p_from, p_to]`.
  - `change_count` = COUNT versions in `[p_from, p_to]`.
  - `delta_pct` = `(current - baseline) / baseline * 100` (NULL if baseline is NULL or 0).
  - `version_number`, `change_note` are NULL in this mode.
- Only emit a row when `change_count > 0` OR `baseline_cost IS NOT NULL` (so we don't emit a row for products that never had a cost history).

**Drill-down semantics (`p_product_id IS NOT NULL`):**
- Return one row per version where `created_at BETWEEN p_from AND p_to` AND `product_id = p_product_id` AND `snapshot ? 'items'`.
- Each row : `version_number`, `created_at`, `cost_per_unit` (from snapshot), `change_note`. `baseline_cost`/`delta_pct`/`change_count` are NULL.
- ORDER BY `version_number ASC` (chronological).
- If product_id is unknown, return zero rows (no error — UI shows empty state).

**Permission gate :** `has_permission(auth.uid(), 'financial.read')` ; raise P0003 forbidden otherwise. Argument validation : `p_from <= p_to` else P0001 invalid_date_range ; `p_from` and `p_to` mandatory else P0001.

Tests :

| # | File | Coverage |
|---|---|---|
| pgTAP | `supabase/tests/recipe_cost_history_v1.test.sql` | At minimum: overview math (baseline/current/delta_pct), overview only emits products with history, drill-down sort, drill-down filter by product_id, empty window returns zero rows, p_from > p_to raises P0001, missing perms raises P0003, legacy bare-array snapshots excluded. |
| Vitest live | `supabase/tests/functions/recipe-cost-history.test.ts` | RPC smoke against V3 dev, asserts row shape for both modes against a seeded recipe-product. |

### 2.2 Phase 2.A — RecipeCostOverviewPage (Wave 2, parallel with 2.B)

Files :
- `apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx` (CREATE).
- `apps/backoffice/src/pages/reports/__tests__/RecipeCostOverviewPage.smoke.test.tsx` (CREATE).

Pattern source : `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx` (S15 — closest analog with DateRangePicker + table + CSV).

Behavior :
- ReportPage wrapper with `title="Recipe Cost Overview"`, subtitle « Delta in the selected window. ».
- DateRangePicker, default = last 30 days ending today.
- `useQuery(['reports', 'recipe-cost', 'overview', from, to], ...)` calls `recipe_cost_history_v1(p_from, p_to, NULL)`.
- Loading / error states match `ProductionYieldPage`.
- Empty result : « No recipe cost movement in the selected window. »
- Table columns : Product (link), Current cost, Baseline cost, Delta %, Change count, Last change date.
- Sort : default `|delta_pct|` DESC (NULL last). Click column header to re-sort (Product, Current, Delta, Date).
- Row click navigates to `/reports/recipe-cost/:productId` (Phase 2.B page).
- Delta_pct color tone : `|delta_pct| > 20` red, `5-20` amber, `0-5` emerald, NULL muted.
- CSV export button (top-right) emits a file `recipe-cost-overview-<from>_<to>.csv` using the same `csvCell`/`rowsToCsv` pattern as `ProductionYieldPage`. Columns : product_name, current_cost, baseline_cost, delta_pct, change_count, last_change_date.
- Permission gate : visible only when `financial.read` granted (RBAC checked in router or via `useUserPermissions`).

### 2.3 Phase 2.B — RecipeCostTimelinePage (Wave 2, parallel with 2.A)

Files :
- `apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx` (CREATE).
- `apps/backoffice/src/pages/reports/__tests__/RecipeCostTimelinePage.smoke.test.tsx` (CREATE).

Pattern source : `SalesByHourPage` (recharts LineChart) + `ProductionYieldPage` (DateRangePicker + CSV).

Behavior :
- Route `/reports/recipe-cost/:productId`. Reads `productId` from URL param.
- Header band : breadcrumb `← Recipe Cost Overview`, product name + current cost.
- DateRangePicker, default last 90 days.
- `useQuery(['reports', 'recipe-cost', 'timeline', productId, from, to], ...)` calls `recipe_cost_history_v1(p_from, p_to, productId)`.
- Recharts `LineChart` (responsive container, height 300) — X axis = created_at (formatted YYYY-MM-DD), Y axis = cost_per_unit. One Line, gold stroke (token `text-gold` translated via `getComputedStyle` or a constant hex from the theme). Tooltip shows date + cost + change_note.
- Below the chart, a table of versions in chronological order : version_number, date, cost, delta vs prev (computed client-side), change_note. Delta tone : color-coded like overview.
- CSV export : `recipe-cost-timeline-<productName>-<from>_<to>.csv` with columns version_number, created_at, cost_per_unit, delta_vs_prev_pct, change_note.
- 404-ish state : if `productId` returns zero rows AND no product with that id exists, render « Product not found or has no cost history in this window. » with a back link.
- Permission gate : same as Phase 2.A.

### 2.4 Phase 2.C — Wiring (Wave 2, sequenced after 2.A & 2.B)

Files :
- `apps/backoffice/src/routes/index.tsx` (or wherever the router config lives — UPDATE).
- `apps/backoffice/src/layouts/Sidebar.tsx` (UPDATE).
- `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (UPDATE).

Wiring :
- 2 new routes : `/reports/recipe-cost` (overview), `/reports/recipe-cost/:productId` (timeline). Permission-gated via the same mechanism the existing reports use.
- Sidebar entry under Reports section : « Recipe Cost » (overview page). Drill-down is reachable only by row click in the overview, no sidebar item.
- ReportsIndexPage tile : « Recipe Cost » with subtitle « History of per-recipe unit cost. » linking to the overview.

### 2.5 Phase 3.A — Wave 3 gate

Reviewer pass + types regen merge. Verify :
- RPC signature in `types.generated.ts`.
- No cross-page regressions (existing reports still render).
- No new console warnings in test output.
- `expandRecipeCascade` still exported (no incidental cleanup).

### 2.6 Phase 4.A — Closeout (Wave 4)

- `pnpm typecheck` + `pnpm exec turbo run test --concurrency=1` + `pnpm build` green.
- CLAUDE.md « Active Workplan » : promote S18 → previous, S19 → current TBD.
- PR draft to master.
- Update deviation packs.

---

## 3. Decisions (numbered for reference)

| # | Decision | Rationale |
|---|---|---|
| D1 | Single RPC for both overview and drill-down (NULL `p_product_id` switches modes). | Avoids two RPCs with overlapping logic. Same permission gate. Same shape (NULL columns per mode) is acceptable for a Reports-only RPC. |
| D2 | Permission gate is `financial.read`. | Cost is a financial signal (margin). Same gate as ProfitLoss, BalanceSheet, CashFlow. |
| D3 | Baseline cost = latest version with `created_at <= p_from`. | Picks the actual cost in effect at the start of the window, not the first version *in* the window. Edge case : product with first edit inside the window → baseline NULL (« new this period »). |
| D4 | Legacy bare-array snapshots (`snapshot ? 'items' = false`) excluded from the RPC. | They have no `product_cost_at_version` ; treating them as zero would skew delta_pct. Consistent with DEV-S16-2.B-02 (wontfix legacy backfill). |
| D5 | UI = two separate pages (not a single page with a side panel). | Drill-down can be deep-linked (URL with productId), shared, exported separately. Cleaner than a modal/drawer. |
| D6 | Recharts is the chart library. Already in bundle (`SalesByHourPage`/`SalesByCategoryPage`). | Zero new dependency. |
| D7 | Delta_pct color thresholds : `|d| > 20` red, `5-20` amber, `0-5` emerald, NULL muted. | Mirrors `varianceTone` in `ProductionYieldPage`. Operators already trained on these thresholds. |
| D8 | Drill-down delta-vs-prev computed client-side (not server-side). | The RPC returns chronologically-sorted versions ; the client just iterates. Keeps the RPC return shape minimal. |
| D9 | CSV export per page (no aggregated multi-page export). | Each page has a different shape ; combined export would be confusing. |
| D10 | No real-time updates (poll-only via `useQuery` default staleTime). | Cost history is append-only ; staleness is acceptable for an audit view. |
| D11 | Sidebar entry only for the overview ; drill-down reachable only by row click. | Drill-down requires a productId — no meaningful default. Avoids menu clutter. |
| D12 | `change_note` displayed verbatim in the timeline table. | Already formatted by S17 triggers (`material price update: …`, `cascade: … changed`, `insert`/`update`/`delete`, `system refresh: …`). No parsing or remapping. |
| D13 | No PDF export, no email scheduling, no chart annotations. | YAGNI. Add when a real user asks. |
| D14 | RPC handles malformed inputs strictly (P0001) ; UI must validate before call. | Same defensive shape as `calculate_recipe_cost_v1` and `recipe_bom_full_v1`. |

---

## 4. Test plan

### 4.1 pgTAP (DB)

- `supabase/tests/recipe_cost_history_v1.test.sql` (CREATE). At minimum :
  - Overview math : baseline & current cost match expected ; delta_pct matches `(current-baseline)/baseline*100`.
  - Overview only emits products with history.
  - Overview : product with NEW recipe in window has `baseline_cost IS NULL` and `delta_pct IS NULL`.
  - Drill-down : returns chronological version list filtered by `[p_from, p_to]`.
  - Drill-down : unknown product_id returns zero rows (no error).
  - Empty window (`p_from = p_to` in a quiet period) returns zero rows.
  - `p_from > p_to` raises P0001 invalid_date_range.
  - Missing `financial.read` raises P0003 forbidden (using SET LOCAL ROLE).
  - Legacy bare-array snapshots (synthetic fixture with no `items` key) excluded.

### 4.2 Vitest live RPC

- `supabase/tests/functions/recipe-cost-history.test.ts` — smoke test against V3 dev with a seeded recipe-product. Verify shape for both overview and drill-down modes.

### 4.3 Backoffice smoke tests

- `RecipeCostOverviewPage.smoke.test.tsx` :
  - Default render with 0 rows (« No recipe cost movement … »).
  - Mock returns rows : table renders, delta color tones correct.
  - Sort column click flips order.
  - Row click navigates to `/reports/recipe-cost/:productId`.
  - CSV download triggers a Blob with correct header.

- `RecipeCostTimelinePage.smoke.test.tsx` :
  - Mock returns 3 versions : LineChart renders (assert via `data-testid` on chart container), table has 3 rows.
  - Delta vs prev computed correctly (first row delta = `—`).
  - Unknown productId : empty state with back link.
  - CSV download.

### 4.4 CI smoke

- Existing nightly `pgtap-nightly.yml` cron picks up the new `recipe_cost_history_v1.test.sql` automatically.

---

## 5. File map (informative)

```
supabase/migrations/
  20260522000010_create_recipe_cost_history_v1_rpc.sql        (CREATE — Wave 1)

supabase/tests/
  recipe_cost_history_v1.test.sql                              (CREATE — Wave 1)
  functions/recipe-cost-history.test.ts                        (CREATE — Wave 1)

apps/backoffice/src/pages/reports/
  RecipeCostOverviewPage.tsx                                   (CREATE — Wave 2.A)
  RecipeCostTimelinePage.tsx                                   (CREATE — Wave 2.B)
  __tests__/RecipeCostOverviewPage.smoke.test.tsx              (CREATE — Wave 2.A)
  __tests__/RecipeCostTimelinePage.smoke.test.tsx              (CREATE — Wave 2.B)
  ReportsIndexPage.tsx                                         (UPDATE — Wave 2.C — tile)

apps/backoffice/src/routes/index.tsx                           (UPDATE — Wave 2.C — 2 routes)
apps/backoffice/src/layouts/Sidebar.tsx                        (UPDATE — Wave 2.C — link)
packages/supabase/src/types.generated.ts                       (UPDATE — Wave 3 — regen)
CLAUDE.md                                                      (UPDATE — Wave 4 — workplan pointer)

docs/workplan/plans/2026-05-17-session-18-INDEX.md             (CREATE — Wave 0, by writing-plans)
docs/workplan/specs/2026-05-17-session-18-spec.md              (CREATE — Wave 0 — this doc)
```

---

## 6. Limitations & known follow-ups (Session 19+)

| ID (anticipated) | Description |
|---|---|
| `DEV-S18-1.A-01` | RPC scans all `recipe_versions` per call. At ~12 products × ~1-2 versions per edit, this is fine. If the table grows to >10k rows, an index on `(product_id, created_at DESC)` would help — currently unindexed by created_at. |
| `DEV-S18-2.A-01` | Overview baseline lookup does N+1 subqueries via `LATERAL`. Could be rewritten with a single window function ; left as-is for clarity. |
| `DEV-S18-2.B-01` | Timeline chart axis labels are raw ISO dates ; no locale-aware formatting. Use the existing `toLocalDateStr` helper if needed in S19. |
| `DEV-S18-2.B-02` | No "zoom to selected range" interaction on the chart. Out of scope for v1. |
| `DEV-S18-2.A-02` | CSV export bundles raw NUMERIC values — no locale-aware formatting. Consumers typically want raw numbers anyway. |

---

## 7. Out of scope (deferred Session 19+)

- Allergen module on receipt + customer display (DEV-S15-5.C-01) — wontfix per user 2026-05-17.
- DEV-S16-2.A-01 trigram predicate fix.
- DEV-S16-1.A-01 PR-time pgTAP gate.
- Session 13 deferred items (Playwright CI, `pg_net` birthday cron, Cash Flow IF/Financing, `mv_pl_monthly` reuse, staging-deploy secrets).
- DEV-S17-3.A-01 backoffice smoke flakes stabilization (10 pre-existing flakes).
- Cost forecasting / what-if scenarios.
- PDF export.
- Cost change email digest.
- New bakery feature module (B2B, expenses, customers/loyalty enhancements).

---

## 8. Success criteria (gate to merge)

- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green (modulo pre-existing flakes — verify 2 new smoke tests pass).
- [ ] `pnpm build` green.
- [ ] pgTAP suite green via cloud MCP (`recipe_cost_history_v1.test.sql`).
- [ ] `packages/supabase/src/types.generated.ts` regenerated and committed (RPC visible).
- [ ] CLAUDE.md « Active Workplan » updated to Session 19.
- [ ] PR open to master with body listing 1 migration, 2 new pages, sidebar/router wiring.
- [ ] No new « DEV-S18-… » deviation packs beyond §6.
- [ ] Smoke on V3 dev : visit overview page in a fresh BO session, verify rows render for the seeded recipes, click a row, verify drill-down chart + table.

---

*Spec écrit 2026-05-17 par lead session 18. Brainstorming par superpowers:brainstorming skill. Allergen scope dropped per user decision (memory : project_allergens_wontfix).*
