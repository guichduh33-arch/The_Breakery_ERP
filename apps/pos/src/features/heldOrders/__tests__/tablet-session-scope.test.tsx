import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useShiftStore } from '@/stores/shiftStore';
import { useCartStore } from '@/stores/cartStore';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), or: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ or: mocks.or }) }),
} }));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
import { useHeldOrdersQuery } from '../hooks/useHeldOrdersQuery';
import { useReopenHeldOrder } from '../hooks/useReopenHeldOrder';
import { useHoldFiredOrder } from '@/features/cart/hooks/useHoldFiredOrder';
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.or.mockReturnValue({ order: () => ({ limit: mocks.limit }) });
  mocks.limit.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  useShiftStore.setState({ current: { id: 'session-current', opened_at: '', opening_cash: 0 } });
});
describe('tablette reprise : portee session', () => {
  it('transmet la session au hold', async () => {
    const { result } = renderHook(() => useHoldFiredOrder(), { wrapper });
    await result.current.mutateAsync('tablet-id');
    expect(mocks.rpc).toHaveBeenCalledWith('hold_fired_order_v3', { p_order_id: 'tablet-id', p_session_id: 'session-current' });
  });
  it('transmet la session au reopen sans remplacer le panier si refuse', async () => {
    const cart = useCartStore.getState().cart;
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0002' } });
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await expect(result.current.mutateAsync('tablet-id')).rejects.toMatchObject({ code: 'P0002' });
    expect(mocks.rpc).toHaveBeenCalledWith('reopen_held_order_v5', { p_order_id: 'tablet-id', p_session_id: 'session-current' });
    expect(useCartStore.getState().cart).toBe(cart);
  });
  it('liste seulement les tablettes reprises dans la session', async () => {
    renderHook(() => useHeldOrdersQuery(), { wrapper });
    await waitFor(() => expect(mocks.or).toHaveBeenCalledWith('and(status.eq.pending_payment,created_via.eq.pos),and(status.eq.draft,created_via.eq.tablet,session_id.eq.session-current)'));
  });
  it('ne liste aucune tablette sans session', async () => {
    useShiftStore.setState({ current: null });
    renderHook(() => useHeldOrdersQuery(), { wrapper });
    await waitFor(() => expect(mocks.or).toHaveBeenCalledWith('and(status.eq.pending_payment,created_via.eq.pos)'));
  });
});
