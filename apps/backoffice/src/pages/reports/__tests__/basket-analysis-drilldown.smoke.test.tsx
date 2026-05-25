import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BasketAnalysisPage from '../BasketAnalysisPage.js';

vi.mock('@/features/reports/hooks/useBasketAnalysis.js', () => ({
  BASKET_ANALYSIS_QK: ['reports', 'basket-analysis'],
  useBasketAnalysis: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        product_id_a: 'p-1',
        product_a_name: 'Croissant',
        product_id_b: 'p-2',
        product_b_name: 'Café',
        co_occurrence_count: 12,
        support_a: 0.3,
        support_b: 0.4,
        support_pair: 0.1,
        confidence: 0.5,
        lift: 1.25,
      },
    ],
  }),
}));

describe('BasketAnalysisPage drill-down wiring (S31)', () => {
  it('both pair cells render DrilldownLink with correct hrefs', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <BasketAnalysisPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const linkA = screen.getByRole('link', { name: /Croissant/ });
    const linkB = screen.getByRole('link', { name: /Café/ });
    expect(linkA.getAttribute('href')).toBe('/backoffice/products/p-1');
    expect(linkB.getAttribute('href')).toBe('/backoffice/products/p-2');
  });
});
