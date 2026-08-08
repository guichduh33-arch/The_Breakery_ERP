// apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
//
// Écran 1c — tests de la page (enveloppe get_dashboard_overview_v3).
// La prop `data` désactive le hook agrégat ET les trois panneaux : aucun réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '@/pages/Dashboard.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { DashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview.js';

beforeEach(() => {
  cleanup();
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: [],
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function overviewFixture(over: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    kpis: {
      net_revenue:  { value: 8_420_000, vs_yesterday: 12.4, vs_d7: 6.1 },
      orders:       { value: 247, vs_yesterday: 8.3, vs_d7: -2 },
      customers:    { value: 189, vs_yesterday: 4.4, vs_d7: -1.2 },
      items_sold:   { value: 1_084, vs_yesterday: 5.2, vs_d7: 1.1 },
      avg_basket:   { value: 34_100, vs_yesterday: 3.8, vs_d7: 9.4 },
      gross_margin: {
        value: 61.8, vs_yesterday_pt: -1.4, vs_d7_pt: 0,
        basis: 'current_cost_price', cost_coverage_pct: 87.5,
      },
      cash_on_hand: {
        value: 3_170_000, drawer: 1_840_000, safe: 1_330_000, is_derived: true,
        wallets: [{ code: '1110', name: 'Undeposited funds', balance: 3_170_000 }],
      },
    },
    revenue_30d: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      net: (i + 1) * 10_000,
      prev_net: i * 9_000,
    })),
    revenue_30d_summary: { total: 231_400_000, prev_total: 211_900_000, delta_pct: 9.2 },
    hourly_sales: Array.from({ length: 12 }, (_, i) => ({
      hour: 6 + i, today: (i + 1) * 1_000, last_week: i * 900,
    })),
    hourly_peak: { from_hour: 7, to_hour: 9, share_pct: 34 },
    revenue_share: [
      { order_type: 'dine_in',  gross: 3_700_000, order_count: 90, share_pct: 44 },
      { order_type: 'take_out', gross: 2_440_000, order_count: 80, share_pct: 29 },
      { order_type: 'b2b',      gross: 842_000,   order_count: 4,  share_pct: 10 },
    ],
    payments: {
      lines: [
        { method: 'qris', amount: 3_450_000, count: 100, share_pct: 41 },
        { method: 'cash', amount: 3_200_000, count: 90,  share_pct: 38 },
      ],
      total: 8_420_000,
      cash_expected_drawer: 1_840_000,
    },
    cost_mtd: {
      cogs_total: 71_200_000, opex_total: 46_800_000, sales_mtd: 209_000_000,
      cogs_pct_of_sales: 34.1, opex_pct_of_sales: 22.4,
      total: 118_000_000, cost_per_basket: 19_100,
      lines: [
        { account_code: '5100', account_name: 'Flour & grains', family: 'cogs', amount: 24_600_000, mom_delta_pct: -2.1 },
        { account_code: '6200', account_name: 'Salaries',       family: 'opex', amount: 28_500_000, mom_delta_pct: 0 },
      ],
    },
    generated_at: '2026-08-06T09:42:00Z',
    ...over,
  };
}

function renderWith(o: DashboardOverview | null, extra: Partial<{ isLoading: boolean; error: Error | null; refetch: () => void }> = {}) {
  return wrap(
    <DashboardPage
      data={{
        data: o,
        isLoading: extra.isLoading ?? false,
        error: extra.error ?? null,
        refetch: extra.refetch ?? vi.fn(),
      }}
    />,
  );
}

