# Handoff: Backoffice shell + Dashboard + Products (option 1c)

## Overview

Redesign of `apps/backoffice` (The Breakery ERP monorepo, Vite + React + Tailwind, tokens in
`packages/ui`). Two goals: make navigation graspable at a glance, and put the day's actionable
work above the numbers. The accepted direction replaces the 240 px accordion sidebar with a
**dark top bar carrying seven domain tabs and flat drop-panels**, freeing the full width for data.

**Eight screens are specified**, and between them they establish **five page archetypes that the
remaining ~80 pages of the backoffice are generated from** — the point of the set is that no further
mockups should be needed:

| Screen | Page | Archetype |
|---|---|---|
| `1c` | Dashboard / "Today" (the landing page) | — (the shell + the landing page) |
| `2a` | Products | **List** |
| `4a` | Stock alerts | **List** |
| `4b` | B2B orders | **List** |
| `4c` | Daily sales | **Report** |
| `5a` | Purchase order detail | **Document** |
| `5b` | Settings hub | **Hub** |
| `5c` | New expense | **Form** |

Build them in that order: `1c` first (it carries the shell every other screen inherits), then `2a`,
then one of each remaining archetype. The five archetypes are specified as reusable recipes in
*Page archetypes* below.

**Status as of 2026-08-07.** `1c` and the shell are **implemented** — `layouts/BackofficeLayout.tsx`,
`layouts/TopBar.tsx`, `layouts/DomainPanel.tsx`, `layouts/nav.ts`, `layouts/CommandPalette.tsx`,
`pages/Dashboard.tsx`, `features/dashboard/*`, and the aesthetic as theme-scoped tokens in
`packages/ui/src/tokens/colors.css` (`.theme-backoffice`). Reuse that shell and those tokens for the
seven remaining screens rather than re-deriving them. Two items from that build are still open and
are marked inline below: **the page-ground dot grid** (not implemented) and **the bell badge count**
(currently stock-only, must become the queue total). Header shortcut pinning was deliberately
deferred to the backlog; the default filtered set stands.

**References, not deliverables.** `0a` is a faithful recreation of the *current* dashboard, kept so
the before/after is comparable. `1a` (icon rail + contextual panel) and `1b` (flat sidebar + ⌘K
palette) were navigation options explored and **not** selected. `3b` / `3c` / `3d` are rejected
aesthetic directions (Press, Console, Calm). Do not implement any of these five — but note that
`1b`'s ⌘K palette rendering **is** part of the accepted design (see *Interactions*).

## About the Design Files

`Backoffice Landing.dc.html` is a **design reference written in HTML**, not production code. It is a
single-file prototype: everything is inline-styled, static, and laid out inside fixed 1440 px frames
so several screens can sit side by side on one canvas.

The task is to **recreate these designs inside the existing backoffice app**, using its established
patterns: React function components under `src/features/*` and `src/layouts/*`, Tailwind classes
bound to the `packages/ui` token layer, `@breakery/ui` primitives (`Card`, `KpiTile`,
`SectionLabel`, `DataTable`, `Badge`, `Currency`, `Button`), lucide-react icons, React Query hooks,
and `recharts` for charts. Do not copy the inline styles or the flat markup; do not introduce a new
CSS approach.

## Fidelity

**High-fidelity.** Colors, type sizes, spacing and copy are final and should be matched. Two caveats:

1. The prototype hardcodes values as **inline hex**. In the codebase, use the equivalent
   **token/Tailwind utility** (see *Design Tokens* — every hex maps to an existing token, except the
   handful of new neutrals listed as "new").
2. Charts are hand-drawn SVG in the prototype. Implement them with `recharts`, matching the
   existing dashboard chart components' props and the colors from
   `src/features/reports/utils/chartColors.ts`.

## Palette and type changes (apply to the whole backoffice, not just these screens)

These are intentional deviations from the current `.theme-backoffice` tokens, and they are the
reason the redesign no longer reads as "a bakery website":

| Change | From | To | Why |
|---|---|---|---|
| Body face | Inter | **Instrument Sans** (Google Fonts, 400/500/600/700) | Same sobriety, more character, narrower advance width — which pays off in a 12-column table. |
| Page titles drop the serif | `font-serif` / Playfair Display 30 px 400 | Instrument Sans 23–24 px 600, `letter-spacing:-.015em` | Playfair was the single strongest "artisan bakery" signal in a management tool. Playfair is **kept** for the brand mark only (the `B` tile in the top bar). |
| Page background cooled | `--surface-0/1` warm ivory `#e8e1d5` / `#f2ece1` | `#f0efec` | Less beige, still warm-neutral. |
| Cards | `--bg-elevated` `#faf6ef` | `#ffffff` | Sharper separation from the page. |
| Borders | `--border-subtle` `#e0d7c8` | `#e3e1db` (card), `#eceae5` (inner), `#f3f1ec` (table row) | Matches the cooler neutrals. |
| Gold usage narrowed | gold fills, gold pills, gold KPI icon tiles everywhere | gold ink `#8a6820` only for: active nav marker, links/inline actions, active toggle, retail price emphasis | Sobriety. The gold-soft icon tile on every KPI card is removed. |
| Primary buttons | gold fill (`bg-gold`, `text-bg-base`) | ink fill `#201d19` / `#fffdf9` | One accent, used for meaning, not decoration. |
| Pills → rectangles | `rounded-full` inputs, selects, toolbar pills | `border-radius: 4px` | Reads as a tool, not a storefront. |
| Radius scale tightened | 8 px cards / 6 px controls | **6 px frame · 4 px card · 3 px control · 2 px badge, bar, checkbox** | An instrument, not a consumer app. Round pills (badges, avatars) keep their full radius. |
| KPI values | `--type-3xl` 34 px | 23–28 px, JetBrains Mono 600, `letter-spacing:-.02em` | Room for comparisons under each value. |

`JetBrains Mono` (all numeric data, SKUs, timestamps, section labels) is unchanged from
`packages/ui/src/tokens/typography.css`. `Inter` is replaced by `Instrument Sans` for body and UI copy.

Three further aesthetic decisions, applied on both screens:

- **Gold hairline under the ink bar** — `border-bottom: 1px solid #8a6820` on the top bar. The only
  ornament in the design, and it is what carries the brand.
- **Measuring grid on the page ground** — the scrolling content area gets
  `background-image: radial-gradient(#dfddd6 1px, transparent 1px); background-size: 22px 22px;
  background-position: -1px -1px` instead of a flat fill. Depth without a gradient. Expose it as a
  theme token (`--page-grid`) consumed by one utility on `<main>` in `BackofficeLayout`, so the
  eight screens inherit it at once and the direction stays switchable.
  **Status: not yet implemented** — `<main>` is currently a flat `bg-bg-base`. It is the only
  visual element of the accepted aesthetic still missing from the shell.
- **Section labels** at `letter-spacing:.14em` (was `.12em`) — reads as instrumentation.

Three alternative directions were built and rejected (Press / zero-radius paper, Console / dark
ground, Calm / soft cool neutrals). They are in the HTML as `#3b`, `#3c`, `#3d` for reference only —
**implement `#3a` "Instrument"**, which is the aesthetic `1c` and `2a` now carry.

---

## Page archetypes

Every backoffice page is one of five shapes. Build each shape once, as a layout component or a
documented composition, and the rest of the app follows from it. The eight specified screens are the
worked examples; a page not in the set should be derived from its archetype rather than invented.

All five share the shell (top bar + drop-panels), the page ground
(`padding: 20px 22px`, `gap:14px`, dot grid), and the header block (breadcrumb → `<h1>` →
one-line subtitle carrying live counts → right-aligned action buttons, secondary then one ink primary).

### A. List — `2a` Products, `4a` Stock alerts, `4b` B2B orders

```
header
counter strip        ← one card, cells split by 1px dividers; EACH CELL IS A FILTER
filter bar           ← search (flex:1) + selects + Columns [+ view toggle]
table (flex:1)       ← ink 1.5px header rule, 9px 14px rows, right-aligned numerics
  selection footer   ← margin-top:auto, bulk actions + "1–N of M" + pager
```

