// apps/backoffice/src/features/reports/__tests__/CashFlowPage.smoke.test.tsx
// Phase 6.A smoke for Cash Flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CashFlowPage from '@/pages/reports/CashFlowPage.js';

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
    period:             { start: '2026-04-15', end: '2026-05-14' },
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CashFlowPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CashFlowPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); payload = reconciledPayload(); });

  it('renders the 3 section headings even with zero investing/financing', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Cash Flow Statement', level: 1 }),
    ).toBeInTheDocument();
    // Wait until data resolves so the table body renders.
    await screen.findByText(/Operating activities/i);
    expect(screen.getByText(/Investing activities/i)).toBeInTheDocument();
    expect(screen.getByText(/Financing activities/i)).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_cash_flow_v3');
      expect(call).toBeDefined();
    });
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
});
