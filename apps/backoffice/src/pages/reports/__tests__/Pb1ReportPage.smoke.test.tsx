// apps/backoffice/src/pages/reports/__tests__/Pb1ReportPage.smoke.test.tsx
//
// S30 Wave 4.3 — smoke de Pb1ReportPage.
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 en granularité MOIS. Ce fichier tient :
//
//  · les bornes standard `start` / `end` pilotent le mois envoyé à la RPC, et
//    l'ancien lien `?month=&year=` reste honoré ;
//  · LES MONTANTS PB1 NE SONT PAS RECALCULÉS — le total du mois affiché est
//    celui du serveur, pas une somme des lignes visibles ;
//  · le taux et le statut NON-PKP restent nommés.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

function accountsQuery() {
  const chain: Record<string, unknown> = {};
  chain.select     = () => chain;
  chain.eq         = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { id: 'acc-2110' }, error: null });
  return chain;
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => accountsQuery(),
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_pb1_report_v1') {
        return Promise.resolve({
          data: {
            period: { month: args.p_period_month, year: args.p_period_year, start: '2026-05-01', end: '2026-05-31' },
            pb1_rate: 0.10,
            taxable_base:          10_000_000,
            pb1_collected:          1_000_000,
            pb1_payable:            1_000_000,
            balance_account_code:  '2110',
            balance_at_period_end:  1_000_000,
            by_day: [
              { day: '2026-05-01', taxable_base: 500_000, pb1_collected: 50_000 },
              { day: '2026-05-02', taxable_base: 400_000, pb1_collected: 40_000 },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import Pb1ReportPage from '@/pages/reports/Pb1ReportPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-05-01&end=2026-05-31') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/pb1${search}`]}>
        <Pb1ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pb1Args(): { p_period_month: number; p_period_year: number }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_pb1_report_v1')
    .map(([, args]) => args as { p_period_month: number; p_period_year: number });
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('Pb1ReportPage (smoke)', () => {
  it('renders the page heading and names the month', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /PB1 Report/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByTestId('period-control')).toHaveTextContent('May 2026');
  });

  it('derive le mois des bornes standard et l envoie a la RPC', async () => {
    renderPage();
    await waitFor(() => {
      expect(pb1Args()).toContainEqual({ p_period_month: 5, p_period_year: 2026 });
    });
  });

  it('honore l ancien lien ?month=&year= (repli legacy)', async () => {
    renderPage('?month=3&year=2025');
    await waitFor(() => {
      expect(pb1Args()).toContainEqual({ p_period_month: 3, p_period_year: 2025 });
    });
  });

  it('le panneau de periode porte un select mois et un champ annee', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('period-control'));
    const panel = screen.getByTestId('period-panel');
    expect(within(panel).getByLabelText('Select month')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Select year')).toHaveValue(2026);
  });

  it('bande KPI : PB1 due en hero, taux et statut NON-PKP nommes', async () => {
    renderPage();
    await screen.findByTestId('pb1-payable-card');
    const band = screen.getByTestId('report-kpi-band');
    expect(within(band).getByTestId('kpi-pb1-rate')).toHaveTextContent('10%');
    expect(within(band).getByTestId('kpi-pb1-rate')).toHaveTextContent('NON-PKP');
    expect(within(band).getByTestId('kpi-taxable-base')).toBeInTheDocument();
    expect(within(band).getByTestId('kpi-pb1-collected')).toBeInTheDocument();
  });

  it('LE TOTAL DU MOIS EST CELUI DU SERVEUR, pas une somme des lignes visibles', async () => {
    renderPage();
    await screen.findByText('Month total');
    const table = screen.getByTestId('pb1-by-day-table');
    const foot = within(table).getByText('Month total').closest('tr');
    // 500 000 + 400 000 = 900 000 cote lignes ; le serveur dit 10 000 000.
    expect(foot).toHaveTextContent('Rp 10.000.000');
    expect(foot).toHaveTextContent('Rp 1.000.000');
  });

  it('un seul graphe, la serie journaliere', async () => {
    renderPage();
    await screen.findByRole('img', { name: /PB1 collected per day/ });
    expect(screen.getByTestId('chart-pb1-by-day')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /PB1 collected per day/ })).toHaveLength(1);
  });

  it('shows export CSV and PDF under the menu once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });
});
