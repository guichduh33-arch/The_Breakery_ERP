// apps/backoffice/src/features/reports/__tests__/BalanceSheetPage.smoke.test.tsx
// Phase 6.A smoke for Balance Sheet — heading, RPC call, balanced indicator.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import BalanceSheetPage from '@/pages/reports/BalanceSheetPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_balance_sheet_v2') {
        return Promise.resolve({
          data: {
            assets: {
              current: { cash: 100, ar: 0, inventory: -40, other: 0, total: 60 },
              fixed:   { total: 0 },
              total:   60,
            },
            liabilities: {
              current:   { ap: 0, tax_payable: 0, loyalty: 0, other: 0, total: 0 },
              long_term: { total: 0 },
              total:     0,
            },
            equity: {
              share_capital:         0,
              retained_earnings:     0,
              current_year_earnings: 60,
              other:                 0,
              total:                 60,
            },
            balanced: true,
            delta:    0,
            as_of:    '2026-05-14',
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
      <MemoryRouter><BalanceSheetPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BalanceSheetPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders heading and queries get_balance_sheet_v2 with YYYY-MM-DD as-of', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Balance Sheet', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_balance_sheet_v2');
      expect(call).toBeDefined();
      const args = (call as [string, { p_as_of_date: string }])[1];
      expect(args.p_as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('shows green balanced indicator when payload.balanced = true', async () => {
    renderPage();
    const status = await screen.findByRole('status', { name: 'Balanced indicator' });
    expect(status.textContent).toMatch(/balanced/i);
  });
});
