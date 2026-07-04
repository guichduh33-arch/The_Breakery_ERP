// apps/pos/src/features/kds/hooks/__tests__/useMarkItemServed.test.ts
//
// Session 59 review (finding 1) — a served item leaves the main useKdsOrders
// query (['kds', station]) and becomes eligible for the recall strip
// (['kds-served', station]), a DIFFERENT query key that ['kds'] does not
// prefix-match. Without an explicit second invalidation, "Recently served"
// would lag up to 30s (that query's refetchInterval) behind Mark Served.

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

import { useMarkItemServed } from '../useMarkItemServed';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMarkItemServed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates both ["kds"] and ["kds-served"] on success', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useMarkItemServed(), { wrapper: wrapper(qc) });
    result.current.mutate('item-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds-served'] });
  });
});
