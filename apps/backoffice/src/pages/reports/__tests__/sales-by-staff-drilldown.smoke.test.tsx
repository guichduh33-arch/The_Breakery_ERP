import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesByStaffPage from '../SalesByStaffPage.js';

vi.mock('@/features/reports/hooks/useSalesByStaff.js', () => ({
  useSalesByStaff: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        staff_id: 'u-1',
        staff_name: 'Alice Cashier',
        total: 1_500_000,
        order_count: 25,
        avg_basket: 60_000,
      },
    ],
  }),
}));

describe('SalesByStaffPage drill-down wiring (S31)', () => {
  it('staff cell renders DrilldownLink with /backoffice/users/:id href', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SalesByStaffPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Alice Cashier/ });
    expect(link.getAttribute('href')).toBe('/backoffice/users/u-1');
  });
});
