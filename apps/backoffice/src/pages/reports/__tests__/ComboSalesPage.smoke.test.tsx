// apps/backoffice/src/pages/reports/__tests__/ComboSalesPage.smoke.test.tsx
//
// « Combo Sales » — ce que la page promet et qui ne doit pas se perdre :
//
//  · L'UPLIFT EST MESURÉ — panier avec combo vs sans, recalculé des chiffres
//    servis ;
//  · LA PART DU CA se recalcule de combo_revenue / gross_sales ;
//  · LE PRIX EFFECTIF EST LE TOTAL PAYÉ — la réserve le dit (arbitrage), et
//    la frontière v2 (cannibalisation) aussi ;
//  · LES PICKS DE COMPOSANTS sont pondérés et visibles.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 260k de combos sur 394k de CA (66 %) ; panier avec
// 138k vs sans 39,3k.
const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    combo_revenue: 260_000, combo_revenue_prev: 45_000,
    combo_qty: 3, combo_qty_prev: 1, combo_orders: 2,
    gross_sales: 394_000, avg_ticket_with: 138_000, avg_ticket_without: 39_333,
  },
  by_day: [
    { date: '2027-01-17', revenue: 90_000, qty: 1 },
    { date: '2027-01-18', revenue: 170_000, qty: 2 },
  ],
  by_combo: [
    { product_id: 'c1', name: 'Combo Breakfast', qty: 3, revenue: 260_000, avg_price: 86_667 },
  ],
  component_picks: [
    { product_id: 'k1', name: 'Croissant', qty: 3 },
    { product_id: 'k2', name: 'Americano', qty: 3 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    combo_revenue: 0, combo_revenue_prev: 0, combo_qty: 0, combo_qty_prev: 0,
    combo_orders: 0, gross_sales: 394_000, avg_ticket_with: null, avg_ticket_without: 78_800,
  },
  by_day: [],
  by_combo: [],
  component_picks: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_combo_sales_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import ComboSalesPage from '@/pages/reports/ComboSalesPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/combo-sales${search}`]}>
        <ComboSalesPage />
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

describe('ComboSalesPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Combo Sales/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_combo_sales_v1 with the period bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_combo_sales_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2027-01-01');
      expect(args.p_end_date).toBe('2027-01-31');
    });
  });

  it('derives the share and the uplift from the served figures', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-share', 'kpi-uplift', 'kpi-top-combo']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-revenue')).toHaveTextContent(/260 rb/);
    // 260k / 394k = 66,0 %.
    expect(within(band).getByTestId('kpi-share')).toHaveTextContent('66,0%');
    // (138k − 39 333) / 39 333 = 250,85 → +250,9 %.
    expect(within(band).getByTestId('kpi-uplift')).toHaveTextContent(/138 rb/);
    expect(within(band).getByTestId('kpi-uplift')).toHaveTextContent(/\+250,9%/);
    expect(within(band).getByTestId('kpi-top-combo')).toHaveTextContent('Combo Breakfast');
  });

  it('states the server-priced reserve and the v2 boundary', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/Server-priced/i);
    expect(caveat).toHaveTextContent(/total.*paid per combo/i);
    expect(caveat).toHaveTextContent(/Cannibalization.*v2/i);
  });

  it('lists combos with the effective price and a product drill-down', async () => {
    renderPage();
    await screen.findAllByText('Combo Breakfast');
    const panel = screen.getByTestId('combo-table');
    expect(panel).toHaveTextContent(/86\.667/);
    expect(within(panel).getByRole('link', { name: 'Combo Breakfast' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/products'));
  });

  it('shows the weighted component picks', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    const panel = screen.getByTestId('component-picks');
    expect(panel).toHaveTextContent('Croissant');
    expect(panel).toHaveTextContent('Americano');
    expect(panel).toHaveTextContent('×3');
  });

  it('offers the CSV export per combo, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when no combo sold', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No combo line in the selected date range/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('combo-table')).toBeNull();
  });
});
