import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseShift } from '../hooks/useCloseShift';

const { rpc, invoke, clear } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, functions: { invoke } } }));
vi.mock('@/stores/shiftStore', () => ({ useShiftStore: (select: (state: { clear: () => void }) => unknown) => select({ clear }) }));

describe('clôture et refus PIN retourné', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('conserve le shift et ne demande aucun PDF pour un refus HTTP 200', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'invalid_pin' }, error: null });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useCloseShift(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ session_id: 'shift', counted_cash: 0, manager_pin: '999999' }))
        .rejects.toThrow('Invalid manager PIN');
    });
    expect(clear).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });
});
