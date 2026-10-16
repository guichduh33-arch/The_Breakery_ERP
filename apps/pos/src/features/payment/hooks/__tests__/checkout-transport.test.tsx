import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { classifyCheckoutError } from '@breakery/domain';
import { useCheckout } from '../useCheckout';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useLanCredential } from '@/features/lan/lanCredential';

const native = vi.hoisted(() => vi.fn(() => false));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/nativeShell', () => ({ isNativeShell: native }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, supabaseUrl: 'https://payment.test' }));
vi.mock('@/lib/accessToken', () => ({ getAccessToken: () => Promise.resolve('token') }));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  native.mockReturnValue(false);
  useLanCredential.setState({ credential: { id: 'pos', code: 'POS', secret: 'test', device_type: 'pos' } });
  rpc.mockClear();
  usePaymentStore.getState().reset();
  useShiftStore.setState({ current: { id: 'shift', opened_at: '', opening_cash: 0 } });
  useCartStore.setState({ cart: { order_type: 'take_out', items: [{ id: 'local', product_id: 'coffee', name: 'Coffee', quantity: 1, unit_price: 10000, modifiers: [] }] }, pickedUpOrderId: null, appliedPromotions: [] });
});

it.each(['tablet', 'kds', 'native'])('refuse le paiement depuis %s avant tout appel réseau ou RPC', async (type) => {
  if (type === 'native') native.mockReturnValue(true);
  else useLanCredential.setState({ credential: { id: 'order-only', code: 'TABLET', secret: 'test', device_type: type } });
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCheckout(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync({ cart: useCartStore.getState().cart, payment: [{ method: 'cash', amount: 10000 }] }))
      .rejects.toThrow('Payments are only available at the cashier.');
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it.each([{ status: 200, body: '{broken' }, { status: 200, body: '{}' }, { status: 502, body: 'gateway unavailable' }])('keeps an unreadable or uncertain server response retryable: %j', async ({ status, body }) => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(body, { status })));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCheckout(), { wrapper });
  let error: unknown;
  await act(async () => {
    try { await result.current.mutateAsync({ cart: useCartStore.getState().cart, payment: [{ method: 'cash', amount: 10000 }] }); }
    catch (caught) { error = caught; }
  });
  expect(classifyCheckoutError(error).kind).toBe('retryable');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
