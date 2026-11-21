// Le prix d'une ligne B2B est lu au serveur par la famille
// `get_pos_product_price` (même résolveur que la création), jamais deviné.
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useB2bLinePrices } from '../hooks/useB2bLinePrices.js';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: (name: string, args: unknown) => Promise.resolve(rpc(name, args) as unknown),
} }));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useB2bLinePrices', () => {
  it('reads each distinct product price from the server resolver for the customer', async () => {
    rpc.mockImplementation((_name: string, args: { p_product_id: string }) =>
      Promise.resolve({ data: args.p_product_id === 'a' ? 9000 : '7500', error: null }));
    const { result } = renderHook(() => useB2bLinePrices('customer', ['b', 'a', 'a', '']), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.fromEntries(result.current.data!)).toEqual({ a: 9000, b: 7500 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('get_pos_product_price_v1', { p_product_id: 'a', p_customer_id: 'customer' });
  });

  it('fails instead of guessing when the server refuses or returns no usable price', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission_denied' } });
    const denied = renderHook(() => useB2bLinePrices('customer', ['a']), { wrapper });
    await waitFor(() => expect(denied.result.current.isError).toBe(true));
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const empty = renderHook(() => useB2bLinePrices('customer', ['b']), { wrapper });
    await waitFor(() => expect(empty.result.current.isError).toBe(true));
  });

  it('stays idle until a customer is chosen', () => {
    const { result } = renderHook(() => useB2bLinePrices('', ['a']), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
