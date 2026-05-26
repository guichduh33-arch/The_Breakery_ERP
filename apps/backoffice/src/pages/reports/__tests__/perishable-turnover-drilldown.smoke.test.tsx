import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerishableTurnoverPage from '../PerishableTurnoverPage.js';

vi.mock('@/features/reports/hooks/usePerishableTurnover.js', () => ({
  usePerishableTurnover: () => ({
    isLoading: false,
    error: null,
    data: {
      period: { start: '2026-05-16', end: '2026-05-22' },
      by_product: [
        {
          product_id: 'p-1',
          product_name: 'Pain au lait',
          lots_count: 3,
          consumed_qty: 20,
          expired_qty: 1,
          current_active_qty: 5,
          waste_pct: 5,
          avg_days_in_stock: 2,
          shelf_life_days_p50: 3,
          velocity_score: 4,
        },
      ],
    },
  }),
}));

describe('PerishableTurnoverPage drill-down wiring (S31)', () => {
  it('product cell renders DrilldownLink with /backoffice/products/:id href', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PerishableTurnoverPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Pain au lait/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });
});
