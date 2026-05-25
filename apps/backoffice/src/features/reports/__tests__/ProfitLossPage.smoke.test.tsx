// apps/backoffice/src/features/reports/__tests__/ProfitLossPage.smoke.test.tsx
// Phase 6.A smoke: renders the Profit & Loss page, asserts heading + RPC
// call to get_profit_loss_v1 with YYYY-MM-DD args, and renders the
// "Net profit" total.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProfitLossPage from '@/pages/reports/ProfitLossPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_profit_loss_v1') {
        return Promise.resolve({
          data: {
            revenue: { sales: 100, discounts: 0, adjustments: 0, total: 100 },
            cogs:    { production: 40, waste: 0, other: 0, total: 40 },
            gross_profit: 60,
            opex:    { salary: 0, rent: 20, utilities: 0, supplies: 0, marketing: 0, maintenance: 0, other: 0, total: 20 },
            operating_profit: 40,
            net_profit:       40,
            lines: [
              { code: '4100', name: 'Sales',  debit: 0,   credit: 100, balance: 100, account_class: 4 },
              { code: '5110', name: 'COGS',   debit: 40,  credit: 0,   balance: 40,  account_class: 5 },
              { code: '6112', name: 'Rent',   debit: 20,  credit: 0,   balance: 20,  account_class: 6 },
            ],
            period: { start: '2026-04-15', end: '2026-05-14', section_id: null },
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
      <MemoryRouter><ProfitLossPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfitLossPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the heading and queries get_profit_loss_v1 with YYYY-MM-DD args', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Profit & Loss', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_profit_loss_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end  ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders Net profit total once data resolves', async () => {
    renderPage();
    await screen.findByText('Net profit');
    // 40 rendered somewhere in the table
    const tds = await screen.findAllByText('40');
    expect(tds.length).toBeGreaterThan(0);
  });
});
