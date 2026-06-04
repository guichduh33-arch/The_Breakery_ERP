/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  },
}));

import { useHoldOrder } from '../hooks/useHoldOrder';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { vi.clearAllMocks(); rpcMock.mockResolvedValue({ data: 'order-1', error: null }); });

describe('useHoldOrder', () => {
  it('calls hold_order_v1 with a client_uuid + cart payload', async () => {
    const { result } = renderHook(() => useHoldOrder(), { wrapper: wrap() });
    await result.current.mutateAsync({ cartPayload: { order_type: 'dine_in', customerId: null, items: [] }, tableNumber: '5', notes: null });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('hold_order_v1', expect.objectContaining({ p_cart_payload: expect.any(Object), p_table_number: '5' })));
    const arg = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(typeof arg.p_client_uuid).toBe('string');
  });
});
