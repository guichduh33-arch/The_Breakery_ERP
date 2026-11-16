import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseShift } from '../hooks/useCloseShift';

const { rpc, invoke, clear } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, functions: { invoke } } }));
vi.mock('@/stores/shiftStore', () => ({ useShiftStore: (select: (state: { clear: () => void }) => unknown) => select({ clear }) }));

// close_shift_v14 refuse la clôture tant qu'une commande ouverte reste impayée.
describe('clôture refusée par une commande impayée', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setup() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return { client, ...renderHook(() => useCloseShift(), { wrapper: Wrapper }) };
  }

  it('nomme les commandes à traiter et garde le shift ouvert', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'unpaid_orders_open', details: 'P16112026019, T115112026117', code: 'P0001' },
    });
    const { client, result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ session_id: 'shift', counted_cash: 0 }))
        .rejects.toThrow('Unpaid orders are still open: P16112026019, T115112026117. Pay them, put them on a tab, hold or void them before closing the shift.');
    });
    expect(rpc).toHaveBeenCalledWith('close_shift_v14', expect.objectContaining({ p_session_id: 'shift' }));
    expect(clear).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    client.clear();
  });

  it('reste lisible sans liste de commandes', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unpaid_orders_open', details: null, code: 'P0001' } });
    const { client, result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ session_id: 'shift', counted_cash: 0 }))
        .rejects.toThrow('Unpaid orders are still open. Pay them, put them on a tab, hold or void them before closing the shift.');
    });
    client.clear();
  });
});
