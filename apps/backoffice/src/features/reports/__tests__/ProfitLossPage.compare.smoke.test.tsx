// apps/backoffice/src/features/reports/__tests__/ProfitLossPage.compare.smoke.test.tsx
//
// S29 Wave 5.3 — la comparaison du P&L.
//
// Lot E (campagne Reports 2026-08-15) — ce qu'assertait ce fichier a changé de
// nature. La période précédente n'est plus requêtée SEULEMENT quand le bouton
// est enfoncé : elle l'est toujours, parce que la bande de KPI promet une
// comparaison sur chaque tuile et qu'une promesse conditionnelle n'en est pas
// une. Le bouton commande désormais ce qui coûte de la PLACE — la colonne de
// delta de la table et la seconde série du graphe.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const rpcSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) as unknown, functions: { invoke: vi.fn() } },
}));

import ProfitLossPage from '@/pages/reports/ProfitLossPage.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const mockPnlData = {
  revenue: { sales: 100, discounts: 0, adjustments: 0, total: 100 },
  cogs: { production: 0, waste: 0, other: 0, total: 0 },
  gross_profit: 100,
  opex: { salary: 0, rent: 0, utilities: 0, supplies: 0, marketing: 0, maintenance: 0, other: 0, total: 0 },
  operating_profit: 100,
  net_profit: 100,
  lines: [],
  period: { start: '2026-05-01', end: '2026-05-31', section_id: null },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/reports/profit-loss?start=2026-06-01&end=2026-06-07']}>
        <ProfitLossPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pnlCalls(): { p_date_start: string; p_date_end: string }[] {
  return rpcSpy.mock.calls
    .filter(([fn]) => fn === 'get_profit_loss_v2')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

describe('ProfitLossPage compare', () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    rpcSpy.mockResolvedValue({ data: mockPnlData, error: null });
    sessionStorage.clear();
  });

  it('requête les DEUX fenêtres sans qu on ait à demander la comparaison', async () => {
    renderPage();
    await waitFor(() => expect(pnlCalls().length).toBeGreaterThanOrEqual(2));
    expect(pnlCalls()).toContainEqual({ p_date_start: '2026-06-01', p_date_end: '2026-06-07' });
    expect(pnlCalls()).toContainEqual({ p_date_start: '2026-05-25', p_date_end: '2026-05-31' });
  });

  it('le bouton Compare ouvre la colonne de delta de la table', async () => {
    renderPage();
    await screen.findByTestId('pnl-statement');
    expect(screen.queryAllByTestId('delta-pct')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('compare-toggle'));
    await waitFor(() => expect(screen.queryAllByTestId('delta-pct').length).toBeGreaterThan(0));
  });
});
