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
      if (fn === 'get_payments_by_method_v3') {
        // Real RPC shape: { period, summary, by_method, by_day }.
        return Promise.resolve({
          data: {
            period:  { start: '2026-04-25', end: '2026-05-25' },
            summary: {
              total_amount: 3_500_000, total_count: 85, total_orders: 80,
              total_fees_est: 17_000, total_net_est: 3_483_000,
            },
            by_method: [
              { method: 'cash',   amount: 2_000_000, count: 45, share_pct: 57.14, fee_pct: 0,   fee_est: 0,      net_est: 2_000_000 },
              { method: 'qris',   amount: 1_000_000, count: 28, share_pct: 28.57, fee_pct: 0.7, fee_est: 7_000,  net_est: 993_000 },
              { method: 'gopay',  amount:   500_000, count: 12, share_pct: 14.29, fee_pct: 2,   fee_est: 10_000, net_est: 490_000 },
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

  it('calls get_payments_by_method_v3 with p_date_start and p_date_end', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_payments_by_method_v3');
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

  // Lot C (ADR-006 déc. 9) — frais informatifs : colonnes Fee / Fee est. / Net est.
  it('renders fee and net-estimate columns from the v3 payload', async () => {
    renderPage();
    expect(await screen.findByText('0.7%')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fee est.' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Net est.' })).toBeInTheDocument();
    // Ligne gopay : 2 % de 500 000 = 10 000 de frais, net 490 000.
    expect(screen.getByText(/490\.000/)).toBeInTheDocument();
  });

  it('shows export CSV and PDF buttons once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
  });
});
