// apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx
// Session 32 / Wave 3.C — OrdersListPage smoke test (3 cases).
// Session 33 / Wave 4 corrective — bumped RPC name v1→v2 + added mocks for
// useOrdersRealtime (channel) + useLanDevices + useAuthStore so the page
// can mount cleanly in JSDOM without a live supabase client.
//
// T1 : default mount calls get_orders_list_v2 with empty filters.
// T2 : URL params propagate into p_filters JSONB.
// T3 : clicking the row date link navigates to /backoffice/orders/:id.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersListPage from '../OrdersListPage.js';

const rpcMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channelMock; }),
};
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc:           (...args: unknown[]) => rpcMock(...args),
    channel:       vi.fn(() => channelMock),
    removeChannel: vi.fn(),
    from:          vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      then:   (resolve: (r: { data: unknown[]; error: null }) => void) =>
                resolve({ data: [], error: null }),
    })),
  },
}));

// useLanDevices : no terminals (don't trip the page on missing data)
vi.mock('@/features/devices/hooks/useLanDevices.js', () => ({
  useLanDevices: () => ({ data: [], isLoading: false, error: null }),
}));

// useAuthStore : grant orders.edit_open + orders.void so the row actions render
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    selector({ hasPermission: (_c: string) => true }),
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
            terminal_id: null,
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

  it('T1 default mount calls RPC v2 with default range and empty filters', async () => {
    renderRoute('/backoffice/orders');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', expect.objectContaining({
      p_filters: {},
    }));
  });

  it('T2 URL params propagate to RPC v2 filters', async () => {
    renderRoute('/backoffice/orders?payment_method=cash&customer_id=c-1&start=2026-05-01&end=2026-05-26');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', expect.objectContaining({
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
