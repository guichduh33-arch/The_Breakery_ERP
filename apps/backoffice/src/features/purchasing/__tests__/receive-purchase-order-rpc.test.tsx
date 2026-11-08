import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReceivePurchaseOrder } from '../hooks/useReceivePurchaseOrder.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));
let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const input = { poId: 'po', items: [{ poItemId: 'line', receivedQuantity: 0.125 }], idempotencyKey: 'stable-key' };

describe('purchase receipt RPC contract', () => {
  beforeEach(() => {
    rpc.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(() => client.clear());

  it('preserves receipt quantities and the key on an explicit retry after a lost response', async () => {
    const receipt = { grn_id: 'grn', grn_number: 'GRN', idempotent_replay: true };
    rpc.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ data: receipt, error: null });
    const { result } = renderHook(() => useReceivePurchaseOrder(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('response lost'); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await expect(result.current.mutateAsync(input)).resolves.toBe(receipt); });
    expect(rpc).toHaveBeenCalledTimes(2);
    const expected = ['receive_purchase_order_v6', { p_po_id: 'po',
      p_received_items: [{ po_item_id: 'line', received_quantity: 0.125 }], p_idempotency_key: 'stable-key' }];
    expect(rpc.mock.calls[0]).toEqual(expected);
    expect(rpc.mock.calls[1]).toEqual(expected);
  });

  it('preserves a server stock guard rejection without retrying or fabricating a receipt', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'received_exceeds_ordered' } });
    const { result } = renderHook(() => useReceivePurchaseOrder(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ name: 'ReceivePOError', code: 'received_exceeds_ordered' });
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
