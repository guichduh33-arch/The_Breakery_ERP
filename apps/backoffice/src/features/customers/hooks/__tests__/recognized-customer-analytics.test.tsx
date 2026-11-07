import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc, from, eq } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), eq: vi.fn(),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc, from } }));
import { useCustomerAnalytics } from '../useCustomerAnalytics.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [{
    id: 'invoice', recognized_at: new Date().toISOString(), total: 100000,
    order_type: 'take_out', status: 'pending_payment',
  }], error: null });
  eq.mockResolvedValue({ data: [{
    product_id: 'bread', name_snapshot: 'Bread', quantity: 2, line_total: 100000,
  }], error: null });
  from.mockReturnValue({ select: () => ({ in: () => ({ eq }) }) });
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
    expect(result.current.data?.monthly.reduce((sum, month) => sum + month.total, 0)).toBe(100000);
    expect(result.current.data?.topProducts[0]?.quantity).toBe(2);
  });

  it('surfaces the server permission refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('permission denied: customers.read') });
    const { result } = renderHook(() => useCustomerAnalytics('customer'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(from).not.toHaveBeenCalled();
  });
});
