import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc, from, inSpy, range } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), inSpy: vi.fn(), range: vi.fn(),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc, from } }));
import { useCustomerAnalytics } from '../useCustomerAnalytics.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const line = (i: number) => ({ product_id: `p-${i % 3}`, name_snapshot: `Item ${i % 3}`, quantity: 1, line_total: 1000 });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [{
    id: 'invoice', recognized_at: new Date().toISOString(), total: 100000,
    order_type: 'take_out', status: 'pending_payment',
  }], error: null });
  range.mockResolvedValue({ data: [{
    product_id: 'bread', name_snapshot: 'Bread', quantity: 2, line_total: 100000,
  }], error: null });
  inSpy.mockImplementation(() => ({ eq: () => ({ order: () => ({ range }) }) }));
  from.mockReturnValue({ select: () => ({ in: inSpy }) });
});

describe('recognized customer analytics', () => {
  it('counts an unpaid recognized sale and reads its items without querying raw orders', async () => {
    const { result } = renderHook(() => useCustomerAnalytics('customer'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('get_customer_recognized_orders_v2', { p_customer_id: 'customer' });
    expect(from).toHaveBeenCalledWith('order_items');
    expect(from).not.toHaveBeenCalledWith('orders');
    expect(result.current.data?.ordersConsidered).toBe(1);
    expect(result.current.data?.totalSpend).toBe(100000);
    expect(result.current.data?.trend.reduce((sum, point) => sum + point.total, 0)).toBe(100000);
    expect(result.current.data?.topProducts[0]?.quantity).toBe(2);
  });

  // Un `in.(…)` de plusieurs centaines d'UUID dépassait la longueur d'URL.
  it('reads the order lines in chunks of 100 ids', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({
      id: `o-${i}`, recognized_at: new Date().toISOString(), total: 1000,
      order_type: 'dine_in', status: 'completed',
    }));
    rpc.mockResolvedValue({ data: many, error: null });
    const { result } = renderHook(() => useCustomerAnalytics('customer'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inSpy).toHaveBeenCalledTimes(3);
    const sizes = inSpy.mock.calls.map((c: unknown[]) => (c[1] as string[]).length);
    expect(sizes).toEqual([100, 100, 30]);
  });

  // PostgREST plafonne une réponse : un paquet de plus de 1000 lignes se lit
  // en plusieurs pages, sinon les quantités sont faussées en silence.
  it('pages through more than 1000 lines in one chunk', async () => {
    range
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => line(i)), error: null })
      .mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, i) => line(i)), error: null });
    const { result } = renderHook(() => useCustomerAnalytics('customer'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    const qty = result.current.data?.topProducts.reduce((s, p) => s + p.quantity, 0);
    expect(qty).toBe(1200);
  });

  it('surfaces the server permission refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('permission denied: customers.read') });
    const { result } = renderHook(() => useCustomerAnalytics('customer'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(from).not.toHaveBeenCalled();
  });
});
