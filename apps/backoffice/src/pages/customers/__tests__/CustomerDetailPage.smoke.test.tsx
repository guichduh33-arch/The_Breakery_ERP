import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerDetailPage } from '../CustomerDetailPage.js';

const baseCustomer = {
  id: 'c-1',
  name: 'Café Bali',
  email: 'cb@example.com',
  phone: '+62-811',
  category_id: 'cat-1',
  category: {
    id: 'cat-1',
    name: 'Wholesale',
    slug: 'wholesale',
    price_modifier_type: 'wholesale' as const,
    discount_percentage: 0,
    points_multiplier: 1,
    loyalty_enabled: true,
  },
  loyalty_points: 100,
  lifetime_points: 500,
  total_spent: 5_000_000,
  total_visits: 42,
  last_visit_at: '2026-05-22T10:00:00Z',
  birth_date: null,
  marketing_consent: true,
  deleted_at: null,
  b2b_company_name: 'Café Bali SRL',
  b2b_tax_id: '01.234.567.8-901',
  b2b_payment_terms_days: 30,
  b2b_credit_limit: 10_000_000,
  b2b_current_balance: 2_500_000,
  retail_credit_limit: null as number | null,
  created_at: '2026-01-01',
};

let mockCustomerType: 'b2b' | 'retail' = 'b2b';
let mockRetailCreditLimit: number | null = null;

vi.mock('@/features/customers/hooks/useCustomerDetail.js', () => ({
  useCustomerDetail: (id: string) => ({
    isLoading: false,
    data: {
      customer: {
        ...baseCustomer,
        id,
        customer_type: mockCustomerType,
        retail_credit_limit: mockRetailCreditLimit,
      },
      orders_count: 42,
      recent_orders: [
        {
          id: 'o-1',
          order_number: 'ORD-001',
          created_at: '2026-05-22T10:00:00Z',
          total: 250_000,
          status: 'completed',
          order_type: 'dine_in',
          items_count: 3,
        },
      ],
    },
  }),
}));

vi.mock('@/features/customers/hooks/useUpdateRetailCreditLimit.js', () => ({
  useUpdateRetailCreditLimit: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/loyalty/hooks/useCustomerLoyaltyHistory.js', () => ({
  loyaltyHistoryKey: (id: string) => ['loyalty-history', id],
  useCustomerLoyaltyHistory: () => ({ isLoading: false, data: [] }),
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
  beforeEach(() => {
    mockCustomerType = 'b2b';
    mockRetailCreditLimit = null;
  });

  it('renders header with name, category chip and active badge', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Wholesale')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows B2B credit info on the Info tab', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByText(/10\.000\.000|10,000,000/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2\.500\.000|2,500,000/)).toBeInTheDocument();
  });

  it('drills into an order from the Orders tab', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }));
    const orderLink = await screen.findByRole('link', { name: /ORD-001/ });
    expect(orderLink.getAttribute('href')).toBe('/backoffice/orders/o-1');
  });

  it('does not show the retail tab-limit field for a b2b customer', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/plafond ardoise/i)).not.toBeInTheDocument();
  });

  it('shows the retail tab-limit field for a retail customer, seeded from the mutation value', async () => {
    mockCustomerType = 'retail';
    mockRetailCreditLimit = 750_000;
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/plafond ardoise/i)).toHaveValue('750000');
  });
});
