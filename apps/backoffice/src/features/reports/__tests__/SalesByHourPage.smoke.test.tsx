// apps/backoffice/src/features/reports/__tests__/SalesByHourPage.smoke.test.tsx
// Smoke test: renders the page, asserts heading + a RPC call to
// get_sales_by_hour_v1 happens with the right shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesByHourPage from '@/pages/reports/SalesByHourPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_hour_v1') {
        // 24-bucket zero-filled response shape
        const data = Array.from({ length: 24 }, (_, hour) => ({
          hour,
          total:       hour === 8 ? 12_345 : 0,
          order_count: hour === 8 ? 3      : 0,
        }));
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

// Recharts uses ResizeObserver under the hood; jsdom doesn't ship it.
class StubResizeObserver {
  observe()   { /* no-op */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: StubResizeObserver,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SalesByHourPage />
    </QueryClientProvider>,
  );
}

describe('SalesByHourPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the heading and queries get_sales_by_hour_v1 with today YYYY-MM-DD', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sales by Hour', level: 1 })).toBeInTheDocument();

    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_hour_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date: string }])[1];
      expect(args.p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
