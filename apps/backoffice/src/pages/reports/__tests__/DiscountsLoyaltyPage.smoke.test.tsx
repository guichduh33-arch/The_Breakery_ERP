// apps/backoffice/src/pages/reports/__tests__/DiscountsLoyaltyPage.smoke.test.tsx
//
// « Discounts & Loyalty » — ce que la page promet et qui ne doit pas se perdre :
//
//  · QUATRE LEVIERS, UNE SEULE SOMME — le hero se recalcule des quatre chiffres
//    servis, et la carte par levier referme dessus ;
//  · CHAQUE REMISE PIN EST SIGNÉE — motif + autorisateur en clair ;
//  · LES POINTS ONT DEUX PRIX — le consenti vient du montant réellement
//    décompté, le passif PROJETÉ est valorisé à REDEMPTION_RATE (domain) et
//    étiqueté comme projection ;
//  · LA DESCRIPTION DE PROMO EST LE SNAPSHOT — lisible même promo supprimée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { REDEMPTION_RATE } from '@breakery/domain';

// Fixture qui se recoupe : consenti = 15k + 50k + 30k + 20k = 115k ;
// net points = 300 − 2000 = −1700 → passif projeté 17k (à Rp 10/pt).
const REPORT_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    line_discount: 15_000, order_discount: 50_000, promotion: 30_000, redemption_value: 20_000,
    line_discount_prev: 10_000, order_discount_prev: 20_000, promotion_prev: 40_000,
    redemption_value_prev: 10_000,
    gross_sales: 2_875_000, gross_sales_prev: 2_000_000,
    pin_count: 1, points_issued: 300, points_burned: 2_000,
  },
  by_day: [
    { date: '2026-06-10', line_discount: 15_000, order_discount: 50_000, promotion: 30_000,
      redemption_value: 20_000, points_issued: 250, points_burned: 2_000 },
    { date: '2026-06-15', line_discount: 0, order_discount: 0, promotion: 0,
      redemption_value: 0, points_issued: 50, points_burned: 0 },
  ],
  pin_discounts: [
    { order_id: 'o1', order_number: '#0101', business_date: '2026-06-10',
      reason: 'geste commercial', amount: 50_000,
      authorized_by: { id: 'u9', name: 'Mamat' } },
  ],
  by_promotion: [
    { promotion_id: 'pr1', description: 'Croissant duo −25 % (snapshot)',
      applications: 3, amount: 30_000 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    line_discount: 0, order_discount: 0, promotion: 0, redemption_value: 0,
    line_discount_prev: 0, order_discount_prev: 0, promotion_prev: 0, redemption_value_prev: 0,
    gross_sales: 2_875_000, gross_sales_prev: 2_000_000,
    pin_count: 0, points_issued: 0, points_burned: 0,
  },
  by_day: [],
  pin_discounts: [],
  by_promotion: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_discounts_loyalty_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import DiscountsLoyaltyPage from '@/pages/reports/DiscountsLoyaltyPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/discounts-loyalty${search}`]}>
        <DiscountsLoyaltyPage />
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

describe('DiscountsLoyaltyPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Discounts & Loyalty/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_discounts_loyalty_v1 with the business-day bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_discounts_loyalty_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
    });
  });

  it('derives the hero from the four levers and the rate from gross sales', async () => {
    renderPage();
    await screen.findByTestId('kpi-consented');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-consented', 'kpi-rate', 'kpi-top-lever', 'kpi-points', 'kpi-pin',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 15k + 50k + 30k + 20k = 115k ; 115k / 2 875k = 4,0 %.
    expect(within(band).getByTestId('kpi-consented')).toHaveTextContent(/115 rb/);
    expect(within(band).getByTestId('kpi-rate')).toHaveTextContent('4,0%');
    // Le levier n°1 des chiffres servis : la remise de commande (50k).
    expect(within(band).getByTestId('kpi-top-lever')).toHaveTextContent('Order discounts (PIN)');
  });

  it('labels the points liability as a PROJECTION at the domain constant', async () => {
    renderPage();
    await screen.findByTestId('kpi-points');
    const tile = screen.getByTestId('kpi-points');
    // net = 300 − 2000 = −1700 → 1700 × REDEMPTION_RATE = 17k, dit "projected".
    expect(tile).toHaveTextContent('300 / 2.000');
    expect(tile).toHaveTextContent(/projected liability/i);
    expect(tile).toHaveTextContent(/17 rb/);
    expect(REDEMPTION_RATE).toBe(10);
  });

  it('states the four-lever reserve and the Promo ROI boundary', async () => {
    renderPage();
    await screen.findAllByText('#0101');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/Four levers/i);
    expect(caveat).toHaveTextContent(/actually.*deducted/i);
    expect(caveat).toHaveTextContent(/Promo ROI/i);
    expect(caveat).toHaveTextContent(/pricing, not a discount/i);
  });

  it('shows the signed PIN discount with an order drill-down', async () => {
    renderPage();
    await screen.findAllByText('#0101');
    const panel = screen.getByTestId('dl-pin-table');
    expect(panel).toHaveTextContent('geste commercial');
    expect(panel).toHaveTextContent('Mamat');
    expect(within(panel).getByRole('link', { name: '#0101' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/orders'));
  });

  it('reconciles the lever breakdown with the band', async () => {
    renderPage();
    await screen.findAllByText('#0101');
    const card = screen.getByTestId('breakdown-levers');
    expect(card).toHaveTextContent(/115 rb/);   // le total referme le hero
    expect(card).toHaveTextContent('Promotions');
    expect(card).toHaveTextContent('Points redeemed');
  });

  it('renders the snapshot promotion description with its totals', async () => {
    renderPage();
    await screen.findAllByText('#0101');
    const table = screen.getByTestId('dl-promo-table');
    expect(table).toHaveTextContent('Croissant duo −25 % (snapshot)');
    expect(table).toHaveTextContent(/30\.000/);
    expect(table).toHaveTextContent('100,0%');
  });

  it('offers the CSV export of the PIN list, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing was given away', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No discount, promotion or loyalty movement/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('dl-pin-table')).toBeNull();
  });
});
