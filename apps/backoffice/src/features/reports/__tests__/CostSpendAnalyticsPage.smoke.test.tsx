// apps/backoffice/src/features/reports/__tests__/CostSpendAnalyticsPage.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 en gardant sa structure et son langage de DEUX FAMILLES DE COÛT. Ce
// fichier tient :
//
//  · les deux RPC de coût ET le P&L sont interrogés, sur la fenêtre et sur la
//    précédente ;
//  · le mock du P&L pointe sur `get_profit_loss_v2` — il visait encore la v1,
//    droppée : la tuile « Revenue » lisait donc un zéro silencieux en test ;
//  · un seul graphe, et le partage COGS ↔ OpEx sans étiquette posée sur un
//    aplat coloré.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_purchase_cogs_breakdown_v1') {
        return Promise.resolve({
          data: {
            period: { start: args.p_date_start, end: args.p_date_end },
            summary: { total: 500_000, line_count: 4, category_count: 2 },
            by_category: [
              { category_id: 'c1', name: 'FLOUR', total: 300_000, qty: 10, share_pct: 60 },
              { category_id: 'c2', name: 'DAIRY', total: 200_000, qty: 5, share_pct: 40 },
            ],
            by_day: [{ date: '2026-06-02', total: 500_000 }],
          },
          error: null,
        });
      }
      if (fn === 'get_expenses_by_category_v1') {
        return Promise.resolve({
          data: {
            period: { start: args.p_date_start, end: args.p_date_end },
            summary: { total: 150_000, count: 2, avg: 75_000 },
            by_category: [
              { category_id: 'e1', code: 'RENT', name: 'Rent', total: 150_000, count: 2, share_pct: 100 },
            ],
            by_day: [{ date: '2026-06-03', total: 150_000 }],
          },
          error: null,
        });
      }
      if (fn === 'get_profit_loss_v2') {
        return Promise.resolve({
          data: {
            revenue: { sales: 2_000_000, discounts: 0, adjustments: 0, total: 2_000_000 },
            cogs: { production: 0, waste: 0, other: 0, total: 0 },
            gross_profit: 2_000_000,
            opex: {
              salary: 0, rent: 0, utilities: 0, supplies: 0,
              marketing: 0, maintenance: 0, other: 0, total: 0,
            },
            operating_profit: 2_000_000,
            net_profit: 2_000_000,
            lines: [],
            period: { start: args.p_date_start, end: args.p_date_end, section_id: null },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import CostSpendAnalyticsPage from '@/pages/reports/CostSpendAnalyticsPage.js';
import { useAuthStore } from '@/stores/authStore.js';

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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/cost-spend?start=${START}&end=${END}`]}>
        <CostSpendAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function windowsOf(fn: string): string[] {
  return mockRpc.mock.calls
    .filter(([name]) => name === fn)
    .map(([, args]) => {
      const a = args as { p_date_start: string; p_date_end: string };
      return `${a.p_date_start}..${a.p_date_end}`;
    });
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('CostSpendAnalyticsPage (smoke)', () => {
  it('renders the heading and queries both cost RPCs with date bounds', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Cost & Spend Analytics/i, level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(windowsOf('get_purchase_cogs_breakdown_v1')).toContain(`${START}..${END}`);
      expect(windowsOf('get_expenses_by_category_v1')).toContain(`${START}..${END}`);
    });
  });

  it('interroge aussi la periode precedente, sur les trois gisements', async () => {
    renderPage();
    await waitFor(() => {
      expect(windowsOf('get_purchase_cogs_breakdown_v1')).toContain('2026-05-25..2026-05-31');
    });
    expect(windowsOf('get_expenses_by_category_v1')).toContain('2026-05-25..2026-05-31');
    expect(windowsOf('get_profit_loss_v2')).toContain('2026-05-25..2026-05-31');
  });

  it('bande KPI : depense totale en hero, ratio en points, revenu lu de la v2', async () => {
    renderPage();
    await screen.findByTestId('kpi-total-spend');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-total-spend', 'kpi-purchases', 'kpi-opex', 'kpi-revenue', 'kpi-spend-ratio',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 650 000 de depense sur 2 000 000 de revenu.
    expect(within(band).getByTestId('kpi-spend-ratio')).toHaveTextContent('32,5%');
  });

  it('un seul graphe, et deux ventilations en cartes', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Daily spend stacked by cost family/ });
    expect(screen.getByTestId('chart-spend-composition')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Daily spend stacked by cost family/ })).toHaveLength(1);
    expect(screen.getByTestId('breakdown-purchase-categories')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-opex-categories')).toBeInTheDocument();
    const structure = screen.getByTestId('breakdown-cost-structure');
    expect(within(structure).getByRole('img', { name: /Share of total spend/ })).toBeInTheDocument();
  });
});
