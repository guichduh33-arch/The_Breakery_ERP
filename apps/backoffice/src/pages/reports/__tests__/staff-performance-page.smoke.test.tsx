// apps/backoffice/src/pages/reports/__tests__/staff-performance-page.smoke.test.tsx
// S40 Wave B1 — Smoke test: StaffPerformancePage renders heading, data rows, export button, and error state.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseStaffPerformance = vi.fn();

vi.mock('@/features/reports/hooks/useStaffPerformance.js', () => ({
  useStaffPerformance: (...args: unknown[]) => mockUseStaffPerformance(...args),
}));

// Supabase is imported transitively. Provide minimal stub.
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}));

import StaffPerformancePage from '@/pages/reports/StaffPerformancePage.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><StaffPerformancePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StaffPerformancePage (smoke)', () => {
  it('renders heading, staff rows with IDR values and CSV export button; no PDF button', () => {
    mockUseStaffPerformance.mockReturnValue({
      isLoading: false,
      error:     null,
      data: {
        period:   { start: '2026-05-13', end: '2026-06-12' },
        by_staff: [
          {
            staff_id:              'u-1',
            staff_name:            'Sari',
            orders_served:         45,
            revenue:               2_700_000,
            aov:                    60_000,
            items_per_order:       3.2,
            voids_count:           2,
            voids_value:           120_000,
            refunds_count:         1,
            refunds_value:          60_000,
            discount_orders_count: 5,
            discount_value:         75_000,
            items_cancelled:       3,
          },
          {
            staff_id:              'u-2',
            staff_name:            'Budi',
            orders_served:         38,
            revenue:               2_200_000,
            aov:                    57_894,
            items_per_order:       2.9,
            voids_count:           0,
            voids_value:           0,
            refunds_count:         0,
            refunds_value:         0,
            discount_orders_count: 3,
            discount_value:        45_000,
            items_cancelled:       1,
          },
        ],
      },
    });

    renderPage();

    // Page heading
    expect(screen.getByRole('heading', { name: /Staff Performance/i, level: 1 })).toBeInTheDocument();
    // Staff name rows
    expect(screen.getByText('Sari')).toBeInTheDocument();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    // IDR values present (revenue column)
    const rpElements = screen.getAllByText(/Rp/);
    expect(rpElements.length).toBeGreaterThan(0);
    // CSV export button present
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    // PDF export button must NOT be rendered (csv-only page per spec)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces role="alert" error element when RPC fails', () => {
    mockUseStaffPerformance.mockReturnValue({
      isLoading: false,
      error:     { message: 'RPC error: get_staff_performance_v1 denied' },
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
