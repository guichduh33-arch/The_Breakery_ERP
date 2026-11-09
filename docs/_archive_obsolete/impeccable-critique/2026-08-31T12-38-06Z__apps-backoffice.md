---
target: critique BO
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-31T12-38-06Z
slug: apps-backoffice
---
Method: dual-agent (A: design review, logged into the running app · B: detector + computed-style browser evidence)

Target: `apps/backoffice`. Mode: **Operate**. Both assessments ran isolated and in parallel; neither saw the other before synthesis.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live badges and `Last sync` are good; the Open Orders footer says "open over 45 min" over rows reading `219h 30m`, and an inline opname row `Save` gives no visible persistence feedback. |
| 2 | Match System / Real World | 3 | Domain copy is excellent and domain-authored. Locale is not: `31/08/2026` and `08/31/2026` render on sibling screens. |
| 3 | User Control and Freedom | 3 | Esc closes panels, filters are URL-addressable, append-only is explained not hidden. No breadcrumb on roughly half the pages. |
| 4 | Consistency and Standards | 2 | Three row-action grammars, four rendered date formats, three field heights, two export affordances, breadcrumb present on some domains and absent on others. Weakest axis by a clear margin. |
| 5 | Error Prevention | 3 | `VoidOrderModal` and `ValidateOpnameDialog` are best-in-class; undercut by destructive row icons visually identical to benign ones at rest. |
| 6 | Recognition Rather Than Recall | 3 | Command palette shows each hit with its full path. Offset by a 39-link Reports panel and product names hard-clipped at 116 px. |
| 7 | Flexibility and Efficiency | 3 | Palette, arrow-key menubar, column chooser, shareable filter URLs. No saved views, recents or favourites for a ~100-destination IA. |
| 8 | Aesthetic and Minimalist Design | 3 | Strong and distinctive. Costed by empty comparison slots on all seven KPI tiles and one real text collision. |
| 9 | Error Recovery | 3 | `voidErrorText` maps 17 server tokens to sentences and redacts the rest — exemplary, and not generalised. |
| 10 | Help and Documentation | 2 | Nothing explains `OpEx · 348,8% of sales` or `Gross margin 99,6%`. No glossary, no definition of a derived measure. |
| **Total** | | **28/40** | **Good, stratified by construction date** |

## Design Specificity Verdict

**LLM assessment: authored for this product, and unusually so.** Three things a category-interchangeable admin panel does not have:

- The **ink / gold / paper + mono-carries-data discipline actually renders**. Every measured figure — `Rp 68.717.295`, `-1 pcs`, `219h 30m`, `OPN-20260818-0567` — comes out in JetBrains Mono tabular, prose in Instrument Sans. Held across nine of nine screens opened live.
- The **copy is domain-authored**: "Corrections are recorded as new movements — nothing here is edited in place." A generic ERP writes "Manage your inventory."
- The **ink budget is spent deliberately**: one ink fill per screen. Exactly one screen spends it on the wrong control (P1-2).

Where it slips is not the aesthetic, it is **consistency of the ossature between domains**. Reports and Orders were built to the spec; Accounting and Inventory predate it and were never brought forward. The identity is intact; its application is stratified by construction date.

**Deterministic scan.** `detect.mjs --json apps/backoffice/src` → exit 2, **8 findings** over 618 `.tsx` / 361 `.ts` / 1 `.css`.

- `design-system-font-size` ×7, all in `apps/backoffice/src/index.css` (L83, L100, L129, L156, L160, L200, L205). **All EXPECTED** — DESIGN.md § Typography pre-arbitrates the login screen's own label body. Nuance: the arbitration text names only the **10 px mono** capitals; the `13px` and `15px` steps (Instrument Sans) in the same file are also off the ramp and are not individually named.
- `border-accent-on-rounded` ×1, `SettingsFloorPlanPage.tsx:49`. **Likely false positive** — the target is a 3 px-radius segmented-control button, not a rounded card, and the 2 px underline is carried by both segments on purpose so activating a view does not shift the label by 2 px.
- Detector calibration confirmed sane: `index.css` L108 (`12px`) and L190 (`19px`) were correctly **not** flagged.

