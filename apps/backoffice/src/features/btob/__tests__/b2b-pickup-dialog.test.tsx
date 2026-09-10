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
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { order_id: 'order-1' }, error: null }); });

  it('saves a planned date and refreshes the order list', async () => {
    const { close, invalidation } = setup(false);
    expect(screen.getByRole('button', { name: 'Save pickup date' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pickup date'), { target: { value: '2026-09-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pickup date' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledWith('update_b2b_pickup_v1', { p_order_id: 'order-1', p_pickup_date: '2026-09-14', p_mark_delivered: false });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['b2b-invoices'] });
  });

  it('confirms collection without sending a payment or replacing the planned date', async () => {
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('update_b2b_pickup_v1', { p_order_id: 'order-1', p_mark_delivered: true });
  });

  it('keeps the dialog open and allows retry after an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } });
    const { close } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection lost');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
  });
});
