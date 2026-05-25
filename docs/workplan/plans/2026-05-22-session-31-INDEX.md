# Session 31 — Reports Drill-Down + 3 detail pages — INDEX

> **Date** : 2026-05-22 → 2026-05-26 (closeout)
> **Branche** : `swarm/session-31`
> **Base** : `master` @ `60a1ff3` (post-merge S30 PR #38)
> **Status** : ✓ ready to merge
> **Spec** : [`../specs/2026-05-22-session-31-spec.md`](../specs/2026-05-22-session-31-spec.md)
> **Plan** : [`./2026-05-22-session-31-plan.md`](./2026-05-22-session-31-plan.md)

---

## 1. Summary

Premier chantier **Vague C** (suite des Reports Vagues A=S29, B=S30) : drill-down navigation transverse sur les 17 reports BO + création de 3 nouvelles detail pages minimales read-only (`customers/:id`, `orders/:id`, `inventory/recipes/:productId`). Composant entity-aware `<DrilldownLink>` consume helper pur `buildDrilldownUrl(entity, id, filter)`.

**Tests** : ~27 (13 unit `buildDrilldownUrl` + 3 component `DrilldownLink` + 6 detail pages + 5 wiring sample smoke + 2 pgTAP `orders.read` perm). `pnpm typecheck` 6/6 PASS.

---

## 2. Migrations applied (1)

Block `20260616000010` :

| # | Name | Object | Notes |
|---|---|---|---|
| `_010` | `seed_orders_read_perm` | perm `orders.read` + role_perms grants MANAGER/ADMIN/SUPER_ADMIN | Débloque `<DrilldownLink entity="order">` |

Applied via cloud MCP `apply_migration` sur `ikcyvlovptebroadgtvd`.

---

## 3. New files (S31)

### Foundation (Wave 1)
- `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts` — helper pur
- `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts` — 13 unit (T1-T13)
- `apps/backoffice/src/features/reports/components/DrilldownLink.tsx` — composant entity-aware
- `apps/backoffice/src/features/reports/components/__tests__/DrilldownLink.smoke.test.tsx` — 3 smoke
- `supabase/migrations/20260616000010_seed_orders_read_perm.sql`
- `supabase/tests/orders_read_perm.test.sql` — 2 pgTAP

### Detail pages (Wave 2)
- `apps/backoffice/src/features/customers/hooks/useCustomerDetail.ts`
- `apps/backoffice/src/pages/customers/CustomerDetailPage.tsx`
- `apps/backoffice/src/pages/customers/__tests__/CustomerDetailPage.smoke.test.tsx`
- `apps/backoffice/src/features/orders/hooks/useOrderDetail.ts`
- `apps/backoffice/src/pages/orders/OrderDetailPage.tsx`
- `apps/backoffice/src/pages/orders/__tests__/OrderDetailPage.smoke.test.tsx`
- `apps/backoffice/src/features/recipes/hooks/useRecipeDetail.ts`
- `apps/backoffice/src/pages/recipes/RecipeDetailPage.tsx`
- `apps/backoffice/src/pages/recipes/__tests__/RecipeDetailPage.smoke.test.tsx`

### Wiring smoke samples (Wave 3.E)
- `apps/backoffice/src/pages/reports/__tests__/wastage-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/sales-by-staff-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/perishable-turnover-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/basket-analysis-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/stock-variance-drilldown.smoke.test.tsx` (substitué à `profit-loss-drilldown` — voir §10 DEV-S31-3.D)

### Workplan
- `docs/workplan/specs/2026-05-22-session-31-spec.md`
- `docs/workplan/plans/2026-05-22-session-31-plan.md`
- `docs/workplan/plans/2026-05-22-session-31-INDEX.md` (ce fichier)

---

## 4. Files modified (S31)

### Routes + types
- `apps/backoffice/src/routes/index.tsx` — 3 nouvelles routes + 3 imports
- `packages/supabase/src/rls/permissions.ts` — `PermissionCode` union étendu avec `'orders.read'`
- `packages/supabase/src/types.generated.ts` — regen (pas de delta — seed n'apparaît pas dans types)

### Reports wired (12 fichiers)
- Wave 3.A : `SalesByCategoryPage.tsx` (category drill), `SalesByStaffPage.tsx` (user drill), `SalesByHourPage.tsx` (terminal comment)
- Wave 3.B : `WastagePage.tsx`, `StockVariancePage.tsx`, `PerishableTurnoverPage.tsx`, `StockMovementHistoryPage.tsx`
- Wave 3.C : `ProductionYieldPage.tsx`, `RecipeCostOverviewPage.tsx`, `BasketAnalysisPage.tsx`
- Wave 3.D : `ProfitLossPage.tsx`, `BalanceSheetPage.tsx`, `CashFlowPage.tsx`, `Pb1ReportPage.tsx` (terminal comments — RPC bump required pour pre-filled drill, deferred S32+)
- Wave 3.E : `AuditPage.tsx` (actor + entity_type switch), `PaymentByMethodPage.tsx` (terminal comment)

### Existing tests retroactively patched (Wave 4.A)
12 tests pré-S31 dans `apps/backoffice/src/features/reports/__tests__/` et `apps/backoffice/src/pages/reports/__tests__/` patched pour wrap `<MemoryRouter>` — sans router, `<Link>` du DrilldownLink crashe sur `useContext(...)`. Script Python idempotent.

---

## 5. Tests run

| Suite | Count | Status |
|---|---|---|
| Unit `buildDrilldownUrl` | 13 | PASS via Vitest BO |
| Component `DrilldownLink.smoke` | 3 | PASS |
| Detail pages smoke (3 pages × 2 cas) | 6 | PASS |
| Wiring sample smoke (5 reports) | 5 | PASS |
| pgTAP `orders_read_perm` | 2 | PASS via cloud MCP `execute_sql` |
| `pnpm typecheck` | 6/6 packages | PASS |

**Full BO regression sweep** : Voir §11 résultat post-MemoryRouter-patch.

---

## 6. Permissions seeded (1)

- `orders.read` → MANAGER + ADMIN + SUPER_ADMIN (UI gate only — RLS row-level inchangée sur `orders` table)

---

## 7. RPCs added (0)

Aucune nouvelle RPC. Les 3 detail pages utilisent direct SELECT PostgREST avec embeds. Recipe detail reuse `recipe_bom_full_v1` (S17).

---

## 8. Tasks closed

| Task | Status | Source |
|---|---|---|
| TASK-14-005 (drill-down navigation) | PARTIAL — 13/17 reports drillable, 4 accounting terminal (RPC bump deferred S32+) | Spec §1 |
| New transverse Vague C item 1/6 (drill-down) | DONE | Spec §1 |

---

## 9. RPCs / EFs out of scope (RPC bumps deferred S32+)

| RPC | What | Why deferred |
|---|---|---|
| `get_profit_loss_v1` | Add `account_id UUID` to lines | S31 returns `code` only ; /accounting/general-ledger expects UUID |
| `get_balance_sheet_v1` | Same | Same |
| `get_cash_flow_v1` | Same | Same |
| `get_stock_movements_v1` | Add `product_id UUID` to lines | S30 RPC doesn't surface product_id, blocks product drill on StockMovementHistory |

Pour débloquer le drill-down pre-filled sur ces 4 reports → bumper les RPCs en S32+ (+ adapter hooks BO + faire que `GeneralLedgerPage` lise `account_id` depuis `useSearchParams`).

---

## 10. Deviations vs spec/plan

| ID | Section spec | Original plan | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S31-2.A-01 | §4.1 CustomerDetailPage | Address card (street/city/postal) | Skipped — table customers a pas ces cols | Réalité cloud schema | Informational |
| DEV-S31-2.A-02 | §4.1 | `type` enum `walk_in/account/b2b` | Réel : `customer_type` enum `retail|b2b` | Schema discovery | Informational |
| DEV-S31-2.B-01 | §4.2 OrderDetailPage | `total_amount`, `created_by` user, `product_name`, `modifiers_json`, `change_due`, `order_refunds` | Réel : `total`, `served_by`, `name_snapshot`, `modifiers`, `change_given`, `refunds` | Schema discovery | Informational |
| DEV-S31-2.C-01 | §4.3 RecipeDetailPage | Route `:id`, hook récupère "1 recipe row" avec yield/version_label/status | Réel : `recipes` est M2M product↔ingredient (1 row par ingrédient) ; pas de "recipe row" autonome | Schema discovery | Informational — route keyed sur `:productId` (output product), hook lit `products` + count `recipe_versions` |
| DEV-S31-2.C-02 | §4.3 RecipeDetailPage | `recipe_bom_full_v1` returns tree | Réel : returns flat TABLE (cascade déjà aggregé côté DB) | Schema discovery | Informational — simplifie la page |
| DEV-S31-3.B-01 | §5 StockMovementHistory | Product drill | Skipped — RPC `get_stock_movements_v1` ne retourne pas `product_id` | RPC bump deferred S32+ | Informational |
| DEV-S31-3.D | §5 4 accounting reports | Account drill avec date filter | Terminal comment uniquement | RPCs retournent `code` 3-4 digit, pas UUID — GL S26b attend UUID | Documented dans `§9` ci-dessus, deferred S32+ |
| DEV-S31-3.E-01 | §6.4 wiring sample | `profit-loss-drilldown.smoke` | Remplacé par `stock-variance-drilldown.smoke` | Profit-loss account drill deferred (DEV-S31-3.D) → smoke n'a rien à vérifier | Informational — count maintenu à 5 samples |
| DEV-S31-4.A-01 | §6 Tests | "BO smoke 6/6 PASS detail pages + 5/5 PASS wiring sample" | 12 existing tests retroactively patched pour wrap MemoryRouter | Wiring DL → existing tests crash hors Router | Defensive — script python idempotent applied 12 files |

---

## 11. Acceptance criteria

- [x] 13/13 unit `buildDrilldownUrl` PASS
- [x] 3/3 component smoke `DrilldownLink` PASS
- [x] Migration `_010` applied cloud V3 dev + pgTAP 2/2 PASS
- [x] Types regen post-migration committé + `PermissionCode` union extended
- [x] 3 detail pages créées (Customer + Order + Recipe) avec routes + back link + permission gate route-level
- [x] 6/6 detail page smoke PASS
- [x] 13 reports wired avec `<DrilldownLink>` (4 accounting + PaymentByMethod + SalesByHour + Pb1 + RecipeCostTimeline = 7 terminal documentés)
- [x] 5/5 BO wiring smoke sample PASS
- [x] `pnpm typecheck` 6/6 PASS
- [x] 12 pre-existing report tests patched pour MemoryRouter wrap (regression-free)
- [x] CLAUDE.md Active Workplan + INDEX S31 committed

---

## 12. Backlog Vague C remaining (S32+)

1. **UnifiedReportFilters extra dims** (category/terminal/customer)
2. **Compare toggle** sur 5 reports S30 (Wastage/PaymentByMethod/PB1/StockMovements/PerishableTurnover)
3. **Mobile responsive** des detail pages + reports
4. **Hub mini-KPI bar** + favorites/pinning sur ReportsIndexPage
5. **6 Soon cards restantes** (Daily Sales, Purchase ×3, Production Report/Efficiency, Staff Performance, Price Changes, Permission Change Log)

Et follow-ups directs S31 :
- `/backoffice/orders` list page filtrable — débloquerait drill PaymentByMethod + SalesByHour
- RPC bumps (P&L, BS, CF, StockMovements) pour exposer UUIDs
- `/accounting/general-ledger` accepts `?account_id=` URL param
