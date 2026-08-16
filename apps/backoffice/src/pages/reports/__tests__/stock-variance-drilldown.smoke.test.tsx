import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockVariancePage from '../StockVariancePage.js';

// ADR-027 — la ligne suit la forme de `get_stock_variance_v3` : ouverture,
// flux signes, correction d'inventaire, cloture.
vi.mock('@/features/reports/hooks/useStockVariance.js', () => ({
  useStockVariance: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        product_id:   'p-1',
        product_name: 'Croissant',
        sku:          'CRO-001',
        opening:      10,
        stock_in:     0,
        sold:         -8,
        consumed:     0,
        wasted:       0,
        corrected:    0,
        other:        0,
        closing:      2,
        current_qty:  2,
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
