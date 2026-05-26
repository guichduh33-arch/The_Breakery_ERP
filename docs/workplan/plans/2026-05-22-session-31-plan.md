# Session 31 — Reports Drill-Down + 3 detail pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câbler drill-down navigation transverse sur les 17 reports BO existants via composant entity-aware `<DrilldownLink>` + créer 3 detail pages minimales read-only (`customers/:id`, `orders/:id`, `inventory/recipes/:id`) — résout le gap "reports affichent des cells riches mais aucun lien sortant".

**Architecture:** Helper pur `buildDrilldownUrl(entity, id, filter)` → `string | null` testable + composant `<DrilldownLink entity={...} id={...} filter={...} />` consume helper. 3 nouvelles routes + 3 pages détail (read-only, PostgREST direct SELECT, no new RPC). 1 seule migration = seed permission `orders.read` MANAGER+. Wiring 17 reports en 5 commits par groupe.

**Tech Stack:** React 18 + react-router-dom, TypeScript monorepo pnpm/turbo, Supabase cloud `ikcyvlovptebroadgtvd`, Vitest + @testing-library/react, pgTAP via MCP.

**Spec:** [`../specs/2026-05-22-session-31-spec.md`](../specs/2026-05-22-session-31-spec.md)

**Branch:** `swarm/session-31` (déjà créée depuis `master` @ `60a1ff3`)

---

## Wave 0 — Spec + plan commit

### Task 0.1 : Commit plan

- [ ] **Step 1:** Add plan file
```bash
git add docs/workplan/plans/2026-05-22-session-31-plan.md
git commit -m "docs(workplan): session 31 — phase 0.1 — plan (Reports Drill-Down + 3 detail pages)"
```

---

## Wave 1 — Foundation

### Task 1.A : `buildDrilldownUrl` helper + unit tests (TDD)

**Files:**
- Create: `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts`
- Create: `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts`

- [ ] **Step 1: Write the failing test file**

Content of `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildDrilldownUrl, type DrilldownEntity } from '../buildDrilldownUrl.js';

describe('buildDrilldownUrl', () => {
  it('T1 product → /backoffice/products/:id', () => {
    expect(buildDrilldownUrl('product', 'p-1')).toBe('/backoffice/products/p-1');
  });

  it('T2 user → /backoffice/users/:id', () => {
    expect(buildDrilldownUrl('user', 'u-1')).toBe('/backoffice/users/u-1');
  });

  it('T3 supplier → /backoffice/suppliers/:id', () => {
    expect(buildDrilldownUrl('supplier', 's-1')).toBe('/backoffice/suppliers/s-1');
  });

  it('T4 expense → /backoffice/expenses/:id', () => {
    expect(buildDrilldownUrl('expense', 'e-1')).toBe('/backoffice/expenses/e-1');
  });

  it('T5 purchase_order → /backoffice/purchasing/purchase-orders/:id', () => {
    expect(buildDrilldownUrl('purchase_order', 'po-1')).toBe(
      '/backoffice/purchasing/purchase-orders/po-1',
    );
  });

  it('T6 customer → /backoffice/customers/:id', () => {
    expect(buildDrilldownUrl('customer', 'c-1')).toBe('/backoffice/customers/c-1');
  });

  it('T7 order → /backoffice/orders/:id', () => {
    expect(buildDrilldownUrl('order', 'o-1')).toBe('/backoffice/orders/o-1');
  });

  it('T8 recipe → /backoffice/inventory/recipes/:id', () => {
    expect(buildDrilldownUrl('recipe', 'r-1')).toBe('/backoffice/inventory/recipes/r-1');
  });

  it('T9 category → /backoffice/products?category_id=:id', () => {
    expect(buildDrilldownUrl('category', 'cat-1')).toBe(
      '/backoffice/products?category_id=cat-1',
    );
  });

  it('T10 account → /backoffice/accounting/general-ledger?account_id=:id', () => {
    expect(buildDrilldownUrl('account', 'acc-1')).toBe(
      '/backoffice/accounting/general-ledger?account_id=acc-1',
    );
  });

  it('T11 filter date_from/date_to is appended', () => {
    expect(
      buildDrilldownUrl('account', 'acc-1', {
        date_from: '2026-01-01',
        date_to: '2026-01-31',
      }),
    ).toBe('/backoffice/accounting/general-ledger?account_id=acc-1&date_from=2026-01-01&date_to=2026-01-31');
  });

  it('T12 empty id returns null', () => {
    expect(buildDrilldownUrl('order', '')).toBeNull();
  });

  it('T13 unknown entity returns null', () => {
    expect(buildDrilldownUrl('terminal' as DrilldownEntity, 't-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```
Expected: FAIL — file not found / module not found.

- [ ] **Step 3: Implement `buildDrilldownUrl.ts`**

Content of `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts`:
```ts
export type DrilldownEntity =
  | 'product'
  | 'category'
  | 'user'
  | 'customer'
  | 'order'
  | 'recipe'
  | 'account'
  | 'supplier'
  | 'expense'
  | 'purchase_order';

export interface DrilldownFilter {
  date_from?: string;
  date_to?: string;
  category_id?: string;
  payment_method?: string;
  movement_type?: string;
  created_by?: string;
  hour_from?: number;
  hour_to?: number;
  [key: string]: string | number | undefined;
}

const DETAIL_ROUTES: Partial<Record<DrilldownEntity, string>> = {
  product: '/backoffice/products/',
  user: '/backoffice/users/',
  supplier: '/backoffice/suppliers/',
  expense: '/backoffice/expenses/',
  purchase_order: '/backoffice/purchasing/purchase-orders/',
  customer: '/backoffice/customers/',
  order: '/backoffice/orders/',
  recipe: '/backoffice/inventory/recipes/',
};

const LIST_FILTERED: Partial<Record<DrilldownEntity, (id: string) => string>> = {
  category: (id) => `/backoffice/products?category_id=${encodeURIComponent(id)}`,
  account: (id) => `/backoffice/accounting/general-ledger?account_id=${encodeURIComponent(id)}`,
};

function appendFilter(base: string, filter?: DrilldownFilter): string {
  if (!filter) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${qs}`;
}

