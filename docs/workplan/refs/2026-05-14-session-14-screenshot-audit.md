# Session 14 — Screenshot audit (122 refs → React files)

**Date:** 2026-05-14
**Source:** `docs/Design/{backoffice,caissapp}/*.jpg` (76 BO + 46 POS).
**Method:** Each screenshot mapped to its React file (existing or to-create) + Wave/Phase + gap level.

**Gap levels:**
- **L1 Polish** — file exists, structure matches, needs tokens/typo/spacing tweaks (~30min/screen)
- **L2 Rebuild** — file exists, structure ≠ ref, needs significant rewrite (~2h/screen)
- **L3 Create** — file doesn't exist or shell only, full implementation (~4h/screen)

---

## A. POS (`docs/Design/caissapp/` — 46 screenshots)

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `01-grid-bagel-empty-cart-dine-in.jpg` | `apps/pos/src/features/products/ProductGrid.tsx` + `cart/ActiveOrderPanel.tsx` | 2.A + 2.B | L2 |
| `02-grid-beverage-subcategory-landing.jpg` | `features/products/CategoryNav.tsx` + subcategory drill | 2.A | L2 |
| `03-grid-coffee-empty-cart.jpg` | `features/products/ProductGrid.tsx` | 2.A | L2 |
| `04-grid-coffee-cart-2items-table-t12.jpg` | `features/cart/ActiveOrderPanel.tsx` (dine-in table state) | 2.B | L2 |
| `05-grid-coffee-takeout-held-orders.jpg` | `features/cart/ActiveOrderPanel.tsx` (take-out + held orders bar) | 2.B | L2 |
| `06-grid-bread-takeout-promo-badges.jpg` | `features/products/ProductCard.tsx` (promo badge) | 2.A | L1 |
| `10-shift-no-open-alert.jpg` | `features/shift/ShiftClosedState.tsx` | 2.C | L2 |
| `11-shift-open-pin-modal.jpg` | `features/shift/OpenShiftModal.tsx` (PIN step) | 2.C | L2 |
| `12-shift-open-cash-modal-numpad.jpg` | `features/shift/OpenShiftModal.tsx` (cash numpad step) | 2.C | L2 |
| `13-shift-open-cash-modal-filled.jpg` | `features/shift/OpenShiftModal.tsx` (filled state) | 2.C | L1 |
| `20-modifier-americano-required-empty.jpg` | `features/products/ModifierGroupSelector.tsx` (required state) | 2.C | L2 |
| `21-modifier-americano-hot-selected.jpg` | `features/products/ModifierGroupSelector.tsx` (selected state) | 2.C | L1 |
| `22-modifier-flat-white-multi-group.jpg` | `features/products/ModifierGroupSelector.tsx` (multi-group layout) | 2.C | L2 |
| `23-modifier-vegetarian-bagel-no-modifiers.jpg` | `features/products/ProductCard.tsx` (no-modifier direct-add) | 2.C | L1 |
| `30-cart-active-2items-dine-in-totals.jpg` | `features/cart/CartLineRow.tsx` + `CartTotals.tsx` | 2.B | L2 |
| `31-cart-takeout-customer-bronze.jpg` | `features/cart/CustomerBadge.tsx` (bronze tier visual) | 2.B | L2 |
| `32-cart-locked-items-after-kitchen-send.jpg` | `features/cart/CartLineRow.tsx` (locked state) | 2.B | L2 |
| `40-floor-plan-no-selection.jpg` | `features/floor-plan/FloorPlanModal.tsx` | 2.D | L3 |
| `41-floor-plan-table-t12-selected.jpg` | `features/floor-plan/TableCell.tsx` (selected) | 2.D | L3 |
| `50-customer-attach-search-list.jpg` | `features/cart/CustomerAttachModal.tsx` | 2.B | L2 |
| `51-held-orders-takeaway-list.jpg` | `features/cart/HeldOrdersModal.tsx` | 2.B | L2 |
| `60-payment-terminal-method-selection.jpg` | `features/payment/PaymentMethodPicker.tsx` | 2.C | L2 |
| `61-payment-terminal-cash-entry-numpad.jpg` | `features/payment/CashEntryStep.tsx` (numpad) | 2.C | L2 |
| `62-payment-terminal-payment-added-success.jpg` | `features/payment/TenderListStep.tsx` (added state) | 2.C | L1 |
| `63-payment-success-modal.jpg` | `features/payment/PaymentSuccessModal.tsx` | 2.C | L2 |
| `70-cafe-stock-grid-all.jpg` | `features/products/POSStockView.tsx` | 2.D | L3 |
| `71-cafe-stock-classic-breads-filtered.jpg` | `features/products/POSStockView.tsx` (filtered state) | 2.D | L1 |
| `72-cafe-stock-item-received-5.jpg` | `features/products/POSStockReceiveModal.tsx` | 2.D | L3 |
| `73-cafe-stock-categories-settings.jpg` | `features/products/POSStockCategoriesSettings.tsx` | 2.D | L3 |
| `80-transaction-history-collapsed.jpg` | `features/order-history/OrderHistoryPanel.tsx` | 2.D | L2 |

