// apps/backoffice/src/features/reports/__tests__/ProfitLossPage.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — la page est réécrite sur le socle
// Report shell v2. Ce que ce fichier tient, au-delà du « ça rend » :
//
//  · les bornes partent bien en RPC, ET la période de COMPARAISON aussi ;
//  · LES SECTIONS COMPTABLES SONT INTACTES — revenue, COGS, gross profit, OpEx,
//    net profit, dans cet ordre, avec les montants du serveur. C'est
//    l'invariant de la migration : la présentation bouge, l'état ne bouge pas ;
//  · un seul graphe ;
//  · l'export vit sous un MENU, et sans `reports.export` il se désactive en
//    disant pourquoi au lieu de disparaître.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();
let injectRpcError = false;
let payload: unknown = null;

function pnlPayload() {
  return {
    revenue: { sales: 100, discounts: 0, adjustments: 0, total: 100 },
    cogs:    { production: 40, waste: 0, other: 0, total: 40 },
    gross_profit: 60,
    opex: {
      salary: 0, rent: 20, utilities: 0, supplies: 0,
      marketing: 0, maintenance: 0, other: 0, total: 20,
    },
    operating_profit: 40,
    net_profit:       40,
    lines: [
      { account_id: 'a-4100', code: '4100', name: 'Sales', debit: 0,  credit: 100, balance: 100, account_class: 4 },
      { account_id: 'a-5110', code: '5110', name: 'COGS',  debit: 40, credit: 0,   balance: 40,  account_class: 5 },
      { account_id: 'a-6112', code: '6112', name: 'Rent',  debit: 20, credit: 0,   balance: 20,  account_class: 6 },
    ],
    period: { start: '2026-06-01', end: '2026-06-07', section_id: null },
  };
}

const BLANK_PNL = {
  revenue: { sales: 0, discounts: 0, adjustments: 0, total: 0 },
  cogs:    { production: 0, waste: 0, other: 0, total: 0 },
  gross_profit: 0,
  opex: {
    salary: 0, rent: 0, utilities: 0, supplies: 0,
    marketing: 0, maintenance: 0, other: 0, total: 0,
  },
  operating_profit: 0,
  net_profit:       0,
  lines: [],
  period: { start: '2026-06-01', end: '2026-06-07', section_id: null },
};

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_profit_loss_v2') {
        return injectRpcError
          ? Promise.resolve({ data: null, error: new Error('RPC error: permission denied') })
          : Promise.resolve({ data: payload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import ProfitLossPage from '@/pages/reports/ProfitLossPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// recharts' ResponsiveContainer needs ResizeObserver, absent in jsdom.
class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const START = '2026-06-01';
const END   = '2026-06-07';

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/profit-loss${search}`]}>
        <ProfitLossPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function boundsQueried(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_profit_loss_v2')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockClear();
  sessionStorage.clear();
  payload = pnlPayload();
  injectRpcError = false;
});

describe('ProfitLossPage (smoke)', () => {
  it('renders the heading and the Reports › Financial breadcrumb', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Profit & Loss', level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('Financial');
  });

  it('interroge la fenêtre ET la période précédente, en YYYY-MM-DD', async () => {
    renderPage();
    await waitFor(() => {
      expect(boundsQueried().length).toBeGreaterThanOrEqual(2);
    });
    const bounds = boundsQueried();
    expect(bounds).toContainEqual({ p_date_start: START, p_date_end: END });
    // `previousPeriod('2026-06-01','2026-06-07')` → la semaine d'avant.
    expect(bounds).toContainEqual({ p_date_start: '2026-05-25', p_date_end: '2026-05-31' });
    for (const b of bounds) {
      expect(b.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('LES SECTIONS COMPTABLES SONT INTACTES, dans l ordre, avec les montants serveur', async () => {
    renderPage();
    await screen.findAllByText('Gross profit');
    const table = screen.getByTestId('pnl-statement');
    const labels = within(table).getAllByRole('cell')
      .map((c) => c.textContent ?? '')
      .filter((t) => [
        'Revenue', 'COGS', 'Gross profit', 'Operating expenses', 'Net profit',
      ].includes(t));
    expect(labels).toEqual(['Revenue', 'COGS', 'Gross profit', 'Operating expenses', 'Net profit']);
    // Les postes de détail restent sous leur section.
    for (const item of ['Sales', 'Discounts', 'Adjustments', 'Production', 'Waste', 'Rent']) {
      expect(within(table).getByText(item)).toBeInTheDocument();
    }
    // `formatIdrFull` rend « Rp<U+00A0>40 », que Testing Library normalise.
    expect(within(table).getAllByText('Rp 40').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Rp 60').length).toBeGreaterThan(0);
  });

  it('bande KPI : net profit en héro, taux de marge en points, une comparaison par chiffre', async () => {
    renderPage();
    await screen.findByTestId('kpi-net-profit');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-net-profit', 'kpi-revenue', 'kpi-cogs',
      'kpi-gross-profit', 'kpi-opex', 'kpi-gross-margin',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-gross-margin')).toHaveTextContent('60,0%');
    expect(within(band).getAllByText(/versus prev/)).toHaveLength(6);
  });

  it('un seul graphe, et le détail par compte garde son drill-down', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Revenue, COGS, gross profit/ });
    expect(screen.getByTestId('chart-pnl-shape')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Revenue, COGS, gross profit/ })).toHaveLength(1);
    const link = within(screen.getByTestId('pnl-account-detail')).getByRole('link', { name: /4100/ });
    expect(link.getAttribute('href') ?? '').toContain('account_id=a-4100');
  });

  it('exposes CSV and PDF exports under the export menu', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('sans la permission reports.export : bouton désactivé et motif nommé', async () => {
    useAuthStore.setState({ permissions: [] });
    renderPage();
    const btn = await screen.findByTestId('export-menu');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the reports.export permission.');
  });

  it('shows the canonical empty state when no journal activity', async () => {
    payload = BLANK_PNL;
    renderPage();
    expect(await screen.findByText('No activity')).toBeInTheDocument();
    expect(screen.queryByTestId('pnl-statement')).toBeNull();
  });

  it('surfaces a role="alert" element when the RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-error').textContent).toMatch(/RPC error/i);
    expect(screen.queryByTestId('pnl-statement')).toBeNull();
  });
});