Rules that make the archetype worth having:

- **The counter strip replaces the KPI grid.** Every cell answers "which rows do I need to look at",
  and clicking it filters the table (reflect in the URL via `useUrlState`). Include at least one
  **data-quality counter** (Products: "No cost price 6"; B2B: "Overdue 4") in `#b4342c` with an
  inline fix link.
- **Sort by consequence, not alphabetically.** `4a` sorts by coverage ascending — what runs out
  first is on top. `4b` groups by what needs doing today.
- **Split status columns when the statuses are independent.** `4b` carries Fulfilment *and*
  Payment as separate columns because they drift apart; `5a` carries two badges for the same reason.
- **Severity dot** in a leading 18 px column when rows have urgency: blocking `#b4342c`,
  warning `#8a5a10`, informational `#2b6c9c`.
- Numerics: JetBrains Mono, right-aligned, `white-space:nowrap`, em-dash `#9b968d` when null.
- The footer is always present; with nothing selected it shows just the count and pager.

### B. Report — `4c` Daily sales

```
header (+ date/period control as the FIRST action button)
KPI row              ← 6 tiles, the primary metric as the ink hero tile
main chart (flex:1)  ← 1.7fr, plus a secondary chart at 1fr
breakdown row        ← flex:0 0 auto, 3–4 cards sized to content
```

- **One hero, five plain.** Exactly one ink tile (`#201d19`, value 26 px `#fffdf9`, delta
  `#86efac`) — the number the page exists to answer. Never two.
- **Every figure carries a comparison** (vs yesterday and vs same weekday D-7, or vs previous
  period). A number with nothing to compare it to is decoration.
- **Every chart carries its comparison series**: solid `#2b6c9c` current, dashed `#c2beb5`
  `strokeDasharray "3 3"` previous (lines), or paired bars with `#c9dcea` behind `#2b6c9c`.
- Breakdown cards end with a **derived total** above a `border-top` (e.g. "Total collected",
  "Cost per basket") — never just a list.
- Include the **operational state** the report implies: `4c` carries register-close status, because
  a sales report you cannot act on is a dead end.

### C. Document — `5a` Purchase order

```
header: crumb → mono <h1> (the document number) + N status badges → actions
2fr / 1fr split:
  left   information grid (4-col, 1px-gap inset panels) → line-items table → sub-documents
  right  financial summary → payment → status timeline → notes
```

- **One badge per independent lifecycle.** A PO is `PARTIAL` *and* `UNPAID`; fulfilment and
  payment are tracked separately and must not be merged into one status.
- **Line items show ordered vs received per line**, with a per-line status
  (`Complete` / `8 short` / `Not received`) — the table footer states what closing the document
  requires.
- **The money must reconcile with the quantities on screen.** Received value = Σ(received qty ×
  unit cost); still-to-receive = ordered total − received total. Derive these, never hardcode.
- Timeline steps are `check-circle-2` `#187a52` when reached, `circle` `#c2beb5` when not, with
  the date right-aligned in mono `#9b968d`.
- Actions that are **locked** render as disabled (`#fafaf8` fill, `#9b968d` text) with the reason
  in `title` — never hidden. `5a`'s Edit is locked because the PO has a GRN.

### D. Hub — `5b` Settings

```
header (+ "Find a setting")
per group: mono group label + count → 4-col tile grid
```

- **Every tile states its current value** under the blurb, in 11.5 px `#9b968d`
  ("06:30–18:00 · closed Monday", "2 registers · float Rp 500.000", "6 devices · 1 offline"). This is
  the whole point: the hub answers questions without any tile being opened.
- Tile = icon `#8a6820` 15 px + title 13.5 px 600 + blurb 12.5 px + value line. Permission-gated
  tiles carry a neutral qualifier badge (`Admin only`); planned surfaces render at `opacity:.6`.
- The header count must equal the sum of the group counts and the rendered tiles.

### E. Form — `5c` New expense

```
header: crumb → <h1> + state badge (DRAFT) → Back / secondary / ink primary
1.6fr / 1fr split:
  left   field groups, one card per group (identity → amounts → attachment)
  right  totals → consequence-of-submitting → recent comparable records
```

- **Group fields by what they are**, one card per group, `grid-template-columns: repeat(n,1fr)`,
  `gap:12px`. Label = `SUB` mono 10 px uppercase; control 34 px, radius 3 px.
- **Derived fields are read-only** (`background:#fafaf8`) with the derivation in the hint
  ("Amount + VAT · read-only"). Never let the user type a value the system computes.
- **State the consequence of submitting before they submit** — `5c`'s right rail shows the approval
  chain that submission will snapshot. A form whose outcome is a surprise gets abandoned.
- **Show comparable recent records** in the rail (same vendor / same category) with a variance line.
  It is what turns data entry into a sanity check.
- Required fields carry `*` in `#b4342c`; constraints go in the hint, not in a tooltip
  ("max 120 characters", "must not exceed the amount").

---

## Screen: `1c` — Dashboard ("Today")

Route: `/backoffice` — replaces `src/pages/Dashboard.tsx`.
Frame: 1440 × 900. Vertical: top bar 52 px, then a non-scrolling content area (`padding: 20px 22px`,
`display:flex; flex-direction:column; gap:14px`). Designed to fit 900 px without scroll at 1440 and
to stay legible at 1920.

### 1. Top bar (global chrome — shared by every screen)

Replaces both `layouts/Sidebar.tsx` and `layouts/Topbar.tsx`.

- Height 52 px, `background:#201d19`, `padding: 0 22px`, `display:flex; align-items:center; gap:22px`.
- **Brand**: 26 × 26 px tile, `radius 6px`, `background:#8a6820`, letter `B` in Playfair Display
  14 px, `color:#fffdf9`; next to it "The Breakery" Inter 13.5 px 600 `#fffdf9`.
- **Domain tabs**, full-height items, `padding: 0 13px`, font 13.5 px:
  `Today · Sales · Stock · Purchase · Finance · Reports · Admin`.
  Each except *Today* carries a `chevron-down` 13 px.
  - Inactive: `color:#c4bcae`.
  - **Active** (current section): `color:#fffdf9`, weight 500, `box-shadow: inset 0 -2px 0 #d3ab5c`.
  - **Open** (panel showing): `color:#fffdf9`, `background:#2e2925`.
- **Right cluster**, `gap:16px`:
  - Search affordance: 30 px tall, `border:1px solid #453e35`, radius 6 px, `color:#a09789`,
    `search` icon 14 px + "Search" 12.5 px + `⌘K` in JetBrains Mono 10 px. **Must open a command
    palette** (see *Interactions*).
  - `bell` 17 px `#e8e1d5` with a count badge: absolute `top:-5px; right:-6px`, min-width 15 px,
    height 15 px, radius 8 px, `background:#b4342c`, `color:#fff`, 9 px 700, `99+` above 99.
    **The badge count must equal the "Needs you" total** — same aggregate hook, all five sources
    (unclosed registers, low stock, reorder suggestions, pending PO receipts, overdue B2B invoices),
    permission-filtered identically. Its `title` breaks the total down by source
    ("3 low stock · 2 PO to receive · 1 register · 4 overdue"), and clicking it goes to the queue.

    *Decided 2026-08-07, against the first implementation.* The shell initially scoped the bell to
    stock only (`useAlertsCount`) while the queue aggregated five sources. A stock-only bell is more
    predictable in isolation, but a user reading "3" on the bell and "11" in the queue on the same
    screen cannot tell which one is lying — and the bell is the thing they check when the page is not
    open. One number, one meaning: **anything that needs a human counts once**. Keep the per-source
    split in the tooltip, not in a second count.
  - User chip: 26 px circle `background:#3a342c`, `color:#e8e1d5`, initial 11.5 px 600 + name 13 px.
    Click → menu with role, settings, logout (logout currently lives in `Topbar.tsx`).

### 2. Drop-panel (one per domain tab)

Shown in the prototype for *Stock*. Absolute, anchored under its tab (`top:52px`), width 640 px,
`background:#fff`, `border:1px solid #cdcac2`, `border-radius: 0 0 10px 10px`,
`box-shadow: 0 18px 40px rgba(28,23,18,.20)`, `padding:18px 20px`,
`display:grid; grid-template-columns: repeat(3, 1fr); gap:22px`.