*(Screenshots 07-09, 14-19, 24-29, 33-39, 42-49, 52-59, 64-69, 74-79, 81+ : numbered placeholders — to inventory if existing or fold into nearest phase.)*

---

## B. Backoffice (`docs/Design/backoffice/` — 76 screenshots)

### B1 — Dashboard + global layout

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `Dashboard.jpg` | `apps/backoffice/src/pages/Dashboard.tsx` | 4.A | L3 |
| `live order.jpg` | `pages/Dashboard.tsx` (live orders tile) + `features/orders/LiveOrdersList.tsx` | 4.A | L2 |
| `live order2.jpg` | idem (alternate state) | 4.A | L1 |
| `setting.jpg` | layout sidebar in `BackofficeLayout.tsx` (left nav reference) | 4.A | L2 |
| `setting page.jpg` | `pages/Settings/SettingsIndex.tsx` | 6.A | L3 |

### B2 — Products + Categories + Combos + Recipes + Units

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `09-stock-list.jpg` | `pages/inventory/StockListPage.tsx` | 4.C | L2 |
| `09b-product-detail-top.jpg` | `pages/products/ProductDetailPage.tsx` (header section) | 4.B | L2 |
| `09c-product-detail-bottom.jpg` | `pages/products/ProductDetailPage.tsx` (variants/stock) | 4.B | L2 |
| `product page.jpg` | `pages/products/ProductsListPage.tsx` | 4.B | L2 |
| `Product detail1.jpg` | `pages/products/ProductDetailPage.tsx` (variant A view) | 4.B | L1 |
| `product detail2.jpg` | `pages/products/ProductDetailPage.tsx` (variant B view) | 4.B | L1 |
| `product general 1.jpg` | `features/products/components/ProductGeneralTab.tsx` | 4.B | L2 |
| `product general 2.jpg` | idem (state 2) | 4.B | L1 |
| `product general 3.jpg` | idem (state 3) | 4.B | L1 |
| `product variant.jpg` | `features/products/components/ProductVariantsTab.tsx` | 4.B | L3 |
| `product costing.jpg` | `features/products/components/ProductCostingTab.tsx` | 4.B | L3 |
| `product recette.jpg` | `features/products/components/ProductRecipeTab.tsx` | 4.B | L2 |
| `product unit.jpg` | `pages/settings/UnitsPage.tsx` | 4.B | L3 |
| `productunit2.jpg` | idem (alternate) | 4.B | L1 |
| `product category.jpg` | `pages/products/CategoriesPage.tsx` | 4.B | L2 |
| `product stock detail.jpg` | `features/products/components/ProductStockTab.tsx` | 4.B | L2 |
| `product stock detail2.jpg` | idem (alternate) | 4.B | L1 |
| `product inventory historique.jpg` | `features/products/components/ProductHistoryTab.tsx` | 4.B | L3 |
| `combo management.jpg` | `pages/promotions/CombosListPage.tsx` | 4.B | L2 |
| `combo 2.jpg` | `features/combos/components/ComboFormStep1.tsx` | 4.B | L2 |
| `comboo 3.jpg` | `features/combos/components/ComboFormStep2.tsx` | 4.B | L2 |
| `edit combo 1.jpg` | `features/combos/components/ComboEditModal.tsx` | 4.B | L2 |

