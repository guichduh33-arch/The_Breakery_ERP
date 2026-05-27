# Backoffice Menu Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre la navigation `apps/backoffice/src/layouts/Sidebar.tsx` de 3 groupes flous (Operations/Management/Admin) vers 7 groupes propres avec sous-sections visuelles internes. Aucune URL ne change, uniquement labels + groupement.

**Architecture:** Modification d'un seul fichier de production (`Sidebar.tsx`) + de son fichier de tests (`Sidebar.test.tsx`). Introduction d'un primitive interne `SubgroupLabel` + élargissement du type `NavGroup` en union discriminée pour supporter les sous-sections. Logique de filtre de permissions étendue pour traverser les subgroups (un subgroup vide est masqué, un group dont tous les subgroups sont vides est masqué).

**Tech Stack:** TypeScript, React 18, react-router-dom, lucide-react icons, Tailwind utility classes via `cn()` helper de `@breakery/ui`, Vitest + @testing-library/react.

**Spec:** [`../specs/2026-05-27-backoffice-menu-reorg-spec.md`](../specs/2026-05-27-backoffice-menu-reorg-spec.md) (committed `18e884f`)

**Branch:** `feat/bo-menu-reorg` (créée depuis `master` @ `18e884f` post-spec-commit)

---

## File Structure

**Modified files (2) :**

| Path | Responsibility | Changes |
|---|---|---|
| `apps/backoffice/src/layouts/Sidebar.tsx` | Production sidebar component | (a) New `SubgroupLabel` primitive component (b) `NavGroup` type widened to discriminated union (c) `GROUPS` constant rewritten — 3 → 7 groups, 9 internal subgroups (d) Permission-filter logic extended to traverse subgroups (e) Render path branches by group shape |
| `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` | Sidebar unit tests | Adapt assertions to new structure : group count 3→7, subgroup rendering, drops, renames, permission filter still works |

**No files created.** No new exports from `@breakery/ui` — `SubgroupLabel` stays internal to `Sidebar.tsx`.

---

## Wave 0 — Setup

### Task 0.A : Create feature branch + commit plan

- [ ] **Step 1: Verify clean working tree**

Run: `git status --short`
Expected: empty output (or only this plan file pending).

- [ ] **Step 2: Create the feature branch from current master**

Run: `git checkout -b feat/bo-menu-reorg`
Expected: `Switched to a new branch 'feat/bo-menu-reorg'`

- [ ] **Step 3: Stage and commit the plan**

```bash
git add docs/workplan/plans/2026-05-27-backoffice-menu-reorg-plan.md
git commit -m "docs(bo): wave 0 — plan backoffice menu reorg"
```

---

## Wave 1 — Read & verify current state

### Task 1.A : Read the current `Sidebar.tsx` end-to-end

**Files:** None modified. Pure read.

- [ ] **Step 1: Read full file `apps/backoffice/src/layouts/Sidebar.tsx`**

Use the Read tool on the full file (225 lines). Confirm:
- Line 36-46 : `NavItem` interface with `external`, `permission`, `indent` fields
- Line 48-51 : `NavGroup` interface
- Line 53-132 : current `GROUPS` array (3 entries)
- Line 134-174 : `NavItemLink` render component (handles external + indent + active state)
- Line 176-184 : permission-filter logic
- Line 186-224 : `Sidebar` JSX with `SectionLabel`, alerts badge, group loop

No changes yet. Goal : confirm the mental model matches the spec before writing code.

### Task 1.B : Read the current `Sidebar.test.tsx`

**Files:** None modified. Pure read.

- [ ] **Step 1: Read full file `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx`**

Use the Read tool. Identify:
- Which group labels are asserted ("Operations", "Management", "Admin")
- Which nav item labels are asserted by exact string match
- Which permission gates are tested
- Whether snapshots are used

Note all hardcoded labels that will need updating. This list will drive Wave 5 test updates.

---

## Wave 2 — Type model + SubgroupLabel primitive

### Task 2.A : Widen `NavGroup` to a discriminated union

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:48-51`

- [ ] **Step 1: Replace the `NavGroup` interface with a union type**

Replace lines 48-51 :

```ts
interface NavGroup {
  label: string;
  items: NavItem[];
}
```

with :

```ts
interface NavSubgroup {
  label: string;
  items: NavItem[];
}

