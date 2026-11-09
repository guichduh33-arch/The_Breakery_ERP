---
target: critique module BO
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-04T21-09-15Z
slug: apps-backoffice
---
Method: dual-agent (A: Explore design review, source-only · B: Explore detector + Explore browser measurements on the logged-in tab)

Target: `apps/backoffice`, working tree of branch `fix/bo-menage-visuel` (uncommitted field-height changes included). Mode: **Operate**. Agent A could not use the browser: the login lives in per-tab `sessionStorage`, so a new tab is always logged out. Agent B measured 17 pages in the logged-in tab at 1440 and 1280 px.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live regions and honest "unknown, not zero" copy are strong. Three pages still show a bare `Loading…` instead of skeletons. |
| 2 | Match System / Real World | 3 | Raw ISO dates (`2026-09-04`) in the journal, the movements ledger and PO payment history. Raw enum `POS_SALE` in the movements TYPE column. A ticket ID in Promo ROI copy. |
| 3 | User Control and Freedom | 3 | Command palette caps each section at 5 hits with no "more" indicator. Product rows open on click only, with no keyboard path. |
| 4 | Consistency and Standards | 2 | Label role renders in two typefaces on the same screen. 15 distinct button heights. 4 date formats. Money in sans on the PO detail. |
| 5 | Error Prevention | 3 | Void modal and expense rail are strong. In the row menu, `Void order` sits 0 px under `View details` with no separator. Expense copy says "when you submit" over a button that says "Save as draft". |
| 6 | Recognition Rather Than Recall | 3 | Reports are grouped one way in the nav panel and another way on the index page. Two counter strips share identical chrome but only one is clickable. |
| 7 | Flexibility and Efficiency | 3 | Palette, URL filters, column chooser. No recents in the palette, no saved views, 5-hit cap. |
| 8 | Aesthetic and Minimalist Design | 3 | The instrument look holds. The Reports panel is 39 links in 5 columns, 16 in one column. |
| 9 | Error Recovery | 4 | Error banners overlay the rows instead of replacing them. Permission errors become sentences. |
| 10 | Help and Documentation | 2 | Counter definitions ("voided included") live only in `title=` tooltips. No keyboard or touch path to them. |
| **Total** | | **29/40** | **Good, uneven by domain** |

## Design Specificity Verdict

**LLM assessment (A):** authored for this product, not interchangeable. The UI says "unknown, not zero" as a rendering rule; the number locale has a written argument in `packages/utils/src/format.ts`; the ink/gold/mono system is enforced at token level. The gap is propagation: the primitives and about 8 flagship pages carry the system; about 70 hand-rolled tables and 144 files write the label style by hand and drift.

**Deterministic scan (B):** `detect.mjs --json apps/backoffice/src` exit 2, 8 findings, all pre-arbitrated (7 × `design-system-font-size` in `apps/backoffice/src/index.css`, login screen; 1 × `border-accent-on-rounded` at `SettingsFloorPlanPage.tsx:49`, known false positive). Net new: 0. Repo guards: `hardcoded-theme-colors` and `tailwind-dead-classes` pass; `focus-ring-controls`, `gold-fills`, `lying-font-classes`, `toolbar-button-scope`, `tight-corner` crash locally because the deletion of `pages/ComingSoon.tsx` is unstaged and `scripts/ci/_guard-lib.mjs:239` reads every tracked file without an existence check. CI (fresh checkout) unaffected.

**Visual overlays:** none. The overlay live-server writes a script tag into the app's HTML entry; the session was read-only (plan mode). Evidence comes from computed-style measurements.

## Overall Impression

The 2026-08-31 P0 is gone: zero cell overlap on any page at 1440 and 1280. Filter bars are 36 px on every list page measured, so the branch's uncommitted work does what it says. What remains is formats the helpers already forbid but that still render, and one typeface split that cuts through the accounting screens. Biggest opportunity: one back-office `Label` wrapper plus one sweep of date and number call sites.

## What's Working