### B3 — Inventory module

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `09d-production-entry.jpg` | `pages/inventory/ProductionEntryPage.tsx` | 4.C | L2 |
| `09d2-production-entry-filled.jpg` | idem (filled state) | 4.C | L1 |
| `stock mouvement.jpg` | `pages/inventory/StockMovementsPage.tsx` | 4.C | L2 |
| `stock opname.jpg` | `pages/inventory/StockOpnamePage.tsx` | 4.C | L2 |
| `stock waste.jpg` | `pages/inventory/StockWastePage.tsx` | 4.C | L2 |
| `14-transfers-list.jpg` | `pages/inventory/TransfersListPage.tsx` | 4.C | L2 |
| `inventory report.jpg` | `pages/reports/InventoryReportPage.tsx` | 6.A | L3 |

### B4 — Purchasing + Suppliers

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `13-incoming-po-list.jpg` | `pages/purchasing/IncomingPOListPage.tsx` | 5.A | L2 |
| `13b-incoming-po-detail.jpg` | `pages/purchasing/IncomingPODetailPage.tsx` | 5.A | L2 |
| `15-suppliers-list.jpg` | `pages/purchasing/SuppliersListPage.tsx` | 5.A | L2 |
| `15b-supplier-detail-purchases.jpg` | `pages/purchasing/SupplierDetailPage.tsx` (purchases tab) | 5.A | L2 |
| `15c-supplier-detail-price-evolution.jpg` | idem (price evolution tab) | 5.A | L3 |
| `15d-supplier-detail-payments.jpg` | idem (payments tab) | 5.A | L3 |
| `15e-supplier-detail-analytics.jpg` | idem (analytics tab) | 5.A | L3 |
| `PO form.jpg` | `features/purchasing/components/POFormModal.tsx` | 5.A | L2 |
| `PO page.jpg` | `pages/purchasing/POIndexPage.tsx` | 5.A | L2 |
| `purshase order page.jpg` | `pages/purchasing/POListPage.tsx` | 5.A | L2 |
| `purshase order2.jpg` | idem (alternate view) | 5.A | L1 |
| `purshase report.jpg` | `pages/reports/PurchasingReportPage.tsx` | 6.A | L3 |

### B5 — B2B

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `btob dashboard.jpg` | `pages/b2b/B2BDashboardPage.tsx` | 5.B | L3 |
| `btob payment.jpg` | `pages/b2b/B2BPaymentPage.tsx` | 5.B | L3 |
| `BtoB setting.jpg` | `pages/b2b/B2BSettingsPage.tsx` | 5.B | L3 |

### B6 — Customers + Loyalty

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `customer.jpg` | `pages/customers/CustomersListPage.tsx` | 5.B | L2 |
| `customer edit.jpg` | `pages/customers/CustomerEditPage.tsx` | 5.B | L2 |
| `customer category.jpg` | `pages/customers/CustomerCategoriesPage.tsx` | 5.B | L2 |
| `customer display.jpg` | `apps/pos/src/features/display/CustomerDisplayView.tsx` (BO doc but POS surface) | 3.B | L3 |
| `loyalty programm.jpg` | `pages/loyalty/LoyaltyProgramPage.tsx` | 5.B | L2 |

### B7 — Expenses

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `expenses.jpg` | `pages/expenses/ExpensesListPage.tsx` | 5.A | L2 |
| `expenses category.jpg` | `pages/expenses/ExpensesCategoriesPage.tsx` | 5.A | L2 |

### B8 — KDS configuration

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `kds configue.jpg` | `pages/settings/KdsConfigPage.tsx` | 6.A | L3 |

### B9 — Reports (financial + operations + audit)

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `report.jpg` | `pages/reports/ReportsIndex.tsx` | 6.A | L2 |
| `report finance.jpg` | `pages/reports/{ProfitLoss,BalanceSheet,CashFlow}Page.tsx` | 6.A | L2 |
| `operations report.jpg` | `pages/reports/OperationsReportPage.tsx` | 6.A | L3 |
| `log report.jpg` | `pages/reports/AuditPage.tsx` | 6.A | L2 |

### B10 — Settings (general + payment + printer + pos)

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `pos setting.jpg` | `pages/settings/PosSettingsPage.tsx` | 6.A | L3 |
| `payment setting.jpg` | `pages/settings/PaymentSettingsPage.tsx` | 6.A | L3 |
| `printer setting.jpg` | `pages/settings/PrinterSettingsPage.tsx` | 6.A | L3 |