export function buildDrilldownUrl(
  entity: DrilldownEntity,
  id: string,
  filter?: DrilldownFilter,
): string | null {
  if (!id) return null;
  const detailPrefix = DETAIL_ROUTES[entity];
  if (detailPrefix) {
    return appendFilter(`${detailPrefix}${encodeURIComponent(id)}`, filter);
  }
  const listFn = LIST_FILTERED[entity];
  if (listFn) {
    return appendFilter(listFn(id), filter);
  }
  return null;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```
Expected: PASS 13/13.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts
git commit -m "feat(reports): session 31 — wave 1.A — buildDrilldownUrl helper + unit tests (13/13 PASS)"
```

---

### Task 1.B : `DrilldownLink` component + smoke test

**Files:**
- Create: `apps/backoffice/src/features/reports/components/DrilldownLink.tsx`
- Create: `apps/backoffice/src/features/reports/components/__tests__/DrilldownLink.smoke.test.tsx`

- [ ] **Step 1: Write failing smoke test**

Content of `apps/backoffice/src/features/reports/components/__tests__/DrilldownLink.smoke.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrilldownLink } from '../DrilldownLink.js';

describe('DrilldownLink', () => {
  it('renders <Link> with correct href for valid entity', () => {
    render(
      <MemoryRouter>
        <DrilldownLink entity="product" id="p-1" label="Croissant" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });

  it('renders plain <span> when target is null (empty id)', () => {
    render(
      <MemoryRouter>
        <DrilldownLink entity="order" id="" label="—" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('appends filter query params', () => {
    render(
      <MemoryRouter>
        <DrilldownLink
          entity="account"
          id="acc-1"
          label="Cash"
          filter={{ date_from: '2026-01-01', date_to: '2026-01-31' }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Cash/ });
    expect(link.getAttribute('href')).toBe(
      '/backoffice/accounting/general-ledger?account_id=acc-1&date_from=2026-01-01&date_to=2026-01-31',
    );
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm --filter @breakery/app-backoffice test DrilldownLink
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DrilldownLink.tsx`**

Content of `apps/backoffice/src/features/reports/components/DrilldownLink.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import {
  buildDrilldownUrl,
  type DrilldownEntity,
  type DrilldownFilter,
} from '../utils/buildDrilldownUrl.js';

export interface DrilldownLinkProps {
  entity: DrilldownEntity;
  id: string;
  label: ReactNode;
  filter?: DrilldownFilter;
  icon?: boolean;
  className?: string;
}

export function DrilldownLink({
  entity,
  id,
  label,
  filter,
  icon = true,
  className,
}: DrilldownLinkProps): JSX.Element {
  const url = buildDrilldownUrl(entity, id, filter);
  if (!url) {
    return <span className={className}>{label}</span>;
  }
  const baseCls =
    'inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline';
  return (
    <Link to={url} className={className ? `${baseCls} ${className}` : baseCls}>
      {label}
      {icon && <ExternalLink size={12} className="opacity-50" />}
    </Link>
  );
}
```

- [ ] **Step 4: Run — verify 3/3 PASS**

```bash
pnpm --filter @breakery/app-backoffice test DrilldownLink
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/reports/components/DrilldownLink.tsx apps/backoffice/src/features/reports/components/__tests__/DrilldownLink.smoke.test.tsx
git commit -m "feat(reports): session 31 — wave 1.B — DrilldownLink component + smoke (3/3 PASS)"
```

---

### Task 1.C : Migration `_010` seed `orders.read` + pgTAP

**Files:**
- Create: `supabase/migrations/20260616000010_seed_orders_read_perm.sql`
- Create: `supabase/tests/orders_read_perm.test.sql`

- [ ] **Step 1: Write migration SQL** (file body)

```sql
-- session 31 / wave 1.C — seed orders.read permission (MANAGER+)
INSERT INTO permissions (code, module, action, description) VALUES
  ('orders.read', 'orders', 'read', 'View orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'orders.read'
FROM roles r
WHERE r.code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply via cloud MCP**

Call `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id` = `ikcyvlovptebroadgtvd`
- `name` = `seed_orders_read_perm`
- `query` = the SQL above

- [ ] **Step 3: Write pgTAP test**

Content of `supabase/tests/orders_read_perm.test.sql`:
```sql
BEGIN;
SELECT plan(2);

SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'orders.read'),
  'T1: permission orders.read is seeded'
);

SELECT is(
  (SELECT COUNT(*)::int FROM role_permissions
   WHERE permission_code = 'orders.read'
     AND role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')),
  3,
  'T2: orders.read granted to MANAGER + ADMIN + SUPER_ADMIN (3 rows)'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run pgTAP via cloud MCP**

Call `mcp__plugin_supabase_supabase__execute_sql` with the full file content. Expected output: `ok 1`, `ok 2`, `# Tests were run but no plan was declared and done_testing() was not seen.` → wrap with `BEGIN...ROLLBACK` envelope (already in file). Verify all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260616000010_seed_orders_read_perm.sql supabase/tests/orders_read_perm.test.sql
git commit -m "feat(db): session 31 — wave 1.C — seed orders.read perm + pgTAP (2/2 PASS)"
```

---

### Task 1.D : Types regen post-migration

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1: Regen types via MCP**

Call `mcp__plugin_supabase_supabase__generate_typescript_types` with `project_id = ikcyvlovptebroadgtvd`. Save the `types` field content to `packages/supabase/src/types.generated.ts` (overwrite full file).

- [ ] **Step 2: Verify `PermissionCode` union includes `'orders.read'`**

```bash
grep -c "orders.read" packages/supabase/src/types.generated.ts
```
Expected: ≥ 1.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): session 31 — wave 1.D — regen post orders.read perm seed"
```

---

## Wave 2 — Detail pages (read-only)

### Task 2.A : `CustomerDetailPage`

**Files:**
- Create: `apps/backoffice/src/features/customers/hooks/useCustomerDetail.ts`
- Create: `apps/backoffice/src/pages/customers/CustomerDetailPage.tsx`
- Create: `apps/backoffice/src/pages/customers/__tests__/CustomerDetailPage.smoke.test.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (add route)

- [ ] **Step 1: Hook `useCustomerDetail.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface CustomerDetailRow {
  id: string;
  name: string;
  type: 'walk_in' | 'account' | 'b2b';
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  b2b_credit_limit: number | null;
  b2b_current_balance: number | null;
  created_at: string;
}

export interface RecentOrder {
  id: string;
  order_number: string;
  created_at: string;
  total_amount: number;
  status: string;
}

export interface CustomerDetail {
  customer: CustomerDetailRow;
  orders_count: number;
  recent_orders: RecentOrder[];
}

export function useCustomerDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['customer-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<CustomerDetail> => {
      if (!id) throw new Error('id required');
      const { data: customer, error } = await supabase
        .from('customers')
        .select('id, name, type, email, phone, address_street, address_city, address_postal_code, b2b_credit_limit, b2b_current_balance, created_at')
        .eq('id', id)
        .single();
      if (error) throw error;
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', id);
      const { data: recent } = await supabase
        .from('orders')
        .select('id, order_number, created_at, total_amount, status')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(10);
      return {
        customer: customer as CustomerDetailRow,
        orders_count: count ?? 0,
        recent_orders: (recent ?? []) as RecentOrder[],
      };
    },
  });
}
```

- [ ] **Step 2: Write smoke test**

Content of `apps/backoffice/src/pages/customers/__tests__/CustomerDetailPage.smoke.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerDetailPage } from '../CustomerDetailPage.js';