**The detector caught nothing the design review missed, and the design review found four issues the detector cannot see.** That is the expected shape on this repo, and it is the standing warning: a green scan proves nothing here.

**Visual overlays.** Injection succeeded and the in-page detector ran, but **only on `/login`** — Assessment B had no credentials and stopped at the wall rather than authenticating. 14 anti-patterns reported there: `undersized-ui-text` ×12 (the arbitrated 10 px), `flat-type-hierarchy` ×1 (artefact of a page deliberately outside the shell), `layout-transition` ×1 (`transition: height`). The live server was started in the background on :8400 and **stopped and verified dead**. Contrast measured on all 25 text nodes of `/login`: **0 failures**. Assessment A reached the authenticated app separately using the E2E seed PIN committed in `tests/e2e/bo-admin-pin-reset.spec.ts:41`; every P0/P1 below was measured in the running app.

## Overall Impression

The system is good and it is yours — nobody else could ship this. The gap is not taste, it is **uneven application**. Two domains (Accounting, Inventory) never got the ossature the others got, and the single most-opened card in the product renders overlapping text. Biggest opportunity: run the existing archetypes over Accounting and Inventory instead of designing anything new.

## What's Working

1. **Irreversibility is a design material, not a warning label.** `VoidOrderModal.tsx:96-140` and `ValidateOpnameDialog.tsx:45-70` name the exact consequence *and the only recourse* before the button — including "there is no way back to counting". The positioning ("fraud as a design risk") rendered as UX, not as a report.
2. **Measured contrast is clean where it was measured.** Computed-style sweeps over every leaf text node on Today, Profit & Loss and `/login`: zero failures below 4.5:1. `PRODUCT.md:177` still calls muted-text contrast "un chantier ouvert reconnu" — on these pages it is closed, and the doc understates the work done.
3. **The command palette teaches the IA while it serves it.** `marg` returns "Margin watch — Stock › Watch" with the full domain path. For a ~100-destination nav with no sidebar, this is the load-bearing affordance and it is done right.

## Priority Issues

### [P0] Open Orders rows collide on the highest-traffic screen
- **What.** The order-number cell is `w-11` (44 px, `shrink-0`, no truncate) holding a 12-character mono order number whose `scrollWidth` is ≈86 px. The adjacent `Take-away` label starts at x=91. Renders as `P2208206Takeaway`. The `w-12` timer cell overruns the same way with `219h 30m`.
- **Why it matters.** This is the identifier the shop manager uses to match a screen row to a physical ticket, on the one card that exists to be scanned between services. Broken for every row, not an edge case.
- **Fix.** `min-w-0 truncate` on the number, or `w-24` and let `flex-1` on the destination absorb the rest. Same for the timer cell.
- `apps/backoffice/src/features/dashboard/components/OpenOrdersCard.tsx:83` and `:86`. Browser-verified at 1440.
- **Suggested command:** `/impeccable adapt`

### [P1] Two contradictory numeric date formats render in the same product
- **What.** Purchase Orders renders `31/08/2026`; the native date filters on Orders and Trial balance render `08/31/2026` (browser locale — `lang="id-ID"` on the `Input` at `TrialBalancePage.tsx:70` is a no-op in Chrome). Opname renders `19 Aug 2026, 00:19`; Today's `h1` renders `August 31, 2026`.
- **Why it matters.** `packages/utils/src/dates.ts:29-49` declares seven date roles and says in its own comment that the lettered month exists precisely to kill day/month ambiguity in tables. Purchasing uses the *filter* role as a *table column* role. For a product whose business day is a stated invariant (ADR-019), `31/08` and `08/31` in one session is the exact ambiguity the helper was built to prevent.
- **Fix.** Purchasing's table columns take `formatDateShortWita` / `formatDateTimeShortWita` like every other list. Separately, decide whether native `type="date"` is acceptable at all, since it will never honour `id-ID`.
- `apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx:213` and `:220`. Browser-verified.
- **Suggested command:** `/impeccable clarify`