### B11 — Users + Roles

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `user.jpg` | `pages/users/UsersListPage.tsx` | 6.A | L2 |
| `edit user.jpg` | `pages/users/UserDetailPage.tsx` | 6.A | L2 |
| `role et permission.jpg` | `pages/users/PermissionsMatrixPage.tsx` | 6.A | L2 |

### B12 — Misc (`Capture d'écran ...`)

8 screenshots à inventaire manuel — probablement plan de table, KDS variants, ou états d'écrans déjà mappés ailleurs. À traiter au début de chaque wave concernée pour ne pas oublier.

| Ref | React file | Phase | Gap |
|---|---|---|---|
| `plan de table.jpg` | `apps/pos/src/features/floor-plan/FloorPlanModal.tsx` (BO ou tablet view ?) | 2.D / 3.C | L2 |
| `Capture d'écran 2026-05-01 220247.jpg` | TO INVENTORY (assigned to whichever Wave bucket fits) | TBD | TBD |
| `Capture d'écran 2026-05-01 220806.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222321.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222718.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222733.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222749.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222833.jpg` | TO INVENTORY | TBD | TBD |
| `Capture d'écran 2026-05-01 222849.jpg` | TO INVENTORY | TBD | TBD |

---

## C. Gap level distribution

| Gap | Count | Phases | Approx hours |
|---|---|---|---|
| L1 Polish (~30min) | ~15 | All | ~7h |
| L2 Rebuild (~2h) | ~50 | All | ~100h (parallel-discounted to ~40h) |
| L3 Create (~4h) | ~20 | All | ~80h (parallel-discounted to ~25h) |
| TBD (Capture d'écran) | 8 | TBD | TBD |
| **TOTAL** | **~93 mapped** | | **~70-100h** |

*(122 screenshots total, ~30 are duplicates/alternates of mapped ones.)*

---

---

## D. Wave 1 close-out addendum (2026-05-14 post-commit)

After Wave 1 (12 commits, branch `swarm/session-14`), we re-inventoried `docs/Design/` (commit `f6d48fc` added 122 screenshots). The original audit (sections A-C) covered ~93 screens. This addendum maps the **30 additional screens** discovered and surfaces 2 design findings that revise the spec D7.

### D1 — Additional POS / caissapp screens (16 new)

| Ref | Description | React file | Phase | Gap |
|---|---|---|---|---|
| `81-transaction-history-expanded-refund.jpg` | Expanded order row + refund action | `apps/pos/src/features/order-history/OrderDetailPanel.tsx` | 2.D | L2 |
| `82-pos-reports-overview-today.jpg` | POS-side mini-reports : today overview | `apps/pos/src/features/reports/POSReportsOverviewPage.tsx` (CREATE) | 2.D | L3 |
| `83-pos-reports-products-month.jpg` | POS-side reports : products this month | `apps/pos/src/features/reports/POSProductsReportPage.tsx` (CREATE) | 2.D | L3 |
| `84-pos-reports-activity-month.jpg` | POS-side reports : activity (sessions/cash) | `apps/pos/src/features/reports/POSActivityReportPage.tsx` (CREATE) | 2.D | L3 |
| `85-pos-settings-general.jpg` | POS-side settings tab : general | `apps/pos/src/features/settings/POSSettingsPage.tsx` (CREATE) | 2.D | L3 |
| `86-pos-outstanding-customer-debts.jpg` | Tableau dettes clients outstanding (B2B view inside POS) | `apps/pos/src/features/customers/CustomerDebtsPanel.tsx` (CREATE) | 2.D | L3 |
| `87-side-menu-drawer.jpg` | Drawer hamburger menu side du POS (nav vers history/reports/settings/debts/customers/sessions modals) | `apps/pos/src/features/nav/SideMenuDrawer.tsx` (CREATE) | 2.A | L3 |
| `88-live-sessions-modal.jpg` | Modal showing live POS sessions (cashier connections) | `apps/pos/src/features/shift/LiveSessionsModal.tsx` (CREATE) | 2.C | L3 |
| `90-split-how-many-payers-entry.jpg` | Split flow step 1 : "HOW MANY PAYERS?" 2/3/4/5 guests grid (centered, dark theatrical) | `apps/pos/src/features/payment/split/PayerCountStep.tsx` (CREATE) | 2.C | L3 |
| `91-split-assign-items-empty.jpg` | Split flow step 2 : item assignment grid (empty initial state) | `apps/pos/src/features/payment/split/ItemAssignStep.tsx` (CREATE) | 2.C | L3 |
| `92-split-how-many-payers-revisit.jpg` | Revisit du step 1 (changing payer count mid-flow) | idem | 2.C | L2 |
| `93-split-assign-items-client1-bagel.jpg` | Step 2 with 1 item assigned to Client 1 | idem | 2.C | L1 |
| `94-split-payment-per-payer-method.jpg` | Split flow step 3 : per-payer method picker | `apps/pos/src/features/payment/split/PerPayerMethodStep.tsx` (CREATE) | 2.C | L3 |
| `95-split-payment-per-payer-cash-entry.jpg` | Per-payer cash numpad entry | `apps/pos/src/features/payment/split/PerPayerCashStep.tsx` (CREATE) | 2.C | L3 |
| `Capture d'écran 2026-05-01 215219.jpg` | **POS Login page** — "STAFF PIN ACCESS", **croissant illustration logo** (not "B"), user picker with switch, dot indicators for PIN, full numpad, "SIGN IN" gold CTA, "Switch to Email Login" link | `apps/pos/src/pages/Login.tsx` | 2.C | L3 |
| `Capture d'écran 2026-05-01 222912.jpg` | **KDS station view** — "HOT KITCHEN" header, "1 ORDER" + "1 Urgent" badges, order card with order#, dine-in indicator, age timer JetBrains Mono, items list, "START" gold CTA, "WAITING (0)" sub-section. **Sound icon + refresh** in top-right. **MAY 1, 2026** date display. | `apps/pos/src/features/kds/KdsStationPage.tsx` | 3.A | L2 |

### D2 — Additional Backoffice screens (8 new "Capture d'écran" captures)

| Ref | Description | React file | Phase | Gap |
|---|---|---|---|---|
| `Capture d'écran 2026-05-01 220247.jpg` | **Product Detail — Purchase tab** : "Almond Slice" SKU SEE-004, tabs OVERVIEW/GENERAL/UNITS/RECIPE/VARIANTS/COSTING/PURCHASE/HISTORY, Purchase History table empty, "Last purchase price IDR 0/kg", "SAVE CHANGES" gold CTA. Sidebar sections **OPERATIONS / MANAGEMENT / ADMIN** with notification bell badge (20). | `apps/backoffice/src/pages/products/ProductDetailPage.tsx` (PURCHASE tab) | 4.B | L3 |
| `Capture d'écran 2026-05-01 220806.jpg` | **Live Orders / Order History page** : KPI strip (Total Orders 100, Total Amount Rp 9 879 000, Completion 51%, Paid 49 Rp 5.268M, Unpaid 51 Rp 4.619M), filter chips (All / New / Preparing / Ready / Completed / Cancelled), date range, type+payment dropdowns, table with status badges + payment icons + Details actions, "Refresh" + "Export" top-right. | `apps/backoffice/src/pages/orders/LiveOrdersPage.tsx` (CREATE — different from Order History) | 4.A | L3 |
| `Capture d'écran 2026-05-01 222321.jpg` | **Settings — Product Types tab** : sub-nav with sections **GENERAL / SALES & POS / OPERATIONS / COMMERCE / SYSTEM / LAYOUT**. Table of product types (finished/raw_material/semi_finished). "Add Type" gold CTA. Search bar at top. | `apps/backoffice/src/pages/settings/ProductTypesPage.tsx` (CREATE) | 6.A | L3 |
| `Capture d'écran 2026-05-01 222718.jpg` | **Settings — Audit Trail page** : Date range filter (Today / Last 7 days / Last 30 days dropdown), "All Team Members" filter, filter chips (All/Auth/POS/Sales/Inventory/Products/Users/Settings), "Export CSV" gold CTA. Same Settings sub-nav. | `apps/backoffice/src/pages/settings/AuditLogPage.tsx` (replaces/extends current AuditPage) | 6.A | L2 |
| `Capture d'écran 2026-05-01 222733.jpg` | Likely Settings continuation — TO INVENTORY at start of Phase 6.A | TBD | 6.A | TBD |
| `Capture d'écran 2026-05-01 222749.jpg` | Likely Settings continuation — TO INVENTORY at start of Phase 6.A | TBD | 6.A | TBD |
| `Capture d'écran 2026-05-01 222833.jpg` | Likely Settings continuation — TO INVENTORY at start of Phase 6.A | TBD | 6.A | TBD |
| `Capture d'écran 2026-05-01 222849.jpg` | Likely Settings continuation — TO INVENTORY at start of Phase 6.A | TBD | 6.A | TBD |

### D3 — Critical design findings revising spec D7

**Finding 1 — Brand asset is dual:**
- **Brand Illustration** (illustrated croissant + "THE BREAKERY" wordmark + "French Bakery & Pastry" tagline) — used for **POS Login** (centered, large) and **BO sidebar header** (compact above section nav).
- **BrandMark "B"** (the round gold circle with Playfair italic B that we built in 1.A) — used for **smaller surfaces** : POS top-left header (40px), KDS top-left, tablet top-left, Customer Display empty states.

The illustrated croissant needs a separate SVG asset — `packages/ui/src/assets/brand-illustration.svg` or `brand-logo.svg` — distinct from `brand-mark.svg` (the B mark).

**Finding 2 — BO sidebar uses section labels:**
The actual canonical BO sidebar is **3-section grouped** :
- **OPERATIONS** (Dashboard, POS Terminal, Kitchen Display, Products, Stock & Inventory, Order History, B2B Wholesale, Purchases, Suppliers, Expenses, Customers)
- **MANAGEMENT** (Reports, Accounting)
- **ADMIN** (Users)

Section headers are `SectionLabel size="xs"` (already built in 1.A). The current `BackofficeLayout.tsx` flat list must be re-grouped in **Phase 4.A** with this structure.

**Finding 3 — Settings page sub-nav is multi-section** :
The Settings page has its own sidebar with 6 sections (GENERAL / SALES & POS / OPERATIONS / COMMERCE / SYSTEM / LAYOUT) covering ~25 settings sub-pages. This is bigger than initially scoped in Phase 6.A. Phase 6.A may need to be split into 6.A1 (settings infrastructure + sub-nav) and 6.A2 (remaining audit/reports/users) — re-evaluate at start of Wave 6.

**Finding 4 — POS side-menu drawer is a master nav:**
The POS isn't just product grid + cart — there's a hamburger drawer at top-left that opens to nav links: Order History, Live Sessions, Live Reports, Outstanding Debts, Customer List, Settings, etc. This drawer (`87-side-menu-drawer.jpg`) needs to be built in Phase 2.A (currently scoped as just "main grid"). It's a substantial component (~L3).

### D4 — Revised effort estimate

Original Wave 0 audit estimated ~70-100h total. With 30 additional screens (mostly L3) and 2 new components (croissant illustration + side-menu drawer), revised estimate :

| Wave | Original h | Revised h | Notes |
|---|---|---|---|
| 1 | 21 | 21 | DONE |
| 2 | 7 (parallel) | 10-12 (parallel) | +split flow (5 screens), +side menu drawer, +POS reports/settings/debts (4 screens) |
| 3 | 4 | 4-5 | KDS station view confirmed L2 (not L3) — files already exist |
| 4 | 10 | 12-14 | +Live Orders page (Order History split), +BO sidebar re-grouping with sections |
| 5 | 10 | 10 | Unchanged |
| 6 | 15 | 18-22 | +Settings sub-nav scaffolding (6 sections, 25 sub-pages) |
| **TOTAL** | **~70** | **~85** | **+15h** for finer-grained UX coverage |

Still within initial 60-100h envelope.

---

## E. How to use this audit

When picking up a phase :
1. Open the audit table filter to your phase (e.g. all rows tagged Phase 2.A).
2. For each row, open the screenshot side-by-side with the React file.
3. Apply changes respecting the [spec D1-D15](../specs/2026-05-14-session-14-spec.md) decisions.
4. Mark the row gap as ✓ done in this doc (append-only edit, datestamped).
5. Commit per Wave (e.g. all 2.A screens done = squash-merge phase branch).