type NavGroup =
  | { label: string; items: NavItem[] }
  | { label: string; subgroups: NavSubgroup[] };
```

- [ ] **Step 2: Typecheck (will fail because `GROUPS` still uses old shape)**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: errors on the `GROUPS` array literal (lines 53-132) because the discriminated union narrowing will require `items` or `subgroups`. We will fix this in Wave 3.

Leave the errors for now — they will resolve once `GROUPS` is rewritten.

### Task 2.B : Add `SubgroupLabel` internal primitive

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` — insert new function above `NavItemLink` (after line 132).

- [ ] **Step 1: Insert the `SubgroupLabel` component**

Insert immediately after the closing `];` of `GROUPS` (currently line 132) — see Wave 3 for the new GROUPS location — and before `function NavItemLink` :

```tsx
function SubgroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-muted/70">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Ensure `ReactNode` is imported**

Check line 20 (the react-router-dom import). Add at the top of the import block :

```ts
import type { ReactNode } from 'react';
```

If a `React` default import or another named import from 'react' already exists, add `ReactNode` to that named import instead.

- [ ] **Step 3: Run typecheck (still expected to fail on GROUPS — unchanged)**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: same errors as Task 2.A — `GROUPS` still using old shape. `SubgroupLabel` itself should not introduce new errors.

### Task 2.C : Commit type widening + SubgroupLabel

- [ ] **Step 1: Commit (typecheck still failing but isolated to GROUPS — known temporary state)**

```bash
git add apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "refactor(bo-nav): widen NavGroup to discriminated union + add SubgroupLabel primitive"
```

---

## Wave 3 — Rewrite GROUPS constant

### Task 3.A : Replace the entire `GROUPS` array

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:53-132`

- [ ] **Step 1: Verify import set covers all icons needed**

The new `GROUPS` uses icons : `LayoutDashboard`, `Printer`, `ShoppingBag`, `Users`, `Tag`, `Building2`, `Banknote`, `Settings`, `Megaphone`, `Heart`, `ClipboardCheck`, `Package`, `Boxes`, `ChefHat`, `BookOpen`, `ClipboardList`, `GitCommitHorizontal`, `BellRing`, `MapPin`, `Receipt`, `Scale`, `Calculator`, `LineChart`, `Coins`, `Signature`, `BarChart3`, `PieChart`, `Layers3`, `TrendingUp`, `AlertTriangle`, `Clock4`, `FileSpreadsheet`, `Sparkles`, `Cake`, `Shield`, `CalendarDays`, `Mail`, `FileText`, `ShieldCheck`, `Network`, `UserPlus` (drop — no longer needed), `Monitor` (drop — no longer needed), `ChefHat as KitchenIcon` (drop — no longer needed).

Open `Sidebar.tsx:21-30`. Remove `Monitor`, `UserPlus`, and the `ChefHat as KitchenIcon` alias from the import block. Confirm all other icons listed above are imported. If `Network` is not yet imported, add it.

After cleanup, the import block at lines 21-30 should resemble :

```ts
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Building2,
  Calculator, BarChart3, Settings, Tag, Heart, PieChart, Shield,
  ChefHat, BookOpen, ClipboardList, GitCommitHorizontal, BellRing, MapPin,
  Receipt, ShieldCheck, CalendarDays, Mail, FileText, Clock4, AlertTriangle, FileSpreadsheet,
  Printer, Network, Coins, Scale, Banknote, Layers3,
  LineChart, Sparkles, Megaphone, Cake,
  ClipboardCheck, TrendingUp, Signature, ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
```

(Note : `ShoppingCart` retained for `Purchase Orders`. `UserPlus`, `Monitor`, `KitchenIcon` removed.)

- [ ] **Step 2: Replace the entire `GROUPS` array (lines 53-132)**

Replace with :

