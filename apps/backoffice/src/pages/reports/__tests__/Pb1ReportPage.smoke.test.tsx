// apps/backoffice/src/pages/reports/__tests__/Pb1ReportPage.smoke.test.tsx
// S30 Wave 4.3 — Smoke test: Pb1ReportPage renders heading, calls RPC, shows export buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Pb1ReportPage from '@/pages/reports/Pb1ReportPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_pb1_report_v1') {
        return Promise.resolve({
          data: {
            period: { month: 5, year: 2026, start: '2026-05-01', end: '2026-05-31' },
            pb1_rate: 0.10,
            taxable_base:          10_000_000,
            pb1_collected:          1_000_000,
            pb1_payable:            1_000_000,
            balance_account_code:  '2120',
            balance_at_period_end:  1_000_000,
            by_day: [
              { day: '2026-05-01', taxable_base: 500_000, pb1_collected: 50_000 },
              { day: '2026-05-02', taxable_base: 400_000, pb1_collected: 40_000 },
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
      <MemoryRouter><Pb1ReportPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Pb1ReportPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /PB1 Report/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_pb1_report_v1 with p_month and p_year', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_pb1_report_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_month: number; p_year: number }])[1];
      expect(typeof args.p_month).toBe('number');
      expect(typeof args.p_year).toBe('number');
    });
  });

  it('renders summary card for PB1 rate', async () => {
    renderPage();
    // The summary section shows "PB1 rate" label
    expect(await screen.findByText(/PB1 rate/i)).toBeInTheDocument();
  });

  it('shows export CSV and PDF buttons once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
  });
});
