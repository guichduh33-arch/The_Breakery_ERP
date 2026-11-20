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
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'check_b2b_stock_availability_v1' ? { available: true } : { order_id: 'order' }, error: null,
    }));
  });

  it('submits an untracked recipe product with zero own stock', async () => {
    const close = await fillOrder();
    expect(select).toHaveBeenCalledWith(expect.stringContaining('track_inventory'));
    expect(screen.getByLabelText('Quantity for line 1')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/Only .* in stock/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
    expect(rpc).toHaveBeenCalledWith('create_b2b_order_v11', expect.objectContaining({ p_items: [{ product_id: 'mini', quantity: 2, unit_price: 5000 }] }));
  });

  it('submits a tracked product without reading or revealing its hidden stock', async () => {
    product.track_inventory = true;
    const close = await fillOrder();
    expect(select.mock.calls[0]?.[0]).not.toContain('current_stock');
    expect(screen.getByLabelText('Quantity for line 1')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/Only .* in stock/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('warns about insufficient general stock without blocking creation', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'check_b2b_stock_availability_v1' ? { available: false } : { order_id: 'order' }, error: null,
    }));
    const close = await fillOrder();
    expect(await screen.findByText(/There is not enough stock for this order right now/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('check_b2b_stock_availability_v1', { p_items: [{ product_id: 'mini', quantity: 2 }] });
    expect(screen.getByRole('button', { name: 'Create B2B order' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('does not show an insufficient-stock warning when stock is available', async () => {
    await fillOrder();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('check_b2b_stock_availability_v1', expect.anything()));
    await waitFor(() => expect(screen.queryByText('Checking stock availability…')).not.toBeInTheDocument());
    expect(screen.queryByText(/There is not enough stock for this order right now/)).not.toBeInTheDocument();
  });

  it('allows creation when the availability query fails without exposing its error', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve(name === 'check_b2b_stock_availability_v1'
      ? { data: null, error: { message: 'private quantity 123' } }
      : { data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    expect(await screen.findByText(/Stock availability could not be checked/)).toBeInTheDocument();
    expect(screen.queryByText(/private quantity/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('rechecks the changed basket and removes the previous warning', async () => {
    rpc.mockImplementation((_name: string, args: { p_items: { quantity: number }[] }) => Promise.resolve({
      data: { available: args.p_items[0]?.quantity !== 2 }, error: null,
    }));
    await fillOrder();
    await screen.findByText(/There is not enough stock for this order right now/);
    fireEvent.change(screen.getByLabelText('Quantity for line 1'), { target: { value: '3' } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('check_b2b_stock_availability_v1', { p_items: [{ product_id: 'mini', quantity: 3 }] }));
    await waitFor(() => expect(screen.queryByText('Checking stock availability…')).not.toBeInTheDocument());
    expect(screen.queryByText(/There is not enough stock for this order right now/)).not.toBeInTheDocument();
  });

  it('allows creation while the indicative stock check is still loading', async () => {
    rpc.mockImplementation((name: string) => name === 'check_b2b_stock_availability_v1'
      ? new Promise(() => undefined)
      : Promise.resolve({ data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    expect(await screen.findByText('Checking stock availability…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create B2B order' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('checks repeated product fractions as exactly 0.3 and keeps a shortage warning non-blocking', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'check_b2b_stock_availability_v1' ? { available: false } : { order_id: 'order' }, error: null,
    }));
    const close = await fillOrder();
    fireEvent.change(screen.getByLabelText('Quantity for line 1'), { target: { value: '0.1' } });
    fireEvent.click(screen.getByRole('button', { name: /add line/i }));
    fireEvent.change(screen.getByLabelText('Product for line 2'), { target: { value: 'mini' } });
    fireEvent.change(screen.getByLabelText('Quantity for line 2'), { target: { value: '0.2' } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('check_b2b_stock_availability_v1', {
      p_items: [{ product_id: 'mini', quantity: 0.3 }],
    }));
    expect(await screen.findByText(/There is not enough stock for this order right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create B2B order' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith('create_b2b_order_v11', expect.objectContaining({ p_items: [
      { product_id: 'mini', quantity: 0.1, unit_price: 5000 },
      { product_id: 'mini', quantity: 0.2, unit_price: 5000 },
    ] }));
  });
});