1. **The branch's change is verified live.** Orders 5 × 36 px, Journal 5 × 36, Trial balance 2 × 36, Cash 2 × 36, GL 3 × 36, Movements 3 × 36, Stock position 36, Promo ROI 3 × 36. Expense form 8 × 44 including the file input.
2. **Nothing lies about zero.** `Dashboard.tsx:266`, `PanelCard.tsx:79`, `JournalEntriesPage.tsx:141`. 0 console errors on 17 pages, 0 French leaks.
3. **Money is mono almost everywhere.** About 900 money nodes measured, 6 in sans.

## Priority Issues

### [P1] The Label role renders in two typefaces on the same screen
- **What.** Uppercase, letter-spaced ≤13 px text. Journal entries: 5 sans (From, To, Search, Source, Account) vs 6 mono (Date, Entry #, …). Trial balance 2 vs 6. Cash 3 vs 8. PO list 29 vs 11. Sans-only: GL, New expense (13), product detail (27), PO detail (18). Root: `packages/ui/src/components/SectionLabel.tsx` sets no font family; 312 hand-rolled `uppercase tracking-wid…` sites in 144 files carry no mono either.
- **Why it matters.** Mono-carries-data is the loudest identity claim; half the labels make the opposite claim.
- **Fix.** Back-office-local `Label` in `apps/backoffice/src/components/` composing `SectionLabel` with `font-data font-semibold`. Replace the 50 `as=` call sites in 24 files first, then filter labels. `packages/ui` untouched.
- Files: `apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx:208`, `features/products/components/GeneralPanel.tsx:100`, `features/expenses/components/ExpenseConsequenceRail.tsx:77`. Browser-verified.
- **Suggested command:** `/impeccable typeset`

### [P1] Formats the helpers forbid still render: raw ISO dates and US decimals
- **What.** Journal Date column: `2026-09-04`. Movements ledger Date: `2026-08-16`. PO payment history: `2026-09-04`. Four date formats render across the app; `packages/utils/src/dates.ts:49` calls an eighth form a defect. Numbers: Movements footer `cap 5,000 rows` beside `Rp 5.000`; product detail `2.02%`; 8 on-screen `toFixed()` sites (`ProductionAlertsTab.tsx:59`, `ReorderTab.tsx:57`, `BakerPreviewPanel.tsx:63`, `SegmentList.tsx:112`, `PurchaseBySupplierPage.tsx:158,273`, `StaffPerformancePage.tsx:323`, `SupplierDetailPage.tsx:134`).
- **Why it matters.** The accountant's main screen and the stock lead's ledger show the eighth form. The dot means thousands two clicks away.
- **Fix.** `JournalEntriesPage.tsx:331` and `StockLedgerTable.tsx:212` take `formatDateShortWita`. `MovementsFilters.tsx:231` takes `formatNumber`. Route the 8 `toFixed` sites through `formatNumber`/`formatQuantity`. Then a lint rule against `.toFixed(` outside CSV accessors.
- Files: `apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx:331`, `features/inventory-movements/components/StockLedgerTable.tsx:212`, `features/inventory-movements/components/MovementsFilters.tsx:231`. Browser-verified.
- **Suggested command:** `/impeccable clarify`

### [P1] Money in sans, and without `Rp`, on the purchase order
- **What.** 4 money nodes in Instrument Sans on the PO detail page: three line-item cells and the payment-history amount. The draft form renders `subtotal.toLocaleString('id-ID')` with no `Rp` and no mono at `POFormDraft.tsx:346, 366, 371, 376`. `SupplierAnalyticsTab.tsx` has no mono class in the whole file.
- **Why it matters.** This is the screen where a misread digit becomes a supplier commitment.
- **Fix.** `font-data` on `PurchaseOrderDetailPage.tsx:516-518` and the payment-history span; `formatCurrency` plus `font-data` in the four draft lines.
- Files: `apps/backoffice/src/pages/purchasing/PurchaseOrderDetailPage.tsx:516`, `features/purchasing/components/POFormDraft.tsx:346`. Browser-verified (detail page); draft form source-only.
- **Suggested command:** `/impeccable polish`

### [P2] Reports are filed two ways, titled two ways, and the palette hides the rest
- **What.** Nav panel: 39 report links in 5 families. Index page: 45 tiles in 7 families with different names. `staff-performance` is under Sales in the panel and Operations on the index. Nav labels sentence case, ~49 page titles Title Case. Palette query `sales` returns 5 hits, not scrollable, no "more" indicator.
- **Fix.** Derive the index families from `nav.ts`. Sentence-case page titles. Show `5 of N` in the palette or raise the cap.
- Files: `apps/backoffice/src/layouts/nav.ts:182-259`, `pages/reports/ReportsIndexPage.tsx:57-157`, `layouts/CommandPalette.tsx:31,152`. Browser-verified.
- **Suggested command:** `/impeccable clarify`

### [P2] On Orders, clickable and non-clickable counter tiles share identical chrome
- **What.** Status counters (`<button>`) and money tiles (`<div>`): same class string, 66 px, transparent background, same border. Only `cursor` differs.
- **Fix.** Give the non-clickable strip the inert-paper ground, or render it as a summary line.
- File: `apps/backoffice/src/components/ListCounterStrip.tsx:108-140`, used at `pages/orders/OrdersListPage.tsx:474-497`. Browser-verified.
- **Suggested command:** `/impeccable layout`

## Persona Red Flags

**Shop manager.** Identical counter chrome on Orders. Nav label vs page title mismatch on ~30 destinations. `Take-away` on Today renders 13 px of 59 at 1280. Dashboard title memoised once at `Dashboard.tsx:151`, so a tab open past midnight keeps yesterday's date (source).

**Accountant.** Journal Date column in raw ISO. `JournalEntriesPage.tsx:301` hides the footer count when the list is empty. General ledger page has zero buttons, no export. Counter definitions only in tooltips. Orders CSV named for a 60-day window but holds only the loaded, quick-find-filtered rows (`OrdersListPage.tsx:454`, `exportOrdersCsv.ts:24`, source).

**Owner-manager.** The label split. Two report taxonomies. 5-hit palette cap. 15 button heights.

**Stock lead.** Raw ISO in the movements ledger. `cap 5,000 rows`. 200 chevrons at 14 × 14 px. `RecipeDetailPage.tsx:153` prints `current_stock` raw beside a formatted quantity. Recipe detail still a flat table, not the Cascade archetype.

## Minor Observations

- 424 interactive elements under 24 px (journal entry buttons 115 × 16, trial balance drill links 26 × 14, movements chevrons 14 × 14 × 200).
- Ticket ID in UI copy: "See D-W6-6B-05 for incrementality caveats." at `PromoRoiPage.tsx:59` and `PromoRoiSummary.tsx:78`.
- Copy mismatch: `ExpenseConsequenceRail.tsx:30` "when you submit" vs button "Save as draft" (`NewExpensePage.tsx:148`).
- Orders row menu: `View details` and `Void order` at 34 px each, no separator.
- Chart legend `Cumulative` in `chart-2` on white, 12 px, 3.36:1 (Stock position).
- Stock position category names `w-24` clip 5 names at 96 px. Today clips 3 labels at 1440, 7 at 1280.
- Heading skips h1 → h3: Today, Cash treasury, Movements.
- Odd control sizes: products `Rows per page` 24 px, movements item combobox 28 px, Reports index search 44 px.
- Expense buttons 56 px (`size` omitted); list pages use 32.
- Products rows `<tr cursor-pointer>` with no `href`, `role`, `tabindex`.
- 4 Marketing reports still on legacy `ReportPage`; Promo ROI has zero buttons.
- Breadcrumb copy-pasted in 32 files, missing from ~25 pages; `PageHeader` has no breadcrumb slot.
- "—" dashes at 3.93:1 on Orders and Products are the arbitrated non-text `text-subtle` token. Not a finding.
- Guards: stage the `ComingSoon.tsx` deletion before running `scripts/ci/*` locally, or add an existence check at `_guard-lib.mjs:239`.

## Questions to Consider

1. The One Ink Fill Rule says at most one. Orders, Trial balance, GL, Movements and every report page have zero. Did you mean exactly one?
2. `SectionLabel` declares no typeface. Is a back-office wrapper the answer, or should DESIGN.md say the label role is sans in most of the product?
3. Route membership between nav and index is synced by hand and perfect. Why is the grouping not derived from the same list?
4. The app never lets a number leave the screen with a false claim, then names a partial CSV after a 60-day window. What is the export's contract?
5. DESIGN.md records its own gaps with dates and measurements, and almost none has a guard. Would five lint rules be worth more than the next feature?