describe('DashboardPage — écran 1c', () => {
  it('renders the "Today · <date>" title and the six KPI labels', () => {
    renderWith(overviewFixture());
    expect(screen.getByRole('heading', { level: 1, name: /^Today · / })).toBeInTheDocument();
    for (const label of ['Net revenue', 'Orders', 'Items sold', 'Avg basket', 'Gross margin', 'Cash on hand']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders both comparisons on a KPI tile', () => {
    renderWith(overviewFixture());
    const tile = screen.getByTestId('kpi-net-revenue');
    expect(tile).toHaveTextContent('12,4%');
    expect(tile).toHaveTextContent('yest');
    expect(tile).toHaveTextContent('6,1%');
    expect(tile).toHaveTextContent('D-7');
  });

  // Régression : la refonte 1c a supprimé ce compteur en silence, parce que rien
  // ne le lisait. Le test existe pour que la prochaine disparition soit bruyante.
  it('renders the customers counter alongside orders', () => {
    renderWith(overviewFixture());
    const tile = screen.getByTestId('kpi-customers');
    expect(tile).toHaveTextContent('189');
    expect(tile).toHaveTextContent('4,4%');
  });

  it('renders the gross margin in POINTS, never as a relative change', () => {
    renderWith(overviewFixture());
    // 1,4pt, pas 1,4% : comparer deux taux en relatif est le rapport faux type.
    expect(screen.getByTestId('kpi-gross-margin')).toHaveTextContent('1,4pt');
  });

  it('states the gross-margin basis instead of passing an estimate off as a measure', () => {
    renderWith(overviewFixture());
    const note = screen.getByTestId('gross-margin-basis');
    expect(note).toHaveTextContent(/current cost price/i);
    expect(note).toHaveTextContent('87,5%');
  });

  it('renders a dash and says "restricted" when the cash block is gated', () => {
    const o = overviewFixture();
    o.kpis.cash_on_hand = { value: null, restricted: true, wallets: [] };
    renderWith(o);
    const tile = screen.getByTestId('kpi-cash-on-hand');
    expect(tile).toHaveTextContent('—');
    expect(tile).toHaveTextContent(/restricted/i);
  });

  it('renders a dash — never a zero — when a comparison has no base', () => {
    const o = overviewFixture();
    o.kpis.orders = { value: 12, vs_yesterday: null, vs_d7: null };
    renderWith(o);
    expect(screen.getByTestId('kpi-orders')).toHaveTextContent('—');
  });

  // Le squelette compte autant de tuiles que la bande en rendra : un squelette
  // plus court fait sauter la grille au premier octet reçu.
  it('renders 7 skeleton tiles while loading', () => {
    renderWith(null, { isLoading: true });
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(7);
  });

  it('renders the error banner on a generic error', () => {
    renderWith(null, { error: new Error('rpc_failed') });
    expect(screen.getByTestId('dashboard-error')).toHaveTextContent(/rpc_failed/);
  });

  // Le défaut que ce bloc verrouille : la bande restait en squelette pulsant
  // pendant que quatre composants affirmaient « aucune vente aujourd'hui ».
  // Quatre assertions factuelles fausses contre une alerte — un gérant qui lit
  // ça à 15 h ne conclut pas « le réseau a lâché », il conclut « la caisse est
  // tombée ». Un « 0 » et un « je ne sais pas » ne sont pas la même phrase.
  describe('on a generic error, the page never asserts a fact it does not have', () => {
    const boom = (): { error: Error } => ({ error: new Error('rpc_failed') });

    it('stops pretending to load: no skeleton survives once loading is over', () => {
      renderWith(null, boom());
      expect(screen.queryByTestId('kpi-skeleton')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('kpi-unavailable')).toHaveLength(7);
    });

    it('renders dashes, never zeros, in the KPI strip', () => {
      renderWith(null, boom());
      const strip = screen.getByTestId('dashboard-kpi-row');
      expect(strip).toHaveTextContent('—');
      expect(strip.textContent).not.toMatch(/\bRp\s*0\b/);
    });

    it('never claims there were no sales', () => {
      renderWith(null, boom());
      expect(screen.queryByText(/no sales today yet/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no revenue data/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no sale recorded today/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no peak yet today/i)).not.toBeInTheDocument();
    });

    it('offers a way back: the banner carries a retry control', () => {
      const refetch = vi.fn();
      renderWith(null, { ...boom(), refetch });
      fireEvent.click(within(screen.getByTestId('dashboard-error')).getByRole('button', { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the restricted state (no KPI row, no alert) on permission denied', () => {
    const err = Object.assign(new Error('permission denied: reports.read required'), { code: '42501' });
    renderWith(null, { error: err });
    expect(screen.getByTestId('dashboard-restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-kpi-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls refetch when the refresh control is clicked', () => {
    const refetch = vi.fn();
    renderWith(overviewFixture(), { refetch });
    fireEvent.click(screen.getByRole('button', { name: /Refresh dashboard/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the four detail cards with their data', () => {
    renderWith(overviewFixture());
    expect(screen.getByTestId('card-open-orders')).toBeInTheDocument();
    expect(screen.getByTestId('card-display-stock')).toBeInTheDocument();
    expect(screen.getByTestId('card-cost-mtd')).toHaveTextContent('Flour & grains');
    const share = screen.getByTestId('card-revenue-share');
    expect(share).toHaveTextContent('Dine-in');
    expect(share).toHaveTextContent('QRIS');
    expect(share).toHaveTextContent(/Cash expected in drawer/i);
  });

  it('renders the 30-day comparison and the hourly peak in the chart headers', () => {
    renderWith(overviewFixture());
    expect(screen.getAllByText(/9,2%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Peak 07:00–09:00/)).toBeInTheDocument();
  });

  it('renders empty states rather than zeros when the day has no activity', () => {
    const o = overviewFixture({
      revenue_30d: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`, net: 0, prev_net: 0,
      })),
      hourly_sales: Array.from({ length: 12 }, (_, i) => ({ hour: 6 + i, today: 0, last_week: 0 })),
      hourly_peak: null,
      revenue_share: [],
      payments: { lines: [], total: 0, cash_expected_drawer: 0 },
    });
    renderWith(o);
    expect(screen.getByText(/No revenue data/i)).toBeInTheDocument();
    expect(screen.getByText(/No sales today yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No sale recorded today/i)).toBeInTheDocument();
    expect(screen.getByText(/No peak yet today/i)).toBeInTheDocument();
  });
});
