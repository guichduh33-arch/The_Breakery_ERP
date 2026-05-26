import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockVariancePage from '../StockVariancePage.js';

vi.mock('@/features/reports/hooks/useStockVariance.js', () => ({
  useStockVariance: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        product_id: 'p-1',
        product_name: 'Croissant',
        sku: 'CRO-001',
        opened: 10,
        sold: 8,
        adjusted: 0,
        current_qty: 2,
        expected: 2,
        variance: 0,
        variance_pct: 0,
      },
    ],
  }),
}));

describe('StockVariancePage drill-down wiring (S31)', () => {
  it('product cell renders DrilldownLink with /backoffice/products/:id href', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <StockVariancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });
});
