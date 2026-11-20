import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { B2bPickupDialog } from '../components/B2bPickupDialog.js';
import type { B2bInvoiceRow } from '../hooks/useB2bInvoices.js';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

const order: B2bInvoiceRow = {
  invoice_id: 'order-1', order_number: 'BO-1', invoice_number: null,
  customer_id: 'customer-1', b2b_company_name: 'Bakery', customer_name: null,
  invoice_total: 100, invoice_date: '2026-09-10', paid_at: null,
  order_status: 'b2b_pending', age_days: 0, is_unpaid: true,
  amount_paid: 0, outstanding: 100, pickup_date: null, b2b_delivered_at: null,
};

function setup(delivered: boolean) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidation = vi.spyOn(qc, 'invalidateQueries');
  const close = vi.fn();
  render(<QueryClientProvider client={qc}><B2bPickupDialog order={order} delivered={delivered} onClose={close} /></QueryClientProvider>);
  return { close, invalidation };
}

describe('B2B pickup actions', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((_name: string, args: { p_pickup_date?: string; p_mark_delivered: boolean }) => Promise.resolve({
      data: { order_id: 'order-1', pickup_date: args.p_pickup_date ?? null,
        b2b_delivered_at: args.p_mark_delivered ? '2026-11-20T10:00:00Z' : null }, error: null,
    }));
  });

  it('saves a planned date and refreshes the order list', async () => {
    const { close, invalidation } = setup(false);
    expect(screen.getByRole('button', { name: 'Save pickup date' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pickup date'), { target: { value: '2026-09-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pickup date' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledWith('update_b2b_pickup_v4', { p_order_id: 'order-1', p_pickup_date: '2026-09-14', p_mark_delivered: false });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['b2b-invoices'] });
    expect(invalidation).not.toHaveBeenCalledWith({ queryKey: ['stock-levels'] });
  });

  it('confirms collection without sending a payment or replacing the planned date', async () => {
    const { close, invalidation } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('update_b2b_pickup_v4', { p_order_id: 'order-1', p_mark_delivered: true });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['stock-levels'] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['stock-movements-feed'] });
    expect(invalidation).not.toHaveBeenCalledWith({ queryKey: ['display-stock'] });
  });

  it('keeps the dialog open and allows retry after an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } });
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry to check the same order');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
  });

  it('blocks pickup on insufficient stock without exposing confidential quantities', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'insufficient_stock have 123 need 456' } });
    const { close, invalidation } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is not enough general stock');
    expect(screen.getByRole('alert')).not.toHaveTextContent('123');
    expect(close).not.toHaveBeenCalled();
    expect(invalidation).not.toHaveBeenCalled();
  });

  it.each([
    ['period_undefined', 'accounting period is closed or unavailable'],
    ['financial_import_requires_dedicated_workflow', 'dedicated correction workflow'],
    ['permission_denied', 'do not have permission'],
  ])('explains the %s refusal and keeps the dialog open', async (message, copy) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message } });
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(close).not.toHaveBeenCalled();
  });

  it('retries the exact confirmation after its committed response was lost', async () => {
    rpc.mockRejectedValueOnce(new Error('Lost response'));
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await screen.findByRole('alert');
    const first = rpc.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[1]).toEqual(first);
  });

  it('rejects a malformed success response and keeps confirmation available', async () => {
    rpc.mockResolvedValueOnce({ data: { order_id: 'different-order' }, error: null });
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm the pickup result');
    expect(close).not.toHaveBeenCalled();
  });

  it('submits once when the confirmation is clicked twice before completion', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { close } = setup(true);
    const button = screen.getByRole('button', { name: 'Mark delivered' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    finish({ data: { order_id: 'order-1', pickup_date: null, b2b_delivered_at: '2026-11-20T10:00:00Z' }, error: null });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
