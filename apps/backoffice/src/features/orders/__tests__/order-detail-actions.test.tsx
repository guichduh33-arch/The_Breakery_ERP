import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderDetail } from '../hooks/useOrderDetail.js';
import type { CancelUnpaidAttempt } from '../hooks/useCancelUnpaidOrder.js';

const mocks = vi.hoisted(() => ({
  permissions: new Set(['orders.edit_open', 'orders.void', 'payments.process']),
  select: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [] as Record<string, unknown>[], error: null as { message: string } | null },
  edit: vi.fn(), cancelUnpaid: vi.fn<(args: { attempt: CancelUnpaidAttempt; managerPin: string }) => Promise<unknown>>(), toastError: vi.fn(),
  snapshot: {
    id: 'order-1', order_number: 'ORD-001', status: 'pending_payment', created_via: 'tablet', updated_at: '2026-11-03T00:00:00Z',
    order_items: [{ id: 'item-1', name_snapshot: 'Croissant', quantity: 2, is_locked: true, is_cancelled: false, kitchen_status: 'pending' }],
  },
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (state: { hasPermission: (code: string) => boolean }) => unknown) =>
    selector({ hasPermission: (code) => mocks.permissions.has(code) }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('../hooks/useEditOrderItems.js', () => ({
  useEditOrderItems: () => ({ mutateAsync: mocks.edit, isPending: false, error: null }),
}));
vi.mock('../hooks/useCancelUnpaidOrder.js', () => ({
  useUnpaidOrderSnapshot: () => ({ data: mocks.snapshot, isFetching: false, isError: false, refetch: vi.fn() }),
  useCancelUnpaidOrder: () => ({ mutateAsync: mocks.cancelUnpaid, isPending: false }),
}));
vi.mock('../components/ProductPicker.js', () => ({ ProductPicker: () => null }));

import { OrderDetailActions } from '../components/OrderDetailActions.js';

const ORDER: OrderDetail = {
  id: 'order-1', order_number: 'ORD-001', status: 'pending_payment', order_type: 'dine_in',
  table_number: '1', created_at: '2026-11-03T00:00:00Z', paid_at: null,
  sent_to_kitchen_at: null, customer_id: null, customer_name: null,
  served_by: null, served_by_name: null, subtotal: 100_000, discount_amount: 0,
  tax_amount: 0, total: 100_000, items: [], payments: [], refunds: [], promotions: [],
  refunded_by_method: {}, total_refunded: 0,
};
const ITEM = {
  id: 'item-1', product_id: 'product-1', name_snapshot: 'Croissant', quantity: 2,
  unit_price: 50_000, line_total: 100_000, modifiers: [], is_locked: false,
};

function mount(overrides: Partial<OrderDetail> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailActions order={{ ...ORDER, ...overrides }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(['orders.edit_open', 'orders.void', 'payments.process']);
  mocks.result = { data: [ITEM], error: null };
  const chain = {
    select: mocks.select, eq: mocks.eq,
    then: (resolve: (value: typeof mocks.result) => unknown) => Promise.resolve(mocks.result).then(resolve),
  };
  mocks.from.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.edit.mockResolvedValue(undefined);
  mocks.cancelUnpaid.mockResolvedValue({ order_id: ORDER.id, status: 'voided' });
});

describe('Order detail management actions', () => {
  it('resumes after a lost response, a voided refetch, and closing the dialog', async () => {
    mocks.cancelUnpaid.mockRejectedValueOnce(new Error('network'));
    const qc = new QueryClient();
    const view = render(<QueryClientProvider client={qc}><OrderDetailActions order={ORDER} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId('detail-void'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer left' } });
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void unpaid order' }));
    await screen.findByText(/Cancellation is not confirmed/);
    const firstAttempt = mocks.cancelUnpaid.mock.calls[0]![0].attempt;
    view.rerender(<QueryClientProvider client={qc}><OrderDetailActions order={{ ...ORDER, status: 'voided' }} /></QueryClientProvider>);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Resume unpaid void' }));
    expect(screen.getByLabelText('Reason')).toHaveValue('Customer left');
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void unpaid order' }));
    await waitFor(() => expect(mocks.cancelUnpaid).toHaveBeenCalledTimes(2));
    expect(mocks.cancelUnpaid.mock.calls[1]![0].attempt).toBe(firstAttempt);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume unpaid void' })).toBeNull());
  });

  it('requires the server payment permission as well as orders.void', () => {
    mocks.permissions.delete('payments.process');
    mount();
    expect(screen.queryByTestId('detail-void')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit items' })).toBeInTheDocument();
  });
  it.each(['draft', 'pending_payment'])('edits an unpaid %s order from its detail', async (status) => {
    mount({ status });
    fireEvent.click(screen.getByRole('button', { name: 'Edit items' }));
    const quantity = await screen.findByTestId('qty-item-1');
    fireEvent.change(quantity, { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('apply-changes'));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith({
      orderId: ORDER.id,
      diff: { removes: [], updates: [{ order_item_id: ITEM.id, qty: 1 }], adds: [] },
    }));
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('is_locked'));
    expect(mocks.eq).toHaveBeenCalledWith('order_id', ORDER.id);
    expect(mocks.eq).toHaveBeenCalledWith('is_cancelled', false);
  });

  it('keeps the kitchen lock, manager authorization and waste requirement', async () => {
    mocks.result.data = [{ ...ITEM, is_locked: true }];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit items' }));
    const quantity = await screen.findByTestId('qty-item-1');
    expect(screen.queryByTestId('remove-item-1')).toBeNull();
    fireEvent.change(quantity, { target: { value: '1' } });
    expect(screen.getByTestId('apply-changes')).toBeDisabled();
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it.each(['paid', 'completed'])('keeps paid %s orders outside the unpaid actions', (status) => {
    mount({ status });
    expect(screen.queryByRole('button', { name: 'Edit items' })).toBeNull();
    expect(screen.queryByTestId('detail-void')).toBeNull();
  });

  it.each(['voided', 'b2b_pending'])('does not send unsupported %s orders to POS mutation RPCs', (status) => {
    mount({ status });
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(['pending_payment', 'completed'])('requires the corresponding permission for %s', (status) => {
    mocks.permissions.clear();
    mount({ status });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a readable load error and permits another attempt', async () => {
    mocks.result.error = { message: 'permission_denied' };
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit items' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not load order items. Please try again.'));
    expect(screen.queryByTestId('apply-changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit items' })).toBeEnabled();
    mocks.result.error = null;
    fireEvent.click(screen.getByRole('button', { name: 'Edit items' }));
    expect(await screen.findByTestId('qty-item-1')).toBeInTheDocument();
  });
});