```ts
const GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/backoffice', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/backoffice/print-queue', label: 'Print Queue', icon: Printer, permission: 'print_queue.read' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/backoffice/orders', label: 'Orders', icon: ShoppingBag, permission: 'orders.read', end: true },
      { to: '/backoffice/customers', label: 'Customers', icon: Users, permission: 'customers.read', end: true },
      { to: '/backoffice/customers/categories', label: 'Customer Categories', icon: Tag, permission: 'customer_categories.read', indent: 1 },
      { to: '/backoffice/b2b', label: 'B2B Wholesale', icon: Building2, permission: 'customers.read', end: true },
      { to: '/backoffice/b2b/payments', label: 'Payments', icon: Banknote, permission: 'customers.read', indent: 1 },
      { to: '/backoffice/b2b/settings', label: 'B2B Credit Settings', icon: Settings, permission: 'settings.read', indent: 1 },
      { to: '/backoffice/promotions', label: 'Promotions', icon: Megaphone, permission: 'promotions.read' },
      { to: '/backoffice/loyalty', label: 'Loyalty', icon: Heart, permission: 'loyalty.read' },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { to: '/backoffice/purchasing/purchase-orders', label: 'Purchase Orders', icon: ClipboardCheck, permission: 'purchasing.po.read' as never },
      { to: '/backoffice/suppliers', label: 'Suppliers', icon: Building2, permission: 'suppliers.read' },
    ],
  },
  {
    label: 'Stock Management',
    items: [
      { to: '/backoffice/products', label: 'Products', icon: Package, end: true },
      { to: '/backoffice/categories', label: 'Product Categories', icon: Tag, permission: 'categories.read', indent: 1 },
      { to: '/backoffice/inventory', label: 'Stock & Inventory', icon: Boxes, permission: 'inventory.read', end: true },
      { to: '/backoffice/inventory/recipes', label: 'Recipes', icon: BookOpen, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/production', label: 'Production', icon: ChefHat, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/opname', label: 'Opname', icon: ClipboardList, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/movements', label: 'Live Movements', icon: GitCommitHorizontal, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/alerts', label: 'Alerts', icon: BellRing, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/sections', label: 'Sections', icon: MapPin, permission: 'inventory.read', indent: 1 },
    ],
  },
  {
    label: 'Finance',
    subgroups: [
      {
        label: 'Expenses',
        items: [
          { to: '/backoffice/expenses', label: 'Expenses', icon: Receipt, permission: 'expenses.read' },
          { to: '/backoffice/settings/expense-thresholds', label: 'Expense Thresholds', icon: Scale, permission: 'expenses.thresholds.read' },
        ],
      },
      {
        label: 'Accounting',
        items: [
          { to: '/backoffice/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen, permission: 'accounting.coa.read' },
          { to: '/backoffice/accounting/journal-entries', label: 'Journal Entries', icon: ClipboardList, permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/general-ledger', label: 'General Ledger', icon: LineChart, permission: 'accounting.gl.read' },
          { to: '/backoffice/accounting/trial-balance', label: 'Trial Balance', icon: Scale, permission: 'accounting.tb.read' },
          { to: '/backoffice/accounting/mappings', label: 'Account Mappings', icon: GitCommitHorizontal, permission: 'accounting.read' },
          { to: '/backoffice/settings/accounting', label: 'Fiscal Periods', icon: Calculator, permission: 'accounting.period.close' },
          { to: '/backoffice/cash-register/zreports', label: 'Cash Closing (Z-Reports)', icon: Signature, permission: 'zreports.read' as never },
        ],
      },
    ],
  },
  {
    label: 'Reports',
    subgroups: [
      {
        label: '',
        items: [
          { to: '/backoffice/reports', label: 'Reports Hub', icon: BarChart3, permission: 'reports.read', end: true },
        ],
      },
      {
        label: 'Sales reports',
        items: [
          { to: '/backoffice/reports/sales-by-hour', label: 'Sales by Hour', icon: BarChart3, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-category', label: 'Sales by Category', icon: PieChart, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/sales-by-staff', label: 'Sales by Staff', icon: Users, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/basket-analysis', label: 'Basket Analysis', icon: Layers3, permission: 'reports.sales.read' },
          { to: '/backoffice/reports/payment-by-method', label: 'Payment by Method', icon: Receipt, permission: 'reports.financial.read' as PermissionCode },
        ],
      },
      {
        label: 'Inventory reports',
        items: [
          { to: '/backoffice/reports/stock-variance', label: 'Stock Variance', icon: Boxes, permission: 'reports.inventory.read' },
          { to: '/backoffice/reports/stock-movements', label: 'Stock Movement History', icon: GitCommitHorizontal, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/wastage', label: 'Wastage & Spoilage', icon: AlertTriangle, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/perishable-turnover', label: 'Perishable Turnover', icon: Clock4, permission: 'reports.inventory.read' as PermissionCode },
          { to: '/backoffice/reports/recipe-cost', label: 'Recipe Cost', icon: TrendingUp, permission: 'reports.financial.read' },
        ],
      },
      {
        label: 'Financial reports',
        items: [
          { to: '/backoffice/reports/profit-loss', label: 'Profit & Loss', icon: Coins, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/balance-sheet', label: 'Balance Sheet', icon: Scale, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/cash-flow', label: 'Cash Flow', icon: Banknote, permission: 'reports.financial.read' },
          { to: '/backoffice/reports/pb1', label: 'VAT / PB1', icon: FileSpreadsheet, permission: 'reports.financial.read' as PermissionCode },
        ],
      },
      {
        label: 'Marketing reports',
        items: [
          { to: '/backoffice/marketing/cohort', label: 'Cohorts', icon: LineChart, permission: 'reports.read' },
          { to: '/backoffice/marketing/segments', label: 'Segments', icon: Sparkles, permission: 'reports.read' },
          { to: '/backoffice/marketing/promo-roi', label: 'Promo ROI', icon: Megaphone, permission: 'reports.read' },
          { to: '/backoffice/marketing/birthday', label: 'Birthdays', icon: Cake, permission: 'reports.read' },
        ],
      },
      {
        label: 'Audit',
        items: [
          { to: '/backoffice/reports/audit', label: 'Audit Log', icon: Shield, permission: 'reports.audit.read' },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    subgroups: [
      {
        label: '',
        items: [
          { to: '/backoffice/settings', label: 'General settings', icon: Settings, permission: 'settings.read', end: true },
          { to: '/backoffice/settings/holidays', label: 'Holidays', icon: CalendarDays, permission: 'settings.read' },
          { to: '/backoffice/settings/templates/email', label: 'Email Templates', icon: Mail, permission: 'settings.read' },
          { to: '/backoffice/settings/templates/receipt', label: 'Receipt Templates', icon: FileText, permission: 'settings.read' },
          { to: '/backoffice/settings/permissions', label: 'Permissions Matrix (read-only)', icon: ShieldCheck, permission: 'settings.read' },
        ],
      },
      {
        label: 'Devices',
        items: [
          { to: '/backoffice/lan-devices', label: 'LAN Devices', icon: Network, permission: 'lan.devices.read' },
        ],
      },
      {
        label: 'Users & Access',
        items: [
          { to: '/backoffice/users', label: 'Users', icon: Users, permission: 'users.read', end: true },
          { to: '/backoffice/users/permissions', label: 'RBAC Editor', icon: ShieldCheck, permission: 'rbac.read' },
        ],
      },
    ],
  },
];
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: type errors on the render path (the `visibleGroups.map` block at lines 205-220 of the original) because it iterates `group.items` directly, which now only exists on one branch of the union. Fix in Wave 4.

### Task 3.B : Commit GROUPS rewrite

- [ ] **Step 1: Commit**

```bash
git add apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "refactor(bo-nav): rewrite GROUPS — 7 top-level groups, 9 subgroups, 3 drops, 8 renames"
```

(Typecheck still failing — this is a known intermediate state, will resolve after Wave 4.)

---

## Wave 4 — Update permission filter + render path

### Task 4.A : Rewrite the permission-filter logic

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:179-184` (current location of `visibleGroups`)

