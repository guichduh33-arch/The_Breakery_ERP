// apps/backoffice/src/pages/reports/__tests__/SalesByCustomerPage.smoke.test.tsx
//
// « Sales by Customer » — ce que la page promet et qui ne doit pas se perdre :
//
//  · IDENTIFIÉ = CAPTURE — la réserve est affichée, la part et le panier
//    identifié vs anonyme se lisent dans la bande ;
//  · LE SEUIL DE DÉCROCHAGE EST LA CONSTANTE DOMAIN — le hook la transmet à la
//    RPC en argument, et la liste des décrochés est nominale, drill-down fiche ;
//  · LES VENTILATIONS SE RECALCULENT depuis les lignes — la carte par type
//    recoupe la table ;
//  · « NOUVEAU » se dit avec un badge, jamais avec un delta contre rien.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CUSTOMER_CHURN_MIN_PREV_ORDERS } from '@breakery/domain';

// Fixture qui se recoupe : identifié 410k = A 150k + B 60k + D 200k ;
// retail 210k + b2b 200k = 410k ; anonyme 40k ; C en décrochage (100k préc.).
const REPORT_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    identified_revenue: 410_000, identified_revenue_prev: 180_000,
    identified_orders: 4,
    anonymous_revenue: 40_000, anonymous_revenue_prev: 50_000, anonymous_orders: 1,
    customer_count: 3, new_customer_count: 2,
  },
  by_customer: [
    { customer_id: 'cd', name: 'Villa Uma Kitchen', customer_type: 'b2b', loyalty_points: 0,
      order_count: 1, revenue: 200_000, last_order_date: '2026-06-20', is_new: true,
      revenue_prev: null, order_count_prev: null },
    { customer_id: 'ca', name: 'Ibu Ratna', customer_type: 'retail', loyalty_points: 1240,
      order_count: 2, revenue: 150_000, last_order_date: '2026-06-18', is_new: true,
      revenue_prev: null, order_count_prev: null },
    { customer_id: 'cb', name: 'Pak Andi', customer_type: 'retail', loyalty_points: 380,
      order_count: 1, revenue: 60_000, last_order_date: '2026-06-12', is_new: false,
      revenue_prev: 80_000, order_count_prev: 1 },
  ],
  churned: [
    { customer_id: 'cc', name: 'Ibu Ketut', customer_type: 'retail',
      order_count_prev: 2, revenue_prev: 100_000, last_order_date: '2026-05-20' },
  ],
  by_day: [
    { date: '2026-06-05', identified: 100_000, anonymous: 0 },
    { date: '2026-06-09', identified: 0, anonymous: 40_000 },
    { date: '2026-06-12', identified: 60_000, anonymous: 0 },
    { date: '2026-06-18', identified: 50_000, anonymous: 0 },
    { date: '2026-06-20', identified: 200_000, anonymous: 0 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    identified_revenue: 0, identified_revenue_prev: 0, identified_orders: 0,
    anonymous_revenue: 40_000, anonymous_revenue_prev: 50_000, anonymous_orders: 1,
    customer_count: 0, new_customer_count: 0,
  },
  by_customer: [],
  churned: [],
  by_day: [{ date: '2026-06-09', identified: 0, anonymous: 40_000 }],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_customer_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SalesByCustomerPage from '@/pages/reports/SalesByCustomerPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-06-01&end=2026-06-30') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-customer${search}`]}>
        <SalesByCustomerPage />
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

describe('SalesByCustomerPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Sales by Customer/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls the RPC with the bounds AND the domain churn threshold', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_customer_v1');
      expect(call).toBeDefined();
      const args = (call as [string, {
        p_start_date: string; p_end_date: string; p_churn_min_orders: number;
      }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
      // Le seuil vient du code, jamais redéclaré dans la page.
      expect(args.p_churn_min_orders).toBe(CUSTOMER_CHURN_MIN_PREV_ORDERS);
    });
  });

  it('renders the KPI band — share, baskets and churn beside the hero', async () => {
    renderPage();
    await screen.findByTestId('kpi-identified');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-identified', 'kpi-share', 'kpi-customers', 'kpi-basket', 'kpi-churned',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 410k / 450k = 91,1 % — la part se recalcule des deux totaux servis.
    expect(within(band).getByTestId('kpi-share')).toHaveTextContent('91,1%');
    expect(within(band).getByTestId('kpi-customers')).toHaveTextContent('2 new');
    expect(within(band).getByTestId('kpi-churned')).toHaveTextContent('1');
  });

  it('states the capture reserve', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/capture/i);
    expect(caveat).toHaveTextContent(/anonymous has no type/i);
    expect(caveat).toHaveTextContent(/B2B module/i);
  });

  it('reconciles the type breakdown with the table rows', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    const card = screen.getByTestId('breakdown-types');
    // retail 150k + 60k = 210k ; b2b 200k — mêmes lignes que la table, et le
    // total de la carte referme sur la bande (410k).
    expect(card).toHaveTextContent(/210 rb/);
    expect(card).toHaveTextContent(/200 rb/);
    expect(card).toHaveTextContent(/410 rb/);
  });

  it('lists churning customers by name with a customer drill-down', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    const panel = screen.getByTestId('sbc-churned');
    const link = within(panel).getByRole('link', { name: 'Ibu Ketut' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/backoffice/customers'));
    expect(panel).toHaveTextContent(/100\.000/);
  });

  it('says "new" with a badge and never renders a delta against nothing', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    const table = within(screen.getByTestId('sbc-customer-table')).getByRole('table');
    const ratnaRow = within(table).getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('Ibu Ratna'));
    expect(ratnaRow).toBeDefined();
    expect(ratnaRow!).toHaveTextContent('new');
    // Pak Andi a une base de comparaison : 60k vs 80k → −25 %.
    const andiRow = within(table).getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('Pak Andi'));
    expect(andiRow!).toHaveTextContent(/25/);
  });

  it('keeps the server ranking (revenue desc) as the table default order', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    const table = within(screen.getByTestId('sbc-customer-table')).getByRole('table');
    const dataRows = within(table).getAllByRole('row');
    expect(dataRows[1]?.textContent ?? '').toMatch(/Villa Uma Kitchen/);
    expect(dataRows[2]?.textContent ?? '').toMatch(/Ibu Ratna/);
  });

  it('passes the type filter to the RPC (identified figures only)', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    fireEvent.change(screen.getByLabelText('Customer type filter'), { target: { value: 'b2b' } });
    await waitFor(() => {
      const call = mockRpc.mock.calls
        .filter(([fn]) => fn === 'get_sales_by_customer_v1')
        .at(-1);
      const args = (call as [string, { p_customer_type?: string }])[1];
      expect(args.p_customer_type).toBe('b2b');
    });
  });

  it('offers the CSV export, and no PDF (no template registered)', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when no order carried a customer', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No order carried a customer/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('sbc-customer-table')).toBeNull();
  });
});
