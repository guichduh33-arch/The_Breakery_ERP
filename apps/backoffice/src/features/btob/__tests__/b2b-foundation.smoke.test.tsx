// apps/backoffice/src/features/btob/__tests__/b2b-foundation.smoke.test.tsx
//
// Session 24 / Phase 2.A.5 — smoke for the B2B foundation surfaces.
//   T1 — useB2bDashboard.aging is built from view_ar_aging (not last_visit_at).
//   T2 — "+ New B2B Order" is enabled, click opens CreateB2bOrderModal.
//   T3 — RecordB2bPaymentModal submit calls record_b2b_payment_v1 mutation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BDashboardPage from '@/pages/btob/B2BDashboardPage.js';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';

const mockRpc = vi.fn();

// `total_spent` is deliberately stale/zero on b2: no write path maintains it,
// so any KPI derived from it under-reports. T4 pins that down.
const CLIENTS = [
  { id: 'b1', name: 'Hotel Kuta',  b2b_company_name: 'PT Kuta',
    b2b_current_balance: 250000, b2b_credit_limit: 1000000,
    total_spent: 5000000, total_visits: 12, last_visit_at: '2026-04-10T00:00:00Z' },
  { id: 'b2', name: 'Villa Sanur', b2b_company_name: 'PT Sanur',
    b2b_current_balance: 0, b2b_credit_limit: null,
    total_spent: 0, total_visits: 0, last_visit_at: null },
];

// Three invoices over two distinct clients — one of them unpaid.
const B2B_INVOICES = [
  { invoice_id: 'i1', order_number: 'B2B-0001', customer_id: 'b1',
    invoice_total: 300000, invoice_date: '2026-04-02T00:00:00Z',
    paid_at: '2026-04-03T00:00:00Z', order_status: 'paid' },
  { invoice_id: 'i2', order_number: 'B2B-0002', customer_id: 'b1',
    invoice_total: 120000, invoice_date: '2026-04-05T00:00:00Z',
    paid_at: null, order_status: 'b2b_pending' },
  { invoice_id: 'i3', order_number: 'B2B-0003', customer_id: 'b2',
    invoice_total: 90000,  invoice_date: '2026-04-06T00:00:00Z',
    paid_at: '2026-04-07T00:00:00Z', order_status: 'paid' },
];
const AGING = [
  { customer_id: 'b1', bucket: '31-60', invoice_count: 2, total_outstanding: 750000, max_age_days: 45 },
  { customer_id: 'b1', bucket: '90+',   invoice_count: 1, total_outstanding: 120000, max_age_days: 95 },
];
const PRODUCTS = [
  { id: 'p1', sku: 'BREAD-01', name: 'Sourdough Loaf', price: 25000, current_stock: 40, unit: 'pcs' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  type Row = Record<string, unknown>;
  function tableRows(table: string): Row[] {
    if (table === 'view_ar_aging')      return AGING;
    if (table === 'view_b2b_invoices')  return B2B_INVOICES;
    if (table === 'products')           return PRODUCTS;
    if (table === 'orders')             return [];
    if (table === 'b2b_payments')       return [];
    return CLIENTS;
  }
  function buildChain(table: string) {
    let rows: Row[] = tableRows(table);
    let headOnly = false;
    type Resolver = (v: RpcResult & { count: number }) => unknown;
    const chain: Record<string, unknown> = {
      select: (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head === true) headOnly = true;
        return chain;
      },
      // Only applied when the fixture actually carries the column, so that
      // filters on columns the fixtures omit (deleted_at…) stay no-ops.
      is: (col: string, val: unknown) => {
        rows = rows.filter((r) => !(col in r) || r[col] === val);
        return chain;
      },
      eq:     () => chain,
      in:     () => chain,
      gte:    () => chain,
      order:  () => chain,
      limit:  (n: number) => { rows = rows.slice(0, n); return chain; },
      then:   (resolve: Resolver) =>
        resolve({ data: headOnly ? null : rows, error: null, count: rows.length }),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? {
          data: {
            payment_id: 'pay-1', payment_number: 'BP-2026-0001',
            allocation: [], allocations: [], je_id: 'je-1',
            customer_balance_after: 150000, idempotent_replay: false,
          },
          error: null,
        });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        p === 'customers.read' || p === 'pos.sale.create' || p === 'customers.update'
        || p === 'b2b.payment.record' || p === 'b2b.order.cancel',
    }),
}));

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDashboard(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <B2BDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Text of a KpiTile's value — the label and value share a wrapper div. */
function kpiValue(label: string): string {
  const labelEl = screen.getByText(label);
  const text = labelEl.parentElement?.textContent ?? '';
  return text.replace(label, '').trim();
}

function renderPaymentModal(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <RecordB2bPaymentModal open={true} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2B foundation (S24)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — dashboard outstanding AR aggregates view_ar_aging rows', async () => {
    renderDashboard();
    // Outstanding AR KPI must display 870 000 (750 + 120 from view_ar_aging).
    await waitFor(() => {
      const candidates = screen.queryAllByText((_, el) => {
        if (el === null) return false;
        const t = el.textContent ?? '';
        return /870[\s,.]?000/.test(t);
      });
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
  });

  // Regression — the order KPIs used to be derived from a 50-row slice of
  // `customers` ordered by the never-maintained `total_spent`: "Total orders"
  // only saw the orders of the clients that survived the slice, and
  // "Active clients" counted clients with total_spent > 0 (here: 1 of 2).
  // Both now read view_b2b_invoices, so they must reflect all three invoices
  // across both clients.
  it('T4 — order KPIs count every B2B invoice, not a total_spent slice', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(kpiValue('Total orders')).toBe('3');
    }, { timeout: 4000 });
    expect(kpiValue('Active clients')).toBe('2');
    expect(kpiValue('Pending orders')).toBe('1');
  });

  it('T2 — + New B2B Order button is enabled (RPC wired)', async () => {
    renderDashboard();
    const btn = await screen.findByRole('button', { name: /new b2b order/i });
    expect(btn).toBeEnabled();
  });

  it('T2b (lot 4) — le modal dit « Pickup date », jamais « Delivery » (pickup-only)', async () => {
    renderDashboard();
    const btn = await screen.findByRole('button', { name: /new b2b order/i });
    fireEvent.click(btn);
    expect(await screen.findByLabelText(/pickup date/i)).toBeInTheDocument();
    expect(screen.queryByText(/delivery date/i)).not.toBeInTheDocument();
  });

  it('T3 — RecordB2bPaymentModal submit calls record_b2b_payment_v2', async () => {
    renderPaymentModal();
    // Wait for B2B customer option to appear.
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'PT Kuta' })).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText(/^customer$/i),   { target: { value: 'b1' } });
    fireEvent.change(screen.getByLabelText(/^amount$/i),     { target: { value: '100000' } });

    const submit = screen.getByRole('button', { name: /record payment/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v2', expect.objectContaining({
        p_customer_id: 'b1',
        p_amount:      100000,
      }));
    });
  });
});
