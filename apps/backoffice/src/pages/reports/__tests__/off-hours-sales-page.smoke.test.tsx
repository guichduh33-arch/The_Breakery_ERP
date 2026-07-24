// ADR-006 déc. 9 (business hours) — Off-Hours Sales : heading, appel RPC,
// lignes (créneau + jour fermé), total, export CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OffHoursSalesPage from '@/pages/reports/OffHoursSalesPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_off_hours_sales_v1') {
        return Promise.resolve({
          data: {
            summary: { payment_count: 2, order_count: 1, total_amount: 300_000 },
            rows: [
              {
                order_id: 'o1', order_number: 'ORD-001', method: 'cash', amount: 100_000,
                paid_at: '2026-06-01T15:30:00Z', local_time: '2026-06-01 23:30',
                day_key: 'mon', window_open: '07:00', window_close: '22:00', cashier: 'Ayu',
              },
              {
                order_id: 'o1', order_number: 'ORD-001', method: 'qris', amount: 200_000,
                paid_at: '2026-06-02T02:00:00Z', local_time: '2026-06-02 10:00',
                day_key: 'tue', window_open: null, window_close: null, cashier: null,
              },
            ],
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
      <MemoryRouter><OffHoursSalesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OffHoursSalesPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading and calls the RPC with a date range', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Off-Hours Sales/i, level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_off_hours_sales_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders one row per flagged payment, window or Closed for a closed day', async () => {
    renderPage();
    expect(await screen.findByText('2026-06-01 23:30')).toBeInTheDocument();
    expect(screen.getByText('07:00–22:00')).toBeInTheDocument();
    // Jour fermé (tue: null) → « Closed ».
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Ayu')).toBeInTheDocument();
  });

  it('renders the summary total and the CSV export once data is available', async () => {
    renderPage();
    expect(await screen.findByText(/2 payments on 1 order/i)).toBeInTheDocument();
    expect(screen.getByText(/300\.000/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('export-csv')).toBeInTheDocument());
  });
});