- [ ] **Step 1: Replace the filter block**

Locate the line `const visibleGroups = GROUPS.map((g) => ({` (around line 179). Replace the entire `visibleGroups` declaration (the `.map(...).filter(...)` chain) with :

```ts
type VisibleGroup =
  | { label: string; items: NavItem[]; subgroups?: undefined }
  | { label: string; subgroups: NavSubgroup[]; items?: undefined };

const filterItems = (items: NavItem[]): NavItem[] =>
  items.filter((n) => n.permission === undefined || hasPermission(n.permission));

const visibleGroups: VisibleGroup[] = GROUPS.flatMap((g): VisibleGroup[] => {
  if ('items' in g) {
    const items = filterItems(g.items);
    return items.length > 0 ? [{ label: g.label, items }] : [];
  }
  const subgroups = g.subgroups
    .map((sg) => ({ label: sg.label, items: filterItems(sg.items) }))
    .filter((sg) => sg.items.length > 0);
  return subgroups.length > 0 ? [{ label: g.label, subgroups }] : [];
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: still errors on the JSX render path (lines 205-220) iterating `group.items`. Fix in Task 4.B.

### Task 4.B : Update the render path to branch on subgroups

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:204-220` (the `<nav>` block)

- [ ] **Step 1: Replace the group rendering loop**