### [P1] On the stock count, the ink fill is spent on `Add` and the terminal action is a ghost beside a destroyer
- **What.** Measured: `Add` (adds one row) = `rgb(32,29,25)`, h=56 — the page's ink fill. `Validate & reveal variances` = ghost, transparent, h=56, x=913. `Cancel` (cancels the whole count) = ghost, **identical colour**, h=56, x=1156. A 12 px gap. Nothing on the page states irreversibility before the button; the warning lives one click later, inside the dialog.
- **Why it matters.** The Bulk-entry archetype requires the terminal action gated *and* an irreversibility note "juste avant le bouton". The One Ink Fill Rule says the ink goes to the button that creates or the tile that answers the page's question — here it is a row-adder. The stock lead does this standing, hands busy; two identical ghosts 12 px apart is the geometry that produces the wrong click.
- **Fix.** `Add` → `secondary`. `Validate & reveal variances` → `ink`. `Cancel` → `ghostDestructive`, relabelled `Cancel count`, moved to the opposite end. Move the one-line irreversibility statement inline above the footer.
- `apps/backoffice/src/pages/inventory/OpnameDetailPage.tsx:230-260`. Browser-verified.
- **Suggested command:** `/impeccable layout`

### [P1] Three different row-action grammars across three List instances
- **What.** Orders: two bare 32 px icons, the first of which is **Void**. Products: three bare icons, the third of which is **delete**. Inventory: a single `…` overflow menu. All observed live.
- **Why it matters.** At rest, `RowActionButton` renders the destructive and the benign icon in the same `text-text-subtle`; the only differentiator is `hover:bg-red-soft`, invisible until the pointer is already on it. A user who learns "the right-most icon is safe" on Orders is wrong on Products.
- **Fix.** Converge on the `…` overflow menu — it names actions in words and removes the adjacency risk. If icons stay, give the destructive one a resting `text-danger`, not just a hover.
- `apps/backoffice/src/features/orders/components/RowActionButton.tsx:33-38`; `features/products/components/ProductsTable.tsx`. Browser-verified across three screens.
- **Suggested command:** `/impeccable polish`

### [P2] A 0-pcs product wears the same chip as a 2-of-5 product, while the counter strip names them separately
- **What.** Inventory's strip declares five states (`ALL 376 / LOW STOCK 5 / AT ZERO 299 / NEGATIVE 20 / NOT TRACKED 40`). The row badge knows one. Observed: `Chocolatine · 0 pcs · LOW STOCK`, `Croissant Almond · -1 pcs · LOW STOCK`.
- **Why it matters.** Today's dashboard already tells the operator an empty counter is categorically different ("2 counters empty — POS blocks the sale"). The row that *is* that state does not say so. Strip vocabulary and row vocabulary disagree in the one place a stock lead reads them together.
- **Fix.** Three badge states mirroring the strip: `Out of stock` (≤0, danger), `Negative` (<0, danger, distinct), `Low stock` (0 < qty < threshold, warning).
- `apps/backoffice/src/features/inventory/components/LowStockBadge.tsx:13-20`. Browser-verified.
- **Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Shop manager — short, interrupted sessions, standing.**
- P0 lands squarely on her: the Open Orders card is the one thing she opens between services, and its identifiers are unreadable.
- No breadcrumb on Inventory or Accounting. With no sidebar and a domain panel that closes on navigate (`TopBar.tsx:169`), an interrupted session resumes with only a 2 px gold tab underline to say where she is.
- No recents, no pinned views. "The six products without a cost price" is re-navigated by hand every time, even though the URL supports it.
- Product names clipped to 116 px inside a 182 px column force a hover on a screen used standing.

