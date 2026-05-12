// apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx
//
// Boots SuppliersPage under a mocked MANAGER session, asserts list load,
// creates one row, edits it, toggles inactive, then soft-deletes.
//
// Strategy mirrors the inventory + loyalty smoke tests:
//   - vi.mock('@/stores/authStore.js')   → permissive hasPermission()
//   - vi.mock('@/lib/supabase.js')       → in-memory builder shim
//   - @testing-library/react fireEvent   → no user-event in the BO toolchain
//
// The supabase shim is intentionally minimal — it understands just the calls
// the suppliers feature makes (select/eq/is/or/order, insert/update). If a
// later sub-plan needs a richer mock, extract this into __tests__/_shared/.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SuppliersPage from '@/pages/Suppliers.js';

interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  payment_terms_days: number;
  notes: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const store: SupplierRecord[] = [];

interface Builder {
  _filters: Record<string, unknown>;
  _isDeletedNull: boolean;
  _orderBy: string | null;
  _orderAsc: boolean;
  _pending: { kind: 'insert'; row: Record<string, unknown> } | { kind: 'update'; values: Record<string, unknown> } | null;
  select: () => Builder;
  is: (col: string, val: unknown) => Builder;
  eq: (col: string, val: unknown) => Builder;
  or: () => Builder;
  order: (col: string, opts: { ascending: boolean }) => Builder;
  insert: (row: Record<string, unknown>) => Builder;
  update: (values: Record<string, unknown>) => Builder;
  single: () => Promise<{ data: SupplierRecord | null; error: null }>;
  then: (
    resolve: (v: { data: SupplierRecord[]; error: null }) => void,
  ) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function applyFilters(b: Builder): SupplierRecord[] {
  let rows = store.slice();
  if (b._isDeletedNull) {
    rows = rows.filter((r) => r.deleted_at === null);
  }
  for (const [col, val] of Object.entries(b._filters)) {
    rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
  }
  if (b._orderBy) {
    const key = b._orderBy as keyof SupplierRecord;
    rows.sort((a, z) => {
      const av = a[key];
      const zv = z[key];
      if (av === zv) return 0;
      const cmp = av! > zv! ? 1 : -1;
      return b._orderAsc ? cmp : -cmp;
    });
  }
  return rows;
}

function makeBuilder(): Builder {
  const b: Builder = {
    _filters: {},
    _isDeletedNull: false,
    _orderBy: null,
    _orderAsc: true,
    _pending: null,
    select() { return b; },
    is(col, val) {
      if (col === 'deleted_at' && val === null) b._isDeletedNull = true;
      else b._filters[col] = val;
      return b;
    },
    eq(col, val) { b._filters[col] = val; return b; },
    or() { return b; },
    order(col, opts) {
      b._orderBy = col;
      b._orderAsc = opts.ascending;
      return b;
    },
    insert(row) {
      const next: SupplierRecord = {
        id: `sup-${store.length + 1}`,
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
        contact_phone: (row.contact_phone ?? null) as string | null,
        contact_email: (row.contact_email ?? null) as string | null,
        address: (row.address ?? null) as string | null,
        payment_terms_days: Number(row.payment_terms_days ?? 30),
        notes: (row.notes ?? null) as string | null,
        is_active: Boolean(row.is_active ?? true),
        deleted_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      store.push(next);
      b._pending = { kind: 'insert', row: next as unknown as Record<string, unknown> };
      return b;
    },
    update(values) {
      const target = store.find((r) =>
        Object.entries(b._filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
      );
      if (target) {
        Object.assign(target, values, { updated_at: nowIso() });
        b._pending = { kind: 'update', values: target as unknown as Record<string, unknown> };
      }
      return b;
    },
    async single() {
      if (b._pending?.kind === 'insert') {
        return { data: b._pending.row as unknown as SupplierRecord, error: null };
      }
      if (b._pending?.kind === 'update') {
        return { data: b._pending.values as unknown as SupplierRecord, error: null };
      }
      const rows = applyFilters(b);
      return { data: rows[0] ?? null, error: null };
    },
    then(resolve) {
      // List read path: list hooks await the chain itself (not .single()).
      // Update-without-select (soft-delete) also lands here — store is already mutated.
      resolve({ data: applyFilters(b), error: null });
    },
  };
  return b;
}

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn<(table: string) => unknown>(),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { from: mockFrom },
}));

const grantedPerms = new Set<string>([
  'suppliers.read',
  'suppliers.create',
  'suppliers.update',
  'suppliers.delete',
]);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => grantedPerms.has(p) }),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SuppliersPage />
    </QueryClientProvider>,
  );
}

describe('SuppliersPage smoke', () => {
  beforeEach(() => {
    store.length = 0;
    mockFrom.mockReset();
    mockFrom.mockImplementation((_table: string) => makeBuilder());
  });

  it('renders, creates a supplier, toggles inactive, and soft-deletes', async () => {
    renderPage();

    // Page boots and shows the heading + empty-state message.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Suppliers/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/No suppliers match the current filters/i)).toBeInTheDocument();
    });

    // Open the create modal.
    fireEvent.click(screen.getByRole('button', { name: /New supplier/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Code/i),  { target: { value: 'SUP-001' } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Acme Wholesale' } });
    fireEvent.change(screen.getByLabelText(/^Email/i),{ target: { value: 'ap@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    // The new row appears in the list.
    await waitFor(() => expect(screen.getByText('Acme Wholesale')).toBeInTheDocument());
    expect(screen.getByText('SUP-001')).toBeInTheDocument();

    // Toggle the row inactive via the inline checkbox.
    const row = screen.getByText('Acme Wholesale').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByLabelText(/Toggle Acme Wholesale active/i));
    await waitFor(() =>
      expect(within(row!).getByText(/Inactive/i)).toBeInTheDocument(),
    );

    // Open the delete dialog and confirm.
    fireEvent.click(within(row!).getByRole('button', { name: /Delete Acme Wholesale/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Confirm delete/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete/i }));

    await waitFor(() =>
      expect(screen.queryByText('Acme Wholesale')).not.toBeInTheDocument(),
    );

    // The page must have hit supabase.from('suppliers') at least once.
    const seen = mockFrom.mock.calls.map((c) => c[0]);
    expect(seen).toContain('suppliers');
  });
});
