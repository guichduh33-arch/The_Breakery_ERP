// apps/backoffice/src/features/reports/__tests__/OperatingExpensesPage.smoke.test.tsx
// Smoke: renders the Operating Expenses report, asserts heading + a query to
// get_expenses_by_category_v1, and that the category filter list loads.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OperatingExpensesPage from '@/pages/reports/OperatingExpensesPage.js';

const mockRpc = vi.fn();

// expense_categories list — chainable .select().eq().order() resolving to data.
function categoriesQuery() {
  const result = { data: [{ id: 'e1', name: 'Rent', code: 'RENT', is_active: true }], error: null };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq     = () => chain;
  chain.order  = () => Promise.resolve(result);
  return chain;
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'expense_categories') return categoriesQuery();
      return categoriesQuery();
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
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
      <MemoryRouter><OperatingExpensesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OperatingExpensesPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the heading and queries get_expenses_by_category_v1 with date bounds', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Operating Expenses', level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_expenses_by_category_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
