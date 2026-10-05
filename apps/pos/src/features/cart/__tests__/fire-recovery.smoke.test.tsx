import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useFireToStations } from '../hooks/useFireToStations';
import { hasPendingCounterFire } from '../hooks/counterFireRecovery';
import type { CounterFireArgs } from '../hooks/counterFireRecovery';
const { rpc, print, offline, auth } = vi.hoisted(() => ({
  rpc: vi.fn(), print: vi.fn(), offline: { value: false },
  auth: { user: { id: 'cashier', full_name: 'Cashier' }, sessionToken: null as string | null },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, supabaseUrl: 'http://sb.test' }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth }) }));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
vi.mock('@/features/settings/hooks/useKotCopies', () => ({ getKotCopies: () => Promise.resolve({ barista: 1 }) }));
vi.mock('@/services/print/printJobs', () => ({ runPrintJob: print }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map([['barista', {}]]) }) }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ useStationMap: () => ({ data: { product: ['barista'] } }), getStationMap: () => Promise.resolve({ product: ['barista'] }) }));
vi.mock('@/features/lan/offlineMode', () => ({ isOfflineMode: () => offline.value }));
vi.mock('@/features/lan/offlineOutbox', () => ({ enqueueIntent: vi.fn(() => { throw new Error('must not enqueue'); }), nextIntentSeq: vi.fn() }));
const line = { id: 'line', product_id: 'product', name: 'Coffee', quantity: 1, unit_price: 20000, modifiers: [] };
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
const confirmed = () => ({ data: { order_id: 'order', order_number: 'P-42', order_type: 'take_out', customerId: null,
  tableNumber: null, notes: null, idempotent_replay: true,
  items: [{ ...line, id: 'server-line', client_line_id: 'line', is_locked: true, kitchen_status: 'pending' }] }, error: null });
beforeEach(() => {
  sessionStorage.clear(); rpc.mockReset(); print.mockReset(); print.mockResolvedValue({ success: true });
  offline.value = false; auth.user.id = 'cashier'; auth.sessionToken = 'tok';
  useShiftStore.setState({ current: { id: 'shift', status: 'open', opening_cash: 0 } as never });
  useCartStore.setState({ cart: { items: [structuredClone(line)], order_type: 'take_out' },
    pickedUpOrderId: null, lockedItemIds: [], printedItemIds: [], offlineOrder: null });
});
describe('envoi caisse avec ACK perdu', () => {
  it('reprend après remount exactement la requête originale et ne scelle pas un ajout ultérieur', async () => {
    rpc.mockRejectedValueOnce(new Error('network error'));
    const first = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await expect(first.result.current.mutation.mutateAsync(undefined)).rejects.toThrow('network error'); });
    const original = structuredClone(rpc.mock.calls[0]![1] as CounterFireArgs);
    expect(hasPendingCounterFire()).toBe(true);
    first.unmount();
    // Même un ancien terminal ayant édité le panier entre les deux appels reste sûr.
    useCartStore.setState({ cart: { items: [{ ...line, quantity: 3 }, { ...line, id: 'extra', name: 'Extra' }], order_type: 'take_out' } });
    rpc.mockResolvedValueOnce(confirmed());
    const retry = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await retry.result.current.mutation.mutateAsync(undefined); });
    expect(rpc.mock.calls[1]![1]).toEqual(original);
    expect(useCartStore.getState().lockedItemIds).toEqual(['line']);
    expect(useCartStore.getState().printedItemIds).toEqual(['line']);
    expect(useCartStore.getState().cart.items.find((item) => item.id === 'line')?.quantity).toBe(1);
    expect((print.mock.calls[0]![0] as { items: unknown }).items).toEqual([{ name: 'Coffee', quantity: 1, modifiers: [] }]);
    expect(hasPendingCounterFire()).toBe(false);
  });
  it('ne convertit jamais un envoi cloud incertain en envoi offline', async () => {
    rpc.mockRejectedValueOnce(new Error('network error'));
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await expect(result.current.mutation.mutateAsync(undefined)).rejects.toThrow(); });
    offline.value = true;
    await act(async () => { await expect(result.current.mutation.mutateAsync({ forceOffline: true })).rejects.toThrow('reconnect'); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(hasPendingCounterFire()).toBe(true);
    expect(print).not.toHaveBeenCalled();
  });
  it('libère le panier après un refus serveur explicite, sans imprimer', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'product unavailable' } });
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await expect(result.current.mutation.mutateAsync(undefined)).rejects.toThrow('product unavailable'); });
    expect(hasPendingCounterFire()).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });
});
