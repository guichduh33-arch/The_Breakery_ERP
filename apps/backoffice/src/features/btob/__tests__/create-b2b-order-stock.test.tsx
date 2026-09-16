import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateB2bOrderModal } from '../components/CreateB2bOrderModal.js';

const { rpc, select, product } = vi.hoisted(() => ({
  rpc: vi.fn(), select: vi.fn(),
  product: { id: 'mini', sku: 'MINI', name: 'Mini Chocolatine', price: 5000, current_stock: 0, track_inventory: false, deduct_stock: true, unit: 'pcs' },
}));
vi.mock('../hooks/useB2bCustomers.js', () => ({ useB2bCustomers: () => ({ data: [
  { id: 'customer', name: 'Hotel', b2b_company_name: 'Hotel', b2b_current_balance: 0, b2b_credit_limit: null },
], isLoading: false }) }));
vi.mock('@/features/customers/hooks/useCustomerNegotiatedPrices.js', () => ({ useCustomerNegotiatedPrices: () => ({ data: [] }) }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc,
  from: () => {
    const chain = {
      select: (columns: string) => { select(columns); return chain; },
      is: () => chain, eq: () => chain, order: () => chain,
      limit: () => Promise.resolve({ data: [{ ...product }], error: null }),
    };
    return chain;
  },
} }));

async function fillOrder() {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><CreateB2bOrderModal open onClose={onClose} /></QueryClientProvider>);
  await screen.findByRole('option', { name: 'Mini Chocolatine (MINI)' });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'customer' } });
  fireEvent.change(screen.getByLabelText('Product for line 1'), { target: { value: 'mini' } });
  fireEvent.change(screen.getByLabelText('Quantity for line 1'), { target: { value: '2' } });
  return onClose;
}

describe('B2B stock validation', () => {
  beforeEach(() => {
    product.track_inventory = false;
    rpc.mockReset(); select.mockClear();
    rpc.mockResolvedValue({ data: { order_id: 'order' }, error: null });
  });

  it('submits an untracked recipe product with zero own stock', async () => {
    const close = await fillOrder();
    expect(select).toHaveBeenCalledWith(expect.stringContaining('track_inventory'));
    expect(screen.getByLabelText('Quantity for line 1')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/Only .* in stock/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledWith('create_b2b_order_v7', expect.objectContaining({ p_items: [{ product_id: 'mini', quantity: 2, unit_price: 5000 }] }));
  });

  it('still blocks a tracked product with insufficient own stock', async () => {
    product.track_inventory = true;
    await fillOrder();
    expect(screen.getByLabelText('Quantity for line 1')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Create B2B order' })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows server rejection when recipe components are insufficient', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'insufficient_stock for recipe material' } });
    const close = await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    expect(await screen.findByText(/Insufficient stock for one of the products/)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
