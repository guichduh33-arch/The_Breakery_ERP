import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { classifyCheckoutError } from '@breakery/domain';
import { useCheckout } from '../useCheckout';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useShiftStore } from '@/stores/shiftStore';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() }, supabaseUrl: 'https://payment.test' }));
vi.mock('@/lib/accessToken', () => ({ getAccessToken: () => Promise.resolve('token') }));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  usePaymentStore.getState().reset();
  useShiftStore.setState({ current: { id: 'shift', opened_at: '', opening_cash: 0 } });
  useCartStore.setState({ cart: { order_type: 'take_out', items: [{ id: 'local', product_id: 'coffee', name: 'Coffee', quantity: 1, unit_price: 10000, modifiers: [] }] }, pickedUpOrderId: null, appliedPromotions: [] });
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
