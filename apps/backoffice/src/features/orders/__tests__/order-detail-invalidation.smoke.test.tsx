// apps/backoffice/src/features/orders/__tests__/order-detail-invalidation.smoke.test.tsx
//
// C1 (BO-02) — after a void or edit mutation, invalidateQueries must target
// ['order-detail', orderId] — the key that useOrderDetail actually uses.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ── supabase stub ──────────────────────────────────────────────────────────
const authGetSessionMock = vi.fn();
const fetchMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: (...a: unknown[]) => authGetSessionMock(...a) },
    rpc:  (...a: unknown[]) => rpcMock(...a),
    // for useAddOrderItem / useUpdateOrderItemQty / useRemoveOrderItem
  },
}));

// We need global fetch for useVoidOrder (calls fetch directly)
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

// ── imports after mocks ────────────────────────────────────────────────────
import { useVoidOrder }       from '../hooks/useVoidOrder.js';
import { useEditOrderItems }  from '../hooks/useEditOrderItems.js';

// ── helpers ────────────────────────────────────────────────────────────────
function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// ── C1-T1: useVoidOrder invalidates ['order-detail', orderId] ──────────────
describe('C1-T1: useVoidOrder invalidateQueries targets the correct key', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(qc, 'invalidateQueries');

    // mock auth session for the getAccessToken helper
    authGetSessionMock.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    });

    // mock void-order EF response
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ order_id: 'ord-1', refund_id: 'ref-1', total_refunded: 0 }),
    });
  });

  it('invalidates ["order-detail", orderId] on success', async () => {
    const { result } = renderHook(() => useVoidOrder(), {
      wrapper: makeWrapper(qc),
    });

    result.current.mutate({ orderId: 'ord-1', reason: 'test reason', managerPin: '123456' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The invalidation should include ['order-detail', 'ord-1']
    expect(qc.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['order-detail', 'ord-1'] }),
    );
  });
});

// ── C1-T2: useEditOrderItems invalidates ['order-detail', orderId] ─────────
describe('C1-T2: useEditOrderItems invalidateQueries targets the correct key', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(qc, 'invalidateQueries');

    // mock all 3 sub-mutation RPCs (remove / update / add order items)
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('invalidates ["order-detail", orderId] on success (empty diff)', async () => {
    const { result } = renderHook(() => useEditOrderItems(), {
      wrapper: makeWrapper(qc),
    });

    result.current.mutate({ orderId: 'ord-2', diff: { removes: [], updates: [], adds: [] } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['order-detail', 'ord-2'] }),
    );
  });
});
