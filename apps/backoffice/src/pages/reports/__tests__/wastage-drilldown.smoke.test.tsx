import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WastagePage from '../WastagePage.js';

vi.mock('@/features/reports/hooks/useWastageReport.js', () => ({
  useWastageReport: () => ({
    isLoading: false,
    error: null,
    data: {
      lines: [
        {
          id: 'l-1',
          product_id: 'p-1',
          product_name: 'Croissant',
          type: 'manual_waste',
          qty: 5,
          value: 12_500,
          created_at: '2026-05-22T10:00:00Z',
        },
      ],
      total_value: 12_500,
      period: { start: '2026-05-16', end: '2026-05-22' },
    },
  }),
}));

describe('WastagePage drill-down wiring (S31)', () => {
  it('product cell renders DrilldownLink with /backoffice/products/:id href', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <WastagePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });
});
