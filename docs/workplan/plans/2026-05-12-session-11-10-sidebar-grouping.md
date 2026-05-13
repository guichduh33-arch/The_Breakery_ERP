# Session 11 — Phase 10 — Sidebar Grouping Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`19-settings-configuration`](../../reference/04-modules/19-settings-configuration.md) (navigation Backoffice)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the `BackofficeLayout` sidebar into three labelled groups — **Catalog**, **Customers**, **Operations** — and re-order entries within each group. Add the new entries from Phases 01-08 so all 11 backoffice destinations are surfaced and discoverable. Per-entry permission gating is preserved.

**Architecture:** A small layout-only change to `apps/backoffice/src/layouts/BackofficeLayout.tsx`. Convert the flat `NAV: NavItem[]` array into a grouped structure (`NavGroup[]`) and render group headers. All routes and per-entry permission codes stay identical — no app-router changes. Pre-existing `Dashboard` entry keeps its un-grouped position above the groups (it's the homepage).

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §4.2 (Sidebar grouping)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- All 8 new routes from Phases 01-08 are live (suppliers, restaurant-tables, customer-categories, categories, discount-templates, products full CRUD, combos, customers)
- Phase 09 (smoke test) does not affect routes; runs independently
- `PermissionCode` TS union contains every code referenced below (verify against `packages/supabase/src/rls/permissions.ts`)

---

## File Structure

| Action | Path |
|---|---|
| MODIFY | `apps/backoffice/src/layouts/BackofficeLayout.tsx` |
| CREATE | `apps/backoffice/src/__tests__/backoffice-layout-nav.smoke.test.tsx` |

---

## Task 1: Refactor the nav structure into groups

**Files:**
- Modify: `apps/backoffice/src/layouts/BackofficeLayout.tsx`

- [ ] **Step 1: Replace `BackofficeLayout.tsx` with the grouped layout**

```tsx
// apps/backoffice/src/layouts/BackofficeLayout.tsx
//
// Session 11 — sidebar grouped into Catalog / Customers / Operations.
// Dashboard stays un-grouped at the top. Each entry is permission-gated
// at render time AND server-side via the route's <PermissionGate>.

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, Layers, Tag, Percent,
  Users, UserCog, Coffee, Truck,
  Calculator, ShoppingCart, Building2,
  BarChart3, Settings, LogOut, Heart,
  type LucideIcon,
} from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore.js';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: PermissionCode;
}

interface NavGroup {
  /** undefined = render the items without a header */
  label: string | undefined;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: undefined,
    items: [
      { to: '/backoffice', label: 'Dashboard', icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/backoffice/products',           label: 'Products',           icon: Package,    permission: 'products.read' },
      { to: '/backoffice/combos',             label: 'Combos',             icon: Layers,     permission: 'combos.read' },
      { to: '/backoffice/categories',         label: 'Categories',         icon: Tag,        permission: 'categories.read' },
      { to: '/backoffice/discount-templates', label: 'Discount templates', icon: Percent,    permission: 'discount_templates.read' },
      { to: '/backoffice/promotions',         label: 'Promotions',         icon: Tag,        permission: 'promotions.read' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { to: '/backoffice/customers',           label: 'Customers',          icon: Users,    permission: 'customers.read' },
      { to: '/backoffice/customer-categories', label: 'Customer categories', icon: UserCog,  permission: 'customer_categories.read' },
      { to: '/backoffice/loyalty',             label: 'Loyalty',            icon: Heart,    permission: 'loyalty.read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/backoffice/tables',     label: 'Tables',     icon: Coffee, permission: 'tables.read' },
      { to: '/backoffice/inventory',  label: 'Inventory',  icon: Boxes,  permission: 'inventory.read' },
      { to: '/backoffice/suppliers',  label: 'Suppliers',  icon: Truck,  permission: 'suppliers.read' },
      { to: '/backoffice/purchasing', label: 'Purchasing', icon: ShoppingCart },           // ComingSoon — no perm gate
      { to: '/backoffice/accounting', label: 'Accounting', icon: Calculator },             // ComingSoon
      { to: '/backoffice/b2b',        label: 'B2B',        icon: Building2 },              // ComingSoon
      { to: '/backoffice/reports',    label: 'Reports',    icon: BarChart3 },              // ComingSoon
      { to: '/backoffice/settings',   label: 'Settings',   icon: Settings },               // ComingSoon
    ],
  },
];

export function BackofficeLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => n.permission === undefined || hasPermission(n.permission)),
  })).filter((g) => g.items.length > 0);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="h-screen flex bg-bg-base text-text-primary">
      <aside className="w-56 bg-bg-elevated border-r border-border-subtle flex flex-col">
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="font-serif text-lg">The Breakery</div>
          <div className="text-xs text-text-secondary uppercase tracking-widest">Backoffice</div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto" aria-label="Backoffice navigation">
          {visibleGroups.map((group, gi) => (
            <div key={`grp-${gi}`} className={gi > 0 ? 'pt-3 mt-3 border-t border-border-subtle' : undefined}>
              {group.label !== undefined && (
                <div className="px-4 py-1 text-xs uppercase tracking-widest text-text-secondary">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((n) => {
                  const Icon = n.icon;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      {...(n.end === true ? { end: true } : {})}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-gold-soft text-gold border-r-2 border-gold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                        )
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {n.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-border-subtle text-xs text-text-secondary">
          <div className="text-text-primary font-semibold">{user?.full_name}</div>
          <div>{user?.role_code}</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 px-6 flex items-center justify-end border-b border-border-subtle bg-bg-elevated">
          <Button variant="ghost" size="sm" onClick={() => { void handleLogout(); }}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Logout
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
```

If any `PermissionCode` is missing from the TS union (typecheck errors), regenerate types first:

```bash
pnpm db:types
```

- [ ] **Step 3: Manual smoke (dev)**

```bash
pnpm --filter backoffice dev
```

Open the BO, log in as MANAGER. Expected: 4 groups visible (Dashboard, Catalog, Customers, Operations). Log in as CASHIER: only Dashboard + items the CASHIER role grants (typically none of the BO list pages).

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/layouts/BackofficeLayout.tsx
git commit -m "feat(backoffice): session 11 — group sidebar into Catalog / Customers / Operations"
```

---

## Task 2: Layout-nav smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/backoffice-layout-nav.smoke.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/backoffice/src/__tests__/backoffice-layout-nav.smoke.test.tsx
//
// Verifies the grouped sidebar is rendered correctly and that per-permission
// filtering hides entries the role lacks.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BackofficeLayout } from '@/layouts/BackofficeLayout.js';
import { useAuthStore } from '@/stores/authStore.js';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/backoffice']}>
      <Routes>
        <Route path="/backoffice/*" element={<BackofficeLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BackofficeLayout sidebar grouping', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [] },
      isAuthenticated: true,
    } as never);
  });

  it('renders all 3 group headers when the user can see at least 1 item per group', () => {
    useAuthStore.setState({
      user: {
        id: 'u1', role_code: 'MANAGER', full_name: 'Mgr',
        permissions: ['products.read', 'customers.read', 'tables.read'],
      },
      isAuthenticated: true,
    } as never);
    renderLayout();
    expect(screen.getByText('Catalog')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('hides a group when the user has no permissions for any item in it', () => {
    useAuthStore.setState({
      user: {
        id: 'u1', role_code: 'CASHIER', full_name: 'Cashier',
        permissions: [],  // CASHIER has none of the BO read perms
      },
      isAuthenticated: true,
    } as never);
    renderLayout();
    // Dashboard always visible (no permission required)
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // BO read perms all gone, so groups are hidden
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('Customers')).not.toBeInTheDocument();
    // Operations still shows for ComingSoon entries (no permission attached);
    // verify only the perm-gated entries are gone
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('Suppliers')).not.toBeInTheDocument();
    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
  });

  it('SUPER_ADMIN sees every Catalog item', () => {
    useAuthStore.setState({
      user: {
        id: 'u1', role_code: 'SUPER_ADMIN', full_name: 'Super', permissions: [
          'products.read', 'combos.read', 'categories.read',
          'discount_templates.read', 'promotions.read',
        ],
      },
      isAuthenticated: true,
    } as never);
    renderLayout();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Combos')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Discount templates')).toBeInTheDocument();
    expect(screen.getByText('Promotions')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + full BO suite**

```bash
pnpm --filter backoffice test -- backoffice-layout-nav.smoke
pnpm --filter backoffice test
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/__tests__/backoffice-layout-nav.smoke.test.tsx
git commit -m "test(backoffice): session 11 — sidebar grouping smoke (per-role visibility)"
```

---

## Phase exit criteria

- [ ] Sidebar shows: Dashboard (un-grouped) + Catalog (5 items) + Customers (3 items) + Operations (8 items)
- [ ] Hidden groups have NO header rendered (manager-of-no-perms doesn't see "Catalog: (empty)")
- [ ] CASHIER role sees only Dashboard
- [ ] All 2 commits landed (layout edit + smoke test)
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, dispatch the subagent for Phase 11 (final verification).
