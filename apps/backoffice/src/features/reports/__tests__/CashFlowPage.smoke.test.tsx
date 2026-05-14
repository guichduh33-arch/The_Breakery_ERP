// apps/backoffice/src/features/reports/__tests__/CashFlowPage.smoke.test.tsx
// Phase 6.A smoke for Cash Flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashFlowPage from '@/pages/reports/CashFlowPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_cash_flow_v1') {
        return Promise.resolve({
          data: {
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
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CashFlowPage />
    </QueryClientProvider>,
  );
}

describe('CashFlowPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

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
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_cash_flow_v1');
      expect(call).toBeDefined();
    });
  });
});
