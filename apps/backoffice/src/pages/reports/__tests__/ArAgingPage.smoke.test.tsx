// apps/backoffice/src/pages/reports/__tests__/ArAgingPage.smoke.test.tsx
//
// « AR Aging — B2B receivables » — ce que la page promet et qui ne doit pas
// se perdre :
//
//  · LE RETARD, PAS L'ÂGE — les buckets comptent les jours APRÈS l'échéance
//    (émission + terms client, défaut 30 j) ;
//  · L'ENCOURS AU GRAIN FACTURE — total − allocations, une facture
//    partiellement réglée montre ce qui RESTE ;
//  · LA RÉCONCILIATION EST VISIBLE — l'encours recalculé s'affiche à côté du
//    solde caché du système, un écart sort en badge « drift » ;
//  · SNAPSHOT INSTANTANÉ — pas de sélecteur de période, pas de Delta inventé.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 100k courant + 200k (1-30) + 180k (61-90) = 480k ;
// échu = 380k (79,2 %). Dream Hotel dépasse sa limite (380k > 300k) ; Club
// Kembali porte un DRIFT voulu (recalcul 100k ≠ cache 150k).
const REPORT_DATA = {
  as_of: '2026-08-17',
  timezone: 'Asia/Makassar',
  terms_default_days: 30,
  summary: {
    total_outstanding: 480_000, overdue_total: 380_000,
    invoice_count: 3, overdue_invoice_count: 2, customer_count: 2,
    oldest_days_late: 70, oldest_customer: 'Dream Hotel', dso_90d: 34.5,
  },
  by_bucket: [
    { bucket: 'current',      amount: 100_000, invoice_count: 1 },
    { bucket: 'late_1_30',    amount: 200_000, invoice_count: 1 },
    { bucket: 'late_31_60',   amount: 0,       invoice_count: 0 },
    { bucket: 'late_61_90',   amount: 180_000, invoice_count: 1 },
    { bucket: 'late_90_plus', amount: 0,       invoice_count: 0 },
  ],
  by_customer: [
    { customer_id: 'c1', customer_name: 'Dream Hotel', company: null,
      terms_days: 30, credit_limit: 300_000, balance_cached: 380_000,
      current: 0, late_1_30: 200_000, late_31_60: 0, late_61_90: 180_000,
      late_90_plus: 0, total_outstanding: 380_000, max_days_late: 70 },
    { customer_id: 'c2', customer_name: 'Club Kembali', company: null,
      terms_days: 15, credit_limit: null, balance_cached: 150_000,
      current: 100_000, late_1_30: 0, late_31_60: 0, late_61_90: 0,
      late_90_plus: 0, total_outstanding: 100_000, max_days_late: 0 },
  ],
  invoices: [
    { invoice_id: 'i1', order_number: 'B2B-0197', invoice_number: 'INV-0197',
      customer_id: 'c1', customer_name: 'Dream Hotel',
      issued_on: '2026-05-09', due_date: '2026-06-08', days_late: 70,
      bucket: 'late_61_90', total: 300_000, settled: 120_000, outstanding: 180_000 },
    { invoice_id: 'i2', order_number: 'B2B-0214', invoice_number: null,
      customer_id: 'c1', customer_name: 'Dream Hotel',
      issued_on: '2026-07-03', due_date: '2026-08-02', days_late: 15,
      bucket: 'late_1_30', total: 200_000, settled: 0, outstanding: 200_000 },
    { invoice_id: 'i3', order_number: 'B2B-0238', invoice_number: 'INV-0238',
      customer_id: 'c2', customer_name: 'Club Kembali',
      issued_on: '2026-08-09', due_date: '2026-08-24', days_late: 0,
      bucket: 'current', total: 100_000, settled: 0, outstanding: 100_000 },
  ],
};

