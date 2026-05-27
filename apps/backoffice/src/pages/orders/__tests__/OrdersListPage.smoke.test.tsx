// apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx
// Session 32 / Wave 3.C — OrdersListPage smoke test (3 cases).
//
// T1 : default mount (no URL params) calls get_orders_list_v1 with empty filters.
// T2 : URL params propagate into p_filters JSONB.
// T3 : clicking the row date link navigates to /backoffice/orders/:id.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersListPage from '../OrdersListPage.js';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function renderRoute(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/backoffice/orders" element={<OrdersListPage />} />
          <Route path="/backoffice/orders/:id" element={<div>OrderDetailStub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrdersListPage smoke', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: {
        lines: [
          {
            id: 'o-1',
            order_number: 'ORD-001',
            order_type: 'dine_in',
            status: 'completed',
            total: 100_000,
            created_at: '2026-05-15T10:00:00Z',
            customer_id: null,
            customer_name: null,
            customer_type: null,
            served_by: null,
            served_by_name: 'Alice',
            refund_status: 'none',
            has_modifiers: false,
            payment_method_primary: 'cash',
            items_count: 3,
          },
        ],
        next_cursor: null,
      },
      error: null,
    });
  });

  it('T1 default mount calls RPC with default range and empty filters', async () => {
    renderRoute('/backoffice/orders');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', expect.objectContaining({
      p_filters: {},
    }));
  });

  it('T2 URL params propagate to RPC filters', async () => {
    renderRoute('/backoffice/orders?payment_method=cash&customer_id=c-1&start=2026-05-01&end=2026-05-26');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', expect.objectContaining({
      p_start: '2026-05-01',
      p_end: '2026-05-26',
      p_filters: { payment_method: 'cash', customer_id: 'c-1' },
    }));
  });

  it('T3 row click navigates to /backoffice/orders/:id', async () => {
    renderRoute('/backoffice/orders');
    const link = await screen.findByRole('link', { name: /15\/05\/2026/ });
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByText('OrderDetailStub')).toBeInTheDocument());
  });
});
