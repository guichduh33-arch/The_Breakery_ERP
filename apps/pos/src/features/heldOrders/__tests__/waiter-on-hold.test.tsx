import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
import { useReopenHeldOrder } from '../hooks/useReopenHeldOrder';

const incoming = { id: 'waiter-order', created_via: 'tablet', status: 'pending_payment' };
const snapshot = {
  order_id: incoming.id, created_via: 'tablet', order_type: 'dine_in',
  customerId: null, tableNumber: '7', notes: null,
  items: [{ id: 'line-1', product_id: 'p1', name: 'Latte', unit_price: 30000,
    quantity: 1, modifiers: [], is_locked: true, kitchen_status: 'pending' }],
};
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  useShiftStore.setState({ current: { id: 'shift-1', opened_at: '', opening_cash: 0 } });
  useCartStore.setState({ cart: { items: [], order_type: 'take_out' }, pickedUpOrderId: null,
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false });
  rpc.mockImplementation((name: string) => Promise.resolve({
    data: name === 'get_pos_order_snapshot_v2' ? snapshot : null, error: null,
  }));
});

describe('commandes waiter dans On hold', () => {
  it('attribue la commande a la caisse avant de charger les lignes verrouillees', async () => {
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await result.current.mutateAsync(incoming);
    expect(rpc).toHaveBeenNthCalledWith(1, 'pickup_tablet_order', { p_order_id: incoming.id, p_session_id: 'shift-1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_pos_order_snapshot_v2', { p_order_id: incoming.id });
    expect(rpc).toHaveBeenCalledWith('pickup_tablet_order', { p_order_id: incoming.id, p_session_id: 'shift-1' });
    expect(useCartStore.getState().pickedUpOrderId).toBe(incoming.id);
    expect(useCartStore.getState().lockedItemIds).toEqual(['line-1']);
    expect(useCartStore.getState().printedItemIds).toEqual(['line-1']);
  });

  it('refuse sans session ouverte avant toute ecriture', async () => {
    useShiftStore.setState({ current: null });
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await expect(result.current.mutateAsync(incoming)).rejects.toThrow('Open a shift');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('conserve le panier si un autre caissier a deja repris la commande', async () => {
    const before = useCartStore.getState().cart;
    rpc.mockResolvedValue({ data: null, error: { code: 'P0012' } });
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await expect(result.current.mutateAsync(incoming)).rejects.toMatchObject({ code: 'P0012' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(useCartStore.getState().cart).toBe(before);
  });

  it('ne remplace pas une commande deja active', async () => {
    useCartStore.setState({ pickedUpOrderId: 'active' });
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await expect(result.current.mutateAsync(incoming)).rejects.toThrow('Finish the current order');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('preserve les changements locaux pendant la lecture du snapshot', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((name: string) => name === 'pickup_tablet_order'
      ? Promise.resolve({ data: null, error: null })
      : new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    const pending = result.current.mutateAsync(incoming);
    const rejected = expect(pending).rejects.toThrow('The current order changed');
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    const changed = { items: [], order_type: 'delivery' as const };
    act(() => useCartStore.setState({ cart: changed }));
    finish({ data: snapshot, error: null });
    await rejected;
    expect(useCartStore.getState().cart).toBe(changed);
  });
});
