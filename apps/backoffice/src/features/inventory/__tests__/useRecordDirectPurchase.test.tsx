import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => { const query = { select: () => query, eq: () => query, limit: () => Promise.resolve({ data: [{ id: 'line' }], error: null }) }; return query; },
} }));
import { useRecordDirectPurchase, type DirectPurchaseArgs } from '../hooks/useRecordDirectPurchase.js';

const input: DirectPurchaseArgs = {
  supplierId: 'supplier', productId: 'flour', quantity: 2, unit: 'bag', unitFactorToBase: 25,
  pricePerUnit: 250000, purchaseDate: '2026-09-09', paymentMethod: 'cash', paymentAmount: 500000,
  paymentDate: '2026-09-09', idempotencyKey: '12345678-1234-1234-1234-123456789012',
};
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
describe('achat direct — idempotence des étapes', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['create_purchase_order_v2', 'receive_purchase_order_v4', 'record_po_payment_v2'])(
    'reprend la réponse perdue de %s sans modifier les paramètres ni doubler les écritures', async (lostStep) => {
      const writes = new Map<string, number>();
      const confirmed = new Map<string, unknown>();
      let loseResponse = true;
      mocks.rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
        const key = `${fn}:${String(args.p_idempotency_key)}`;
        if (!confirmed.has(key)) {
          writes.set(fn, (writes.get(fn) ?? 0) + 1);
          confirmed.set(key, fn === 'create_purchase_order_v2' ? { po_id: 'po', po_number: 'PO', total_amount: 500000 }
            : fn === 'receive_purchase_order_v4' ? { grn_id: 'grn', grn_number: 'GRN' } : { payment_id: 'payment' });
        }
        if (loseResponse && fn === lostStep) { loseResponse = false; return Promise.reject(new Error('response lost')); }
        return Promise.resolve({ data: confirmed.get(key), error: null });
      });
      const { result } = renderHook(() => useRecordDirectPurchase(), { wrapper });
      await act(async () => { await expect(result.current.mutateAsync({ ...input })).rejects.toThrow('response lost'); });
      const initialCalls = structuredClone(mocks.rpc.mock.calls) as unknown[][];
      await act(async () => {
        await result.current.mutateAsync({ ...input, quantity: 99, pricePerUnit: 1, paymentAmount: 1, paymentMethod: 'transfer' });
      });
      expect([...writes.values()]).toEqual([1, 1, 1]);
      for (const [fn, args] of initialCalls) {
        const repeats = mocks.rpc.mock.calls.filter((call) => call[0] === fn);
        for (const repeated of repeats) expect(repeated[1]).toEqual(args);
      }
      expect(mocks.rpc).toHaveBeenLastCalledWith('record_po_payment_v2', expect.objectContaining({ p_amount: 500000, p_method: 'cash' }));
      expect(result.current.progress).toMatchObject({ poId: 'po', grnId: 'grn', paymentId: 'payment' });
    },
  );
});