Each column: a JetBrains Mono 10 px `letter-spacing:.12em` uppercase `#9b968d` group label, then
links Inter 13 px `#1a1917`, `gap:7px`. Stock panel contents:

- **Catalogue** — Products · Combos · Categories · Recipes
- **Movements** — Incoming · Transfers · Production · Opname · Live movements
- **Watch** — Alerts (with count `3` in mono 10.5 px 700 `#b4342c`) · Display stock · Sections · Margin watch

**This is the whole navigation model.** The current `GROUPS` array in `Sidebar.tsx` (8 groups,
nested subgroups, ~90 entries) must be reduced to 7 domains × up to 3 columns. Suggested mapping:

| Domain | Columns |
|---|---|
| Today | (no panel — direct link to `/backoffice`) |
| Sales | Orders · Customers · Customer categories · B2B wholesale · B2B payments · Promotions · Loyalty |
| Stock | as above |
| Purchase | Purchase orders · Suppliers · Purchase reports |
| Finance | Expenses · Accounting (COA, journal entries, GL, cash, trial balance, mappings) · Z-reports |
| Reports | Sales · Inventory · Financial · Marketing · Audit |
| Admin | Business · POS & sales · Notifications · Security & access · Users · Network |

Permission filtering stays as it is today (`useAuthStore().hasPermission`) — hide empty columns, hide
a tab whose every column is empty.

### 3. Page header

`display:flex; align-items:flex-end; justify-content:space-between; gap:16px`.

- Left: `<h1>` "Today · Wednesday 5 August 2026", Inter 23 px 600, `letter-spacing:-.015em`,
  `#1a1917`; below it 13 px `#55524c`: "Open since 06:30 · closes 18:00 · last sync 09:42".
- Right: four 32 px-tall buttons, radius 6 px, font 12.5 px 500, `gap:8px`, each with a 14 px icon:
  - `Daily sales` (`bar-chart-3`), `Stock alerts` (`bell-ring`), `B2B orders` (`building-2`) —
    secondary: `background:#fff`, `border:1px solid #cdcac2`, `color:#1a1917`, icon `#7a766e`.
    These are the user's declared frequent destinations; they should be **user-pinnable**, not hardcoded.
  - `Export` (`file-down`) — primary: `background:#201d19`, `color:#fffdf9`, no border.

### 4. KPI strip — seven tiles, each with two comparisons

