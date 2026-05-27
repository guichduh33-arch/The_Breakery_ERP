// apps/backoffice/src/pages/reports/__tests__/stock-movement-history-drilldown.smoke.test.tsx
// Session 32 / Wave 3.H — StockMovementHistory product drill-down smoke.
//
// T1 : product_name cell wraps in <DrilldownLink entity="product" id={product_id}>
//      pointing to /backoffice/products/<uuid>.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockMovementHistoryPage from '../StockMovementHistoryPage.js';

vi.mock('@/features/reports/hooks/useStockMovementsReport.js', () => ({
  useStockMovementsReport: () => ({
    data: {
      pages: [
        {
          lines: [
            {
              id:             'mov-1',
              product_id:     'prod-xyz',
              product_name:   'Croissant',
              movement_type:  'sale',
              quantity:       -2,
              value:          50_000,
              reference_type: null,
              reference_id:   null,
              created_at:     '2026-05-22T10:00:00Z',
              created_by_id:  null,
              created_by_name: null,
            },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [null],
    },
    isLoading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StockMovementHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockMovementHistoryPage drilldown', () => {
  it('T1 product cell wraps in DrilldownLink to /backoffice/products/<id>', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Croissant' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toBe('/backoffice/products/prod-xyz');
  });
});