Locate the `<nav className="flex-1 py-4 overflow-y-auto" aria-label="Primary">` element (around line 204). Replace the inside (between `<nav...>` and `</nav>`) with :

```tsx
{visibleGroups.map((group) => (
  <div key={group.label} className="mb-5">
    <SectionLabel
      as="h2"
      size="xs"
      className="px-4 mb-2 text-text-muted"
    >
      {group.label}
    </SectionLabel>
    {'items' in group && group.items !== undefined ? (
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
      </div>
    ) : (
      group.subgroups!.map((sg) => (
        <div key={`${group.label}::${sg.label}`} className="mb-2">
          {sg.label !== '' && <SubgroupLabel>{sg.label}</SubgroupLabel>}
          <div className="space-y-0.5">
            {sg.items.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </div>
        </div>
      ))
    )}
  </div>
))}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: **PASS** with no errors on `Sidebar.tsx`. If errors remain, read the message and fix the specific narrowing issue — the union should be fully resolved.

### Task 4.C : Commit filter + render refactor

- [ ] **Step 1: Commit**

```bash
git add apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "refactor(bo-nav): extend permission filter + render path to traverse subgroups"
```

---

## Wave 5 — Update tests

### Task 5.A : Audit existing sidebar tests

**Files:**
- Read: `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Re-read the file with the new mental model**

Use Read tool. Identify every assertion that pins to one of these old strings : `"Operations"`, `"Management"`, `"Admin"`, `"POS Terminal"`, `"Kitchen Display"`, `"Z-Reports"`, `"Categories"`, `"Permissions"`, `"Movements"` (without "Live"), `"Settings"` for B2B context, `"New user"`. List them.

- [ ] **Step 2: Identify any snapshot tests**

If `toMatchSnapshot()` calls exist, the snapshots in `__snapshots__/` will need regeneration. Note the snapshot file paths.

### Task 5.B : Rewrite assertions for the new structure

