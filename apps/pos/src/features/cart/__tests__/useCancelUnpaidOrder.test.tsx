import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useCancelUnpaidOrder, type CancelUnpaidAttempt } from '../hooks/useCancelUnpaidOrder';
const { locked } = vi.hoisted(() => ({ locked: vi.fn(() => false) }));
vi.mock('@/stores/cartPaymentGuard', () => ({ isCartPaymentLocked: locked, guardCartActions: (actions: unknown) => actions }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://example.invalid' }));
vi.mock('@/lib/accessToken', () => ({ getAccessToken: () => Promise.resolve('test-token') }));
const attempt = { snapshot: { id: 'order-1', updated_at: '2026-09-30T00:00:00Z', order_items: [] },
  losses: [], reason: 'Customer left', idempotencyKey: 'same-key' } as unknown as CancelUnpaidAttempt;
const fetchMock = vi.fn<typeof fetch>();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks(); locked.mockReturnValue(false); vi.stubGlobal('fetch', fetchMock);
  useCartStore.setState({ pickedUpOrderId: 'order-1', cart: { items: [], order_type: 'take_out' } });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ order_id: 'order-1', status: 'voided' })));
});
afterEach(() => vi.unstubAllGlobals());
describe('transport annulation impayée', () => {
  it('PIN et clé en headers ; reset uniquement après confirmation du même UUID', async () => {
    const { result } = renderHook(() => useCancelUnpaidOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ attempt, managerPin: '123456' }); });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/functions/v1/cancel-unpaid-order');
    expect(options?.headers).toMatchObject({ 'x-manager-pin': '123456', 'x-idempotency-key': 'same-key' });
    expect(options?.body).not.toContain('123456');
    if (typeof options?.body !== 'string') throw new Error('Expected JSON body');
    expect(JSON.parse(options.body)).toMatchObject({ order_id: 'order-1', expected_items: [] });
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
  });
  it.each([new Response('{}', { status: 409 }), new Response('{"order_id":"other","status":"voided"}'), new Error('network')])(
    'garde la commande après erreur ou confirmation étrangère', async (response) => {
      if (response instanceof Error) fetchMock.mockRejectedValue(response); else fetchMock.mockResolvedValue(response);
      const { result } = renderHook(() => useCancelUnpaidOrder(), { wrapper });
      await act(async () => { await expect(result.current.mutateAsync({ attempt, managerPin: '123456' })).rejects.toThrow(); });
      expect(useCartStore.getState().pickedUpOrderId).toBe('order-1');
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  it('refuse pendant un paiement sans appel réseau', async () => {
    locked.mockReturnValue(true);
    const { result } = renderHook(() => useCancelUnpaidOrder(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ attempt, managerPin: '123456' })).rejects.toThrow(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('un ACK tardif ne vide pas la nouvelle commande', async () => {
    fetchMock.mockImplementation(() => {
      useCartStore.setState({ pickedUpOrderId: 'new-order' });
      return Promise.resolve(new Response(JSON.stringify({ order_id: 'order-1', status: 'voided' })));
    });
    const { result } = renderHook(() => useCancelUnpaidOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ attempt, managerPin: '123456' }); });
    expect(useCartStore.getState().pickedUpOrderId).toBe('new-order');
  });
});
