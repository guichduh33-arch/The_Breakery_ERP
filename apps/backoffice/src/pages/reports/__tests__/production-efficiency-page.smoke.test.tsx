// apps/backoffice/src/pages/reports/__tests__/production-efficiency-page.smoke.test.tsx
// S40 Wave B3 — Smoke test: ProductionEfficiencyPage renders heading, calls RPC, shows table + CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductionEfficiencyPage from '@/pages/reports/ProductionEfficiencyPage.js';

// Mutable flag read by the rpc mock to switch between happy path and error path.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC efficiency error' } });
      }
      if (fn === 'get_production_efficiency_v1') {
        return Promise.resolve({
          data: {
            period: { start: '2026-05-13', end: '2026-06-12' },
            by_product: [
              {
                product_id:             'p-1',
                product_name:           'Croissant',
                runs:                   8,
                avg_yield_variance_pct: -5.2,
                worst_variance_pct:     -15.0,
                waste_rate_pct:         3.1,
                has_variance_reasons:   true,
              },
              {
                product_id:             'p-2',
                product_name:           'Sourdough',
                runs:                   4,
                avg_yield_variance_pct: 2.1,
                worst_variance_pct:     null,
                waste_rate_pct:         null,
                has_variance_reasons:   false,
              },
            ],
            by_day: [
              { date: '2026-06-10', avg_yield_variance_pct: -3.0, waste_rate_pct: 2.5 },
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
      <MemoryRouter><ProductionEfficiencyPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductionEfficiencyPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading, product rows with variance, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Production Efficiency/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Sourdough')).toBeInTheDocument();
    // Null variance rendered as dash
    const dashCells = screen.getAllByText('—');
    expect(dashCells.length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    // No PDF export button (CSV-only page)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces an error message when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('RPC efficiency error');
  });
});