**Files:**
- Modify: `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Replace group-label assertions**

Wherever the test asserts on `"Management"` or `"Admin"`, replace with the appropriate new group : items previously in `Management` are now in `Sales` / `Purchase` / `Stock Management` / `Finance`. Items previously in `Admin` are now in `Finance` / `Reports` / `Settings`. Use `getByText` / `queryByText` matchers against the new strings.

For tests that verify "all 3 group labels render", expand to all 7 : `"Operations"`, `"Sales"`, `"Purchase"`, `"Stock Management"`, `"Finance"`, `"Reports"`, `"Settings"`.

- [ ] **Step 2: Add assertions for subgroup labels (when SUPER_ADMIN renders the full menu)**

For a SUPER_ADMIN-mocked render test, add `expect(screen.getByText('Sales reports')).toBeInTheDocument()` and similar for : `'Inventory reports'`, `'Financial reports'`, `'Marketing reports'`, `'Audit'`, `'Devices'`, `'Users & Access'`, `'Expenses'` (in Finance), `'Accounting'` (in Finance).

- [ ] **Step 3: Add negative assertions for drops**

```ts
expect(screen.queryByText('POS Terminal')).not.toBeInTheDocument();
expect(screen.queryByText('Kitchen Display')).not.toBeInTheDocument();
expect(screen.queryByText('New user')).not.toBeInTheDocument();
```

- [ ] **Step 4: Update rename-affected assertions**

| Search | Replace |
|---|---|
| `getByText('Categories')` referring to `/products` context | `getByText('Product Categories')` |
| `getByText('Categories')` referring to `/customers` context | `getByText('Customer Categories')` |
| `getByText('Settings')` referring to `/b2b` context | `getByText('B2B Credit Settings')` |
| `getByText('Z-Reports')` | `getByText('Cash Closing (Z-Reports)')` |
| `getByText('Movements')` referring to inventory live | `getByText('Live Movements')` |
| `getByText('Stock Movements')` referring to report | `getByText('Stock Movement History')` |
| `getByText('Permissions')` referring to `/users/permissions` | `getByText('RBAC Editor')` |
| `getByText('Permissions')` referring to `/settings/permissions` | `getByText('Permissions Matrix (read-only)')` |

- [ ] **Step 5: Verify permission-filter test still works**

If a test asserts that a cashier-role render shows ONLY a subset, verify the subset is still correct under the new GROUPS structure. Adjust the expected list.

- [ ] **Step 6: Delete obsolete snapshots if any**

If snapshot files exist in `__snapshots__/Sidebar.test.tsx.snap`, delete them — they'll be regenerated on next run :

```bash
rm apps/backoffice/src/layouts/__tests__/__snapshots__/Sidebar.test.tsx.snap 2>/dev/null || true
```

(Powershell: `Remove-Item ... -ErrorAction SilentlyContinue` equivalent — actually just check existence first via `Test-Path`.)

### Task 5.C : Run sidebar tests

- [ ] **Step 1: Run only sidebar tests**

Run: `pnpm --filter @breakery/app-backoffice test Sidebar`
Expected: PASS. If snapshot tests were used and snapshots deleted, they regenerate on first run — verify the generated snapshot is sensible before re-running.

- [ ] **Step 2: If failures, read each error and fix the assertion**

Common failures :
- "Unable to find an element with the text..." → the new label string differs from what the test expects. Update per Task 5.B.
- Multiple matches on a generic label like "Users" or "Settings" → use `getAllByText` or narrow by role / parent.

### Task 5.D : Commit test updates

- [ ] **Step 1: Commit**

```bash
git add apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx
# Also stage the deleted snapshot file if it existed
git add -u apps/backoffice/src/layouts/__tests__/__snapshots__/
git commit -m "test(bo-nav): update sidebar tests for new 7-group structure + renames + drops"
```

---

## Wave 6 — Full backoffice test sweep + manual visual check

### Task 6.A : Run the full backoffice test sweep

**Files:** None modified.

- [ ] **Step 1: Run the full BO test suite**

Run: `pnpm --filter @breakery/app-backoffice test`
Expected: all tests PASS. Other tests should not be affected because `Sidebar.tsx` is a leaf component — no other BO file imports `NavGroup` or `NavItem`.

- [ ] **Step 2: If any non-Sidebar test fails**

Read the failure. The only plausible cause : another test imports `Sidebar` and asserts on its output. Update that test's assertions per the mapping in Task 5.B.

### Task 6.B : Run full project typecheck

- [ ] **Step 1: Run turbo typecheck**

Run: `pnpm typecheck`
Expected: 6/6 packages PASS.

- [ ] **Step 2: If `@breakery/ui` fails**

This is a pre-existing env issue (see Active Workplan note for S26b/S27c). Verify that the failure exists on `master` too by running `git stash && pnpm typecheck` then restoring. If pre-existing, ignore — not introduced by this refactor.

### Task 6.C : Manual visual smoke (optional but recommended)

**Files:** None modified.

- [ ] **Step 1: Start the BO dev server**

Run: `pnpm --filter @breakery/app-backoffice dev` (in a separate terminal — user-initiated, not automated)

Note : the user runs interactive commands themselves. Ask the user to launch the dev server if they want a visual check, do not run `pnpm dev` from within the agent session.

- [ ] **Step 2: Ask the user to confirm visual sanity**

Suggested check items (for the user to verify in the browser) :
- All 7 group labels visible (Operations / Sales / Purchase / Stock Management / Finance / Reports / Settings)
- Subgroup labels visible inside Finance (Expenses / Accounting), Reports (Sales / Inventory / Financial / Marketing / Audit), Settings (Devices / Users & Access)
- Clicking any nav entry routes correctly
- AlertsBadge still appears next to BrandMark when user has `inventory.read`
- Visual hierarchy : group label > subgroup label > nav item is legible
- No regression on the gold-highlight active-state styling

If the SubgroupLabel styling looks too noisy or too pale, capture the user feedback as a polish issue (Wave 7).

### Task 6.D : Commit any visual polish

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (SubgroupLabel styling only, if needed)

- [ ] **Step 1: If user requested style adjustments, apply them**

The `SubgroupLabel` is the only thing that's truly new visually. Likely tweaks :
- Increase contrast (drop `/70` opacity to make it more readable)
- Adjust padding (`px-6 pt-3 pb-1` → maybe `px-5 pt-4 pb-1`)
- Change letter-spacing or font size

Apply user feedback. If no feedback, skip this task.

- [ ] **Step 2: Commit if changes were made**

```bash
git add apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "style(bo-nav): polish SubgroupLabel visual hierarchy"
```

---

## Wave 7 — Cleanup + PR

### Task 7.A : Remove dead code (external link branch)

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` — `NavItem` type and `NavItemLink` render

