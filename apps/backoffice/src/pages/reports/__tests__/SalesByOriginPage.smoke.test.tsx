// apps/backoffice/src/pages/reports/__tests__/SalesByOriginPage.smoke.test.tsx
//
// « Sales by Origin » — ce que la page promet et qui ne doit pas se perdre :
//
//  · L'ORIGINE EST DANS LE NUMÉRO — P/T1/T2/BO servis par le serveur, jamais
//    fusionnés, l'ordre d'identité est stable (couleurs par origine, pas par
//    rang) ;
//  · LE PÉRIMÈTRE COMMENCE AU CUTOVER — la réserve dit l'exclusion de la
//    pré-numérotation ;
//  · LES PARTS SE RECALCULENT DES CHIFFRES SERVIS — comptoir, salle (T1+T2),
//    back-office referment sur le total.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 150k (P) + 80k (T1) + 70k (T2) + 200k (BO) = 500k ;
// parts 30 % / 16 % / 14 % / 40 %.
const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    total_revenue: 500_000, total_orders: 5,
    total_revenue_prev: 400_000, total_orders_prev: 4,
  },
  by_origin: [
    { origin: 'BO', orders: 1, revenue: 200_000, avg_ticket: 200_000,
      discount_total: 0, revenue_prev: 150_000, orders_prev: 1 },
    { origin: 'P',  orders: 2, revenue: 150_000, avg_ticket: 75_000,
      discount_total: 10_000, revenue_prev: 130_000, orders_prev: 2 },
    { origin: 'T1', orders: 1, revenue: 80_000, avg_ticket: 80_000,
      discount_total: 5_000, revenue_prev: 60_000, orders_prev: 1 },
    { origin: 'T2', orders: 1, revenue: 70_000, avg_ticket: 70_000,
      discount_total: 0, revenue_prev: 60_000, orders_prev: 0 },
  ],
  by_day: [
    { date: '2027-01-17', origin: 'P',  revenue: 150_000, orders: 2 },
    { date: '2027-01-17', origin: 'T1', revenue: 80_000,  orders: 1 },
    { date: '2027-01-18', origin: 'T2', revenue: 70_000,  orders: 1 },
    { date: '2027-01-18', origin: 'BO', revenue: 200_000, orders: 1 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    total_revenue: 0, total_orders: 0, total_revenue_prev: 0, total_orders_prev: 0,
  },
  by_origin: [],
  by_day: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_origin_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SalesByOriginPage from '@/pages/reports/SalesByOriginPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2027-01-01&end=2027-01-31') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-origin${search}`]}>
        <SalesByOriginPage />
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

describe('SalesByOriginPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Sales by Origin/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_sales_by_origin_v1 with the period bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_origin_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2027-01-01');
      expect(args.p_end_date).toBe('2027-01-31');
    });
  });

  it('derives the shares from the served figures', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-counter', 'kpi-floor', 'kpi-bo']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-revenue')).toHaveTextContent(/500 rb/);
    // 150k/500k = 30 % ; (80k+70k)/500k = 30 % ; 200k/500k = 40 %.
    expect(within(band).getByTestId('kpi-counter')).toHaveTextContent('30,0%');
    expect(within(band).getByTestId('kpi-floor')).toHaveTextContent('30,0%');
    expect(within(band).getByTestId('kpi-bo')).toHaveTextContent('40,0%');
  });

  it('states the cutover reserve — pre-numbering orders are excluded', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/Source-coded orders only/i);
    expect(caveat).toHaveTextContent(/before the cutover are excluded/i);
    expect(caveat).toHaveTextContent(/B2B.*BO/i);
  });

  it('keeps T1 and T2 apart and in identity order in the table', async () => {
    renderPage();
    await screen.findAllByText('Counter (P)');
    const panel = screen.getByTestId('origin-table');
    expect(panel).toHaveTextContent('Tablet 1 (T1)');
    expect(panel).toHaveTextContent('Tablet 2 (T2)');
    const rows = within(panel).getAllByRole('row');
    // En-tête, P, T1, T2, BO, total — l'ordre d'identité, pas le rang par CA.
    expect(rows[1]).toHaveTextContent('Counter (P)');
    expect(rows[4]).toHaveTextContent('Back-office (BO)');
    expect(panel).toHaveTextContent(/200\.000/);
  });

  it('reconciles the origin breakdown with the band total', async () => {
    renderPage();
    await screen.findAllByText('Counter (P)');
    const card = screen.getByTestId('breakdown-origins');
    expect(card).toHaveTextContent(/500 rb/);   // le total referme la bande
    // Les quatre origines, dans l'ordre d'identité — parts recalculées.
    expect(card).toHaveTextContent('Counter (P)');
    expect(card).toHaveTextContent('40%');      // BO = 200k / 500k
  });

  it('offers the CSV export per origin, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state before the cutover', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/the numbering went live on 2026-08-16/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('origin-table')).toBeNull();
  });
});
