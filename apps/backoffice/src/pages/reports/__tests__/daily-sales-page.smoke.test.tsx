// apps/backoffice/src/pages/reports/__tests__/daily-sales-page.smoke.test.tsx
// S40 Wave B1 — Smoke test: DailySalesPage renders heading, data, export button, and error state.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseDailySales = vi.fn();

vi.mock('@/features/reports/hooks/useDailySales.js', () => ({
  useDailySales: (...args: unknown[]) => mockUseDailySales(...args),
}));

// Supabase is imported transitively by the page but not called directly in these tests
// (the hook is mocked). Provide a minimal stub to satisfy the module graph.
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}));

import DailySalesPage from '@/pages/reports/DailySalesPage.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DailySalesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DailySalesPage (smoke)', () => {
  it('renders heading, IDR aggregate values and CSV export button; no PDF button', () => {
    mockUseDailySales.mockReturnValue({
      isLoading: false,
      error:     null,
      data: {
        period:  { start: '2026-05-13', end: '2026-06-12' },
        summary: {
          total:        8_500_000,
          order_count:  142,
          aov:           59_859,
          refund_total:  250_000,
          net:          8_250_000,
        },
        by_day: [
          {
            date:        '2026-06-11',
            order_count: 18,
            gross:       1_050_000,
            refunds:     50_000,
            net:         1_000_000,
            aov:          58_333,
          },
        ],
      },
    });

    renderPage();

    // Page heading
    expect(screen.getByRole('heading', { name: /Daily Sales/i, level: 1 })).toBeInTheDocument();
    // IDR value appears in KPI tiles (multiple Rp values expected — check at least one)
    const rpElements = screen.getAllByText(/Rp/);
    expect(rpElements.length).toBeGreaterThan(0);
    // CSV export button present
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    // PDF export button must NOT be rendered (csv-only page per spec)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
    // Date drill-down link present
    expect(screen.getByRole('link', { name: '2026-06-11' })).toBeInTheDocument();
  });

  it('surfaces role="alert" error element when RPC fails', () => {
    mockUseDailySales.mockReturnValue({
      isLoading: false,
      error:     { message: 'RPC error: permission denied for get_daily_sales_v1' },
      data:      undefined,
    });

    renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/RPC error/i);
    // No export button shown on error
    expect(screen.queryByTestId('export-csv')).toBeNull();
  });
});
