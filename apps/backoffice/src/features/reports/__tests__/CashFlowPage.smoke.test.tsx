// apps/backoffice/src/features/reports/__tests__/CashFlowPage.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce fichier tient les DEUX invariants qui comptent ici :
//
//  · les trois sections de la méthode indirecte restent affichées, y compris
//    quand investing et financing valent zéro — une section absente se lit
//    « pas concerné », un zéro se lit « rien ne s'est passé » ;
//  · LE CONTRÔLE DE RÉCONCILIATION EST TOUJOURS LÀ. Depuis la v3 il est
//    normalement vert : c'est un détecteur de régression (écriture
//    déséquilibrée, compte mal classé), pas un aveu d'écart connu.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

/** Payload par défaut : réconcilié (net_change = cash_end - cash_start). */
function reconciledPayload() {
  return {
    operating: {
      net_profit:           40,
      delta_ar:             0,
      delta_ap:             0,
      delta_inventory:      40,   // inventory went down 40
      non_cash_adjustments: 0,
      total:                80,
    },
    investing:          { total: 0 },
    financing:          { total: 0 },
    net_change_in_cash: 80,
    cash_start:         0,
    cash_end:           80,
    period:             { start: '2026-06-01', end: '2026-06-07' },
  };
}

let payload: ReturnType<typeof reconciledPayload> = reconciledPayload();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_cash_flow_v3') {
        return Promise.resolve({ data: payload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import CashFlowPage from '@/pages/reports/CashFlowPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/cash-flow?start=${START}&end=${END}`]}>
        <CashFlowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function boundsQueried(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_cash_flow_v3')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  payload = reconciledPayload();
});

describe('CashFlowPage (smoke)', () => {
  it('renders the 3 section headings even with zero investing/financing', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Cash Flow Statement', level: 1 }),
    ).toBeInTheDocument();
    await screen.findByText('Operating activities');
    const statement = screen.getByTestId('cf-statement');
    expect(within(statement).getByText('Operating activities')).toBeInTheDocument();
    expect(within(statement).getByText('Investing activities')).toBeInTheDocument();
    expect(within(statement).getByText('Financing activities')).toBeInTheDocument();
    expect(within(statement).getByText('Net change in cash')).toBeInTheDocument();
  });

  it('interroge la fenêtre ET la période précédente', async () => {
    renderPage();
    await waitFor(() => {
      expect(boundsQueried().length).toBeGreaterThanOrEqual(2);
    });
    expect(boundsQueried()).toContainEqual({ p_date_start: START, p_date_end: END });
    expect(boundsQueried()).toContainEqual({ p_date_start: '2026-05-25', p_date_end: '2026-05-31' });
  });

  // Le controle de reconciliation reste affiche apres le passage a la v3 : il
  // n'avoue plus un ecart connu, il detecte une regression (ecriture
  // desequilibree, compte mal classe dans accounts.cash_flow_section).
  it('ne signale aucun ecart quand net_change retombe sur cash_end - cash_start', async () => {
    renderPage();
    const ind = await screen.findByTestId('cf-reconciliation');
    expect(ind).toHaveAttribute('role', 'status');
    expect(ind).toHaveTextContent(/^Reconciled:/);
  });

  it('signale l ecart quand net_change ne retombe pas sur la tresorerie', async () => {
    // Le cas de juillet 2026 en miniature : le rapport annonce -20 quand la
    // tresorerie monte de +80.
    payload = { ...reconciledPayload(), net_change_in_cash: -20 };
    renderPage();
    const ind = await screen.findByTestId('cf-reconciliation');
    expect(ind).toHaveAttribute('role', 'alert');
    expect(ind).toHaveTextContent(/Not reconciled/);
  });

  it('bande KPI : variation nette en héro, un seul graphe de sections', async () => {
    renderPage();
    await screen.findByTestId('kpi-net-change');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-net-change', 'kpi-operating', 'kpi-investing',
      'kpi-financing', 'kpi-cash-start', 'kpi-cash-end',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    await screen.findByRole('img', { name: /Operating, investing and financing/ });
    expect(screen.getByTestId('chart-cash-flow-sections')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Operating, investing and financing/ })).toHaveLength(1);
  });
});
