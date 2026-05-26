// apps/backoffice/src/pages/reports/__tests__/StockMovementHistoryPage.smoke.test.tsx
// S30 Wave 4.3 — Smoke test: StockMovementHistoryPage renders heading, calls RPC, shows CSV export only (no PDF).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementHistoryPage from '@/pages/reports/StockMovementHistoryPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_movements_v1') {
        return Promise.resolve({
          data: {
            lines: [
              {
                id: 'sm-1',
                product_name:   'Flour',
                movement_type:  'incoming',
                quantity:       100,
                unit_cost:      5000,
                value:          500_000,
                reference_type: 'purchase_order',
                reference_id:   'po-001',
                created_by_name: 'Admin',
                created_at:     '2026-05-20T08:00:00Z',
              },
            ],
            next_cursor: null,
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
      <MemoryRouter><StockMovementHistoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockMovementHistoryPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock Movement History/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_stock_movements_v1 with date range params', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_movements_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start: string; p_end: string }])[1];
      expect(args.p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders movement rows once data loads', async () => {
    renderPage();
    expect(await screen.findByText('Flour')).toBeInTheDocument();
    // 'incoming' appears both in the type filter <option> and in the table cell
    const incomingEls = screen.getAllByText('incoming');
    expect(incomingEls.length).toBeGreaterThanOrEqual(1);
  });

  it('shows CSV export button but NOT PDF export button (pagination limitation)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    // PDF is intentionally omitted for paginated stock movements (DEV-S30-4.X-01)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });
});
