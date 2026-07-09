# Session 11 — Phase 08 — Customers Page Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`08-customers-loyalty`](../../../reference/04-modules/08-customers-loyalty.md)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<ComingSoonPage module="Customers" />` placeholder at `/backoffice/customers` with a dedicated Customers CRUD page that reuses the existing components from `apps/backoffice/src/features/loyalty/` (CustomerFormModal, CustomerListRow, CustomerDeleteConfirm, hooks). No new business logic — this phase is purely a route + page wiring exercise. The existing `/backoffice/loyalty` page stays as-is (it's the loyalty management surface; the new `/backoffice/customers` is the plain CRUD surface).

**Architecture:** A new page `apps/backoffice/src/pages/Customers.tsx` that imports from `features/loyalty/`. The page omits the loyalty-specific UI elements (`LoyaltyHistoryDrawer`, `LoyaltyAdjustModal`, tier badges, lifetime/balance columns) and shows a leaner table: name, phone, email, customer_type, category, created_at. Filters: search + tier + category. The route swaps from `<ComingSoonPage>` to `<CustomersPage>` behind `<PermissionGate required="customers.read">`.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Customers CRUD bullet — separate route from Loyalty)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- `apps/backoffice/src/features/loyalty/` is fully implemented (it is — see commits 721c33a, 63a3891, 344ba4f, etc.)
- Perms `customers.{read,create,update,delete}` seeded — `customers.read` should be available to MANAGER+ (a stricter perm than `loyalty.read` which gates the Loyalty page)

**Design decision (why not rename loyalty):** the loyalty feature in `features/loyalty/` is the right home for the CRUD components because the loyalty page is what shipped first. The Customers page is the plain CRUD-only surface for admins who don't want to think about points. Keeping both routes lets the sidebar group them under different categories (Phase 10).

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `apps/backoffice/src/pages/Customers.tsx` |
| CREATE | `apps/backoffice/src/features/loyalty/hooks/useCustomerCategoriesForFilter.ts` (small reference-data helper) |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (swap ComingSoon → Customers) |
| CREATE | `apps/backoffice/src/__tests__/customers-page.smoke.test.tsx` |

---

## Task 1: Reference-data hook for the category filter

**Files:**
- Create: `apps/backoffice/src/features/loyalty/hooks/useCustomerCategoriesForFilter.ts`

The Loyalty page filters by tier; the Customers page filters by **customer_category** (since wholesale customers cluster differently from retail). We need a tiny hook to fetch active categories.

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/loyalty/hooks/useCustomerCategoriesForFilter.ts
//
// Tiny ref-data hook: list active, non-deleted customer_categories for the
// CustomersPage filter bar. Same data shape as the BO categories page
// (Phase 03), but cached separately to keep the filter snappy.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CustomerCategoryOption {
  id: string;
  name: string;
  slug: string;
}

