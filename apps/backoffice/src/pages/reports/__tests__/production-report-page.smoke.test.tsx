// apps/backoffice/src/pages/reports/__tests__/production-report-page.smoke.test.tsx
// S40 Wave B3 — Smoke test: ProductionReportPage renders heading, calls RPC, shows KPI + CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductionReportPage from '@/pages/reports/ProductionReportPage.js';

// Mutable flag read by the rpc mock to switch between happy path and error path.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC production error' } });
      }
      if (fn === 'get_production_report_v1') {
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            summary: { runs: 12, total_produced: 480, total_waste: 24, total_value: 3_600_000 },
            by_product: [
              { product_id: 'p-1', product_name: 'Croissant', qty_produced: 300, qty_waste: 15, value: 2_250_000, runs: 8 },
              { product_id: 'p-2', product_name: 'Baguette',  qty_produced: 180, qty_waste:  9, value: 1_350_000, runs: 4 },
            ],
            by_day: [
              { date: '2026-06-10', qty_produced: 120, qty_waste: 6, value: 900_000 },
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
      <MemoryRouter><ProductionReportPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductionReportPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading, KPI cards, product rows, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Production Report/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Baguette')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    // No PDF export button (CSV-only page)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces an error message when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('RPC production error');
  });
});
