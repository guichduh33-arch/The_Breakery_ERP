// apps/backoffice/src/features/reports/__tests__/CostSpendAnalyticsPage.smoke.test.tsx
// Smoke: renders the consolidated cost dashboard, asserts heading + that it
// queries both new cost RPCs with YYYY-MM-DD bounds.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CostSpendAnalyticsPage from '@/pages/reports/CostSpendAnalyticsPage.js';

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
            by_day: [{ date: '2026-06-20', total: 500_000 }],
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
            by_day: [{ date: '2026-06-21', total: 150_000 }],
          },
          error: null,
        });
      }
      if (fn === 'get_profit_loss_v1') {
        return Promise.resolve({
          data: { revenue: { sales: 0, discounts: 0, adjustments: 0, total: 2_000_000 } },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CostSpendAnalyticsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CostSpendAnalyticsPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the heading and queries both cost RPCs with date bounds', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Cost & Spend Analytics/i, level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      const cogs = mockRpc.mock.calls.find(([fn]) => fn === 'get_purchase_cogs_breakdown_v1');
      const opex = mockRpc.mock.calls.find(([fn]) => fn === 'get_expenses_by_category_v1');
      expect(cogs).toBeDefined();
      expect(opex).toBeDefined();
      const args = (cogs as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
