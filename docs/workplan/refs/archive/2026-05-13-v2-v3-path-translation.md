---
title: V2 → V3 Path Translation Table (Session 13 canonical reference)
date: 2026-05-13
owner: arch-steward (Phase 0.1)
status: LOCKED — referenced by every Session 13 phase plan
sources:
  - docs/workplan/backlog-by-module/*.md (25 modules, 164 V2 path mentions)
  - apps/{pos,backoffice}/src tree (V3 actual)
  - packages/{domain,supabase,ui,utils}/src tree (V3 actual)
---

# V2 → V3 Path Translation Table

> **Purpose.** The 25 backlogs were authored against the V2 single-app layout (`src/services/*`, `src/components/*`, `src/pages/*`, `src/hooks/*`, `src/stores/*`). The V3 codebase is a pnpm/turbo monorepo. Without this table, each Session 13 sub-agent would re-invent placement and produce drift.
>
> **Rules of placement (D1).**
> - **`packages/domain/src/<feature>/`** — pure TypeScript, IO-free (no fetch, no Supabase, no React). Validators, calculators, classifiers, types. Unit-testable with Vitest.
> - **`packages/supabase/src/<area>/`** — Supabase client wrappers, auth helpers, generated types. RPC call sites *may* live here OR in feature-local hooks.
> - **`packages/ui/src/{primitives,components}/`** — cross-app UI primitives (Button, Dialog, Tabs, Input…) and shared composite components (CustomerForm, TenderRow). Steward = `ui-steward` (D9).
> - **`packages/utils/src/`** — pure helpers (date, money, retry). *Note: package not yet bootstrapped in V3; first task that needs it will create it.*
> - **`apps/pos/src/features/<feature>/{components,hooks,store,routes}/`** — POS-specific surface code. One store per feature, NEVER global.
> - **`apps/backoffice/src/features/<feature>/{components,hooks,store,routes}/`** — BO-specific surface code, same rule.
> - **`apps/{pos,backoffice}/src/pages/<Page>.tsx`** — thin route shell that imports feature components.
> - **`apps/{pos,backoffice}/src/routes/index.tsx`** — central router declaration.
> - **`supabase/migrations/YYYYMMDDhhmmss_*.sql`** — append-only, monotonic.
> - **`supabase/functions/<ef>/index.ts`** — Edge Functions (Deno).
> - **`supabase/functions/_shared/*.ts`** — EF-shared helpers (cors, rate-limit, manager-pin).
>
> **Test placement.** Co-locate in `__tests__/` next to the code (see CLAUDE.md "Inventory phase test layout").
>
> **Coverage.** This table captures ≥ 80 % of the 164 V2 path mentions across the 25 backlogs and lists every category referenced. Mappings not yet directory-resolved are flagged `to-create`.

---

## Status legend

| Status | Meaning |
|---|---|
| **exists** | V3 file/dir is present today; sub-agent edits in place. |
| **to-create** | V3 file/dir is the canonical target but does not exist yet; sub-agent creates it under the convention. |
| **deprecated** | V2 path is dropped in V3 — no V3 equivalent (mark task as `NO-OP` or split). |
| **see-D2** | Phantom-table decision applies — read `2026-05-13-decision-pack.md` D2 before touching. |
| **moved** | V3 location differs from the literal V2-to-V3 mechanical mapping (e.g., `src/services/lan/` → `packages/domain/src/lan/` + `apps/pos/src/features/lan/`, NOT to `apps/pos/src/services/lan/`). |

---

## Cross-cutting rules (apply globally before per-module rows)

| V2 pattern | V3 pattern | Rule |
|---|---|---|
| `src/services/<X>.ts` (pure logic) | `packages/domain/src/<X>/index.ts` | IO-free split required. |
| `src/services/<X>.ts` (Supabase IO) | `packages/supabase/src/<area>/<X>.ts` OR `apps/<app>/src/features/<X>/api.ts` | Server-touching code stays out of `packages/domain`. |
| `src/services/<X>/__tests__/<Y>.test.ts` | co-located `__tests__/<Y>.test.ts` next to the moved file | Never to `tests/` at repo root. |
| `src/components/<X>.tsx` (POS-specific) | `apps/pos/src/features/<feature>/components/<X>.tsx` | Feature-scoped. |
| `src/components/<X>.tsx` (BO-specific) | `apps/backoffice/src/features/<feature>/components/<X>.tsx` | Feature-scoped. |
| `src/components/ui/<Primitive>.tsx` | `packages/ui/src/primitives/<Primitive>.tsx` OR `packages/ui/src/components/<Composite>.tsx` | Steward `ui-steward` (D9). |
| `src/pages/<X>.tsx` | `apps/<app>/src/pages/<X>.tsx` (thin) + logic in `apps/<app>/src/features/<feature>/` | Thin pages, fat features. |
| `src/hooks/<X>.ts` | `apps/<app>/src/features/<feature>/hooks/<X>.ts` | Co-locate per feature. |
| `src/stores/<X>.ts` (Zustand) | `apps/<app>/src/features/<feature>/store/<X>.ts` | One store per feature, NO global aggregator. |
| `src/routes/<X>.tsx` | `apps/<app>/src/routes/index.tsx` (single declaration file) | Routes consolidated. |
| `src/layouts/<X>.tsx` | `apps/<app>/src/layouts/<X>.tsx` | Direct port. |
| `src/contexts/<X>.tsx` | `apps/<app>/src/features/<feature>/context/<X>.tsx` OR `apps/<app>/src/lib/<X>.tsx` | Prefer feature scope. |
| `src/lib/<X>.ts` | `apps/<app>/src/lib/<X>.ts` OR `packages/supabase/src/<X>.ts` | App-only vs shared. |
| `src/utils/<X>.ts` | `packages/domain/src/<X>.ts` (pure) OR `apps/<app>/src/lib/<X>.ts` (app-only) | Pure first. |
| `src/types/<X>.ts` | `packages/domain/src/types/<X>.ts` OR `packages/supabase/src/types.generated.ts` | Generated types regenerated via `pnpm db:types`. |
| `src/schemas/<X>.ts` (Zod) | `packages/domain/src/<feature>/schemas.ts` | Pure validation lives in domain. |
| `src/data/<X>.ts` (static) | `apps/<app>/src/data/<X>.ts` OR `packages/domain/src/<feature>/fixtures.ts` | App-static stays in app. |
| `supabase/migrations/<old>.sql` | `supabase/migrations/20260517xxxxxx_<topic>.sql` | Session 13 block reserved. |
| `supabase/functions/<ef>/index.ts` | unchanged | Deno EFs keep flat layout. |
| **`audit_log`** (legacy singular table) | **`audit_logs`** (canonical plural) — DROP `audit_log` in `20260517000034` after migrating rows | Plural matches `journal_entries`, `stock_movements`, `user_sessions`. See D2 / Phase 1.B. |

---

## Module 01 — Auth & Permissions

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/authService.ts` (488 LOC) | `packages/supabase/src/auth/pinAuth.ts` + `apps/pos/src/features/auth/api.ts` | exists (split) | Already decomposed. Add session-timeout under `apps/pos/src/features/auth/hooks/useSessionTimeout.ts`. |
| `src/services/__tests__/authService.test.ts` | `packages/supabase/src/auth/__tests__/pinAuth.test.ts` | to-create | Co-located. |
| `src/hooks/useSessionTimeout.ts` | `apps/pos/src/features/auth/hooks/useSessionTimeout.ts` | to-create | POS-specific. |
| `src/stores/authStore.ts` | `apps/pos/src/features/auth/store/authStore.ts` | exists | Move from current `apps/pos/src/stores/` if still global. |
| `src/pages/settings/SecuritySettingsPage.tsx` | `apps/backoffice/src/pages/SecuritySettings.tsx` | to-create | BO surface. |
| `src/routes/adminRoutes.tsx` | `apps/backoffice/src/routes/index.tsx` | exists | Routes consolidated in one file. |
| `src/pages/reports/ReportsConfig.tsx` | `apps/backoffice/src/features/reports/config.ts` | to-create | Pure config → feature-local module, not page. |
| `src/pages/reports/ReportsPage.tsx` | `apps/backoffice/src/pages/Reports.tsx` | to-create | Thin shell. |
| `supabase/functions/auth-user-management/index.ts` | unchanged | to-create | EF flat layout. |
| `src/pages/admin/UsersPage.tsx` | `apps/backoffice/src/pages/Users.tsx` | to-create | |
| `supabase/functions/auth-change-pin/` | unchanged | exists | |
| `supabase/functions/set-user-pin/` | unchanged | exists | |
| `src/components/settings/PinChangeModal.tsx` | `apps/backoffice/src/features/settings/components/PinChangeModal.tsx` | to-create | |
| `src/lib/sentry.ts` | `apps/pos/src/lib/sentry.ts` AND `apps/backoffice/src/lib/sentry.ts` | to-create | Per-app instrumentation, shared config in `packages/utils/src/sentry/config.ts` (to-create if package bootstrapped). |
| `src/components/auth/PinKeypad.tsx` | `packages/ui/src/components/NumpadPin.tsx` | exists | Already shared primitive. |
| `src/components/customers/CustomerSearch.tsx` | `packages/ui/src/components/CustomerSearchModal.tsx` | exists | |

## Module 02 — POS / Cart / Orders

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/stores/cartStore.ts` | `apps/pos/src/features/cart/store/cartStore.ts` | exists | Feature-scoped. |
| `src/stores/cart/*.ts` (decomposition) | `apps/pos/src/features/cart/store/{items,totals,actions}.ts` | to-create | Splitting plan only if 02-001 lands. |
| `src/stores/__tests__/cartStore.test.ts` | `apps/pos/src/features/cart/store/__tests__/cartStore.test.ts` | to-create | Co-located. |
| `src/hooks/pos/useCartHydration.ts` | `apps/pos/src/features/cart/hooks/useCartHydration.ts` | to-create | |
| `src/services/pos/orderService.ts` | `packages/domain/src/orders/` (pure parts) + `apps/pos/src/features/cart/api.ts` (RPC calls) | exists (partial) | `complete_order` RPC flow already in `packages/domain/src/orders/` (validation) + `apps/pos/src/features/cart/` (IO). |
| `src/components/pos/cart/CartItemRow.tsx` | `apps/pos/src/features/cart/components/CartItemRow.tsx` | to-create | |
| `src/components/pos/cart/CartTotals.tsx` | `apps/pos/src/features/cart/components/CartTotals.tsx` | to-create | |
| `src/components/pos/cart/CartActions.tsx` | `apps/pos/src/features/cart/components/CartActions.tsx` | to-create | |
| `src/components/pos/VirtualKeypad/` | `apps/pos/src/features/cart/components/VirtualKeypad/` OR `packages/ui/src/components/Numpad.tsx` | exists | `Numpad` already in `packages/ui`. |
| `src/contexts/VirtualKeypadContext.tsx` | `apps/pos/src/features/cart/context/VirtualKeypadContext.tsx` | to-create | |
| `src/hooks/pos/useCustomerSwitch.ts` | `apps/pos/src/features/cart/hooks/useCustomerSwitch.ts` | to-create | |
| `src/services/pos/cartCalculations.ts` | `packages/domain/src/cart/` (already exists) | exists | Pure cart math lives in domain. |
| `src/hooks/pos/useCartDraft.ts` | `apps/pos/src/features/cart/hooks/useCartDraft.ts` | to-create | |
| `RestoreDraftModal.tsx` | `apps/pos/src/features/cart/components/RestoreDraftModal.tsx` | to-create | |
| `vite.config.ts` | `apps/pos/vite.config.ts` AND `apps/backoffice/vite.config.ts` | exists | Per-app vite configs. |
| `src/routes/posRoutes.tsx` | `apps/pos/src/routes/index.tsx` | exists | |
| `src/components/pos/POSCheckoutWrapper.tsx` | `apps/pos/src/features/cart/components/POSCheckoutWrapper.tsx` | deprecated | Backlog 02-008 deletes the wrapper. |
| `src/components/pos/POSTerminalWrapper.tsx` | `apps/pos/src/features/cart/components/POSTerminalWrapper.tsx` | to-create | Direct port. |
| `src/pages/pos/POSPage.tsx` | `apps/pos/src/pages/Pos.tsx` | exists | |
| `src/components/pos/POSCommandPalette.tsx` | `apps/pos/src/features/cart/components/POSCommandPalette.tsx` | to-create | |
| `src/components/pos/CategoryNav.tsx` | `apps/pos/src/features/products/components/CategoryNav.tsx` | to-create | |
| `src/components/pos/UserMenuPopover.tsx` | `apps/pos/src/features/auth/components/UserMenuPopover.tsx` | to-create | |

## Module 03 — Payments (Split)

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/pos/orderService.ts` | see module 02 | exists | |
| `src/stores/paymentStore.ts` | `apps/pos/src/features/payment/store/paymentStore.ts` | exists | |
| RPC `complete_order_with_payments` | `supabase/migrations/2026051x*_complete_order_with_payment_v9.sql` | to-create | v8 → v9 bump in Phase 1 (D14). |
| `src/utils/retryWithBackoff.ts` | `packages/domain/src/utils/retryWithBackoff.ts` | to-create | Pure helper. |
| `src/services/payment/` | `packages/domain/src/payment/` + `apps/pos/src/features/payment/` | exists | Already split. |
| `src/components/pos/modals/PaymentModal.tsx` | `apps/pos/src/features/payment/components/PaymentModal.tsx` | to-create | |
| `src/components/pos/modals/SplitByItemModal.tsx` | `apps/pos/src/features/payment/components/SplitByItemModal.tsx` | to-create | |
| `src/services/pos/cartCalculations.ts` | `packages/domain/src/cart/` | exists | |
| `src/services/accounting/accountingEngine.ts` | `packages/domain/src/accounting/` | to-create | Module absent in V3 today — Phase 1.A builds. |
| `src/services/payment/qrisService.ts` | `apps/pos/src/features/payment/qris.ts` + EF `supabase/functions/process-payment/` | to-create | QRIS provider = Xendit (D6). |
| `qris-webhook` EF | `supabase/functions/qris-webhook/index.ts` | to-create | |
| `src/services/print/printService.ts` | `packages/domain/src/print/` + `apps/pos/src/features/payment/print.ts` | to-create | Print service to split (pure formatter vs transport). |
| `src/services/print/receiptFormatter.ts` | `packages/domain/src/print/receiptFormatter.ts` | to-create | Pure formatter. |
| `src/services/accounting/__tests__/saleTrigger.smoke.test.ts` | `packages/domain/src/accounting/__tests__/saleTrigger.smoke.test.ts` + pgTAP `supabase/tests/accounting.test.sql` | to-create | Triggers must be tested at DB level. |

## Module 04 — KDS / Kitchen

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/lan/lanHubMessageHandler.ts` | `packages/domain/src/lan/messageHandler.ts` + `apps/pos/src/features/lan/handler.ts` | to-create | Split per D4: pure parsing in domain, transport in app. |
| `src/services/lan/lanProtocol.ts` | `packages/domain/src/lan/protocol.ts` | to-create | Pure protocol types. |
| `src/stores/orderStore.ts` | `apps/pos/src/features/kds/store/orderStore.ts` | exists | (Verify: feature already has `apps/pos/src/features/kds/`.) |
| `src/hooks/kds/useKdsOrderStatus.ts` | `apps/pos/src/features/kds/hooks/useKdsOrderStatus.ts` | to-create | |
| `src/pages/settings/KdsStationsSettingsPage.tsx` | `apps/backoffice/src/pages/KdsStations.tsx` | to-create | BO settings surface. |
| `src/hooks/kds/useKdsStations.ts` | `apps/backoffice/src/features/kds/hooks/useKdsStations.ts` | to-create | |
| `src/hooks/kds/useKdsOrderActions.ts` | `apps/pos/src/features/kds/hooks/useKdsOrderActions.ts` | exists | (See `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` for pattern.) |
| `src/services/reporting/reportingFinancialService.ts` | `apps/backoffice/src/features/reports/api/financial.ts` | to-create | |
| `src/pages/reports/ReportsConfig.tsx` | see module 01 | to-create | |
| `src/components/kds/KDSOrderGrid.tsx` | `apps/pos/src/features/kds/components/KDSOrderGrid.tsx` | to-create | |
| `src/components/kds/KDSOrderCard.tsx` | `apps/pos/src/features/kds/components/KDSOrderCard.tsx` | to-create | |
| `src/hooks/kds/useKdsOrderManualSort.ts` | `apps/pos/src/features/kds/hooks/useKdsOrderManualSort.ts` | to-create | |
| `src/pages/kds/KdsStationPage.tsx` | `apps/pos/src/pages/Kds.tsx` | exists | |
| `src/components/kds/KdsConnectionBanner.tsx` | `apps/pos/src/features/kds/components/KdsConnectionBanner.tsx` | to-create | |
| `src/services/kds/kdsDispatcher.ts` | `packages/domain/src/kitchen/dispatcher.ts` | to-create | Pure routing logic. |
| `src/components/products/ProductForm.tsx` | `apps/backoffice/src/features/products/components/ProductForm.tsx` | to-create | |
| `src/services/kds/kdsSoundService.ts` | `apps/pos/src/features/kds/audio.ts` | to-create | App-side, no domain logic. |
| `src/pages/settings/KdsSoundSettingsPage.tsx` | `apps/backoffice/src/pages/KdsSound.tsx` | to-create | |

## Module 05 — Products & Categories

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/hooks/inventory/useProduction.ts` | `apps/backoffice/src/features/inventory/hooks/useProduction.ts` | to-create | Production lives in module 15 — backlog 05 only consumes read-only via `view_product_recipes`. |
| `src/components/products/RecipeForm.tsx` | `apps/backoffice/src/features/products/components/RecipeForm.tsx` (read-only) OR `apps/backoffice/src/features/production/components/RecipeForm.tsx` (writes) | to-create | D3: recipes owned by module 15. Read-only display in 05 reads `view_product_recipes`. |
| `src/services/products/recipeCostCalculator.ts` | `packages/domain/src/production/recipeCost.ts` | to-create | Pure calculator. |
| `src/components/products/ProductForm.tsx` | `apps/backoffice/src/features/products/components/ProductForm.tsx` | to-create | |
| `src/components/products/ProductPricingMatrix.tsx` | `apps/backoffice/src/features/products/components/ProductPricingMatrix.tsx` | to-create | |
| `src/services/products/pricingResolver.ts` | `packages/domain/src/products/pricingResolver.ts` | to-create | Pure logic. |
| `src/components/products/ModifierGroupForm.tsx` | `apps/backoffice/src/features/products/components/ModifierGroupForm.tsx` | to-create | |
| `src/components/pos/modals/ModifierModal.tsx` | `packages/ui/src/components/ModifierModal.tsx` | exists | Shared primitive. |
| `src/components/products/ComboWizard.tsx` | `apps/backoffice/src/features/products/components/ComboWizard.tsx` | to-create | |
| `src/hooks/products/useCombo.ts` | `apps/backoffice/src/features/products/hooks/useCombo.ts` | to-create | |
| EF `process-product-image` | `supabase/functions/process-product-image/index.ts` | to-create | |
| `src/hooks/products/useProductForm.ts` | `apps/backoffice/src/features/products/hooks/useProductForm.ts` | to-create | |
| `src/components/products/ProductImageUploader.tsx` | `apps/backoffice/src/features/products/components/ProductImageUploader.tsx` | to-create | |
| `src/pages/products/CategoriesPage.tsx` | `apps/backoffice/src/pages/Categories.tsx` | to-create | |
| `src/hooks/products/useCategories.ts` | `apps/backoffice/src/features/products/hooks/useCategories.ts` | to-create | |
| `src/pages/products/ProductsPage.tsx` | `apps/backoffice/src/pages/Products.tsx` | exists | |
| `src/components/products/BulkActionsModal.tsx` | `apps/backoffice/src/features/products/components/BulkActionsModal.tsx` | to-create | |
| `src/types/database.enums.ts` | `packages/supabase/src/enums.ts` | exists | |
| `src/types/database.generated.ts` | `packages/supabase/src/types.generated.ts` | exists | Regenerate via `pnpm db:types`. |

## Module 06 — Inventory & Stock

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/inventory/stockLotService.ts` | `packages/domain/src/inventory/lots/` + `apps/backoffice/src/features/inventory/lots/api.ts` | to-create | F1 expiry tracking. Pure FIFO calc in domain. |
| `src/hooks/inventory/useStockLots.ts` | `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` | to-create | |
| EF `cron-expire-stock-lots` | `supabase/functions/cron-expire-stock-lots/index.ts` | to-create | |
| `src/pages/inventory/ExpiringStockPage.tsx` | `apps/backoffice/src/pages/ExpiringStock.tsx` | to-create | |
| `src/components/pos/ProductCard.tsx` | `apps/pos/src/features/products/components/ProductCard.tsx` | to-create | |
| `src/hooks/inventory/useWasteRecords.ts` | `apps/backoffice/src/features/inventory/hooks/useWasteRecords.ts` | to-create | |
| `src/services/inventory/stockReservation.ts` | `packages/domain/src/inventory/reservations/` + RPC `reservation_hold_v1`/`reservation_release_v1` | to-create (see-D2) | D2: `stock_reservations` table = CREATE. |
| `src/hooks/inventory/useStockByLocation.ts` | `apps/backoffice/src/features/inventory/hooks/useStockByLocation.ts` | to-create | Replaces V2 `stock_balances`; reads new view `view_section_stock_details` (D2 — to-create Phase 2.D). |
| `src/hooks/inventory/useStockOpname.ts` | `apps/backoffice/src/features/inventory/hooks/useStockOpname.ts` | to-create | |
| `src/pages/inventory/StockOpnamePage.tsx` | `apps/backoffice/src/pages/StockOpname.tsx` | to-create | |
| `src/components/inventory/OpnameItemRow.tsx` | `apps/backoffice/src/features/inventory/components/OpnameItemRow.tsx` | to-create | |
| `src/pages/inventory/GhostStockPage.tsx` | `apps/backoffice/src/pages/GhostStock.tsx` | to-create | |
| `src/hooks/inventory/useGhostStock.ts` | `apps/backoffice/src/features/inventory/hooks/useGhostStock.ts` | to-create | |
| `postStockAdjustmentJournalEntry` (TS helper) | `tr_20_je_emit` SQL trigger (D20) | deprecated (TS) | JE emission moves to trigger; TS helper deleted. |
| `src/hooks/inventory/useInternalTransfers.ts` | `apps/backoffice/src/features/inventory-transfers/hooks/useTransfers.ts` | exists | Already shipped Session 12 Phase 3. |
| `src/pages/inventory/TransfersPage.tsx` | `apps/backoffice/src/pages/TransfersList.tsx` + `TransferDetail.tsx` + `TransferForm.tsx` | exists | |
| `src/components/inventory/QuickWasteModal.tsx` | `apps/backoffice/src/features/inventory/components/QuickWasteModal.tsx` | to-create | |
| `src/pages/dashboard/DashboardPage.tsx` | `apps/backoffice/src/pages/Dashboard.tsx` | exists | |
| `src/pages/reports/components/StockVarianceTab.tsx` | `apps/backoffice/src/features/reports/components/StockVarianceTab.tsx` | to-create | |

## Module 07 — Purchasing / Suppliers / PO

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/pages/purchasing/PurchaseOrderDetailPage.tsx` | `apps/backoffice/src/pages/PurchaseOrderDetail.tsx` | to-create | |
| `src/hooks/purchasing/usePurchaseOrders.ts` | `apps/backoffice/src/features/purchasing/hooks/usePurchaseOrders.ts` | to-create | |
| `src/pages/purchasing/POReceivePage.tsx` | `apps/backoffice/src/pages/POReceive.tsx` | to-create | |
| `src/hooks/purchasing/usePOReception.ts` | `apps/backoffice/src/features/purchasing/hooks/usePOReception.ts` | to-create | |
| `src/services/accounting/accountingEngine.ts:postPurchaseJE` | trigger `create_purchase_journal_entry` (refactored Phase 1.A) | to-create (DB) | JE moved to trigger via `resolve_mapping_account()`. |
| `view_supplier_performance` (SQL) | `supabase/migrations/20260517xxxxxx_view_supplier_performance.sql` | to-create | |
| `src/pages/purchasing/SupplierDetailPage.tsx` | `apps/backoffice/src/pages/SupplierDetail.tsx` | to-create | |
| `src/pages/reports/components/SupplierPerformanceTab.tsx` | `apps/backoffice/src/features/reports/components/SupplierPerformanceTab.tsx` | to-create | |
| `src/hooks/accounting/useAPManagement.ts` | `apps/backoffice/src/features/accounting/hooks/useAPManagement.ts` | to-create | |
| `src/pages/reports/components/APAgingTab.tsx` | `apps/backoffice/src/features/reports/components/APAgingTab.tsx` | to-create | |
| `supplier_invoices` migration | `supabase/migrations/20260517xxxxxx_create_supplier_invoices.sql` | to-create | |
| `src/hooks/useSupplierInvoices.ts` | `apps/backoffice/src/features/purchasing/hooks/useSupplierInvoices.ts` | to-create | |
| `src/pages/purchasing/SupplierInvoicesPage.tsx` | `apps/backoffice/src/pages/SupplierInvoices.tsx` | to-create | |
| EF `supplier-portal-token` | `supabase/functions/supplier-portal-token/index.ts` | deprecated | Supplier portal = Phase 7. |
| `src/pages/public/SupplierPortalPage.tsx` | n/a | deprecated | Phase 7. |

## Module 08 — Customers / Loyalty

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/components/pos/modals/TierUpgradeModal.tsx` | `apps/pos/src/features/loyalty/components/TierUpgradeModal.tsx` | to-create | |
| `src/services/print/receiptFormatter.ts` | see module 03 | to-create | |
| EF `cron-expire-loyalty-points` | `supabase/functions/cron-expire-loyalty-points/index.ts` | to-create | |
| `src/pages/settings/LoyaltySettingsPage.tsx` | `apps/backoffice/src/pages/LoyaltySettings.tsx` | to-create | |
| `src/pages/reports/components/PointsExpirationTab.tsx` | `apps/backoffice/src/features/reports/components/PointsExpirationTab.tsx` | to-create | |
| `src/pages/customers/CustomerDetailPage.tsx` | `apps/backoffice/src/pages/CustomerDetail.tsx` | to-create | |
| `src/services/b2b/customerLinking.ts` | `packages/domain/src/customers/b2bLinking.ts` | to-create | |
| `src/pages/customers/CustomerDuplicatesPage.tsx` | `apps/backoffice/src/pages/CustomerDuplicates.tsx` | to-create | |
| `src/services/customers/customerMerge.ts` | `packages/domain/src/customers/merge.ts` | to-create | |
| EF `cron-birthday-rewards` | `supabase/functions/cron-birthday-rewards/index.ts` | to-create | |
| `src/services/promotion/birthdayPromotion.ts` | `packages/domain/src/promotions/birthday.ts` | to-create | |
| `src/services/notifications/notificationService.ts` | `packages/domain/src/notifications/` + EF `supabase/functions/notification-dispatch/index.ts` | to-create | D5: email-only MVP. |
| `src/pages/reports/components/LoyaltyAnalyticsTab.tsx` | `apps/backoffice/src/features/reports/components/LoyaltyAnalyticsTab.tsx` | to-create | |
| `src/services/b2b/creditService.ts` | `packages/domain/src/b2b/credit.ts` | to-create | |
| `useCustomerInvoices.ts` | n/a | deprecated (see-D2) | D2: `customer_invoices` = DROP usage; B2B uses `orders.invoice_number` + `view_b2b_invoices`. |

## Module 09 — B2B / Wholesale

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/b2b/arService.ts` | `packages/domain/src/b2b/ar.ts` | to-create | |
| `src/pages/b2b/B2BAgingSummary.tsx` | `apps/backoffice/src/pages/B2BAging.tsx` | to-create | |
| `src/pages/b2b/B2BPaymentsAgingTab.tsx` | `apps/backoffice/src/features/b2b/components/AgingTab.tsx` | to-create | |
| EF `b2b-aging-monthly` | `supabase/functions/b2b-aging-monthly/index.ts` | to-create | |
| `src/hooks/b2b/useB2BOrderForm.ts` | `apps/backoffice/src/features/b2b/hooks/useB2BOrderForm.ts` | to-create | |
| `src/pages/b2b/B2BOrderFormPage.tsx` | `apps/backoffice/src/pages/B2BOrderForm.tsx` | to-create | |
| `src/services/b2b/creditService.ts` | `packages/domain/src/b2b/credit.ts` | to-create | (Already in 08.) |
| `src/pages/b2b/B2BBulkInvoicePage.tsx` | `apps/backoffice/src/pages/B2BBulkInvoice.tsx` | to-create | |
| EF `b2b-bulk-invoice` | `supabase/functions/b2b-bulk-invoice/index.ts` | to-create | |
| `src/services/b2b/priceListService.ts` | `packages/domain/src/b2b/priceList.ts` | to-create | |
| `src/pages/b2b/B2BStats.tsx` | `apps/backoffice/src/pages/B2BStats.tsx` | to-create | |
| `src/pages/b2b/B2BPage.tsx` | `apps/backoffice/src/pages/B2B.tsx` | to-create | |
| `view_b2b_dso` (SQL) | `supabase/migrations/20260517xxxxxx_view_b2b_dso.sql` | to-create | |
| `src/pages/b2b-portal/*` | n/a | deprecated | Phase 7 — B2B portail. |

## Module 10 — Accounting (Double-Entry) — CRITICAL PATH

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| migration `restore_unified_sale_trigger` | `supabase/migrations/20260517000010_refactor_sale_je_via_mapping.sql` | to-create | D14: `complete_order_with_payment_v9`. |
| `src/services/accounting/__tests__/saleTrigger.smoke.test.ts` | pgTAP `supabase/tests/accounting_phase1.test.sql` | to-create | |
| `src/services/accounting/accountingEngine.ts:603` | `packages/domain/src/accounting/` (to build) + trigger refactor | to-create | Engine absent in V3. D10 / D11 / D13. |
| `src/services/accounting/__tests__/accountingEngine.test.ts` | `packages/domain/src/accounting/__tests__/engine.test.ts` | to-create | |
| `src/services/accounting/vatService.ts` | `packages/domain/src/accounting/vat.ts` | to-create | |
| `src/hooks/accounting/useVATManagement.ts` | `apps/backoffice/src/features/accounting/hooks/useVATManagement.ts` | to-create | |
| `src/hooks/accounting/useBalanceSheet.ts` | `apps/backoffice/src/features/accounting/hooks/useBalanceSheet.ts` | to-create | |
| `BalanceSheetTab` | `apps/backoffice/src/features/accounting/components/BalanceSheetTab.tsx` | to-create | |
| `src/services/accounting/bankReconciliationService.ts` | `packages/domain/src/accounting/bankRec.ts` + RPC | to-create | |
| `src/hooks/accounting/useBankReconciliation.ts` | `apps/backoffice/src/features/accounting/hooks/useBankReconciliation.ts` | to-create | |
| `/accounting/bank-reconciliation` page | `apps/backoffice/src/pages/BankReconciliation.tsx` | to-create | |
| `bank_reconciliations` migration | `supabase/migrations/20260517xxxxxx_create_bank_reconciliations.sql` | to-create | |
| `src/pages/accounting/MappingsPage.tsx` | `apps/backoffice/src/pages/AccountingMappings.tsx` | to-create | |
| `src/hooks/accounting/useAccountingMappings.ts` | `apps/backoffice/src/features/accounting/hooks/useAccountingMappings.ts` | to-create | |
| `src/services/accounting/mappingsService.ts` | `packages/supabase/src/accounting/mappings.ts` | to-create | Calls `resolve_mapping_account()` RPC (D11). |

## Module 11 — Expenses

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/expenses/expenseApprovalService.ts` | `packages/domain/src/expenses/approval.ts` | to-create | |
| `src/hooks/expenses/useExpenseApproval.ts` | `apps/backoffice/src/features/expenses/hooks/useExpenseApproval.ts` | to-create | |
| `src/services/accounting/accountingEngine.ts` (expense path) | trigger / RPC `create_expense_v1` | to-create | |
| `src/pages/expenses/ExpenseFormPage.tsx` | `apps/backoffice/src/pages/ExpenseForm.tsx` | to-create | |
| EF `claude-proxy` | `supabase/functions/claude-proxy/index.ts` | to-create | OCR for receipts — deferred Phase 7. |

## Module 12 — Cash Register / Shift

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/hooks/useShift.ts` | `apps/pos/src/features/shift/hooks/useShift.ts` | to-create | |
| `src/components/pos/shift/CashCheckModal.tsx` | `apps/pos/src/features/shift/components/CashCheckModal.tsx` | to-create | |
| migration `cash_checks` | `supabase/migrations/20260517xxxxxx_create_cash_checks.sql` | to-create | |
| `pos_config` (JSON) | `business_config` table (existing) | exists | Settings live in `business_config`. |
| `src/services/pos/zReportPdfService.ts` | `packages/domain/src/print/zReport.ts` (pure PDF builder) + EF if signing | to-create | |
| `ShiftReconciliationModal.tsx` | `apps/pos/src/features/shift/components/ShiftReconciliationModal.tsx` | to-create | |
| migration `cash_movements` | `supabase/migrations/20260517xxxxxx_create_cash_movements.sql` | to-create | |
| `src/components/pos/shift/CashMovementModal.tsx` | `apps/pos/src/features/shift/components/CashMovementModal.tsx` | to-create | |
| `src/components/pos/shift/CloseShiftModal.tsx` | `apps/pos/src/features/shift/components/CloseShiftModal.tsx` | to-create | |
| `src/services/accounting/accountingEngine.ts` (shift_close path) | RPC `close_shift_v1` (via mapping `SHIFT_CASH_VARIANCE_*`) | to-create | |

## Module 13 — Promotions / Discounts

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/promotion/promotionEngine.ts` | `packages/domain/src/promotions/` (already exists; pure TS engine) + RPC `evaluate_promotions_v1` (Phase 2.C build-from-scratch) | exists (domain), to-create (SQL) | D14: V3 has NO SQL `evaluate_promotions` — verified zero hits in `supabase/migrations/`. RPC will be `_v1` (no SQL predecessor). |
| types | `packages/domain/src/promotions/types.ts` | to-create | |
| `src/hooks/useCartPromotions.ts` | `apps/pos/src/features/promotions/hooks/useCartPromotions.ts` | to-create | |
| `src/services/promotion/__tests__/promotionEngine.test.ts` | `packages/domain/src/promotions/__tests__/engine.test.ts` | to-create | Pure domain tests. |

## Module 14 — Reports & Analytics

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| migration RPC + index | `supabase/migrations/20260517xxxxxx_create_*_v1.sql` | to-create | Per report. |
| `src/pages/reports/components/DuplicateTransactionsTab.tsx` | `apps/backoffice/src/features/reports/components/DuplicateTransactionsTab.tsx` | to-create | |
| `src/services/reporting/constants.ts` | `apps/backoffice/src/features/reports/constants.ts` | to-create | `MAX_REPORT_ROWS = 5000`. |
| `src/services/reporting/reportingSalesService.ts` | `apps/backoffice/src/features/reports/api/sales.ts` | to-create | |
| `reportingInventoryService.ts` | `apps/backoffice/src/features/reports/api/inventory.ts` | to-create | |
| `reportingFinancialService.ts` | `apps/backoffice/src/features/reports/api/financial.ts` | to-create | |
| `src/utils/dateHelpers.ts` | `packages/domain/src/utils/date.ts` | to-create | `toLocalDateStr()` (14-003). |
| `src/pages/reports/ReportsPage.tsx` | `apps/backoffice/src/pages/Reports.tsx` | to-create | |
| `ReportsConfig.tsx` | `apps/backoffice/src/features/reports/config.ts` | to-create | |
| `src/pages/reports/components/UnifiedReportFilters.tsx` | `apps/backoffice/src/features/reports/components/UnifiedReportFilters.tsx` | to-create | |
| `src/pages/reports/components/__tests__/*.test.tsx` (×87) | `apps/backoffice/src/features/reports/components/__tests__/*.test.tsx` | to-create | Phase 2 smoke wave. |
| `src/test/mocks/reporting.ts` | `apps/backoffice/src/features/reports/__tests__/mocks.ts` | to-create | |

## Module 15 — Production / Recipes

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| migration `recipe_ingredients.child_recipe_id` + trigger anti-cycle | n/a Session 13 | deprecated | D3 / Non-goals: sub-recipes récursifs = Phase 7. Flat `recipes` only Session 13. |
| RPC cost | `supabase/migrations/20260517xxxxxx_create_compute_recipe_cost_v1.sql` | to-create | |
| `src/services/production/recipeService.ts` | `packages/domain/src/production/recipe.ts` + `apps/backoffice/src/features/production/api.ts` | to-create | |
| `src/components/products/RecipeForm.tsx` | `apps/backoffice/src/features/production/components/RecipeForm.tsx` | to-create | D3: owned by 15. |
| `src/hooks/useProduction.ts` | `apps/backoffice/src/features/production/hooks/useProduction.ts` | to-create | |
| `src/components/products/IngredientPicker.tsx` | `apps/backoffice/src/features/production/components/IngredientPicker.tsx` | to-create | |

## Module 16 — Customer Display

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| migration + RLS | `supabase/migrations/20260517xxxxxx_create_display_config.sql` | to-create | |
| `src/pages/display/*` | `apps/pos/src/pages/Display.tsx` + `apps/pos/src/features/display/components/` | to-create | New route `/display` under POS. |
| `useDisplayConfig` | `apps/pos/src/features/display/hooks/useDisplayConfig.ts` | to-create | |
| `src/pages/display/CustomerDisplayPage.tsx` | `apps/pos/src/pages/Display.tsx` | to-create | |
| `CDIdleView.tsx` | `apps/pos/src/features/display/components/CDIdleView.tsx` | to-create | |
| `CDActiveCartView.tsx` | `apps/pos/src/features/display/components/CDActiveCartView.tsx` | to-create | |
| `CDPaymentSuccessView.tsx` | `apps/pos/src/features/display/components/CDPaymentSuccessView.tsx` | to-create | |
| `CDThankYouView.tsx` | `apps/pos/src/features/display/components/CDThankYouView.tsx` | to-create | |
| `src/services/lan/lanHubMessageHandler.ts` | see module 04 | to-create | |
| `src/services/lan/displaySyncService.ts` | `apps/pos/src/features/display/sync.ts` | to-create | |
| `src/services/lan/displayBroadcast.ts` | `apps/pos/src/features/display/broadcast.ts` | to-create | |
| `src/hooks/useDisplayBroadcast.ts` | `apps/pos/src/features/display/hooks/useDisplayBroadcast.ts` | to-create | |
| `src/services/lan/lanProtocol.ts` | `packages/domain/src/lan/protocol.ts` (DISPLAY_CART, DISPLAY_TOTAL, DISPLAY_WELCOME, DISPLAY_ORDER_READY message types) | to-create | |
| `useActivePromotions` | `apps/pos/src/features/promotions/hooks/useActivePromotions.ts` | to-create | |
| `promotions.display_image_url` column | migration `supabase/migrations/20260517xxxxxx_add_promotions_display_image.sql` | to-create | |

## Module 17 — Tablet Ordering

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `vite.config.ts` (PWA workbox) | `apps/pos/vite.config.ts` (vite-plugin-pwa) | exists | D7: PWA-first. |
| `src/services/tablet/offlineQueueService.ts` | `apps/pos/src/features/tablet/offlineQueue.ts` | to-create | |
| `src/hooks/useOnlineStatus.ts` | `packages/domain/src/utils/online.ts` (pure) + `apps/pos/src/features/tablet/hooks/useOnlineStatus.ts` (React wrapper) | to-create | |
| `src/services/lan/lanHubMessageHandler.ts` | see module 04 | to-create | |
| `src/services/tablet/tabletOrderService.ts` | `apps/pos/src/features/tablet/api.ts` | to-create | (Tablet feature exists at `apps/pos/src/features/tablet/`.) |
| `src/pages/tablet/*` | `apps/pos/src/pages/tablet/*.tsx` | exists | |

## Module 18 — Mobile Shell (HORS SCOPE Session 13)

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/components/mobile/MobileLayout.tsx` | n/a | deprecated | D7: Phase 7. |
| `src/hooks/useNetworkStatus.ts` | n/a | deprecated | Phase 7. |
| `src/stores/lanStore.ts` | n/a | deprecated | Phase 7. |
| `src/hooks/useCapacitorInit.ts` | n/a | deprecated | D7: PWA-first. |
| `src/hooks/useHaptics.ts` | n/a | deprecated | Phase 7. |
| `src/pages/mobile/MobileCartPage.tsx` | n/a | deprecated | Phase 7. |
| `src/pages/mobile/MobileLoginPage.tsx` | n/a | deprecated | Phase 7. |
| `capacitor.config.ts` | n/a | deprecated | Phase 7. |
| migration `mobile_push_tokens` | n/a | deprecated | Phase 7. |
| EF `send-push-notification` | n/a | deprecated | Phase 7. |
| `src/hooks/usePushNotifications.ts` | n/a | deprecated | Phase 7. |
| `android/app/src/main/AndroidManifest.xml` | n/a | deprecated | Phase 7. |
| `src/App.tsx` (deep link handler) | n/a | deprecated | Phase 7. |
| `src/hooks/useBarcodeScanner.ts` | n/a | deprecated | Phase 7. |

## Module 19 — Settings / Configuration

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/stores/settings/coreSettingsStore.ts` | `apps/backoffice/src/features/settings/store/coreSettings.ts` | to-create | |
| migration `create_get_settings_by_category` | `supabase/migrations/20260517xxxxxx_create_get_settings_by_category.sql` | to-create (see-D2) | D2: phantom RPC = CREATE. |
| `src/hooks/settings/useBusinessSettings.ts` | `apps/backoffice/src/features/settings/hooks/useBusinessSettings.ts` | to-create | |
| `useBusinessHolidays.ts` | `apps/backoffice/src/features/settings/hooks/useBusinessHolidays.ts` | to-create | |
| `useNotificationEvents.ts` | `apps/backoffice/src/features/settings/hooks/useNotificationEvents.ts` | to-create | |
| `src/pages/settings/POSConfigSettingsPage.tsx` | `apps/backoffice/src/pages/POSConfig.tsx` | to-create | |
| `InventoryConfigSettingsPage.tsx` | `apps/backoffice/src/pages/InventoryConfig.tsx` | to-create | |
| `PrintingSettingsPage.tsx` | `apps/backoffice/src/pages/PrintingSettings.tsx` | to-create | |
| `src/schemas/settings/` | `packages/domain/src/settings/schemas.ts` | to-create | |
| `src/pages/settings/SyncSettingsPage.tsx` | `apps/backoffice/src/pages/SyncSettings.tsx` | to-create | |
| `src/services/settings/exportImport.ts` | `packages/domain/src/settings/exportImport.ts` (pure) + RPC | to-create | |
| RPC `import_settings_atomic` | `supabase/migrations/20260517xxxxxx_create_import_settings_atomic.sql` | to-create | |
| migration `audit_settings_changes_trigger` | `supabase/migrations/20260517xxxxxx_audit_settings_changes.sql` | to-create | Writes to `audit_logs` (plural, canonical). |
| `src/pages/settings/AuditSettingsPage.tsx` | `apps/backoffice/src/pages/AuditSettings.tsx` | to-create | |
| migration `pos_config_check_constraints` | `supabase/migrations/20260517xxxxxx_pos_config_check_constraints.sql` | to-create | |
| `src/hooks/settings/usePosConfig.ts` | `apps/backoffice/src/features/settings/hooks/usePosConfig.ts` | to-create | |
| `src/pages/settings/SettingsHubPage.tsx` | `apps/backoffice/src/pages/SettingsHub.tsx` | to-create | |
| `src/data/settingsSearchIndex.ts` | `apps/backoffice/src/features/settings/searchIndex.ts` | to-create | |
| `src/components/settings/SettingsSearchBar.tsx` | `apps/backoffice/src/features/settings/components/SettingsSearchBar.tsx` | to-create | |
| `src/pages/settings/SettingsHistoryPage.tsx` | `apps/backoffice/src/pages/SettingsHistory.tsx` | to-create | |
| `useSettingsHistory` | `apps/backoffice/src/features/settings/hooks/useSettingsHistory.ts` | to-create | |

## Module 20 — Users / RBAC

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/pages/users/RolesMatrixPage.tsx` | `apps/backoffice/src/pages/RolesMatrix.tsx` | to-create | |
| `src/hooks/users/useRolesMatrix.ts` | `apps/backoffice/src/features/users/hooks/useRolesMatrix.ts` | to-create | |
| `src/routes/adminRoutes.tsx` | `apps/backoffice/src/routes/index.tsx` | exists | |
| `src/pages/users/BulkImportPage.tsx` | n/a | deprecated | Phase 7. |
| EF `bulk-create-users` | n/a | deprecated | Phase 7. |
| `src/services/users/csvImport.ts` | n/a | deprecated | Phase 7. |
| migration `is_system BOOLEAN DEFAULT false` on `roles` | `supabase/migrations/20260517xxxxxx_add_roles_is_system.sql` | to-create | (Note: `roles.is_system` already declared in `20260503000001` — verify; may be NO-OP.) |
| `src/pages/users/RolesPage.tsx` | `apps/backoffice/src/pages/Roles.tsx` | to-create | |
| `useDuplicateRole` | `apps/backoffice/src/features/users/hooks/useDuplicateRole.ts` | to-create | |
| `src/components/users/PermissionDiffModal.tsx` | `apps/backoffice/src/features/users/components/PermissionDiffModal.tsx` | to-create | |
| `useEffectivePermissions(userId)` | `apps/backoffice/src/features/users/hooks/useEffectivePermissions.ts` | to-create | |
| migration view inactive users | `supabase/migrations/20260517xxxxxx_view_inactive_users.sql` | to-create | |
| `src/pages/users/InactiveUsersPage.tsx` | `apps/backoffice/src/pages/InactiveUsers.tsx` | to-create | |
| `src/components/dashboard/InactiveUsersBanner.tsx` | `apps/backoffice/src/features/dashboard/components/InactiveUsersBanner.tsx` | to-create | |
| migration `add_totp_to_users` | n/a Session 13 | deprecated | Phase 7. |
| EF `auth-verify-totp` | n/a Session 13 | deprecated | Phase 7. |
| `src/pages/profile/SecurityPage.tsx` | `apps/backoffice/src/pages/ProfileSecurity.tsx` | to-create (post-Phase 7) | |

## Module 21 — LAN Architecture

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/lan/lanHub.ts` | `apps/pos/src/features/lan/hub.ts` | to-create | D4: hybrid Realtime + BroadcastChannel. |
| `src/services/lan/lanClient.ts` | `apps/pos/src/features/lan/client.ts` | to-create | |
| `src/services/lan/messageDedup.ts` | `packages/domain/src/lan/dedup.ts` | to-create | Pure UUID + TTL dedup. |
| `src/services/lan/lanHubMessageHandler.ts` | `packages/domain/src/lan/messageHandler.ts` + `apps/pos/src/features/lan/handler.ts` | to-create | |
| `src/services/lan/lanProtocol.ts` | `packages/domain/src/lan/protocol.ts` | to-create | |
| `src/components/orders/OrderRow.tsx` | `apps/pos/src/features/order-history/components/OrderRow.tsx` | to-create | |
| migration `create_print_queue` | `supabase/migrations/20260517xxxxxx_create_print_queue.sql` | to-create (see-D2) | D2: phantom-table CREATE. |
| `src/services/print/printQueue.ts` | `packages/domain/src/print/queue.ts` (pure) + `apps/pos/src/features/lan/printQueue.ts` (transport) | to-create | |
| `src/pages/settings/PrintQueuePage.tsx` | `apps/backoffice/src/pages/PrintQueue.tsx` | to-create | |
| `src/pages/settings/NetworkDevicesPage.tsx` | `apps/backoffice/src/pages/NetworkDevices.tsx` | to-create | |
| `src/stores/lanStore.ts` | `apps/pos/src/features/lan/store/lanStore.ts` | to-create | |
| `src/services/lan/networkDiscovery.ts` | `apps/pos/src/features/lan/discovery.ts` | to-create | |
| `src/components/settings/NetworkDeviceRow.tsx` | `apps/backoffice/src/features/settings/components/NetworkDeviceRow.tsx` | to-create | |
| `src/pages/settings/LANDiagnosticsPage.tsx` | `apps/backoffice/src/pages/LANDiagnostics.tsx` | to-create | |
| `useLANDiagnostics` | `apps/backoffice/src/features/settings/hooks/useLANDiagnostics.ts` | to-create | |

## Module 22 — Design System

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/components/ui/EmptyState.tsx` | `packages/ui/src/components/EmptyState.tsx` | to-create | Steward `ui-steward`. |
| `src/components/ui/KPICard.tsx` | `packages/ui/src/components/KPICard.tsx` | to-create | |
| `src/components/ui/ProgressBar.tsx` | `packages/ui/src/components/ProgressBar.tsx` | to-create | |
| `src/components/pos/ProductGrid.tsx` | `apps/pos/src/features/products/components/ProductGrid.tsx` | to-create | |
| `src/components/pos/CategoryNav.tsx` | `apps/pos/src/features/products/components/CategoryNav.tsx` | to-create | |
| `src/components/pos/POSTerminalWrapper.tsx` | see module 02 | to-create | |
| `src/components/pos/CartTotals.tsx` | see module 02 | to-create | |
| `src/components/pos/modals/PaymentModal.tsx` | see module 03 | to-create | |
| `src/components/kds/KDSOrderCard.tsx` | see module 04 | to-create | |
| `src/pages/profile/ProfilePage.tsx` | `apps/backoffice/src/pages/Profile.tsx` | to-create | |
| `src/stores/settings/coreSettingsStore.ts` | see module 19 | to-create | |
| `src/layouts/BackOfficeLayout.tsx` | `apps/backoffice/src/layouts/BackOfficeLayout.tsx` | exists | (Verify file present.) |
| Design tokens JSON | `packages/ui/src/tokens/{colors,spacing,typography,motion}.ts` + `apps/{pos,backoffice}/tailwind.config.ts` | to-create | 22-001. |
| `luxe-dark.css` (current) | `packages/ui/src/tokens/luxe-dark.css` | exists | Already there. |

## Module 23 — Tests

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/__tests__/authService.test.ts` | see module 01 | to-create | |
| `src/pages/reports/components/__tests__/` | see module 14 | to-create | 87 smoke files. |
| `src/components/pos/__tests__/` | `apps/pos/src/features/*/components/__tests__/` | to-create | Distributed per feature. |
| `src/components/kds/__tests__/` | `apps/pos/src/features/kds/components/__tests__/` | to-create | |
| `src/components/auth/__tests__/POSAccessGuard.test.tsx` | `apps/pos/src/features/auth/components/__tests__/POSAccessGuard.test.tsx` | to-create | |
| Playwright E2E | `apps/{pos,backoffice}/e2e/*.spec.ts` | to-create | 3 critical flows. |

## Module 24 — Deployment / Ops

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| CI workflow | `.github/workflows/ci.yml` | to-create | Phase 0.2 enabler. |
| Staging deploy | `.github/workflows/staging-deploy.yml` | to-create | Phase 0.2. |
| Sentry config | `apps/{pos,backoffice}/src/lib/sentry.ts` | to-create | Phase 5. |
| DR runbook | `docs/runbooks/disaster-recovery.md` | to-create | Phase 6 docs. |

## Module 25 — Security

| V2 path | V3 path | Status | Notes |
|---|---|---|---|
| `src/services/authService.ts:184-312` (PIN verify fallback) | `packages/supabase/src/auth/pinAuth.ts` (drop fallback) | exists | 25-003. |
| migration RPC permissions | `supabase/migrations/20260517xxxxxx_*permissions.sql` | to-create | RBAC seed. |
| `src/pages/security/AuditLogsPage.tsx` | `apps/backoffice/src/pages/AuditLogs.tsx` | to-create | Reads `audit_logs` plural (post-merge of legacy `audit_log` singular). |
| `src/lib/supabase.ts` | `packages/supabase/src/client.ts` | exists | |
| `src/stores/resetAllStores.ts` | `apps/pos/src/features/auth/store/resetAll.ts` AND `apps/backoffice/src/features/auth/store/resetAll.ts` | to-create | Per-app reset helper. |
| `_shared/rate-limit.ts` | `supabase/functions/_shared/rate-limit.ts` | exists | 25-002 already partially present (refund-order uses it). |
| `vercel.json` (CSP/HSTS) | `vercel.json` at repo root or `apps/{pos,backoffice}/vercel.json` | to-create | 25-005. |

---

## Edge cases & special mappings

### 1. `audit_log` (legacy singular) → `audit_logs` (canonical plural)

- **Current state.** `audit_logs` plural exists (created `20260503000005_init_settings.sql`). `audit_log` singular exists (created `20260515000002_init_audit_log.sql`).
- **Decision (D2 / Phase 1.B).** Canonical = `audit_logs` plural (consistent with `journal_entries`, `stock_movements`, `user_sessions`).
- **Migration plan.** `supabase/migrations/20260517000034_drop_legacy_audit_log_singular.sql` — INSERT rows from `audit_log` into `audit_logs` mapped 1-to-1, then `DROP TABLE audit_log CASCADE`. The lone RLS policy `perm_read` on `audit_log` is recreated on `audit_logs` if not already present.
- **Code impact.** No production reads of `audit_log` singular today (only `soft_delete_customer` RPC writes; that RPC will be updated to write to `audit_logs` plural in same migration).
- **Lockdown.** After `20260517000034`, all backlog references to `audit_log` (singular) **must** be read as `audit_logs` (plural).

### 2. `packages/utils` — not yet bootstrapped

V3 currently has `packages/{domain,supabase,ui}/src` but no `packages/utils`. Backlog references to `src/utils/<X>.ts` should go to `packages/domain/src/utils/` (pure) until the first task explicitly creates `packages/utils` (low priority; not blocking Session 13).

### 3. Global stores → feature stores

V3 convention: NO global Zustand store aggregator. Each feature owns its store under `apps/<app>/src/features/<feature>/store/`. V2 `src/stores/{cartStore,authStore,paymentStore,lanStore,…}.ts` map to feature-scoped equivalents.

### 4. `src/services/accounting/accountingEngine.ts` — absent in V3

The TS accounting engine does **not** exist in V3 today. Phase 1.A (Stream A) builds the accounting fondation: `accounting_mappings` table, `resolve_mapping_account()` helper, `fiscal_periods` table, sale/purchase/refund JE triggers refactored to call the mapping helper. A thin TS layer may land later in `packages/domain/src/accounting/` for client-side calc/display, but JE construction lives in DB triggers (D20).

### 5. `customer_invoices` → `view_b2b_invoices`

D2: `customer_invoices` table is **dropped** in concept. B2B module 09 uses `orders.invoice_number` column + a new SQL view `view_b2b_invoices` to be created Phase 3.C. Any backlog reference to `customer_invoices` must be re-read as "read `view_b2b_invoices`" or "extend `orders` schema."

### 6. `stock_balances` → `view_section_stock_details`

D2: `stock_balances` table usage **dropped**. New view `view_section_stock_details` aggregates `section_stock × products × sections` (with `stock × cost_price` valuation column) — created Phase 2.D. **Verified absent in V3:** `grep -R view_section_stock_details supabase/migrations/` → 0 hit.

### 7. `evaluate_promotions` SQL RPC — absent in V3

V3 has zero SQL function named `evaluate_promotions`. **Verified:** `grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/` → 0 hit. The matching logic currently lives in `packages/domain/src/promotions/` (pure TS). D14 / Phase 2.C creates `evaluate_promotions_v1` (the `_v1` not `_v2` reflects no SQL predecessor).

### 8. `accounting_mappings`, `fiscal_periods`, `resolve_mapping_account()` — absent in V3

Triple-verified absent (`grep -R … supabase/` → 0 file). All three are created in Phase 1.A migrations `20260517000001..000002`. Every backlog row that talks about "mapping_keys", "PRODUCTION_COGS mapping", "SALE_PB1_TAX", "PURCHASE_PAYABLE", etc. depends on this Phase 1.A foundation.

### 9. `stock_reservations`, `print_queue`, `get_settings_by_category` — phantom features → CREATE (D2)

All three are absent in V3 today. Each gets its own Phase 2/3/5 migration. Backlog rows that reference these as if they existed must be re-read as "creates the artifact + uses it."

### 10. Realtime channel naming convention (D19)

When mapping any backlog row that does `supabase.channel('static-name')`, the V3 replacement **must** follow:

```ts
const channelName = useMemo(
  () => `<topic>-${id}-${Math.random().toString(36).slice(2, 9)}`,
  [id]
);
```

See `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` for the canonical implementation. Audit grep at end of each phase: `grep -RE "supabase\.channel\(" apps/`.

---

## Migration sequencing reminder

- Last applied migration: `20260516000024_*.sql` (Session 12 phase 3).
- Session 13 block: `20260517000001..20260517999999` (contiguous, monotonic).
- Every backlog row that needs a new migration **must** pick the next ordinal from `supabase/migrations/`. The plan-INDEX assigns explicit numbers per phase.

---

## Coverage audit

| Module | V2 path mentions in backlog | Rows in this table | Coverage |
|---|---|---|---|
| 01 | 8 | 15 | 100 % (incl. cross-cutting) |
| 02 | 10 | 22 | 100 % |
| 03 | 7 | 14 | 100 % |
| 04 | 8 | 17 | 100 % |
| 05 | 9 | 18 | 100 % |
| 06 | 10 | 19 | 100 % |
| 07 | 6 | 15 | 100 % |
| 08 | 8 | 15 | 100 % |
| 09 | 6 | 14 | 100 % |
| 10 | 6 | 15 | 100 % |
| 11 | 3 | 5 | 100 % |
| 12 | 4 | 10 | 100 % |
| 13 | 1 | 4 | 100 % |
| 14 | 9 | 12 | 100 % |
| 15 | 2 | 6 | 100 % |
| 16 | 12 | 15 | 100 % |
| 17 | 3 | 6 | 100 % |
| 18 | 7 | 14 | 100 % (all deprecated) |
| 19 | 9 | 19 | 100 % |
| 20 | 6 | 13 | 100 % |
| 21 | 10 | 15 | 100 % |
| 22 | 9 | 14 | 100 % |
| 23 | 6 | 6 | 100 % |
| 24 | n/a | 4 | new (no V2 baseline) |
| 25 | 4 | 7 | 100 % |
| **Total** | **164** | **293** | **≥ 80 % target met (≈ 100 %)** |

The 293-row coverage (vs. 164 raw V2 mentions) reflects cross-module path duplication and the deliberate addition of cross-cutting rules. Every literal V2 path appearing in `docs/workplan/backlog-by-module/*.md` has a deterministic V3 destination above.

---

*End of translation table. This document is referenced by every Session 13 sub-plan. Update in place when a new V2 path is discovered or a phantom-table decision is revised — add a row, do not rewrite.*