vi.mock('@/features/customers/hooks/useCustomerDetail.js', () => ({
  useCustomerDetail: (id: string) => ({
    isLoading: false,
    data: {
      customer: {
        id, name: 'Café Bali', type: 'b2b' as const, email: 'cb@example.com',
        phone: '+62-811', address_street: null, address_city: null, address_postal_code: null,
        b2b_credit_limit: 10_000_000, b2b_current_balance: 2_500_000, created_at: '2026-01-01',
      },
      orders_count: 42,
      recent_orders: [],
    },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/customers/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomerDetailPage', () => {
  it('renders header with name + B2B badge', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() => expect(screen.getByText('Café Bali')).toBeInTheDocument());
    expect(screen.getByText(/B2B/i)).toBeInTheDocument();
  });

  it('renders B2B credit info when type=b2b', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() => expect(screen.getByText(/10.000.000|10,000,000/)).toBeInTheDocument());
    expect(screen.getByText(/2.500.000|2,500,000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test — fails (no page yet)**

```bash
pnpm --filter @breakery/app-backoffice test CustomerDetailPage
```

- [ ] **Step 4: Implement `CustomerDetailPage.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import { Card, Button } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useCustomerDetail } from '@/features/customers/hooks/useCustomerDetail.js';
import { PermissionGate } from '@/components/PermissionGate.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function TypeBadge({ type }: { type: 'walk_in' | 'account' | 'b2b' }) {
  const map = { walk_in: 'Walk-in', account: 'Account', b2b: 'B2B' } as const;
  const cls = type === 'b2b'
    ? 'bg-blue-100 text-blue-800'
    : type === 'account'
      ? 'bg-purple-100 text-purple-800'
      : 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{map[type]}</span>;
}

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useCustomerDetail(id);
  if (isLoading || !data) return <div className="p-8">Loading…</div>;
  const { customer, orders_count, recent_orders } = data;
  return (
    <PermissionGate required="customers.read">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link to="/backoffice/customers"><ArrowLeft size={16} /> Back</Link>
          </Button>
          <h1 className="text-2xl font-semibold font-fraunces">{customer.name}</h1>
          <TypeBadge type={customer.type} />
        </div>

        <Card className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Contact</h2>
          {customer.email && <div className="flex items-center gap-2"><Mail size={14} /> {customer.email}</div>}
          {customer.phone && <div className="flex items-center gap-2"><Phone size={14} /> {customer.phone}</div>}
          {customer.address_street && (
            <div className="flex items-start gap-2">
              <MapPin size={14} className="mt-1" />
              <div>{customer.address_street}, {customer.address_city} {customer.address_postal_code}</div>
            </div>
          )}
        </Card>

        {customer.type === 'b2b' && (
          <Card className="p-4 space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">B2B Account</h2>
            <div>Credit limit : <strong>Rp {formatIdr(Number(customer.b2b_credit_limit ?? 0))}</strong></div>
            <div>Current balance : <strong>Rp {formatIdr(Number(customer.b2b_current_balance ?? 0))}</strong></div>
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent orders ({orders_count} total)</h2>
          {recent_orders.length === 0 ? (
            <div className="text-sm text-muted-foreground">No orders yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th>Order</th><th>Date</th><th className="text-right">Total</th><th>Status</th>
              </tr></thead>
              <tbody>
                {recent_orders.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="py-2">
                      <DrilldownLink entity="order" id={o.id} label={`#${o.order_number}`} icon={false} />
                    </td>
                    <td>{new Date(o.created_at).toLocaleDateString('id-ID')}</td>
                    <td className="text-right">Rp {formatIdr(Number(o.total_amount))}</td>
                    <td>{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </PermissionGate>
  );
}
```

- [ ] **Step 5: Wire route**

In `apps/backoffice/src/routes/index.tsx`, near line 110 (existing `path="customers"` route), add:
```tsx
<Route path="customers/:id" element={<CustomerDetailPage />} />
```
Add the import at the top of the file:
```tsx
import { CustomerDetailPage } from '../pages/customers/CustomerDetailPage.js';
```

- [ ] **Step 6: Run test — PASS**

```bash
pnpm --filter @breakery/app-backoffice test CustomerDetailPage
```
Expected: 2/2 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/customers/hooks/useCustomerDetail.ts apps/backoffice/src/pages/customers/CustomerDetailPage.tsx apps/backoffice/src/pages/customers/__tests__/CustomerDetailPage.smoke.test.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 31 — wave 2.A — CustomerDetailPage + hook + route + smoke (2/2 PASS)"
```

---

### Task 2.B : `OrderDetailPage`

**Files:**
- Create: `apps/backoffice/src/features/orders/hooks/useOrderDetail.ts`
- Create: `apps/backoffice/src/pages/orders/OrderDetailPage.tsx`
- Create: `apps/backoffice/src/pages/orders/__tests__/OrderDetailPage.smoke.test.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Hook `useOrderDetail.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  modifiers_json: unknown;
}

export interface OrderPayment {
  id: string;
  method: string;
  amount: number;
  change_due: number | null;
  paid_at: string;
}

export interface OrderRefund {
  id: string;
  refund_number: string;
  refund_amount: number;
  reason: string;
  refunded_at: string;
  refunded_by: string | null;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: string;
  order_type: string;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  items: OrderItem[];
  payments: OrderPayment[];
  refunds: OrderRefund[];
}

export function useOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['order-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<OrderDetail> => {
      if (!id) throw new Error('id required');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, status, order_type, created_at, customer_id, created_by,
          subtotal, discount_amount, tax_amount, total_amount,
          customers(name),
          users!orders_created_by_fkey(name),
          order_items(id, product_id, product_name, quantity, unit_price, line_total, modifiers_json),
          order_payments(id, method, amount, change_due, paid_at),
          order_refunds(id, refund_number, refund_amount, reason, refunded_at, refunded_by)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      const row = data as any;
      return {
        id: row.id,
        order_number: row.order_number,
        status: row.status,
        order_type: row.order_type,
        created_at: row.created_at,
        customer_id: row.customer_id,
        customer_name: row.customers?.name ?? null,
        created_by: row.created_by,
        created_by_name: row.users?.name ?? null,
        subtotal: Number(row.subtotal ?? 0),
        discount_amount: Number(row.discount_amount ?? 0),
        tax_amount: Number(row.tax_amount ?? 0),
        total_amount: Number(row.total_amount ?? 0),
        items: (row.order_items ?? []) as OrderItem[],
        payments: (row.order_payments ?? []) as OrderPayment[],
        refunds: (row.order_refunds ?? []) as OrderRefund[],
      };
    },
  });
}
```

Note: column names in `order_items` (`modifiers_json`, `line_total`) and `order_refunds` (`refund_number`, `refund_amount`) — confirm via `mcp__plugin_supabase_supabase__list_tables` if `pnpm typecheck` complains; adjust to actual names (likely `product_name_snapshot`, `total_price`, etc.). Update the hook + smoke test consistently.

- [ ] **Step 2: Smoke test `OrderDetailPage.smoke.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderDetailPage } from '../OrderDetailPage.js';

