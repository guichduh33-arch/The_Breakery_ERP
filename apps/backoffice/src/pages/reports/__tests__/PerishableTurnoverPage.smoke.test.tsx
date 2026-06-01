// apps/backoffice/src/pages/reports/__tests__/PerishableTurnoverPage.smoke.test.tsx
// S30 Wave 4.3 — Smoke test: PerishableTurnoverPage renders heading, calls RPC, shows velocity stars + export buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PerishableTurnoverPage from '@/pages/reports/PerishableTurnoverPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_perishable_turnover_v1') {
        return Promise.resolve({
          data: {
            period: { start: '2026-04-25', end: '2026-05-25' },
            by_product: [
              {
                product_id:          'p-1',
                product_name:        'Fresh Milk',
                lots_count:          8,
                consumed_qty:        240,
                expired_qty:         12,
                current_active_qty:  15,
                waste_pct:           4.76,
                avg_days_in_stock:   2,
                shelf_life_days_p50: 3,
                velocity_score:      4.2,
              },
              {
                product_id:          'p-2',
                product_name:        'Cream Cheese',
                lots_count:          4,
                consumed_qty:        80,
                expired_qty:         20,
                current_active_qty:  5,
                waste_pct:           20.0,
                avg_days_in_stock:   7,
                shelf_life_days_p50: 10,
                velocity_score:      2.1,
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
      <MemoryRouter><PerishableTurnoverPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PerishableTurnoverPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Perishable Turnover/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_perishable_turnover_v1 with p_date_start and p_date_end', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_perishable_turnover_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders product rows with velocity stars once data loads', async () => {
    renderPage();
    expect(await screen.findByText('Fresh Milk')).toBeInTheDocument();
    expect(screen.getByText('Cream Cheese')).toBeInTheDocument();
    // Velocity stars are rendered as ★/☆ characters; at least one star span should exist
    const starSpans = document.querySelectorAll('span[title^="Velocity:"]');
    expect(starSpans.length).toBeGreaterThan(0);
  });

  it('shows export CSV and PDF buttons once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
  });
});
