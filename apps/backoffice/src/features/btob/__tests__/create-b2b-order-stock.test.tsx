import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateB2bOrderModal } from '../components/CreateB2bOrderModal.js';
import { B2B_STOCK_CHECK_TIMEOUT_MS } from '../hooks/useB2bStockAvailability.js';

const { rpc, select, product, toastWarning, abortSignals } = vi.hoisted(() => ({
  rpc: vi.fn(), select: vi.fn(), toastWarning: vi.fn(), abortSignals: [] as AbortSignal[],
  product: { id: 'mini', sku: 'MINI', name: 'Mini Chocolatine', price: 5000, current_stock: 0, track_inventory: false, deduct_stock: true, unit: 'pcs' },
}));
vi.mock('sonner', () => ({ toast: { warning: toastWarning } }));
vi.mock('../hooks/useB2bCustomers.js', () => ({ useB2bCustomers: () => ({ data: [
  { id: 'customer', name: 'Hotel', b2b_company_name: 'Hotel', b2b_current_balance: 0, b2b_credit_limit: null },
], isLoading: false }) }));
vi.mock('@/features/customers/hooks/useCustomerNegotiatedPrices.js', () => ({ useCustomerNegotiatedPrices: () => ({ data: [] }) }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: (name: string, args: unknown) => {
    const result = Promise.resolve(rpc(name, args) as unknown);
    return Object.assign(result, { abortSignal: (signal: AbortSignal) => { abortSignals.push(signal); return result; } });
  },
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
  const onClose = vi.fn(() => view.unmount());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={qc}><CreateB2bOrderModal open onClose={onClose} /></QueryClientProvider>);
  await screen.findByRole('option', { name: 'Mini Chocolatine (MINI)' });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'customer' } });
  fireEvent.change(screen.getByLabelText('Product for line 1'), { target: { value: 'mini' } });
  fireEvent.change(screen.getByLabelText('Quantity for line 1'), { target: { value: '2' } });
  return onClose;
}

describe('B2B stock validation', () => {
  beforeEach(() => {
    product.track_inventory = false;
    rpc.mockReset(); select.mockClear(); toastWarning.mockReset(); abortSignals.length = 0;
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'check_b2b_stock_availability_v1' ? { available: true } : { order_id: 'order' }, error: null,
    }));
  });
  afterEach(() => { vi.useRealTimers(); });

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
    let finish!: (value: unknown) => void;
    const pendingCheck = new Promise((resolve) => { finish = resolve; });
    rpc.mockImplementation((name: string) => name === 'check_b2b_stock_availability_v1'
      ? pendingCheck
      : Promise.resolve({ data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    expect(await screen.findByText('Checking stock availability…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create B2B order' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    await act(async () => { finish({ data: { available: true }, error: null }); await pendingCheck; });
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

  it('shows the late shortage notification after creation closes the dialog, with one submitted order', async () => {
    let finish!: (value: unknown) => void;
    const pendingCheck = new Promise((resolve) => { finish = resolve; });
    rpc.mockImplementation((name: string) => name === 'check_b2b_stock_availability_v1'
      ? pendingCheck : Promise.resolve({ data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    const button = screen.getByRole('button', { name: 'Create B2B order' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toastWarning).not.toHaveBeenCalled();
    await act(async () => { finish({ data: { available: false }, error: null }); await pendingCheck; });
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('Stock is currently insufficient'), { duration: 20000, closeButton: true }));
    expect(rpc.mock.calls.filter(([name]) => name === 'create_b2b_order_v11')).toHaveLength(1);
  });

  it('keeps the fresh submission check tied to its captured basket when the form changes', async () => {
    let create!: (value: unknown) => void;
    let check!: (value: unknown) => void;
    const pendingCreate = new Promise((resolve) => { create = resolve; });
    const pendingCheck = new Promise((resolve) => { check = resolve; });
    let checkCount = 0;
    rpc.mockImplementation((name: string) => {
      if (name !== 'check_b2b_stock_availability_v1') return pendingCreate;
      checkCount++;
      return checkCount === 2 ? pendingCheck : Promise.resolve({ data: { available: true }, error: null });
    });
    const close = await fillOrder();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('check_b2b_stock_availability_v1', { p_items: [{ product_id: 'mini', quantity: 2 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(checkCount).toBe(2));
    fireEvent.change(screen.getByLabelText('Quantity for line 1'), { target: { value: '9' } });
    await waitFor(() => expect(checkCount).toBe(3));
    await act(async () => { create({ data: { order_id: 'order' }, error: null }); await pendingCreate; });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    await act(async () => { check({ data: { available: false }, error: null }); await pendingCheck; });
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('Stock is currently insufficient'), expect.anything()));
    expect(rpc.mock.calls.filter(([name]) => name === 'check_b2b_stock_availability_v1').map(([, args]) => args as unknown)).toEqual([
      { p_items: [{ product_id: 'mini', quantity: 2 }] },
      { p_items: [{ product_id: 'mini', quantity: 2 }] },
      { p_items: [{ product_id: 'mini', quantity: 9 }] },
    ]);
    expect(rpc).toHaveBeenCalledWith('create_b2b_order_v11', expect.objectContaining({
      p_items: [{ product_id: 'mini', quantity: 2, unit_price: 5000 }],
    }));
  });

  it('does not notify a shortage when the fresh submission check succeeds', async () => {
    const close = await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(rpc.mock.calls.filter(([name]) => name === 'check_b2b_stock_availability_v1')).toHaveLength(2);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('reports an unverified check after creation when the request fails', async () => {
    rpc.mockImplementation((name: string) => name === 'check_b2b_stock_availability_v1'
      ? Promise.reject(new Error('private backend error'))
      : Promise.resolve({ data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('Stock availability was not verified'), expect.anything()));
    expect(toastWarning.mock.calls[0]?.[0]).not.toContain('private backend error');
  });

  it('bounds the fresh check and aborts its request without delaying creation', async () => {
    rpc.mockImplementation((name: string) => name === 'check_b2b_stock_availability_v1'
      ? new Promise(() => undefined)
      : Promise.resolve({ data: { order_id: 'order' }, error: null }));
    const close = await fillOrder();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create B2B order' })); await Promise.resolve(); });
    expect(close).toHaveBeenCalledOnce();
    expect(toastWarning).not.toHaveBeenCalled();
    const submittedSignal = abortSignals.at(-1)!;
    expect(submittedSignal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(B2B_STOCK_CHECK_TIMEOUT_MS); });
    expect(submittedSignal.aborted).toBe(true);
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('Stock availability was not verified'), expect.anything());
  });
});