const EMPTY_DATA = {
  as_of: '2026-08-17',
  timezone: 'Asia/Makassar',
  terms_default_days: 30,
  summary: {
    total_outstanding: 0, overdue_total: 0, invoice_count: 0,
    overdue_invoice_count: 0, customer_count: 0,
    oldest_days_late: 0, oldest_customer: null, dso_90d: null,
  },
  by_bucket: [
    { bucket: 'current', amount: 0, invoice_count: 0 },
    { bucket: 'late_1_30', amount: 0, invoice_count: 0 },
    { bucket: 'late_31_60', amount: 0, invoice_count: 0 },
    { bucket: 'late_61_90', amount: 0, invoice_count: 0 },
    { bucket: 'late_90_plus', amount: 0, invoice_count: 0 },
  ],
  by_customer: [],
  invoices: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_ar_aging_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import ArAgingPage from '@/pages/reports/ArAgingPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/reports/ar-aging']}>
        <ArAgingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // On seede la permission d'export : ce fichier teste le CÂBLAGE, pas le RBAC.
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  reportPayload = REPORT_DATA;
});

describe('ArAgingPage smoke', () => {
  it('renders the heading and the Reports › Finance breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /AR Aging/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Finance');
  });

  it('calls get_ar_aging_v1 — a snapshot takes no period arguments', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_ar_aging_v1');
      expect(call).toBeDefined();
      expect((call as [string, unknown])[1]).toBeUndefined();
    });
  });

  it('shows the outstanding band: totals, overdue share, oldest, DSO, exposure', async () => {
    renderPage();
    await screen.findByTestId('kpi-outstanding');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-outstanding', 'kpi-overdue', 'kpi-oldest', 'kpi-dso', 'kpi-exposed',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-outstanding')).toHaveTextContent(/480 rb/);
    // 380k / 480k = 79,2 % de l'encours.
    expect(within(band).getByTestId('kpi-overdue')).toHaveTextContent(/380 rb/);
    expect(within(band).getByTestId('kpi-overdue')).toHaveTextContent('79,2%');
    expect(within(band).getByTestId('kpi-oldest')).toHaveTextContent('70 d');
    expect(within(band).getByTestId('kpi-oldest')).toHaveTextContent('Dream Hotel');
    expect(within(band).getByTestId('kpi-dso')).toHaveTextContent('34.5 d');
    // 380k de cache > 300k de limite : un client au-dessus de sa limite.
    expect(within(band).getByTestId('kpi-exposed')).toHaveTextContent(/1 over their credit limit/i);
  });

  it('states the snapshot reserve: lateness past due, not invoice age', async () => {
    renderPage();
    await screen.findByTestId('kpi-outstanding');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/past due/i);
    expect(caveat).toHaveTextContent(/30 d when unset/i);
    expect(caveat).toHaveTextContent(/cached balance/i);
  });

  it('lists open invoices with settled amounts and an order drill-down', async () => {
    renderPage();
    await screen.findAllByText('INV-0197');
    const panel = screen.getByTestId('ar-invoices-table');
    // La facture partiellement réglée montre ce qui RESTE.
    expect(panel).toHaveTextContent(/120\.000/);   // settled
    expect(panel).toHaveTextContent(/180\.000/);   // outstanding
    expect(panel).toHaveTextContent('70 d late');
    expect(within(panel).getByRole('link', { name: 'INV-0197' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/orders'));
    // Sans invoice_number, l'order_number fait foi.
    expect(panel).toHaveTextContent('B2B-0214');
  });

  it('reconciles per customer and never hides a cache drift', async () => {
    renderPage();
    await screen.findAllByText('INV-0197');
    const panel = screen.getByTestId('ar-customers-table');
    // Dream Hotel dépasse sa limite ; Club Kembali porte le drift voulu.
    expect(panel).toHaveTextContent(/over/);
    expect(panel).toHaveTextContent('drift');
    expect(panel).toHaveTextContent('unlimited');
    expect(within(panel).getByRole('link', { name: 'Dream Hotel' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/customers'));
  });

  it('closes the lateness breakdown on the band total', async () => {
    renderPage();
    await screen.findAllByText('INV-0197');
    const card = screen.getByTestId('breakdown-buckets');
    expect(card).toHaveTextContent(/480 rb/);
    expect(card).toHaveTextContent('61-90 d late');
  });

  it('offers the CSV export of the invoice list, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when every invoice is settled', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/Every B2B invoice is settled/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ar-invoices-table')).toBeNull();
  });
});
