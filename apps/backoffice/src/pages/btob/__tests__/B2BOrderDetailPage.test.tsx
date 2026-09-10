import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BOrderDetailPage from '../B2BOrderDetailPage.js';

const { state, rpc } = vi.hoisted(() => ({
  state: { delivered: false, paid: false, missing: false, error: false, allowed: true },
  rpc: vi.fn(),
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (select: (s: { hasPermission: () => boolean }) => unknown) =>
    select({ hasPermission: () => state.allowed }),
}));
vi.mock('@/features/btob/components/B2bOrderItemsPanel.js', () => ({
  B2bOrderItemsPanel: ({ orderId }: { orderId: string }) => <div>Items for {orderId}</div>,
}));
vi.mock('@/features/btob/components/RecordB2bPaymentModal.js', () => ({
  RecordB2bPaymentModal: ({ initialInvoiceIds }: { initialInvoiceIds: string[] }) => (
    <div role="dialog">Payment for {initialInvoiceIds.join(',')}</div>
  ),
}));
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({
          data: state.missing
            ? null
            : {
                invoice_id: 'o1',
                order_number: 'BO-001',
                customer_id: 'c1',
                customer_name: 'Hotel',
                invoice_date: '2026-09-10',
                pickup_date: '2026-09-15',
                invoice_total: 100,
                amount_paid: state.paid ? 100 : 0,
                outstanding: state.paid ? 0 : 100,
                b2b_delivered_at: state.delivered ? '2026-09-15' : null,
              },
          error: state.error ? { message: 'Connection failed' } : null,
        }),
      };
      return chain;
    },
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/backoffice/b2b/orders/o1?payment=unpaid']}>
        <Routes>
          <Route path="/backoffice/b2b/orders/:orderId" element={<B2BOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2B order detail', () => {
  beforeEach(() => {
    Object.assign(state, {
      delivered: false,
      paid: false,
      missing: false,
      error: false,
      allowed: true,
    });
    rpc.mockReset();
  });
  it('opens directly with items, actions and a return link preserving filters', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'BO-001' })).toBeInTheDocument();
    expect(screen.getByText('Items for o1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to B2B orders/ })).toHaveAttribute(
      'href',
      '/backoffice/b2b/orders?payment=unpaid',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Payment for o1');
  });
  it('refreshes delivery status after confirming pickup without marking the order paid', async () => {
    rpc.mockImplementation(() => {
      state.delivered = true;
      return Promise.resolve({ data: { order_id: 'o1' }, error: null });
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark delivered' }).at(-1)!);
    await waitFor(() => {
      expect(screen.getByText('Delivered')).toBeInTheDocument();
    });
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });
  it('disables writes for a reader without permissions', async () => {
    state.allowed = false;
    setup();
    expect(await screen.findByRole('button', { name: 'Mark delivered' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });
  it('shows a missing order without offering actions', async () => {
    state.missing = true;
    setup();
    expect(await screen.findByText('Order not found or no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
  it('shows a retry on a read error', async () => {
    state.error = true;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
