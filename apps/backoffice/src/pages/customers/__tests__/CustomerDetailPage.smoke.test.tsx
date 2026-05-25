import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerDetailPage } from '../CustomerDetailPage.js';

vi.mock('@/features/customers/hooks/useCustomerDetail.js', () => ({
  useCustomerDetail: (id: string) => ({
    isLoading: false,
    data: {
      customer: {
        id,
        name: 'Café Bali',
        customer_type: 'b2b' as const,
        email: 'cb@example.com',
        phone: '+62-811',
        category_id: null,
        loyalty_points: 100,
        lifetime_points: 500,
        total_spent: 5_000_000,
        total_visits: 42,
        last_visit_at: '2026-05-22T10:00:00Z',
        birth_date: null,
        marketing_consent: true,
        b2b_company_name: 'Café Bali SRL',
        b2b_tax_id: '01.234.567.8-901',
        b2b_payment_terms_days: 30,
        b2b_credit_limit: 10_000_000,
        b2b_current_balance: 2_500_000,
        created_at: '2026-01-01',
      },
      orders_count: 42,
      recent_orders: [
        {
          id: 'o-1',
          order_number: 'ORD-001',
          created_at: '2026-05-22T10:00:00Z',
          total: 250_000,
          status: 'completed',
        },
      ],
    },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/customers/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomerDetailPage', () => {
  it('renders header with name + B2B badge', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() => expect(screen.getByText('Café Bali')).toBeInTheDocument());
    expect(screen.getByText('B2B')).toBeInTheDocument();
  });

  it('renders B2B credit info when customer_type=b2b + recent order drill', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByText(/10\.000\.000|10,000,000/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2\.500\.000|2,500,000/)).toBeInTheDocument();
    const orderLink = screen.getByRole('link', { name: /ORD-001/ });
    expect(orderLink.getAttribute('href')).toBe('/backoffice/orders/o-1');
  });
});