**Accountant — traceability and export.**
- **Trial balance rows do not drill down.** Plain `<tr>` with no link and no handler (`TrialBalancePage.tsx:140`). You cannot get from `1141 Inventory - General · Rp 18.813.000` to the ledger lines behind it. Product Principle 3 fails on the flagship accounting screen.
- **Export asymmetry.** 42 of 43 report pages mount `ExportMenu` (CSV **and** PDF). Accounting mounts a bare `Export CSV`: `TrialBalancePage.tsx:63`, `CashTreasuryPage.tsx:148`. The trial balance is precisely the document that leaves the building as a PDF.
- No breadcrumb anywhere in `/accounting`, the one domain whose users navigate by document hierarchy.

**Owner-manager — long, dense sessions.**
- **Two screens give incompatible cost ratios with no visible denominator.** Today reads `COGS · 52,0% of sales` and `OpEx · 348,8% of sales` (month to date); P&L over 28 days reads `GROSS MARGIN 90,8%`, i.e. COGS ≈ 9,2%. Both may be correct over different windows; neither states its window next to the ratio. `348,8% of sales` ships with no plausibility treatment and no reserve line, against DESIGN.md's own "la réserve s'affiche à côté de la valeur".
- Every one of the seven Today tiles renders `— yest = 0,0% D-7`. Roughly 30% of each tile's height spent on "no information", seven times.
- 39-link Reports panel with no favourites; the palette is the only fast path, and it requires knowing the report's name.

## Minor Observations

- **`Badge` is `rounded-full`** (`packages/ui/src/primitives/Badge.tsx:6`). Every status chip in the back-office is a pill, against the tight-corner rule. Shared primitive — touches the POS.
- **Three field heights on one form.** New expense: 7 controls at 44 px, the `Receipt` file input at **32 px**. DESIGN.md allows exactly two (44 / 36).
- **Filter bars are 44 px, not 36 px.** All five Orders filter controls and both Trial balance date fields measured 44 px. DESIGN.md assigns the filter-bar role to 36 px, with the rationale that 44 px "coûte une ligne de tableau à chaque écran".
- **Number locale escapes once.** `features/products/components/StockAnalyticsPanel.tsx:63` uses `toLocaleString(undefined, …)`; 46 other call sites pin `'id-ID'`. [source-only]
- **Same value, two formats, 40 px apart.** Open Orders header reads `Rp 65 rb in the room`; the row beneath reads `Rp 65.000`. The compact/exact split is applied cleanly elsewhere; this card breaks it inside itself.
- **`pages/ComingSoon.tsx` is unrouted** — dead file. [source-only]
- **Settings hub has no breadcrumb and no page actions**, unlike its own children.
- `transition: height` on `/login` animates a layout property (detector, runtime).
- The login page reserves ~38% of a 1440 viewport for the croissant lockup — the owner's arbitrated exception, not scored. At 1280 it still holds and the PIN column does not clip.

## Questions to Consider

1. **If the trial balance cannot be clicked through to the ledger, is the accountant a user of this product or a reader of its CSV?** Three of five product principles are about traceability; the screen that most needs them has none.
2. **The dashboard prints a cost ratio of 348,8% and a gross margin of 99,6% side by side and has no opinion about either.** When does a ratio become implausible enough that the tile should say so rather than print it?
3. **Multi-select was removed from List because the bulk RPCs don't exist; "differences only" was removed from Matrix because the data didn't justify it — both good calls.** By the same test: does the 39-link Reports panel justify itself, or is it a menu of routes that exist rather than a menu of questions people ask?
4. **`Add` is the ink fill of the stock-count page.** Slip, or evidence that One Ink Fill needs a companion rule — *the ink goes to the action that ends the page's work, not the one that extends it*?
5. **The blind count and the void modal are the best UX here, and both were built to an archetype. Accounting and Inventory were not.** Is the remaining work a design backlog, or just "run the archetype over the two domains that predate it"?
