// apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for B2BDashboardPage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BDashboardPage from '@/pages/btob/B2BDashboardPage.js';

// Commutateur du mock : 'ok' répond les fixtures, 'error' fait échouer la
// requête (le hook jette), 'pending' ne résout jamais (chargement figé).
const mockState = vi.hoisted((): { mode: 'ok' | 'error' | 'pending' } => ({ mode: 'ok' }));

vi.mock('@/lib/supabase.js', () => {
  const clients = [
    { id: 'b1', name: 'Hotel Kuta',  b2b_company_name: 'PT Kuta',  b2b_current_balance: 250000,
      b2b_credit_limit: 1000000, total_spent: 5000000, total_visits: 12, last_visit_at: '2026-04-10T00:00:00Z' },
    { id: 'b2', name: 'Bali Organic', b2b_company_name: 'CV Bali', b2b_current_balance: 0,
      b2b_credit_limit: null,    total_spent: 1200000, total_visits: 4,  last_visit_at: '2026-05-01T00:00:00Z' },
  ];
  // Order-side KPIs read view_b2b_invoices (the canonical B2B invoice surface),
  // so the top-clients rollup is derived from these rows — one per invoice.
  const b2bInvoices = [
    { invoice_id: 'o1', order_number: 'B2B-0001', customer_id: 'b1', invoice_total: 350000,
      invoice_date: '2026-05-10T08:00:00Z', paid_at: '2026-05-10T09:00:00Z', order_status: 'paid' },
    { invoice_id: 'o2', order_number: 'B2B-0002', customer_id: 'b1', invoice_total: 500000,
      invoice_date: '2026-05-12T08:00:00Z', paid_at: null, order_status: 'b2b_pending' },
    { invoice_id: 'o3', order_number: 'B2B-0003', customer_id: 'b2', invoice_total: 120000,
      invoice_date: '2026-05-13T08:00:00Z', paid_at: '2026-05-14T00:00:00Z', order_status: 'paid' },
  ];
  // S24 — view_ar_aging now provides the real buckets.
  const aging = [
    { customer_id: 'b1', bucket: 'current', invoice_count: 1, total_outstanding: 250000, max_age_days: 7 },
  ];
  type Resolver = (v: unknown) => void;
  const make = (rows: Record<string, unknown>[]) => {
    let current = rows;
    let headOnly = false;
    const builder: Record<string, unknown> = {
      select: (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head === true) headOnly = true;
        return builder;
      },
      // Applied only when the fixture carries the column, so filters on
      // columns the fixtures omit (deleted_at…) stay no-ops.
      is: (col: string, val: unknown) => {
        current = current.filter((r) => !(col in r) || r[col] === val);
        return builder;
      },
      eq:     () => builder,
      in:     () => builder,
      order:  () => builder,
      limit:  (n: number) => { current = current.slice(0, n); return builder; },
      then:   (resolve: Resolver) => {
        if (mockState.mode === 'pending') return;
        if (mockState.mode === 'error') {
          resolve({ data: null, error: new Error('dashboard query failed'), count: null });
          return;
        }
        resolve({ data: headOnly ? null : current, error: null, count: current.length });
      },
    };
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'orders')             return make([]);
        if (table === 'view_b2b_invoices')  return make(b2bInvoices);
        if (table === 'view_ar_aging')      return make(aging);
        return make(clients);
      },
      rpc: (fn: string) => {
        if (fn === 'reconcile_b2b_balance_v1') {
          return Promise.resolve({
            data: [
              { customer_id: 'b1', customer_name: 'Hotel Kuta', cached_balance: 250000,
                derived_balance: 200000, drift: 50000, has_drift: true },
              { customer_id: 'b2', customer_name: 'Bali Organic', cached_balance: 0,
                derived_balance: 0, drift: 0, has_drift: false },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        p === 'customers.read' || p === 'pos.sale.create' || p === 'customers.update' || p === 'b2b.read',
    }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <B2BDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2BDashboardPage', () => {
  beforeEach(() => { mockState.mode = 'ok'; });

  it('renders title, KPI tiles and quick links', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /b2b dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/active clients/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly b2b revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/outstanding ar/i)).toBeInTheDocument();
    expect(screen.getByText(/pending orders/i)).toBeInTheDocument();
    expect(screen.getByText(/total orders/i)).toBeInTheDocument();
    // Quick links
    expect(screen.getByRole('link', { name: /b2b clients/i })).toHaveAttribute('href', '/backoffice/customers');
    expect(screen.getAllByRole('link', { name: /payments/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: /b2b settings/i })).toHaveAttribute('href', '/backoffice/b2b/settings');
  });

  it('lists top B2B clients from the joined data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('PT Kuta')).toBeInTheDocument());
    expect(screen.getByText('CV Bali')).toBeInTheDocument();
  });

  it('S24 — + New B2B Order is now enabled (RPC landed)', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /new b2b order/i });
    expect(btn).toBeEnabled();
  });

  it('shows a balance-drift warning banner when reconcile reports drift', async () => {
    renderPage();
    expect(await screen.findByTestId('b2b-drift-banner')).toBeInTheDocument();
    expect(screen.getByTestId('b2b-drift-banner')).toHaveTextContent('Hotel Kuta');
    // le client sans drift n'apparaît pas dans le bandeau
    expect(screen.getByTestId('b2b-drift-banner')).not.toHaveTextContent('Bali Organic');
  });

  it('renders dashes, never zeros, while the dashboard is loading', async () => {
    mockState.mode = 'pending';
    renderPage();
    await screen.findByText(/active clients/i);
    // 5 tuiles KPI en vol → 5 tirets ; aucun zéro fabriqué.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('Rp 0')).not.toBeInTheDocument();
  });

  it('renders an alert and dashes when the dashboard query fails', async () => {
    mockState.mode = 'error';
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });
});
