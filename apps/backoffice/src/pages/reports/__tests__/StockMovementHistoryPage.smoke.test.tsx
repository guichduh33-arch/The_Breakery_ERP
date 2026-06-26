// apps/backoffice/src/pages/reports/__tests__/StockMovementHistoryPage.smoke.test.tsx
// 2026-06-18 — stock-card ledger layout: heading, RPC call, 13 columns, generated
// ref_no + type label, CSV export (no PDF).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementHistoryPage from '@/pages/reports/StockMovementHistoryPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_movement_ledger_v1') {
        return Promise.resolve({
          data: {
            lines: [
              {
                id: 'sm-1',
                movement_date:   '2026-05-20',
                created_time:    '2026-05-20T08:00:00Z',
                movement_type:   'incoming',
                product_id:      'prod-1',
                product_name:    'Flour',
                product_group:   'Ingredient',
                unit:            'kg',
                incoming_qty:    100,
                outgoing_qty:    0,
                beginning_qty:   0,
                balance_qty:     100,
                price:           5000,
                movement_amount: 500_000,
                reference_type:  'admin_action',
                reference_id:    null,
                reason:          null,
                reference_label: null,
                created_by_name: 'Admin',
              },
            ],
            truncated: false,
            row_count: 1,
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

  it('calls get_stock_movement_ledger_v1 with a date range', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_movement_ledger_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start: string; p_end: string }])[1];
      expect(args.p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders the 10 slim stock-card columns', async () => {
    renderPage();
    await screen.findByText('Flour');
    for (const h of ['date', 'type', 'product', 'uom',
      'beginning_qty', 'incoming_qty', 'outgoing_qty', 'balance_qty', 'price', 'movement_amount']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    // Detail-only fields are NOT top-level columns anymore.
    expect(screen.queryByRole('columnheader', { name: 'created_time' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'ref_no' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'product_group' })).toBeNull();
  });

  it('renders the type label in the main row and ref_no only after expanding', async () => {
    renderPage();
    expect(await screen.findByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('INCOMING')).toBeInTheDocument();          // type label, main row
    expect(screen.queryByText('IN26052000000001')).toBeNull();          // ref_no hidden until expanded
    fireEvent.click(screen.getByRole('button', { name: /Expand movement detail/i }));
    expect(screen.getByText('IN26052000000001')).toBeInTheDocument();   // incoming → IN prefix
    expect(screen.getByText('Stock in')).toBeInTheDocument();           // origin label
  });

  it('shows CSV export button but NOT PDF', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('export-csv')).toBeInTheDocument());
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });
});
