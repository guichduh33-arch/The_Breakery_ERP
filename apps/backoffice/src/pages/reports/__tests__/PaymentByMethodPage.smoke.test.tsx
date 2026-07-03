// apps/backoffice/src/pages/reports/__tests__/PaymentByMethodPage.smoke.test.tsx
// S30 Wave 4.3 — Smoke test: PaymentByMethodPage renders heading, calls RPC, shows export buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PaymentByMethodPage from '@/pages/reports/PaymentByMethodPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_payments_by_method_v2') {
        // Real RPC shape: { period, summary, by_method, by_day }.
        return Promise.resolve({
          data: {
            period:  { start: '2026-04-25', end: '2026-05-25' },
            summary: { total_amount: 3_500_000, total_count: 85, total_orders: 80 },
            by_method: [
              { method: 'cash',   amount: 2_000_000, count: 45, share_pct: 57.14 },
              { method: 'qris',   amount: 1_000_000, count: 28, share_pct: 28.57 },
              { method: 'gopay',  amount:   500_000, count: 12, share_pct: 14.29 },
            ],
            by_day: [],
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
      <MemoryRouter><PaymentByMethodPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentByMethodPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Payment by Method/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_payments_by_method_v2 with p_date_start and p_date_end', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_payments_by_method_v2');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders all payment method rows once data loads', async () => {
    renderPage();
    expect(await screen.findByText('cash')).toBeInTheDocument();
    expect(screen.getByText('qris')).toBeInTheDocument();
    expect(screen.getByText('gopay')).toBeInTheDocument();
  });

  it('shows export CSV and PDF buttons once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
  });
});
