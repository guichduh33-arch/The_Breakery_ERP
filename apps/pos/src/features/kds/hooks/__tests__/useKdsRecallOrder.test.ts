// apps/pos/src/features/kds/hooks/__tests__/useKdsRecallOrder.test.ts
//
// Session 59 review (finding 1) — a recall moves an order's items
// served→preparing, which should drop it from the "Recently served" strip
// (['kds-served', station]) immediately, not up to 30s later (that query's
// refetchInterval). ['kds'] alone does not prefix-match ['kds-served', …].

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { useKdsRecallOrder } from '../useKdsRecallOrder';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useKdsRecallOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates both ["kds"] and ["kds-served"] on success', async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useKdsRecallOrder(), { wrapper: wrapper(qc) });
    result.current.mutate({ orderId: 'order-1', reason: 'test' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds-served'] });
  });
});