vi.mock('@/features/orders/hooks/useOrderDetail.js', () => ({
  useOrderDetail: (id: string) => ({
    isLoading: false,
    data: {
      id, order_number: 'ORD-001', status: 'completed', order_type: 'dine_in',
      created_at: '2026-05-22T10:00:00Z',
      customer_id: 'c-1', customer_name: 'Café Bali',
      created_by: 'u-1', created_by_name: 'Alice',
      subtotal: 100000, discount_amount: 10000, tax_amount: 9000, total_amount: 99000,
      items: [
        { id: 'i-1', product_id: 'p-1', product_name: 'Croissant', quantity: 2, unit_price: 25000, line_total: 50000, modifiers_json: null },
      ],
      payments: [{ id: 'pay-1', method: 'cash', amount: 99000, change_due: 1000, paid_at: '2026-05-22T10:05:00Z' }],
      refunds: [],
    },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage', () => {
  it('renders order header + status', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('renders items + payments table', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText('Croissant')).toBeInTheDocument());
    expect(screen.getByText(/cash/i)).toBeInTheDocument();
    expect(screen.getByText(/99.000|99,000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — fails**

```bash
pnpm --filter @breakery/app-backoffice test OrderDetailPage
```

- [ ] **Step 4: Implement `OrderDetailPage.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, Button } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useOrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import { PermissionGate } from '@/components/PermissionGate.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-green-100 text-green-800'
    : status === 'voided' ? 'bg-red-100 text-red-800'
    : status === 'refunded' ? 'bg-orange-100 text-orange-800'
    : 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
}

export function OrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useOrderDetail(id);
  if (isLoading || !data) return <div className="p-8">Loading…</div>;
  return (
    <PermissionGate required="orders.read">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild><Link to="/backoffice"><ArrowLeft size={16} /> Back</Link></Button>
          <h1 className="text-2xl font-semibold font-fraunces">Order #{data.order_number}</h1>
          <StatusBadge status={data.status} />
          <span className="text-sm text-muted-foreground">{data.order_type}</span>
        </div>

        {data.customer_id && data.customer_name && (
          <Card className="p-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Customer</h2>
            <DrilldownLink entity="customer" id={data.customer_id} label={data.customer_name} />
          </Card>
        )}

        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Items</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Total</th>
            </tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="py-2">
                    <DrilldownLink entity="product" id={it.product_id} label={it.product_name} icon={false} />
                  </td>
                  <td className="text-right">{it.quantity}</td>
                  <td className="text-right">Rp {formatIdr(it.unit_price)}</td>
                  <td className="text-right">Rp {formatIdr(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Payments</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th>Method</th><th className="text-right">Amount</th><th className="text-right">Change</th><th>Paid at</th>
            </tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{p.method}</td>
                  <td className="text-right">Rp {formatIdr(p.amount)}</td>
                  <td className="text-right">{p.change_due ? `Rp ${formatIdr(p.change_due)}` : '—'}</td>
                  <td>{new Date(p.paid_at).toLocaleString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {data.refunds.length > 0 && (
          <Card className="p-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Refunds</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th>Number</th><th className="text-right">Amount</th><th>Reason</th><th>At</th>
              </tr></thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.refund_number}</td>
                    <td className="text-right">Rp {formatIdr(r.refund_amount)}</td>
                    <td>{r.reason}</td>
                    <td>{new Date(r.refunded_at).toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card className="p-4 space-y-1 max-w-md ml-auto">
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>Rp {formatIdr(data.subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span>Discount</span><span>− Rp {formatIdr(data.discount_amount)}</span></div>
          <div className="flex justify-between text-sm"><span>PB1</span><span>Rp {formatIdr(data.tax_amount)}</span></div>
          <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>Rp {formatIdr(data.total_amount)}</span></div>
        </Card>
      </div>
    </PermissionGate>
  );
}
```

- [ ] **Step 5: Wire route**

In `apps/backoffice/src/routes/index.tsx`, add (anywhere in the `/backoffice` children):
```tsx
<Route path="orders/:id" element={<OrderDetailPage />} />
```
With import:
```tsx
import { OrderDetailPage } from '../pages/orders/OrderDetailPage.js';
```

- [ ] **Step 6: Run — PASS**

```bash
pnpm --filter @breakery/app-backoffice test OrderDetailPage
```
Expected: 2/2.

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/orders/hooks/useOrderDetail.ts apps/backoffice/src/pages/orders/OrderDetailPage.tsx apps/backoffice/src/pages/orders/__tests__/OrderDetailPage.smoke.test.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 31 — wave 2.B — OrderDetailPage + hook + route + smoke (2/2 PASS)"
```

---

### Task 2.C : `RecipeDetailPage`

**Files:**
- Create: `apps/backoffice/src/features/recipes/hooks/useRecipeDetail.ts`
- Create: `apps/backoffice/src/pages/recipes/RecipeDetailPage.tsx`
- Create: `apps/backoffice/src/pages/recipes/__tests__/RecipeDetailPage.smoke.test.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Hook `useRecipeDetail.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface RecipeBomNode {
  ingredient_id: string;
  ingredient_name: string;
  ingredient_type: 'product' | 'recipe';
  quantity: number;
  unit: string;
  unit_cost: number;
  line_cost: number;
  children?: RecipeBomNode[];
}

export interface RecipeDetail {
  recipe: {
    id: string;
    name: string;
    status: 'active' | 'draft' | 'archived';
    yield_qty: number;
    yield_unit: string;
    batch_size: number | null;
    output_product_id: string | null;
    output_product_name: string | null;
  };
  active_version_label: string;
  version_count: number;
  bom: RecipeBomNode[];
}

export function useRecipeDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<RecipeDetail> => {
      if (!id) throw new Error('id required');
      const { data: recipe, error } = await supabase
        .from('recipes')
        .select('id, name, status, yield_qty, yield_unit, batch_size, output_product_id, products!recipes_output_product_id_fkey(name)')
        .eq('id', id)
        .single();
      if (error) throw error;
      const { data: versions } = await supabase
        .from('recipe_versions')
        .select('version_label, is_active')
        .eq('recipe_id', id);
      const active = (versions ?? []).find((v: any) => v.is_active);
      const { data: bom, error: bomErr } = await supabase.rpc('recipe_bom_full_v1', {
        p_recipe_id: id,
      });
      if (bomErr) throw bomErr;
      const r = recipe as any;
      return {
        recipe: {
          id: r.id, name: r.name, status: r.status,
          yield_qty: Number(r.yield_qty ?? 0), yield_unit: r.yield_unit,
          batch_size: r.batch_size != null ? Number(r.batch_size) : null,
          output_product_id: r.output_product_id,
          output_product_name: r.products?.name ?? null,
        },
        active_version_label: active?.version_label ?? '—',
        version_count: versions?.length ?? 0,
        bom: ((bom as any)?.tree ?? []) as RecipeBomNode[],
      };
    },
  });
}
```

- [ ] **Step 2: Smoke test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeDetailPage } from '../RecipeDetailPage.js';

vi.mock('@/features/recipes/hooks/useRecipeDetail.js', () => ({
  useRecipeDetail: (id: string) => ({
    isLoading: false,
    data: {
      recipe: {
        id, name: 'Pain au chocolat', status: 'active' as const,
        yield_qty: 10, yield_unit: 'pcs', batch_size: 1,
        output_product_id: 'p-1', output_product_name: 'Pain choc',
      },
      active_version_label: 'v3',
      version_count: 5,
      bom: [
        { ingredient_id: 'i-1', ingredient_name: 'Flour', ingredient_type: 'product' as const,
          quantity: 500, unit: 'g', unit_cost: 5, line_cost: 2500 },
      ],
    },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/inventory/recipes/:id" element={<RecipeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecipeDetailPage', () => {
  it('renders header with name + version label', async () => {
    renderAt('/backoffice/inventory/recipes/r-1');
    await waitFor(() => expect(screen.getByText('Pain au chocolat')).toBeInTheDocument());
    expect(screen.getByText(/v3/)).toBeInTheDocument();
  });

  it('renders ingredients tree', async () => {
    renderAt('/backoffice/inventory/recipes/r-1');
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — fails**

- [ ] **Step 4: Implement `RecipeDetailPage.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, Button } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useRecipeDetail, type RecipeBomNode } from '@/features/recipes/hooks/useRecipeDetail.js';
import { PermissionGate } from '@/components/PermissionGate.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function BomRow({ node, depth }: { node: RecipeBomNode; depth: number }) {
  return (
    <>
      <tr className="border-t">
        <td className="py-1" style={{ paddingLeft: `${depth * 16}px` }}>
          {node.ingredient_type === 'product' ? (
            <DrilldownLink entity="product" id={node.ingredient_id} label={node.ingredient_name} icon={false} />
          ) : (
            <DrilldownLink entity="recipe" id={node.ingredient_id} label={node.ingredient_name} icon={false} />
          )}
        </td>
        <td className="text-right">{node.quantity}</td>
        <td>{node.unit}</td>
        <td className="text-right">Rp {formatIdr(node.line_cost)}</td>
      </tr>
      {node.children?.map((c) => <BomRow key={c.ingredient_id} node={c} depth={depth + 1} />)}
    </>
  );
}

export function RecipeDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useRecipeDetail(id);
  if (isLoading || !data) return <div className="p-8">Loading…</div>;
  const { recipe, active_version_label, version_count, bom } = data;
  return (
    <PermissionGate required="reports.inventory.read">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link to="/backoffice/inventory/recipes"><ArrowLeft size={16} /> Back</Link>
          </Button>
          <h1 className="text-2xl font-semibold font-fraunces">{recipe.name}</h1>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{recipe.status}</span>
          <span className="text-sm text-muted-foreground">{active_version_label} ({version_count} versions)</span>
        </div>

        <Card className="p-4 space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">Yield</h2>
          <div>{recipe.yield_qty} {recipe.yield_unit}{recipe.batch_size ? ` × batch ${recipe.batch_size}` : ''}</div>
          {recipe.output_product_id && recipe.output_product_name && (
            <div className="text-sm">Output : <DrilldownLink entity="product" id={recipe.output_product_id} label={recipe.output_product_name} icon={false} /></div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Ingredients</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th>Ingredient</th><th className="text-right">Qty</th><th>Unit</th><th className="text-right">Cost</th>
            </tr></thead>
            <tbody>
              {bom.map((n) => <BomRow key={n.ingredient_id} node={n} depth={0} />)}
            </tbody>
          </table>
        </Card>
      </div>
    </PermissionGate>
  );
}
```

- [ ] **Step 5: Wire route**

In `routes/index.tsx`:
```tsx
<Route path="inventory/recipes/:id" element={<RecipeDetailPage />} />
```
Import:
```tsx
import { RecipeDetailPage } from '../pages/recipes/RecipeDetailPage.js';
```

- [ ] **Step 6: Run — PASS**

```bash
pnpm --filter @breakery/app-backoffice test RecipeDetailPage
```

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/recipes/hooks/useRecipeDetail.ts apps/backoffice/src/pages/recipes/RecipeDetailPage.tsx apps/backoffice/src/pages/recipes/__tests__/RecipeDetailPage.smoke.test.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 31 — wave 2.C — RecipeDetailPage + hook + route + smoke (2/2 PASS)"
```

---

## Wave 3 — Wiring drill-down (17 reports en 5 groupes)

For each report page, locate the cell rendering the entity reference (search e.g. `product_name`, `account_name`, `user_name` in the JSX), and wrap with `<DrilldownLink entity="..." id={...} label={...} filter={{ date_from, date_to }} />`.

Pattern import (add to each report page touched):
```tsx
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
```

### Task 3.A : Sales reports wiring (3 reports)

**Files (modify):**
- `apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx` — wrap category cell → `entity="category"`
- `apps/backoffice/src/pages/reports/SalesByHourPage.tsx` — no drill cells, audit + comment "terminal"
- `apps/backoffice/src/pages/reports/SalesByStaffPage.tsx` — wrap staff name cell → `entity="user"`

- [ ] **Step 1:** Open `SalesByCategoryPage.tsx`, find the category row rendering (likely a `<td>{row.category_name}</td>`), replace with:
```tsx
<td><DrilldownLink entity="category" id={row.category_id} label={row.category_name} filter={{ date_from: dateFrom, date_to: dateTo }} /></td>
```

- [ ] **Step 2:** Open `SalesByStaffPage.tsx`, find staff name cell, replace with:
```tsx
<td><DrilldownLink entity="user" id={row.user_id} label={row.user_name} /></td>
```

- [ ] **Step 3:** Open `SalesByHourPage.tsx`, add a top-of-file comment:
```tsx
// S31 : hour bucket cells are terminal (no /orders list yet). Drill-down deferred to S32+.
```

- [ ] **Step 4: Run targeted tests**

```bash
pnpm --filter @breakery/app-backoffice test SalesByCategory SalesByStaff SalesByHour
```
Expected: existing smokes still PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx apps/backoffice/src/pages/reports/SalesByStaffPage.tsx apps/backoffice/src/pages/reports/SalesByHourPage.tsx
git commit -m "feat(reports): session 31 — wave 3.A — wire drill-down on sales reports (category, staff)"
```

---

### Task 3.B : Stock reports wiring (4 reports)

**Files (modify):**
- `apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx` — product + reference (PO/expense)
- `apps/backoffice/src/pages/reports/StockVariancePage.tsx` — product
- `apps/backoffice/src/pages/reports/WastagePage.tsx` — product (both by_product + lines)
- `apps/backoffice/src/pages/reports/PerishableTurnoverPage.tsx` — product

- [ ] **Step 1:** In each file, find the `{row.product_name}` cell and replace with:
```tsx
<DrilldownLink entity="product" id={row.product_id} label={row.product_name} icon={false} />
```

- [ ] **Step 2:** In `StockMovementHistoryPage.tsx`, additionally wrap reference cell:
```tsx
{row.reference_type === 'purchase' && row.reference_id ? (
  <DrilldownLink entity="purchase_order" id={row.reference_id} label={row.reference_label ?? `PO ${row.reference_id.slice(0,8)}`} />
) : row.reference_type === 'expense' && row.reference_id ? (
  <DrilldownLink entity="expense" id={row.reference_id} label={row.reference_label ?? `Expense ${row.reference_id.slice(0,8)}`} />
) : '—'}
```

- [ ] **Step 3:** Run regression tests

```bash
pnpm --filter @breakery/app-backoffice test "Stock|Wastage|Perishable"
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx apps/backoffice/src/pages/reports/StockVariancePage.tsx apps/backoffice/src/pages/reports/WastagePage.tsx apps/backoffice/src/pages/reports/PerishableTurnoverPage.tsx
git commit -m "feat(reports): session 31 — wave 3.B — wire drill-down on stock reports (4 reports)"
```

---

### Task 3.C : Production reports wiring (3 reports)

**Files (modify):**
- `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx` — recipe + product
- `apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx` — add recipe drill in row label (in addition to existing /recipe-cost/:productId)
- `apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx` — both product_a and product_b cells

- [ ] **Step 1:** `ProductionYieldPage.tsx` — wrap product + recipe:
```tsx
<DrilldownLink entity="recipe" id={row.recipe_id} label={row.recipe_name} icon={false} />
{/* … */}
<DrilldownLink entity="product" id={row.product_id} label={row.product_name} icon={false} />
```

- [ ] **Step 2:** `RecipeCostOverviewPage.tsx` — add a side icon link to recipe detail next to existing `/reports/recipe-cost/:productId` cost-history link. Use `icon={true}` for the new one:
```tsx
<span className="inline-flex items-center gap-2">
  <Link to={`/backoffice/reports/recipe-cost/${row.product_id}`}>{row.recipe_name}</Link>
  <DrilldownLink entity="recipe" id={row.recipe_id} label="" icon={true} />
</span>
```

- [ ] **Step 3:** `BasketAnalysisPage.tsx` — wrap both halves of the pair:
```tsx
<td><DrilldownLink entity="product" id={row.product_a_id} label={row.product_a_name} icon={false} /></td>
<td><DrilldownLink entity="product" id={row.product_b_id} label={row.product_b_name} icon={false} /></td>
```

- [ ] **Step 4: Run regression**

```bash
pnpm --filter @breakery/app-backoffice test "Production|RecipeCost|Basket"
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/ProductionYieldPage.tsx apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx
git commit -m "feat(reports): session 31 — wave 3.C — wire drill-down on production reports (3 reports)"
```

---

### Task 3.D : Accounting reports wiring (4 reports)

**Files (modify):**
- `apps/backoffice/src/pages/reports/ProfitLossPage.tsx` — account cell → GL with date filter
- `apps/backoffice/src/pages/reports/BalanceSheetPage.tsx` — account cell → GL (no date filter — BS is snapshot)
- `apps/backoffice/src/pages/reports/CashFlowPage.tsx` — account cell → GL
- `apps/backoffice/src/pages/reports/Pb1ReportPage.tsx` — month → JE list filtered by date range

- [ ] **Step 1:** In `ProfitLossPage.tsx` + `CashFlowPage.tsx`, locate account row, wrap:
```tsx
<DrilldownLink entity="account" id={row.account_id} label={row.account_name} filter={{ date_from: dateFrom, date_to: dateTo }} icon={false} />
```

- [ ] **Step 2:** In `BalanceSheetPage.tsx`, same but **no filter** (BS is point-in-time):
```tsx
<DrilldownLink entity="account" id={row.account_id} label={row.account_name} icon={false} />
```

- [ ] **Step 3:** In `Pb1ReportPage.tsx`, wrap the month/year header cell:

The Pb1 report is monthly. Drill the period to `/accounting/journal-entries?date_from=<first>&date_to=<last>` :
```tsx
const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);
// In header:
<DrilldownLink entity="account" id="2110" label={`${month}/${year}`} filter={{ date_from: periodStart, date_to: periodEnd }} icon={false} />
```
(Account 2110 = PB1 Payable per S26 ADR-003.)

- [ ] **Step 4: Run regression**

```bash
pnpm --filter @breakery/app-backoffice test "ProfitLoss|BalanceSheet|CashFlow|Pb1"
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/ProfitLossPage.tsx apps/backoffice/src/pages/reports/BalanceSheetPage.tsx apps/backoffice/src/pages/reports/CashFlowPage.tsx apps/backoffice/src/pages/reports/Pb1ReportPage.tsx
git commit -m "feat(reports): session 31 — wave 3.D — wire drill-down on accounting reports (4 reports)"
```

---

### Task 3.E : Other reports + 5 BO smoke wiring samples

**Files (modify):**
- `apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx` — add terminal comment (no drill viable)
- `apps/backoffice/src/pages/reports/AuditPage.tsx` — actor_id → user ; entity_id → switch by entity_type

**Files (create — 5 wiring smoke tests):**
- `apps/backoffice/src/pages/reports/__tests__/wastage-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/sales-by-staff-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/perishable-turnover-drilldown.smoke.test.tsx`
- `apps/backoffice/src/pages/reports/__tests__/basket-analysis-drilldown.smoke.test.tsx`

- [ ] **Step 1:** `PaymentByMethodPage.tsx` — top comment:
```tsx
// S31 : method cells are terminal (no /orders?payment_method=X list yet). Drill-down deferred to S32+.
```

- [ ] **Step 2:** `AuditPage.tsx` — wrap actor + entity:
```tsx
<td><DrilldownLink entity="user" id={row.actor_id} label={row.actor_name ?? row.actor_id.slice(0,8)} icon={false} /></td>
<td>{
  row.entity_type === 'product' ? <DrilldownLink entity="product" id={row.entity_id} label={row.entity_id.slice(0,8)} icon={false} /> :
  row.entity_type === 'order' ? <DrilldownLink entity="order" id={row.entity_id} label={row.entity_id.slice(0,8)} icon={false} /> :
  row.entity_type === 'expense' ? <DrilldownLink entity="expense" id={row.entity_id} label={row.entity_id.slice(0,8)} icon={false} /> :
  row.entity_type === 'customer' ? <DrilldownLink entity="customer" id={row.entity_id} label={row.entity_id.slice(0,8)} icon={false} /> :
  (row.entity_id?.slice(0, 8) ?? '—')
}</td>
```

- [ ] **Step 3:** Write 5 wiring smoke tests — pattern (one example for `wastage-drilldown`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WastagePage } from '../WastagePage.js';

vi.mock('@/features/reports/hooks/useWastageReport.js', () => ({
  useWastageReport: () => ({
    isLoading: false,
    data: {
      summary: { total_qty: 10, total_value: 25000, line_count: 1 },
      by_product: [{ product_id: 'p-1', product_name: 'Croissant', total_qty: 10, total_value: 25000 }],
      lines: [],
    },
  }),
}));

describe('WastagePage drill-down wiring', () => {
  it('product cell links to /backoffice/products/:id', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><WastagePage /></MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });
});
```
The 4 other smoke files follow the same template — copy-paste and adjust mock + entity + expected href:

**`sales-by-staff-drilldown.smoke.test.tsx`** :
```tsx
vi.mock('@/features/reports/hooks/useSalesByStaff.js', () => ({
  useSalesByStaff: () => ({
    isLoading: false,
    data: { rows: [{ user_id: 'u-1', user_name: 'Alice', total_amount: 100000, orders_count: 5 }] },
  }),
}));
// In test:
const link = screen.getByRole('link', { name: /Alice/ });
expect(link.getAttribute('href')).toBe('/backoffice/users/u-1');
```

**`profit-loss-drilldown.smoke.test.tsx`** :
```tsx
vi.mock('@/features/reports/hooks/useProfitLoss.js', () => ({
  useProfitLoss: () => ({
    isLoading: false,
    data: { lines: [{ account_id: 'acc-4000', account_name: 'Sales Revenue', amount: 500000 }] },
  }),
}));
// In test render with date filter context (use the page's default dateFrom/dateTo or pass via props if applicable):
const link = screen.getByRole('link', { name: /Sales Revenue/ });
// Expected href includes filter date_from/date_to applied by the page (use the test's default range):
expect(link.getAttribute('href')).toMatch(/^\/backoffice\/accounting\/general-ledger\?account_id=acc-4000(&date_from=.+&date_to=.+)?$/);
```

**`perishable-turnover-drilldown.smoke.test.tsx`** :
```tsx
vi.mock('@/features/reports/hooks/usePerishableTurnover.js', () => ({
  usePerishableTurnover: () => ({
    isLoading: false,
    data: { rows: [{ product_id: 'p-1', product_name: 'Pain au lait', velocity_score: 3, waste_pct: 5 }] },
  }),
}));
const link = screen.getByRole('link', { name: /Pain au lait/ });
expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
```

**`basket-analysis-drilldown.smoke.test.tsx`** :
```tsx
vi.mock('@/features/reports/hooks/useBasketAnalysis.js', () => ({
  useBasketAnalysis: () => ({
    isLoading: false,
    data: { pairs: [{
      product_a_id: 'p-1', product_a_name: 'Croissant',
      product_b_id: 'p-2', product_b_name: 'Café',
      support: 0.1, confidence: 0.5,
    }] },
  }),
}));
const linkA = screen.getByRole('link', { name: /Croissant/ });
const linkB = screen.getByRole('link', { name: /Café/ });
expect(linkA.getAttribute('href')).toBe('/backoffice/products/p-1');
expect(linkB.getAttribute('href')).toBe('/backoffice/products/p-2');
```

Each file imports `WastagePage`-style boilerplate (QueryClientProvider + MemoryRouter + render). If the actual hook name differs from what's mocked (e.g., `useProfitLossReport` vs `useProfitLoss`), look it up in the matching `pages/reports/*.tsx` and update the `vi.mock` path. Same for the data shape — mock must match what the page consumes.

- [ ] **Step 4: Run 5 wiring smokes**

```bash
pnpm --filter @breakery/app-backoffice test drilldown
```
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx apps/backoffice/src/pages/reports/AuditPage.tsx apps/backoffice/src/pages/reports/__tests__/wastage-drilldown.smoke.test.tsx apps/backoffice/src/pages/reports/__tests__/sales-by-staff-drilldown.smoke.test.tsx apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx apps/backoffice/src/pages/reports/__tests__/perishable-turnover-drilldown.smoke.test.tsx apps/backoffice/src/pages/reports/__tests__/basket-analysis-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 31 — wave 3.E — wire other reports (AuditPage) + 5 drill-down smoke samples (5/5 PASS)"
```

---

## Wave 4 — Closeout

### Task 4.A : Full typecheck + BO regression sweep

- [ ] **Step 1:** Run full BO test suite

```bash
pnpm --filter @breakery/app-backoffice test --run
```
Expected: all tests PASS (S31 additions + zero regression on previous sessions). Any FAIL → fix and re-commit before proceeding.

- [ ] **Step 2:** Run full typecheck

```bash
pnpm typecheck
```
Expected: 6/6 packages PASS.

- [ ] **Step 3:** No commit (verification only — if fixes needed, commit with `fix(...):` message).

---

### Task 4.B : INDEX + CLAUDE.md Active Workplan update

**Files:**
- Create: `docs/workplan/plans/2026-05-22-session-31-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan section — add Session 31 as "Current session", demote S30 to "Session 30 reference")
- Modify: `docs/workplan/backlog-by-module/00-roadmap-globale.md` (mark drill-down delivered, list remaining Vague C items)

- [ ] **Step 1: Write `2026-05-22-session-31-INDEX.md`**

Content (~150 lines, sections per past INDEX format):
- §1 Summary (1 paragraph)
- §2 Branch + base commit
- §3 Migrations applied (just `_010`)
- §4 New files (component + util + 3 pages + 3 hooks + 5 wiring smokes + INDEX/plan/spec)
- §5 Files modified (17 reports + routes/index.tsx + CLAUDE.md + backlog/00 + types.generated.ts)
- §6 Tests run (13 unit + 6 detail smoke + 5 wiring smoke + 3 component smoke + 2 pgTAP + 6/6 typecheck)
- §7 Tasks closed (TASK-14-005 partial — drill-down sans compare ; new transverse Vague C item 1/6)
- §8 Permissions seeded (orders.read MANAGER+)
- §9 RPCs added (none — pure UI)
- §10 Deviations + open follow-ups (R1-R6 from spec, plus any during impl)
- §11 Backlog Vague C remaining (5 items)

- [ ] **Step 2: Update `CLAUDE.md`**

In the "Active Workplan" section :
- Demote current S30 bullet : change "**Current session:** Session 30…" to "**Session 30 reference:**…"
- Add a new bullet **above** S30 :
```markdown
- **Current session:** Session 31 — Reports Drill-Down + 3 detail pages ✓ ready to merge `swarm/session-31` (~13 commits, 4 waves, 1 migration `20260616000010`, INDEX: [`docs/workplan/plans/2026-05-22-session-31-INDEX.md`](docs/workplan/plans/2026-05-22-session-31-INDEX.md), spec: [`docs/workplan/specs/2026-05-22-session-31-spec.md`](docs/workplan/specs/2026-05-22-session-31-spec.md), plan: [`docs/workplan/plans/2026-05-22-session-31-plan.md`](docs/workplan/plans/2026-05-22-session-31-plan.md)). Base `master` @ `60a1ff3` (post-merge S30 PR #38). Premier chantier Vague C : composant entity-aware `<DrilldownLink entity={...} id={...} filter={...} />` + helper pur `buildDrilldownUrl` (13/13 unit PASS) + 3 nouvelles routes BO read-only (`customers/:id`, `orders/:id`, `inventory/recipes/:id`) + wiring 17 reports en 5 commits par groupe. 1 migration `_010` seed permission `orders.read` (MANAGER+). Aucune nouvelle RPC — detail pages utilisent direct SELECT PostgREST + reuse RPC `recipe_bom_full_v1` (S17). Tests : ~25 (13 unit + 3 component + 6 detail smoke + 5 wiring sample smoke + 2 pgTAP perm) ; typecheck 6/6 PASS. **Hors scope S32+** : `/backoffice/orders` list filtrable (débloquerait PaymentByMethod + SalesByHour drill), actions sur detail pages, mobile responsive, UnifiedReportFilters extra dims, compare toggle sur reports S30, hub mini-KPI bar + favorites, 6 Soon cards restantes. Deviations tracked in INDEX §10.
```

- [ ] **Step 3: Update `docs/workplan/backlog-by-module/00-roadmap-globale.md`**

Mark drill-down item DONE under Vague C ; list 5 remaining Vague C items.

- [ ] **Step 4: Commit**

```bash
git add docs/workplan/plans/2026-05-22-session-31-INDEX.md CLAUDE.md docs/workplan/backlog-by-module/00-roadmap-globale.md
git commit -m "docs(s31): wave 4.B — INDEX + CLAUDE.md Active Workplan + backlog status notes (S31 closeout)"
```

---

## Acceptance checklist (matches spec §11)

- [ ] 13/13 unit `buildDrilldownUrl` PASS
- [ ] 3/3 component smoke `DrilldownLink` PASS
- [ ] Migration `_010` applied to V3 dev + pgTAP 2/2 PASS via cloud MCP
- [ ] Types regen post-migration committed
- [ ] 3 detail pages created (Customer + Order + Recipe) with routes + breadcrumb + back + permission gate
- [ ] 6/6 detail page smoke PASS
- [ ] 17 reports wired with `<DrilldownLink>` (or explicit terminal comment for PaymentByMethod / SalesByHour / RecipeCostTimeline)
- [ ] 5/5 BO wiring smoke sample PASS
- [ ] `pnpm typecheck` 6/6 PASS
- [ ] CLAUDE.md Active Workplan + INDEX S31 + backlog status notes committed
- [ ] Deviations tracked dans INDEX §10