`display:grid; grid-template-columns: repeat(7, 1fr); gap:10px` (`grid-cols-2` →
`md:grid-cols-4` → `xl:grid-cols-7`).
Tile: `background:#fff`, `border:1px solid #e3e1db`, radius 4 px, `padding:13px 15px`,
`display:flex; flex-direction:column; gap:5px`. **No icon tile** (unlike today's `KpiTile`).

**Net revenue is the hero tile**: `background:#201d19`, `border:1px solid #201d19`, label
`#a09789` at `letter-spacing:.14em`, value 26 px `#fffdf9` `letter-spacing:-.03em`, delta
`#86efac` with `#a09789` period labels. It is the number the page exists to answer; the other five
stay white.

- Label: JetBrains Mono 10 px, `letter-spacing:.12em`, uppercase, `#7a766e`.
- Value: JetBrains Mono 23 px 600, `#1a1917`, `letter-spacing:-.02em`.
- Delta line: JetBrains Mono 11 px — `▲12,4%` in `#187a52` 600 / `▼2,0%` in `#b4342c` 600 /
  `=0,0` in `#9b968d` 600, each followed by its period label (`yest`, `D-7`) in `#9b968d` 400.

| Tile | Value | vs yesterday | vs D-7 |
|---|---|---|---|
| Net revenue | Rp 8,42 jt | ▲12,4% | ▲6,1% |
| Orders | 247 | ▲8,3% | ▼2,0% |
| Items sold | 1 084 | ▲5,2% | ▲1,1% |
| Avg basket | Rp 34.100 | ▲3,8% | ▲9,4% |
| Customers | 198 | ▲7,0% | =0,0% |
| Gross margin | 61,8% | ▼1,4pt | =0,0 |
| Cash on hand | Rp 3,17 jt | — (footnote: "drawer Rp 1,84 · safe Rp 1,33") | — |

**`Customers` sits immediately after `Orders`** — the two measure the same day, one in tickets and
one in people, and **the gap between them is the information** (20 orders from 4 customers is not the
day 20 orders from 19 customers is). Separating them makes the cross-reading impossible. Anonymous
customers are excluded server-side.

**Two tiles carry a source note instead of a comparison**, because their measurement has a caveat
that must not be silently dropped: `Gross margin` is computed at *current* cost with the share of
revenue actually covered by a `cost_price` (a 61,8% margin over 40% coverage is not a 61,8% margin —
state the coverage under the strip), and `Cash on hand`'s drawer/safe split is *derived* from open
POS sessions, not a ledger account. Passing an estimate off as a reading is worse than omitting it.

Gross margin and cash on hand are **new** metrics; the RPC
`get_dashboard_overview_v1` must return them plus a `vs_yesterday` / `vs_d7` pair per KPI. "D-7" is
the **same weekday** last week, not a 7-day average — bakery traffic is weekday-shaped.

### 5. "Needs you" bar — the action queue

One line, `background:#fff`, `border:1px solid #e3e1db`, radius 8 px, `display:flex; align-items:stretch`.

- Leading cell: `padding:9px 14px`, `border-right:1px solid #eceae5` — `list-checks` 14 px + label
  "NEEDS YOU" (mono 10.5 px 600, `letter-spacing:.12em`) + count pill (min-width 17 px, radius 9 px,
  `background:#b4342c`, `color:#fff`, mono 10 px 700).
- Then one `flex:1` cell per item, `padding:9px 14px`, `border-right:1px solid #eceae5`, `min-width:0`:
  a 6 px severity dot, the label (13 px `#1a1917`, `white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis`), and a right-aligned action link (12 px 500 `#8a6820`).
- Trailing cell: "All 11 →" (12 px 500 `#8a6820`).

| Dot | Item | Action | Source |
|---|---|---|---|
| `#b4342c` | Register not closed — 4 Aug | Reconcile | Z-reports / cash register |
| `#8a5a10` | 3 items below reorder point | Create PO | `get_low_stock_v1` + `get_reorder_suggestions_v1` |
| `#2b6c9c` | 2 POs awaiting receipt | Receive | purchase orders |
| `#8a5a10` | Villa Selong invoice 12 d overdue | Open | B2B payments |

Severity colors: blocking `#b4342c`, warning `#8a5a10`, informational `#2b6c9c`. Items must be
**permission-filtered** (a cashier sees none of these) and **dismissible only by being resolved** —
no "mark as read".

### 6. Chart row (`flex:1`, `display:grid; grid-template-columns: 1.7fr 1fr; gap:12px`)

Both cards: `background:#fff`, `border:1px solid #e3e1db`, radius 8 px, `padding:16px`.
Card titles everywhere are JetBrains Mono 11 px 600, `letter-spacing:.12em`, uppercase, `#1a1917`.

- **Revenue · 30 days** — recharts `LineChart`. Solid line `#2b6c9c` `strokeWidth 2.5` = current
  30 days; **dashed** `#c2beb5` `strokeWidth 1.5` `strokeDasharray "3 3"` = the previous 30 days.
  Horizontal grid `#eceae5`, baseline `#e3e1db`, no vertical grid, no dots. X labels mono 10 px
  `#9b968d`. Header right: "Rp 231,4 jt total · ▲9,2% vs previous 30 d" (13 px, delta `#187a52` 600).
- **Sales by hour** — grouped `BarChart`, 12 buckets 06:00→18:00, two stacked-looking bars per
  bucket separated by 2 px: today `#2b6c9c`, same weekday last week `#c9dcea` (lighter). Header
  right "today vs last Wed" (11.5 px `#7a766e`); subtitle "Peak 07:00–09:00 · 34% of the day".

### 7. Detail row (`display:grid; grid-template-columns: repeat(4, 1fr); gap:12px`, sized to content)

Four cards, same chrome. **Sizing note:** let each card size to its own content
(`align-items:start`) or keep their content lengths within ~30 px of each other — with
`align-items:stretch` and unequal content the short cards show a dead white lower third.

**a. Open orders** *(new — live floor state)*
Header + `live` marker (6 px `#187a52` dot + "live" 11.5 px `#7a766e`). Subtitle
"7 open · Rp 1,24 jt in the room". Rows 12.5 px, `gap:8px`:
order no (mono `#7a766e`, width 44 px) · destination (`#1a1917`, `flex:1`) · amount (mono `#1a1917`)
· time open (mono, width 48 px, `white-space:nowrap`, right-aligned).

| # | Destination | Amount | Open |
|---|---|---|---|
| #1042 | Table 4 | 186.000 | 12 min |
| #1043 | Take-away | 64.000 | 6 min |
| #1044 | Table 9 | 312.000 | 21 min |
| #1045 | Terrace 2 | 148.000 | 9 min |
| #1046 | Delivery · Gojek | 97.000 | 34 min (amber) |
| #1047 | Table 1 | 241.000 | 48 min (red) |
| #1048 | Take-away | 92.000 | 3 min |

Time thresholds: `< 30 min` `#9b968d`; `30–45 min` `#8a5a10` 600; `> 45 min` `#b4342c` 600.
Footer (`border-top:1px solid #eceae5`, `padding-top:10px`): `alert-triangle` 13 px `#b4342c` +
"1 order open over 45 min" + right-aligned "Open floor" (`#8a6820` 500).
Destination reads `dine_in` → table/zone name, `take_out` → "Take-away", `delivery` → "Delivery · <channel>",
`b2b` → customer name. Should be realtime (Supabase Realtime on open orders), not 60 s polling.

**b. COGS & expenses** *(replaces nothing — new)*
Subtitle right: "month to date". Two figures side by side (`gap:18px`): label 11 px `#7a766e`
("COGS · 34,1% of sales", "OpEx · 22,4% of sales") over a mono 17 px 600 value
(Rp 71,2 jt / Rp 46,8 jt). Then a 9 px split bar, radius 5 px: 60% `#2b6c9c` (COGS), 40% `#8a5a10` (OpEx).
Then six lines (12.5 px, `gap:8px`): 8 px square swatch · account label · MoM delta (mono 600,
`#187a52` down = good, `#b4342c` up, `#9b968d` flat) · amount (mono `#1a1917`).

| Swatch | Account | Δ MoM | Amount |
|---|---|---|---|
| `#2b6c9c` | Flour & grains | ▼2,1% | Rp 24,6 jt |
| `#4f93bf` | Dairy & butter | ▲8,4% | Rp 19,3 jt |
| `#8cc3e0` | Packaging | =0,3% | Rp 6,1 jt |
| `#8a5a10` | Salaries | =0,0% | Rp 28,5 jt |
| `#c2872a` | Rent & utilities | ▲4,6% | Rp 12,4 jt |
| `#d9a44a` | Other OpEx | =1,1% | Rp 5,9 jt |

Then, above a `border-top:1px solid #eceae5`: "Total cost MTD" (500) / Rp 118,0 jt (mono 600), and
"Cost per basket" (`#7a766e`) / Rp 19.100. Swatches are the real COGS/OpEx ramps in
`chartColors.ts` — blue = matter, amber = operating. Keep that coding.

**c. Display stock · vitrine**
Header + `live` marker; subtitle "Read-only · time since the product's last sale". Rows: product
name (`flex:1`) · time since last sale (mono `#9b968d`) · quantity + unit (mono, width 44 px,
right-aligned). `> 0` `#1a1917`; low `#8a5a10` 600; `0` `#b4342c` 600.

Croissant beurre 2 min / 18 pc · Pain au chocolat 6 min / 11 pc · Baguette tradition 9 min / 24 pc ·
Sourdough 800 g 14 min / **3 pc** · Focaccia slice 21 min / 9 pc · Cinnamon roll 26 min / **2 pc** ·
Quiche lorraine 38 min / **0 pc** · Banana bread slice 52 min / **0 pc**.

Footer: `alert-triangle` `#b4342c` + "2 counters empty — POS blocks the sale" + "Open vitrine".
Data: `useDisplayStock()` (`display_stock` + product embed; RLS gate `display.read`). The counter is
**mutated from the POS only** — this card is read-only. The "POS blocks the sale" wording matches the
existing warning in `NewProductDialog.tsx` / `GeneralPanel.tsx`. *Time since last sale* is new and
needs a per-product last-sale timestamp; it is the signal that a product has stopped moving.

**d. Share of revenue + Payments collected** *(replaces the donut)*
Top block: title, then a 10 px split bar, radius 5 px — Dine-in 44% `#2b6c9c`, Take-out 29% `#4f93bf`,
Delivery 17% `#8cc3e0`, B2B 10% `#8a5a10`; legend below, 11.5 px `#55524c`, 8 px swatches, radius 2 px.
Then `height:1px; background:#eceae5`. Bottom block: "Payments collected" — QRIS 41% Rp 3,45 jt /
Cash 38% Rp 3,20 jt / Card 14% Rp 1,18 jt / B2B credit 7% Rp 0,59 jt, then above a top border
"Total collected" Rp 8,42 jt (600) and "Cash expected in drawer" Rp 1,84 jt (`#7a766e`).

**Kill the donut.** `RevenueByTypeDonut` reads worse than a single share bar at four slices and
costs a whole card. The `recharts` `PieChart` can be dropped from the dashboard bundle.

---

## Screen: `2a` — Products

Route: `/backoffice/products` — replaces `src/pages/Products.tsx`. Frame 1440 × 1000.
Top bar identical, *Stock* tab active. Content `padding: 20px 22px`, `gap:14px`.

### 1. Header

Breadcrumb 12 px `#9b968d` — "Stock" › (`chevron-right` 12 px `#c2beb5`) "Catalogue" (`#55524c`).
`<h1>` "Products" Instrument Sans 23 px 600. Subtitle 13 px `#55524c`: "318 items · prices and
customer-category pricing · last edit 2 h ago by Mamat".
Right: `Import` (`upload`) and `Recipes` (`book-open`) secondary, `New product` (`plus`) primary ink.
**The current `ProductsHeader` card wrapper, the gold icon tile, the italic subtitle and the round
gold pills are all removed.**

### 2. Tabs

`border-bottom:1px solid #e3e1db`. Active "Products": 12.5 px 600 `#1a1917`,
`box-shadow: inset 0 -2px 0 #8a6820`, `padding: 0 2px 9px`. Inactive "Import / Export": 12.5 px
`#7a766e`, `padding: 0 12px 9px`. (Today's tabs are uppercase gold with `tracking-widest` — drop that.)

### 3. Counter strip — replaces `ProductsKpiGrid`

One card, `display:flex; align-items:stretch`, cells `padding:11px 18px` separated by
`border-right:1px solid #eceae5`. Each cell: mono 10 px uppercase `letter-spacing:.12em` `#7a766e`
label (`letter-spacing:.14em`) over a mono 20 px 600 value. **Each cell is a filter toggle**; the active one gets
`background: rgba(138,104,32,.08)` + `box-shadow: inset 2px 0 0 #8a6820`.

All products 318 (active) · Finished 184 · Semi-finished 37 · Raw materials 89 · Combos 8 ·
Inactive 12 (`#7a766e`) · **No cost price 6** (`#b4342c`) with an inline "Fix" link (`#8a6820` 500).

The last two are data-quality counters and are the productivity point of the strip: four decorative
KPI tiles become seven counters that each answer "which rows do I need to look at".

### 4. Filter bar

`display:flex; gap:8px`, controls 34 px tall, radius **3 px** (not `rounded-full`),
`border:1px solid #cdcac2`, `background:#fff`, font 13 px:
search (`flex:1`, `search` icon 15 px `#9b968d`, placeholder "Search by name or SKU…") ·
"All categories" select · "All products" (variant filter) select · `Columns`
(`sliders-horizontal`) · view toggle (two 32 px cells in one bordered box; active
`background: rgba(138,104,32,.12)`, `color:#8a6820`; `layout-grid` / `list`).

### 5. Table

One card, `flex:1`, `overflow:hidden`. Rows are a 12-track CSS grid — reuse `DataTable` and give it
these columns:

```
28px 1.95fr .95fr 1.1fr 1fr .8fr .8fr .8fr .85fr .68fr .68fr 72px
```
`align-items:center; gap:10px; padding:9px 14px`.

- **Header**: `background:#fafaf8`, `border-bottom:1.5px solid #1a1917` — a firm ink rule, not a
  hairline — mono 10 px `letter-spacing:.1em` uppercase `#7a766e`. Cells: select-all checkbox · Product · SKU · Type ·
  Category · **Stock** (right) · Cost (right) · Retail (right) · Wholesale (right) · Margin (right) ·
  Status (center) · Actions (right).
- **Rows**: `border-bottom:1px solid #f3f1ec`, font 13 px.
  - Checkbox: 14 px, `border:1px solid #cdcac2`, radius 3 px. Checked: `background:#8a6820`,
    `border-color:#8a6820`, white `check` 10 px. Selected row: `background:#fafaf8`.
  - Product: `#1a1917` 500. **Not** `font-display` as today. Parent/Variant get an outline badge
    (11 px 600, `padding:1px 6px`, radius 4 px, `border:1px solid #cdcac2`, `#7a766e`);
    variants are indented `padding-left:16px`.
  - SKU: mono 11.5 px `#7a766e`.
  - Type badge: 11 px 600, `padding:2px 7px`, radius 4 px — Finished `rgba(24,122,82,.12)`/`#187a52`;
    Semi-finished `rgba(43,108,156,.12)`/`#2b6c9c`; Raw material `rgba(138,90,16,.12)`/`#8a5a10`;
    Combo `rgba(109,40,217,.12)`/`#6d28d9`. Type comes from `classifyProduct()`.
  - Category: 12.5 px `#55524c` plain text (the `CategoryChip` pill is dropped in list view).
  - **Stock** *(new column)*: mono, `white-space:nowrap`, right-aligned — `current_stock` + `unit`.
    `#55524c` normally; `#8a5a10` 600 at or below `min_stock_threshold`; `#b4342c` 600 at 0;
    `#9b968d` em-dash when `track_inventory` is false. Display-case products read their vitrine
    counter, not global inventory.
  - Cost / Wholesale: mono `#55524c`, em-dash `#9b968d` when 0/null. A **missing cost price** shows
    `#b4342c` — it feeds the "No cost price" counter.
  - Retail: mono `#8a6820` 600 (the one gold on the row).
  - **Margin** *(new column)*: mono `#1a1917`, `(retail − cost) / retail` as a percentage; em-dash
    when either side is missing.
  - Status: centered 11.5 px 600 — Active `#187a52`, Inactive `#7a766e`.
  - Actions: `eye`, `dollar-sign`, `trash-2`, 14 px `#9b968d`, `gap:6px`, right-aligned. Same
    permission gating as today (`onPricing` needs `products.update`, `onDelete` needs `products.delete`).

Row data in the prototype (cost / stock / retail / wholesale / margin):

| Product | SKU | Type | Category | Stock | Cost | Retail | Wholesale | Margin | Status |
|---|---|---|---|---|---|---|---|---|---|
| Croissant beurre | CRO-001 | Finished | Viennoiserie | 18 pc | 6.200 | 15.000 | 12.000 | 58,7% | Active |
| Pain au chocolat | VIE-002 | Finished | Viennoiserie | 11 pc | 6.800 | 16.000 | 12.800 | 57,5% | Active |
| Baguette tradition *(Parent, selected)* | BRD-010 | Finished | Bread | 24 pc | 3.100 | 9.000 | 7.200 | 65,6% | Active |
| — Baguette 250 g *(Variant)* | BRD-010-S | Finished | Bread | 9 pc | 2.200 | 6.500 | — | 66,2% | Active |
| Sourdough 800 g | BRD-021 | Finished | Bread | **3 pc** | 8.400 | 24.000 | 19.200 | 65,0% | Active |
| Focaccia slice | BRD-034 | Finished | Bread | 9 pc | 4.900 | 16.000 | — | 69,4% | Active |
| Cinnamon roll | VIE-018 | Finished | Viennoiserie | **2 pc** | 5.400 | 18.000 | 14.400 | 70,0% | Active |
| Quiche lorraine | SAV-005 | Finished | Savoury | **0 pc** | 11.200 | 32.000 | 25.600 | 65,0% | Active |
| Almond tart | PAT-007 | Finished | Pastry | 7 pc | 9.800 | 28.000 | — | 65,0% | **Inactive** |
| Flat white | COF-002 | Finished | Coffee | — | 4.100 | 32.000 | — | 87,2% | Active |
| Croissant dough (bulk) | SEMI-003 | Semi-finished | Doughs | 14 kg | 4.200 | — | — | — | Active |
| Poolish starter | SEMI-009 | Semi-finished | Doughs | 6 kg | **—** | — | — | — | Active |
| T55 flour 25 kg | RAW-101 | Raw material | Ingredients | 8 sack | 168.000 | — | — | — | Active |
| Butter unsalted 5 kg | RAW-118 | Raw material | Ingredients | **2 ctn** | 412.000 | — | — | — | Active |
| Breakfast combo | CMB-002 | Combo | Combos | — | 10.300 | 39.000 | — | 73,6% | Active |

- **Footer** (`margin-top:auto`, `border-top:1px solid #e3e1db`, `background:#fafaf8`,
  `padding:10px 14px`, `gap:14px`): selection checkbox + "1 selected"; bulk actions
  `Change prices`, `Move category`, `Deactivate` (12.5 px 500 `#8a6820`); right-aligned
  "1–15 of 318" (mono 11.5 px `#7a766e`) + `chevron-left` / `chevron-right` 15 px `#7a766e`.
  Bulk actions are **new** and require the corresponding RPCs + permission gates.

---

## Screen: `4a` — Stock alerts

Route: `/backoffice/inventory/alerts` — the surface `AlertsBadge.tsx` links to. Frame 1440 × 900.
*Stock* tab active. **List archetype.**

- Header: crumb "Stock › Watch"; `<h1>` "Stock alerts"; subtitle "12 items under threshold · 3 will
  run out before the next delivery · coverage computed on 14-day average use".
  Actions: `Snooze rules` (`bell-off`), `Thresholds` (`sliders-horizontal`),
  **`Create PO from selection`** (`package-plus`, ink primary).
- Counter strip (each a filter): All alerts 12 · **Will run out 3** (`#b4342c`) ·
  Below min 9 (`#8a5a10`) · Expiring < 3 d 4 · Overstock 2 · **Late deliveries 1** (`#8a5a10`, "View").
- Filters: search by product or SKU · All locations · All suppliers · **Sort: coverage ↑**.
- Table, 12 tracks: `18px 1.9fr .95fr 1.05fr .8fr .7fr .95fr .8fr 1.25fr .75fr .95fr 88px` —
  severity dot · Product · SKU · Location · **On hand** · Min · **Coverage** · Daily use · Supplier ·
  Lead · **Order qty** · Action ("Add to PO").
  - **Coverage** (days of stock left = on hand ÷ 14-day average daily use) is the column the page is
    sorted on and the reason it exists: `#b4342c` when below lead time, `#8a5a10` when within ~2×
    lead time, `#55524c` otherwise. On hand takes the same three-way coloring.
  - **Order qty** is the suggested quantity from `get_reorder_suggestions_v1`, not a user entry.
- Footer with a selection made: "3 selected · 3 suppliers → 3 draft POs" + `Create POs` +
  `Snooze 24 h`. **One PO per supplier** — the grouping is the whole value of selecting here.

Data: `get_low_stock_v1` + `get_reorder_suggestions_v1` (already used by `AlertsBadge`), joined to
suppliers for lead time. Coverage and Order qty are computed server-side.

---

## Screen: `4b` — B2B orders

Route: `/backoffice/b2b/orders`. Frame 1440 × 900. *Sales* tab active. **List archetype.**

- Header: crumb "Sales › Wholesale"; `<h1>` "B2B orders"; subtitle "42 orders this month ·
  Rp 68,4 jt invoiced · Rp 11,2 jt outstanding across 7 customers".
  Actions: `Customers` (`users`), `Export` (`file-down`), `New order` (`plus`, ink).
- Counter strip: All orders 42 · Draft 3 · Confirmed 12 · **In production 6** (`#2b6c9c`) ·
  **To deliver today 2** (`#8a5a10`) · Awaiting payment 9 · **Overdue 4** (`#b4342c`, "Chase").
- Table, 9 tracks: `18px 1fr 2fr 1.1fr .7fr 1.05fr 1.2fr 1.2fr 88px` — severity dot · Order (mono
  600) · Customer + segment qualifier (`· Hotel`, `· Café` in 11.5 px `#9b968d`) · Delivery ·
  Items · Amount · **Fulfilment badge** · **Payment status** · Action.
  - **Fulfilment and payment are separate columns.** Fulfilment: Draft (`#f0efec`/`#7a766e`),
    Confirmed / In production (`rgba(43,108,156,.12)`/`#2b6c9c`), Delivered
    (`rgba(24,122,82,.12)`/`#187a52`). Payment is text, not a badge: Paid `#187a52`,
    Due in N d `#8a5a10`, **Overdue N d** `#b4342c`, On credit / Not invoiced `#7a766e`.
  - Delivery date is `#8a5a10` when it is today, `#55524c` when future, `#7a766e` once delivered.
  - Action is contextual, one word: `Confirm` (draft) · `Open` (in flight) · `Invoice` (delivered,
    paid) · `Remind` (due) · `Chase` (overdue).
- Footer bulk actions: `Print delivery notes`, `Send invoices`, `Mark delivered`.

---

## Screen: `4c` — Daily sales

Route: `/backoffice/reports/sales/daily`. Frame 1440 × 1000. *Reports* tab active.
**Report archetype.**

- Header: crumb "Reports › Sales"; `<h1>` "Daily sales"; subtitle "Wednesday 5 August 2026 ·
  06:30–18:00 · 2 registers · figures net of refunds". Actions: **date control first**
  (`calendar` "5 Aug 2026" + chevron), `Compare` (`git-compare`), `Print` (`printer`),
  `Export` (`file-down`, ink).
- KPI row, 6 tiles — **the same tile component as the dashboard strip, six of them here**, not seven:
  a report is scoped to a period, so `Customers` and `Cash on hand` (a now-value) do not belong.
  **Net revenue as the ink hero** Rp 8,42 jt (▲12,4% yest · ▲6,1% D-7); then Gross revenue
  Rp 8,61 jt · **Refunds & voids** Rp 186.000 (0,4% of gross · 4 tickets) · Orders 247 ·
  Avg basket Rp 34.100 · **Discounts** Rp 412.000 (4,8% of gross · 31 tickets).
  Refunds and discounts are on the report and not on the dashboard on purpose — they are what you
  audit, not what you monitor.
- Chart row (`1.7fr / 1fr`): **Sales by hour, today vs last Wednesday** (paired bars, 06→17,
  `#c9dcea` behind `#2b6c9c`; subtitle "Peak 08:00–09:00 · Rp 2,84 jt in two hours") ·
  **Revenue by category** (5 labelled bars: Viennoiserie 31% / Bread 24% / Coffee 19% /
  Savoury 14% / Pastry 12%, using the COGS ramp) over a divider, then **By order type** as the
  same 10 px share bar as the dashboard.
- Breakdown row, 4 cards: **Top products** (6 rows) · **Payments** (4 methods + "Total collected"
  Rp 8,42 jt + "Cash expected in drawer" Rp 1,84 jt) · **By cashier** (orders + revenue per
  cashier per register, ending on "Voids by cashier · Dewi 3" in `#8a5a10`) ·
  **Register close** (per-register status badge + opening float, footer "4 Aug not reconciled" +
  "Open Z-report").
- The report must be **printable** — it is what gets handed to the accountant. `Print` renders
  without the shell.

---

## Screen: `5a` — Purchase order detail

Route: `/backoffice/purchasing/purchase-orders/:id` — replaces
`pages/purchasing/PurchaseOrderDetailPage.tsx`. Frame 1440 × 940. *Purchase* tab active.
**Document archetype.** The existing page's structure is right; this is a presentation rewrite.

- Header: crumb "Purchase › Purchase orders › PO-2026-0184"; `<h1>` **in JetBrains Mono** (it is a
  document number) + `PARTIAL` (`rgba(138,90,16,.12)`/`#8a5a10`) + `UNPAID`
  (`rgba(180,52,44,.12)`/`#b4342c`); subtitle "CV Sumber Rasa · ordered 2 Aug · expected 6 Aug ·
  2 of 5 lines still open".
  Actions: `Print`, **`Edit` disabled** (`#fafaf8` / `#9b968d`, `title` "Locked — PO already
  received or paid" — the D6 lock), `Cancel` (danger outline `rgba(180,52,44,.35)` / `#b4342c`),
  `Receive remaining` (`truck`, ink).
- Left column (`2fr`):
  - **Order information** — 8 inset panels in a 4-col grid built as `gap:1px` over an `#eceae5`
    background, each panel `background:#fafaf8; padding:9px 12px`, `SUB` label + 13 px value:
    Supplier · Order date · Expected delivery · Actual delivery · Payment terms · Ordered by ·
    Receiving section · VAT rate.
  - **Ordered items** — 7 tracks `2.2fr .8fr .8fr .6fr 1fr 1.1fr .9fr`: Product + SKU · Ordered ·
    **Received** (`#187a52` complete / `#8a5a10` short / `#b4342c` none) · Unit · Unit cost ·
    Subtotal · **per-line status** (`Complete` / `8 short` / `Not received`). Header
    "5 lines · 72 of 86 units received"; footer "2 lines short — receiving them closes the PO" +
    `Receive remaining`.
  - **Goods receipt notes** — GRN · Date · Subtotal · VAT · Total.
- Right column (`1fr`): **Financial summary** (Subtotal Rp 10.536.000 · VAT 11% Rp 1.158.960 ·
  **Total ordered Rp 11.694.960** above a divider · Received to date Rp 10.460.640 ·
  Still to receive Rp 1.234.320 in `#8a5a10`) · **Payment** (`UNPAID` badge, Total due / Paid /
  Remaining, `Record payment` ink button, and the note "Payment is tracked independently from goods
  reception — a PO can be paid before it is complete") · **Status timeline** · **Notes**.
- **Reconciliation is a requirement, not a detail.** Received-to-date = Σ(received qty × unit cost)
  + VAT; still-to-receive = total ordered − received to date. All three must derive from the same
  line data shown in the table.

---

## Screen: `5b` — Settings hub

Route: `/backoffice/settings` — replaces `pages/settings/SettingsHubPage.tsx`. Frame 1440 × 1000,
**the one screen that scrolls** (`overflow-y:auto`). *Admin* tab active. **Hub archetype.**

- Header: crumb "Admin › Settings"; `<h1>` "Settings"; subtitle "20 configuration surfaces ·
  last change 4 Aug 18:12 by Mamat · every change is written to the audit trail".
  Actions: `Settings history` (`history`), `Find a setting` (`search`).
- Seven groups, unchanged from the `SECTIONS` array — Business (3) · POS & sales (6) ·
  Inventory (1) · Notifications & templates (3) · Finance (3) · Security & access (3) ·
  Network (1) = **20 tiles**. Group heading = `LBL` + count in mono 11 px `#9b968d`.
  Tiles in a 4-col grid, `gap:10px`.
- Tile: `icon` `#8a6820` 15 px + title 13.5 px 600 (+ optional neutral qualifier badge) ·
  blurb 12.5 px `#55524c` · **current-value line 11.5 px `#9b968d`**.
  Keep the existing titles, blurbs and icons verbatim; the value line is the new part, e.g.
  Company → "PT Artisan Bakery Tenggara · IDR · NPWP set" · Business hours → "06:30–18:00 ·
  closed Monday" · POS configuration → "2 registers · float Rp 500.000" · Payment methods →
  "4 enabled · QRIS, cash, card, B2B credit" · Floor plan → "14 tables · 3 zones" ·
  KDS → "warn 8 min · urgent 15 min" · Inventory config → "weekly opname · 12 alerts open" ·
  Financial → "Jul 2026 closed · Aug open" · Expense thresholds → "approval over Rp 2 jt" ·
  B2B settings → "9 customers · 2 over limit" · Security → "timeout 30 min · lockout 5 tries" ·
  Roles → "6 roles · 148 permissions" · Settings history → "212 entries" ·
  Network devices → "6 devices · 1 offline".
- **Each value line is a real query.** They are cheap (one aggregate per surface) and they are what
  turns a menu into a status page. `Settings history` keeps its `adminOnly` gate, rendered as an
  `Admin only` qualifier badge; permission-gated tiles stay hidden as they are today.
- Card-per-tile `<Link>` wrapping, focus ring and hover behavior are unchanged.

---

## Screen: `5c` — New expense

Route: `/backoffice/expenses/new` — replaces `pages/expenses/NewExpensePage.tsx` +
`features/expenses/components/ExpenseForm.tsx`. Frame 1440 × 900. *Finance* tab active.
**Form archetype.** The field set is exactly `ExpenseFormValues` — do not add fields.

- Header: crumb "Finance › Expenses › New"; `<h1>` "New expense" + `DRAFT` badge
  (`#f0efec`/`#7a766e`); subtitle "Saved as a draft first · submitting it requests approval under
  the configured thresholds". Actions: `Back to expenses` (`arrow-left`),
  **`Duplicate last`** (`copy` — the `duplicateFrom` navigation-state path already exists),
  `Save as draft` (`save`, ink).
- Left column (`1.6fr`), three cards:
  - **Expense** — 2-col grid: `Category` * (`CategoryPicker`) · `Date` * (mono, `calendar`) ·
    `Payment method` * (cash / **Bank transfer** / card / credit — the four enum values) ·
    `Vendor / supplier name` (hint "Free text · optional, max 120 characters") ·
    `Description` * spanning both columns (hint "Short description · max 250 characters").
  - **Amount** — 3-col: `Amount (IDR)` * · `VAT amount (IDR)` · `Total` read-only.
    Header note: **"VAT is entered, not derived — it must not exceed the amount"**. That is the real
    validation (`vat_amount` is a user field with `vatNum > amountNum` rejected); there is no VAT
    rate, no per-account recoverability flag, and no generated journal entry on this screen.
  - **Receipt** — dashed `#cdcac2` drop zone on `#fafaf8`, note "Optional · not carried over when
    duplicating" (matches `ReceiptUploader` + the `duplicateFrom` rule).
- Right column (`1fr`): **Totals** (Amount / VAT / **Total** above a divider) ·
  **Approval chain** · **Recent · this vendor** (4 rows date / category / amount / status, ending on
  "+8,4% vs the July average" in `#8a5a10`).
- **Approval chain** mirrors `ApprovalTimeline.tsx` and `ThresholdResolutionBadge.tsx` exactly:
  card title "Approval chain", badge **`{n}-step approval required`** (or `Manager approval
  required` at one step, `Auto-approved` under threshold), and steps rendered as
  **`Step {i}: {step.label}`** with `step.role_codes.join(', ')` beneath. Icons: `check`
  `#187a52` done, `circle-dot` `#2b6c9c` current, `circle` `#c2beb5` pending. Note under the
  title: "The chain is snapshotted from Settings · Expense thresholds when the expense is submitted.
  Separation of duties applies: you cannot approve an expense you created."
  The chain and the step count come from the resolved snapshot — **never hardcode a threshold
  amount or a step count**.
- `Submit for approval` (`send`, ink) sits at the bottom of that card, not in the header: it is the
  action the card explains.

---

## Interactions & Behavior

- **Domain tab** — click opens its drop-panel; click again, `Esc`, or an outside click closes it.
  Hover on an already-open bar switches panel without a click (standard menubar behavior). Keyboard:
  `←`/`→` move between tabs, `↓` enters the panel, `Tab` walks the links.
- **⌘K / Ctrl-K** — command palette over the whole app: 560 px, centered, radius 10 px,
  `box-shadow: 0 18px 48px rgba(28,23,18,.22)`; input row 14–16 px with an `Esc` hint; results in
  labelled groups ("Pages", "Actions"), the highlighted row `background: rgba(138,104,32,.10)` with
  a `↵` hint. Each result shows its breadcrumb (e.g. "Reports › Inventory"). Fuzzy match on page
  title, and results respect permissions. (See option `1b` in the HTML for the exact palette
  rendering — the palette is part of the accepted design even though `1b`'s sidebar is not.)
- **Header shortcut buttons** — pinnable per user; persist the pin set (localStorage is what the
  sidebar already does with `bo:sidebar:*`, or a user-preferences row).
- **Needs-you item** — the whole cell is clickable, going to the resolving screen; the action link is
  the same target. **The bar count, the "All N →" link and the bell badge all read the same
  aggregate** — three places showing three numbers is the failure mode this replaces.
- **Counter strip cell (every list screen)** — toggles a filter on the table; reflect it in the URL
  (`useUrlState` already exists). Multiple strips are single-select, not multi.
- **Table row** — click opens the record's detail; action icons `stopPropagation` as they do today.
- **Selection → bulk action** — selection is per-page and survives filtering within the page; the
  footer states what the action will produce before it runs (`4a`: "3 selected · 3 suppliers → 3
  draft POs"). Bulk actions are permission-gated and idempotent (each needs an idempotency key).
- **Locked action** — renders disabled with the reason in `title`, never hidden (`5a`'s Edit).
  Hiding an action the user expects reads as a bug; disabling it with a reason teaches the rule.
- **Report date / period control** — the first action button in the header, not a filter row; it
  belongs in the URL so a report can be linked. `Compare` opens a second period alongside.
- **Form submit vs save** — `Save as draft` is the header primary; the state-changing action
  (`Submit for approval`) lives at the bottom of the card that explains its consequence. Never put
  an irreversible action in the header next to a reversible one.
- **Hub tile value lines** — one cheap aggregate per surface, fetched together in a single hub query;
  a failed aggregate renders the tile without its value line rather than failing the page.
- **Refresh cadence** — the "live" markers mean it: open orders and vitrine on Supabase Realtime;
  KPI + charts on the existing 60 s React Query polling; "last sync HH:MM" in the header reflects
  the most recent successful fetch.
- **Loading** — skeletons, not spinners: KPI tiles keep their box and show a `#f0efec` bar where the
  value goes; table shows 15 skeleton rows so the layout does not jump.
- **Empty / restricted** — keep today's behavior: a 42501 from the dashboard RPC renders the
  "metrics are restricted" card instead of an error; each card degrades on its own rather than
  taking the page down.
- **Reduced motion** — no chart entry animation under `prefers-reduced-motion`.

## State Management

Per screen, on top of what exists:

- Dashboard: `useDashboardOverview()` extended with `vs_yesterday` / `vs_d7` per KPI, gross margin,
  cash on hand, MTD COGS/OpEx by account, and open orders. `useDisplayStock()` unchanged.
  Action queue: one aggregate hook (unclosed registers + low stock + reorder suggestions +
  pending PO receipts + overdue B2B invoices), permission-filtered.
- Products: `useProducts()` already returns `current_stock`, `min_stock_threshold`, `unit`,
  `track_inventory`, `is_display_item` — the Stock and Margin columns need **no new query**.
  Local state: search, categoryId, variantFilter, typeFilter (from the counter strip), view,
  selection set, page.
- Stock alerts (`4a`): `get_low_stock_v1` + `get_reorder_suggestions_v1`, joined to suppliers for
  lead time. **Coverage** (on hand ÷ 14-day average daily use) and **Order qty** are new server-side
  computations. Local state: alert-type filter, location, supplier, sort, selection set.
- B2B orders (`4b`): the existing B2B orders list, extended with a derived payment status per order
  (paid / due in N / overdue N / on credit / not invoiced) computed from the invoice ledger — the
  same independence rule as `5a`'s PO payment. Local state: strip filter, customer, status, period.
- Daily sales (`4c`): the existing daily-sales report query, extended with refunds/voids and
  discount totals with ticket counts, per-cashier-per-register aggregates, and register-close state.
  The hourly series needs the same weekday one week back.
- Purchase order (`5a`): `usePurchaseOrderDetail`, `usePoPayments`, `useReceivePurchaseOrder`,
  `useCancelPurchaseOrder`, `useUpdatePurchaseOrder` — all unchanged. Received-to-date and
  still-to-receive are **derived client-side from the line data already returned**; do not add a
  field for them.
- Settings hub (`5b`): the `SECTIONS` array is unchanged; add one hub-summary query returning the
  per-surface value lines. Permission and `adminOnly` filtering unchanged.
- New expense (`5c`): `useCreateExpense` + `create_expense_v1`, `ExpenseForm` validation
  unchanged (amount > 0, VAT ≥ 0 and ≤ amount, description and category required). The approval
  chain preview comes from the threshold resolution for the current amount
  (`useExpenseThresholds` / `ApprovalStep[]`), and the recent-vendor list from `useExpensesList`
  filtered on the vendor. `draftId` / `idempotency_key` behavior unchanged.
- Shell: open domain tab (transient), palette open (transient), pinned shortcuts (persisted).
  The `bo:sidebar:groups` / `bo:sidebar:subgroups` / `bo:sidebar:collapsed` keys become obsolete.

## Design Tokens

Existing tokens (`packages/ui/src/tokens/colors.css`, `.theme-backoffice`) reused as-is:

| Value | Token |
|---|---|
| `#8a6820` | `--gold-base` |
| `rgba(138,104,32,.12)` | `--gold-soft` |
| `#187a52` | `--green-base` / `--success` |
| `#b4342c` | `--red-base` / `--danger` |
| `#2b6c9c` | `--blue-info` / `--info` / `COGS_BASE` |
| `#8a5a10` | `--amber-warn` / `--warning` / `OPEX_BASE` |
| `#4f93bf` `#8cc3e0` `#0d5f8a` `#17456b` | COGS ramp, `chartColors.ts` |
| `#c2872a` `#d9a44a` | OpEx ramp, `chartColors.ts` |
| `#c2beb5` | `--border-strong` / `CHART_SERIES_OFF` |
| `#6d28d9` | `--cat-violet` (109 40 217) |

New neutrals to add to `.theme-backoffice` (they replace the warm ivory ramp on these screens):

| Value | Role |
|---|---|
| `#f0efec` | page background (was `#f2ece1`) |
| `#ffffff` | card surface (was `#faf6ef`) |
| `#fafaf8` | table header / footer / inert field fill |
| `#e3e1db` | card border (was `#e0d7c8`) |
| `#eceae5` | inner divider |
| `#f3f1ec` | table row divider |
| `#cdcac2` | control border |
| `#1a1917` | primary text (was `#1c1712`) |
| `#55524c` | secondary text (was `#4b4238`) |
| `#7a766e` | muted text (was `#6d6355`) |
| `#9b968d` | subtle text / disabled icon |
| `#201d19` | top bar + primary button fill |
| `#2e2925` `#3a342c` `#453e35` | top-bar hover, avatar, control border on ink |
| `#c4bcae` `#a09789` `#e8e1d5` `#fffdf9` | text on ink, in increasing brightness |
| `#d3ab5c` | active-tab underline on ink (the gold, lightened for dark ground) |
| `#c9dcea` | comparison series fill (light blue) |
| `#dfddd6` | page-ground grid dot |
| `#86efac` | positive delta on the ink hero tile (`--cat-green`, dark-theme value) |

Spacing: 22 px page gutter, 14 px between page blocks, 12 px between cards in a row, 10 px between
KPI tiles, 16 px card padding (13–15 px on the compact KPI tiles), 8–9 px between rows inside a card.
Radius: 6 px frame, 4 px card, 3 px control/button, 2 px badge, bar and checkbox;
9 px / 50% kept on count pills and avatars.
Shadows: cards are flat (border only) — no `shadow-sm`; overlays use
`0 18px 40px rgba(28,23,18,.20)` (drop-panel) and `0 18px 48px rgba(28,23,18,.22)` (palette).
Type: 23–24 px 600 page title · 16 px 600 card title (or mono 11 px uppercase section label) ·
13–13.5 px body · 12–12.5 px secondary · 11–11.5 px meta · mono 10–11 px labels and deltas ·
mono 20–28 px 600 values.

## Assets

- `assets/brand-logo.png` — copied from `apps/backoffice/public/brand-logo.png`. Only used in the
  `0a` baseline; the new top bar uses a **`B` monogram tile** instead (Playfair Display on
  `#8a6820`), since a 96 px logo block was a large part of the old sidebar's wasted space. If you
  want the real mark there, `packages/ui/src/assets/brand-mark.svg` at ~26 px is the right asset.
- **Icons: lucide.** The prototype loads lucide from a CDN; the app already has `lucide-react`.
  Icons used: `layout-dashboard, shopping-bag, boxes, clipboard-check, wallet, bar-chart-3, users,
  settings, coffee, log-out, search, gauge, list-checks, calendar-days, calendar, bell-ring,
  building-2, signature, coins, panel-left-close, chevron-right, chevron-down, chevron-left,
  refresh-cw, file-down, alert-triangle, package-plus, megaphone, package, chef-hat, layers-3, tag,
  arrow-left-right, clipboard-list, git-commit-horizontal, store, bell, clock, upload, book-open,
  plus, sliders-horizontal, layout-grid, list, eye, dollar-sign, trash-2, check`.
- No photography or illustration is used anywhere, by design.

## Files

- `Backoffice Landing.dc.html` — every frame on one canvas. Open it in a browser and pan/zoom;
  `#id` in the URL jumps to a frame.
  **Build these:** `#1c` Dashboard · `#2a` Products · `#4a` Stock alerts · `#4b` B2B orders ·
  `#4c` Daily sales · `#5a` Purchase order · `#5b` Settings · `#5c` New expense.
  **Reference only:** `#3a` is the accepted aesthetic shown on the dashboard (identical to `#1c`);
  `#3b` Press / `#3c` Console / `#3d` Calm are rejected aesthetics; `#1a` / `#1b` are rejected
  navigation options (but `#1b`'s ⌘K palette is part of the accepted design); `#0a` is the current
  dashboard recreated for before/after.
- `support.js` — runtime for the prototype format. Not part of the design; do not port it.
- `assets/brand-logo.png` — see above.

Source files the design was read from and should be edited against:
`apps/backoffice/src/pages/Dashboard.tsx` · `pages/Products.tsx` ·
`layouts/BackofficeLayout.tsx` · `layouts/Sidebar.tsx` · `layouts/Topbar.tsx` ·
`components/PageHeader.tsx` ·
`features/dashboard/components/*` · `features/dashboard/hooks/useDashboardOverview.ts` ·
`features/products/components/{ProductsHeader,ProductsPageTabs,ProductsKpiGrid,ProductsFilters,ProductsTable}.tsx` ·
`features/products/hooks/useProducts.ts` · `features/products/types.ts` ·
`features/inventory/hooks/useDisplayStock.ts` ·
`features/inventory-alerts/components/AlertsBadge.tsx` ·
`features/reports/utils/chartColors.ts` ·
`pages/purchasing/PurchaseOrderDetailPage.tsx` · `pages/settings/SettingsHubPage.tsx` ·
`pages/expenses/NewExpensePage.tsx` · `features/expenses/components/ExpenseForm.tsx` ·
`features/expenses/components/ApprovalTimeline.tsx` ·
`features/expenses/components/ThresholdResolutionBadge.tsx` ·
`packages/ui/src/components/{KpiTile,SectionLabel}.tsx` · `packages/ui/src/primitives/Card.tsx` ·
`packages/ui/src/tokens/{colors,typography,semantic}.css`
