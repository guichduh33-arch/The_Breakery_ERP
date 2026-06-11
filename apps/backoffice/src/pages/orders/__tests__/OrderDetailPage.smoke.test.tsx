import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderDetailPage } from '../OrderDetailPage.js';

vi.mock('@/features/orders/hooks/useOrderDetail.js', () => ({
  useOrderDetail: (id: string) => ({
    isLoading: false,
    data: {
      id,
      order_number: 'ORD-001',
      status: 'completed',
      order_type: 'dine_in',
      created_at: '2026-05-22T10:00:00Z',
      paid_at: '2026-05-22T10:05:00Z',
      customer_id: 'c-1',
      customer_name: 'Café Bali',
      served_by: 'u-1',
      served_by_name: 'Alice Cashier',
      subtotal: 100_000,
      discount_amount: 10_000,
      tax_amount: 9_000,
      total: 99_000,
      items: [
        {
          id: 'i-1',
          product_id: 'p-1',
          name_snapshot: 'Croissant',
          quantity: 2,
          unit_price: 25_000,
          line_total: 50_000,
          modifiers: null,
          is_cancelled: false,
        },
      ],
      payments: [
        {
          id: 'pay-1',
          method: 'cash',
          amount: 99_000,
          cash_received: 100_000,
          change_given: 1_000,
          paid_at: '2026-05-22T10:05:00Z',
          reference: null,
        },
      ],
      refunds: [],
    },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage', () => {
  it('renders order header with number + status + customer drill', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    const custLink = screen.getByRole('link', { name: /Café Bali/ });
    expect(custLink.getAttribute('href')).toBe('/backoffice/customers/c-1');
  });

  it('renders items + payments table with product drill', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText('Croissant')).toBeInTheDocument());
    const prodLink = screen.getByRole('link', { name: /Croissant/ });
    expect(prodLink.getAttribute('href')).toBe('/backoffice/products/p-1');
    expect(screen.getAllByText(/cash/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/99\.000|99,000/).length).toBeGreaterThan(0);
  });

  it('T3 (C4/BO-12) Back link points to /backoffice/orders, not /backoffice', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
    const backLink = screen.getByRole('link', { name: /back/i });
    expect(backLink.getAttribute('href')).toBe('/backoffice/orders');
  });
});
