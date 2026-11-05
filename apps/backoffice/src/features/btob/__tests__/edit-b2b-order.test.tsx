import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditB2bOrderDialog } from '../components/EditB2bOrderDialog.js';
import { financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';

const { rpc, state } = vi.hoisted(() => ({ rpc: vi.fn(), state: { readError: false } }));
const productId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const addedId = '33333333-3333-4333-8333-333333333333';
const revision = '2026-10-31T01:02:03.123456+00:00';
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc,
  from: () => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, order: () => chain,
      single: () => Promise.resolve({ data: { notes: 'Original', updated_at: revision,
        order_items: [{ id: itemId, product_id: productId, name_snapshot: 'Bread', quantity: 2, unit_price: 10000, is_cancelled: false }] },
        error: state.readError ? { message: 'Unavailable' } : null }),
      limit: () => Promise.resolve({ data: [{ id: addedId, name: 'Cookie', sku: 'COOKIE' }], error: null }),
    };
    return chain;
  },
} }));

function setup() {
  const close = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <EditB2bOrderDialog orderId="order-1" orderNumber="BO-001" onClose={close} />
  </QueryClientProvider>);
  return { ...view, close, client };
}
function success(_name: string, args: { p_order_id: string; p_idempotency_key: string }) {
  return Promise.resolve({ data: { order_id: args.p_order_id, idempotency_key: args.p_idempotency_key,
    total: 35000, updated_at: revision, idempotent_replay: false }, error: null });
}

describe('B2B order editing', () => {
  beforeEach(() => {
    installFinancialBrowser(); resetFinancialSession(); state.readError = false;
    rpc.mockReset().mockImplementation(success);
  });
  it('edits quantities, adds products and saves notes with the original revision', async () => {
    const { close } = setup();
    fireEvent.change(await screen.findByLabelText('Quantity 1'), { target: { value: '3' } });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add product' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product 2'), { target: { value: addedId } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledWith('edit_b2b_order_v3', expect.objectContaining({
      p_order_id: 'order-1', p_items: [{ id: itemId, product_id: productId, quantity: 3 }, { product_id: addedId, quantity: 1 }],
      p_notes: 'Updated', p_expected_updated_at: revision,
    }));
    expect(typeof (rpc.mock.calls[0]?.[1] as { p_idempotency_key: unknown }).p_idempotency_key).toBe('string');
  });
  it('removes products and refuses to save an empty order', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove product 1' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps an unconfirmed edit across closing and reopening and replays its exact key and payload', async () => {
    rpc.mockRejectedValueOnce(new Error('Lost response')).mockImplementation(success);
    const first = setup();
    fireEvent.change(await screen.findByLabelText('Quantity 1'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: 'Check pending edit' });
    const original = rpc.mock.calls[0];
    expect(first.close).not.toHaveBeenCalled();
    first.unmount();
    const second = setup();
    expect(await screen.findByLabelText('Quantity 1')).toBeDisabled();
    expect(screen.getByLabelText('Quantity 1')).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: 'Check pending edit' }));
    await waitFor(() => { expect(second.close).toHaveBeenCalledOnce(); });
    expect(rpc.mock.calls[1]).toEqual(original);
  });
  it('shows a definitive server payment refusal and allows correcting the form', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0011', message: 'order_has_payments' } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This order has a payment and can no longer be edited.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
  it('treats an invalid success response as unconfirmed', async () => {
    rpc.mockResolvedValueOnce({ data: { order_id: 'different-order' }, error: null });
    const { close } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: 'Check pending edit' });
    expect(close).not.toHaveBeenCalled();
  });
  it('requires both read and sale permissions', async () => {
    financialTestAuth.setState({ hasPermission: (permission) => permission === 'pos.sale.create' });
    setup();
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('offers retry without a form when the order cannot be read', async () => {
    state.readError = true;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this order');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});