- [ ] **Step 1: Confirm no remaining consumer uses `external`**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Then grep `external` within `Sidebar.tsx` — confirm only the type definition + the render branch still reference it. Since `GROUPS` no longer sets `external: true` anywhere (POS / KDS dropped), the render branch is dead.

- [ ] **Step 2: Remove `external?: boolean` from `NavItem`**

In the `NavItem` interface (around line 36-46), delete the line :

```ts
  /** External link (e.g. POS / KDS in another app). */
  external?: boolean;
```

- [ ] **Step 3: Remove the external-link render branch from `NavItemLink`**

Delete the `if (item.external === true) { return ( <a ...> ... </a> ); }` block (approximately lines 142-155 of the original). Leave only the `<NavLink>` return.

- [ ] **Step 4: Typecheck again**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: PASS.

- [ ] **Step 5: Run sidebar tests once more**

Run: `pnpm --filter @breakery/app-backoffice test Sidebar`
Expected: PASS.

- [ ] **Step 6: Commit cleanup**

```bash
git add apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "refactor(bo-nav): remove dead external-link branch (no consumer post-reorg)"
```

### Task 7.B : Update CLAUDE.md Active Workplan

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read the current Active Workplan section in `CLAUDE.md`**

Locate the bullet starting "**Current session:** none". Read enough context to insert a new bullet for this menu reorg.

- [ ] **Step 2: Add a one-line reference to the menu reorg**

Insert a new bullet immediately after the "Current session" bullet :

```markdown
- **Backoffice menu reorg (2026-05-27):** Refactor standalone livré sur `feat/bo-menu-reorg` (post-S32) — 3 groupes (Operations/Management/Admin) → 7 groupes (Operations/Sales/Purchase/Stock/Finance/Reports/Settings) avec 9 sous-sections visuelles internes. 3 drops (POS/KDS/New user) + 8 renames (Product Categories, Customer Categories, B2B Credit Settings, Cash Closing, Live Movements, Stock Movement History, RBAC Editor, Permissions Matrix). Aucune URL ne change. Spec : [`docs/workplan/specs/2026-05-27-backoffice-menu-reorg-spec.md`](docs/workplan/specs/2026-05-27-backoffice-menu-reorg-spec.md). Plan : [`docs/workplan/plans/2026-05-27-backoffice-menu-reorg-plan.md`](docs/workplan/plans/2026-05-27-backoffice-menu-reorg-plan.md).
```

- [ ] **Step 3: Commit CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note backoffice menu reorg in Active Workplan"
```

### Task 7.C : Create PR (optional — only if user wants to merge to master)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/bo-menu-reorg
```

- [ ] **Step 2: Open PR via gh CLI**