export function useCustomerCategoriesForFilter() {
  return useQuery<CustomerCategoryOption[]>({
    queryKey: ['customer-categories-for-filter'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_categories')
        .select('id, name, slug')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/loyalty/hooks/useCustomerCategoriesForFilter.ts
git commit -m "feat(backoffice): session 11 — useCustomerCategoriesForFilter ref-data hook"
```

---

## Task 2: Customers page

**Files:**
- Create: `apps/backoffice/src/pages/Customers.tsx`

The page reuses `CustomerFormModal`, `CustomerDeleteConfirm`, `CustomerListRow` from `features/loyalty/`. It uses `useLoyaltyCustomersList` with new filter shape (we pass `category_id` instead of `tier`, but the underlying hook already supports both — check the existing implementation; if not, extend it).

- [ ] **Step 1: Verify the existing list hook**

```bash
cat apps/backoffice/src/features/loyalty/hooks/useLoyaltyCustomersList.ts
```

Look for the filter type. If it already accepts `category_id` and `search`, proceed. If it only accepts `tier + search`, extend it now (add an optional `category_id?: string | null` filter applied via `.eq('category_id', filters.category_id)`).

- [ ] **Step 2: Extend the list hook if needed**

If the hook lacks `category_id` filter, edit `apps/backoffice/src/features/loyalty/hooks/useLoyaltyCustomersList.ts`:

```ts
export interface LoyaltyCustomersFilters {
  search?: string;
  tier?: TierFilter;
  category_id?: string | null;  // NEW
}
```

And in the `queryFn`:

```ts
if (filters.category_id !== undefined && filters.category_id !== null && filters.category_id !== '') {
  q = q.eq('category_id', filters.category_id);
}
```

Commit:

```bash
git add apps/backoffice/src/features/loyalty/hooks/useLoyaltyCustomersList.ts
git commit -m "feat(backoffice): session 11 — extend useLoyaltyCustomersList with category_id filter"
```

- [ ] **Step 3: Write the page**

```tsx
// apps/backoffice/src/pages/Customers.tsx
//
// BO customers list (plain CRUD — no loyalty drawers). Reuses the loyalty
// feature components but presents a leaner table: name / phone / email /
// type / category / created_at.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { CustomerDeleteConfirm } from '@/features/loyalty/components/CustomerDeleteConfirm.js';
import { useCustomerCategoriesForFilter } from '@/features/loyalty/hooks/useCustomerCategoriesForFilter.js';
import {
  useLoyaltyCustomersList,
  type CustomerListRow as Row,
  type LoyaltyCustomersFilters,
} from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';

export default function CustomersPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('customers.read');
  const canCreate = hasPermission('customers.create');
  const canUpdate = hasPermission('customers.update');
  const canDelete = hasPermission('customers.delete');

  const [search, setSearch] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');

  const filters = useMemo<LoyaltyCustomersFilters>(
    () => ({
      ...(search.trim() !== '' ? { search } : {}),
      tier: 'all',
      ...(categoryId !== '' ? { category_id: categoryId } : {}),
    }),
    [search, categoryId],
  );

  const list = useLoyaltyCustomersList(filters);
  const cats = useCustomerCategoriesForFilter();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Row | undefined>(undefined);
  const [deleting, setDeleting] = useState<Row | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view customers.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Customers</h1>
          <p className="text-text-secondary text-sm mt-1">Retail + wholesale contacts. Loyalty drawer lives at /backoffice/loyalty.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New customer
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[14rem]">
          <label htmlFor="cust-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="cust-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone or email" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="cust-cat" className="text-xs uppercase tracking-widest text-text-secondary">Category</label>
          <select id="cust-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {list.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
      {list.error && <div className="text-red py-12 text-center">{list.error.message}</div>}
      {list.data?.length === 0 && (
        <div className="text-text-secondary py-12 text-center">No customers match.</div>
      )}
      {list.data && list.data.length > 0 && (
        <table className="w-full text-sm bg-bg-elevated border border-border-subtle rounded-lg overflow-hidden">
          <thead className="text-xs uppercase tracking-widest text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((row) => (
              <tr key={row.id} className="border-t border-border-subtle hover:bg-bg-overlay">
                <td className="px-3 py-2 font-semibold">{row.full_name ?? row.first_name}</td>
                <td className="px-3 py-2 text-text-secondary text-sm">{row.phone ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-sm">{row.email ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-sm">{row.customer_type ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-sm">{row.category?.name ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{new Date(row.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={!canUpdate}
                      onClick={() => setEditing(row)} aria-label={`Edit ${row.full_name ?? row.first_name}`}>
                      Edit
                    </Button>
                    {canDelete && (
                      <Button type="button" variant="ghostDestructive" size="sm"
                        onClick={() => setDeleting(row)} aria-label={`Delete ${row.full_name ?? row.first_name}`}>
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CustomerFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <CustomerFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <CustomerDeleteConfirm customer={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

> If `row.full_name` / `row.customer_type` / `row.category?.name` aren't on the existing `CustomerListRow` type returned by `useLoyaltyCustomersList`, extend the hook's select clause and type. Check before writing.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

If typecheck complains about missing fields, extend the select-clause in `useLoyaltyCustomersList` to include `customer_type, category_id, category:customer_categories(name)`, and update the `CustomerListRow` interface accordingly. Commit that extension separately:

```bash
git add apps/backoffice/src/features/loyalty/hooks/useLoyaltyCustomersList.ts
git commit -m "feat(backoffice): session 11 — extend useLoyaltyCustomersList row shape (type + category embed)"
```

- [ ] **Step 5: Commit the page**

```bash
git add apps/backoffice/src/pages/Customers.tsx
git commit -m "feat(backoffice): session 11 — Customers page reusing loyalty feature CRUD"
```

---

## Task 3: Wire the route

**Files:**
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Replace the ComingSoonPage entry**

Currently (line 62):

```tsx
<Route path="customers" element={<ComingSoonPage module="Customers" />} />
```

Replace with:

```tsx
import CustomersPage from '@/pages/Customers.js';
// ...
<Route
  path="customers"
  element={
    <PermissionGate required="customers.read">
      <CustomersPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — swap /backoffice/customers from ComingSoon to CustomersPage"
```

---

## Task 4: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/customers-page.smoke.test.tsx`

- [ ] **Step 1: Write the smoke**

```tsx
// apps/backoffice/src/__tests__/customers-page.smoke.test.tsx
//
// MANAGER session. Verifies the page renders, applies the category filter,
// and opens the create modal. The CRUD mutations are already covered by
// existing loyalty feature tests — we just smoke the new entry point.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomersPage from '@/pages/Customers.js';
import { useAuthStore } from '@/stores/authStore.js';

vi.mock('@/lib/supabase.js', () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    customers: [
      { id: 'c-1', full_name: 'Alice', phone: '+62811', email: 'a@x.test', customer_type: 'retail', category_id: 'cat-1', category: { name: 'Retail' }, created_at: '2026-05-01T00:00:00Z', deleted_at: null },
      { id: 'c-2', full_name: 'Bob',   phone: '+62812', email: 'b@x.test', customer_type: 'wholesale', category_id: 'cat-2', category: { name: 'Wholesale' }, created_at: '2026-05-02T00:00:00Z', deleted_at: null },
    ],
    customer_categories: [
      { id: 'cat-1', name: 'Retail',    slug: 'retail',    is_active: true, deleted_at: null, is_default: true },
      { id: 'cat-2', name: 'Wholesale', slug: 'wholesale', is_active: true, deleted_at: null, is_default: false },
    ],
  };
  function makeBuilder(table: string) {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean } = { filters: {}, isDeletedNull: false };
    const api = {
      select: () => api,
      is:    (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq:    (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      or:    () => api,
      ilike: () => api,
      order: () => api,
      then: (cb: (v: { data: typeof tables[string]; error: null }) => void) => {
        const filtered = tables[table].filter((r) =>
          (!chain.isDeletedNull || r.deleted_at == null)
          && Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        cb({ data: filtered, error: null });
      },
    } as unknown as { [key: string]: unknown };
    return api;
  }
  return { supabase: { from: vi.fn().mockImplementation((t: string) => makeBuilder(t)) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CustomersPage />
    </QueryClientProvider>,
  );
}

describe('CustomersPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'customers.read', 'customers.create', 'customers.update', 'customers.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('renders both customers and filters by category', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Category/i), 'cat-2');
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('opens the create modal', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Customers/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New customer/i }));
    // The CustomerFormModal from features/loyalty has its own tests — just
    // assert it appears.
    expect(await screen.findByText(/New customer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter backoffice test -- customers-page.smoke
pnpm --filter backoffice test
git add apps/backoffice/src/__tests__/customers-page.smoke.test.tsx
git commit -m "test(backoffice): session 11 — customers page smoke"
```

---

## Phase exit criteria

- [ ] `/backoffice/customers` now renders the new CRUD page (no more "Coming Soon")
- [ ] `/backoffice/loyalty` continues to work exactly as before (no shared-component regressions)
- [ ] Category filter narrows the list correctly
- [ ] CASHIER login → `/backoffice/customers` redirects to `/backoffice`
- [ ] All 3-4 commits landed (depending on whether the list hook needed extension)
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, dispatch the subagent for Phase 09 (tablet split-pay smoke).