```bash
gh pr create --title "refactor(bo): reorganise backoffice menu — 7 groups, 9 subgroups, 0 doublons" --body "$(cat <<'EOF'
## Summary

- Refactor `apps/backoffice/src/layouts/Sidebar.tsx` : 3 groupes flous → 7 groupes propres avec 9 sous-sections visuelles internes
- 3 drops (POS Terminal / Kitchen Display / "New user"), 8 renames, 10 moves structurels — aucune URL ne change
- Nouveau primitive interne `SubgroupLabel`, type `NavGroup` élargi en union discriminée

## Spec / Plan

- Spec : `docs/workplan/specs/2026-05-27-backoffice-menu-reorg-spec.md`
- Plan : `docs/workplan/plans/2026-05-27-backoffice-menu-reorg-plan.md`

## Test plan

- [x] `pnpm --filter @breakery/app-backoffice typecheck` PASS
- [x] `pnpm --filter @breakery/app-backoffice test Sidebar` PASS
- [x] `pnpm --filter @breakery/app-backoffice test` PASS (full BO sweep)
- [x] `pnpm typecheck` 6/6 PASS
- [ ] Visual sanity check by user across roles (SUPER_ADMIN / MANAGER / CASHIER)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL back to user**

The gh CLI prints the PR URL. Echo it as the final message.

---

## Self-Review (run after writing this plan, before execution)

### Spec coverage

| Spec section | Covered by task(s) |
|---|---|
| §2 Choix 1 (scope = labels + groupement) | Tasks 3.A (no URL changes in the to: field — verified) |
| §2 Choix 2 (7 groupes top-level) | Task 3.A (GROUPS array has 7 entries) |
| §2 Choix 3 (SubgroupLabel primitive + 3-level hierarchy) | Tasks 2.A, 2.B, 4.B |
| §2 Choix 4 (3 drops) | Task 3.A (POS, KDS removed from GROUPS), Task 5.B step 3 (negative assertions) |
| §2 Choix 5 (8 renames) | Task 3.A (all 8 strings updated), Task 5.B step 4 |
| §2 Choix 6 (10 moves) | Task 3.A (GROUPS structure) |
| §3.1 Structure top-level | Task 3.A |
| §3.2 Moves mapping table | Task 3.A (matches the table 1:1) |
| §3.3 Drops | Task 3.A |
| §4.1 SubgroupLabel implementation | Task 2.B |
| §4.2 Type model union discriminée | Task 2.A |
| §4.3 Filter propagation through subgroups | Task 4.A |
| §4.4 Preserve AlertsBadge | Task 4.B (the AlertsBadge JSX above the nav is untouched) |
| §4.5 External links handling | Task 7.A (cleanup chosen) |
| §5.1 Inclus (Sidebar.tsx + test file) | Wave 3 + Wave 5 |
| §5.2 Hors scope | Not implemented (correct) |
| §6 R1 (test audit) | Task 5.A |
| §6 R2 (permission gate on /users/new) | Note added to spec — not enforced in plan beyond drop. Acceptable. |
| §6 R3 (subgroup visual contrast) | Task 6.C step 2 (manual check) + Task 6.D (polish) |
| §6 R4 (label feedback) | Task 6.C step 2 |
| §6 R5 (`external` field cleanup) | Task 7.A |
| §7 Tests | Wave 5 + Wave 6 |

**Gaps : none.**

### Placeholder scan

- No "TBD", "TODO", "fill in later" in the plan body.
- Every code step contains the actual code.
- Every command is concrete.

### Type consistency

- `NavSubgroup` defined in Task 2.A, referenced in Tasks 4.A and 4.B — consistent.
- `VisibleGroup` defined locally in Task 4.A — used only in that function, no leak.
- `NavGroup` widened in Task 2.A — used in Task 3.A and Task 4.A consistently.
- `SubgroupLabel` component defined in Task 2.B (signature `({ children }: { children: ReactNode })`) — invoked in Task 4.B as `<SubgroupLabel>{sg.label}</SubgroupLabel>` — consistent.

---

## Execution Notes

**Total estimated wall-time : 2-3 hours.**

Per-Wave breakdown :
- Wave 0 : 5 min (branch + commit plan)
- Wave 1 : 10 min (read existing code)
- Wave 2 : 15 min (type widening + SubgroupLabel)
- Wave 3 : 30 min (GROUPS rewrite — bulk of the work)
- Wave 4 : 20 min (filter + render path)
- Wave 5 : 30-45 min (tests — depends on existing test coverage)
- Wave 6 : 10 min (sweep + manual check)
- Wave 7 : 15 min (cleanup + PR)
