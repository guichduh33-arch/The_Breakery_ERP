import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePOSReceiveStock } from '../hooks/usePOSReceiveStock';
import { useWasteDisplay } from '../hooks/useWasteDisplay';
import { useAdjustDisplay } from '../hooks/useAdjustDisplay';
import { useReturnToKitchen } from '../hooks/useReturnToKitchen';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((fn: string) => Promise.resolve({ error: null, data: fn === 'waste_display_stock_v4'
    ? { declaration_id: 'd', status: 'pending', display_withdrawal_applied: true, idempotent_replay: false }
    : { product_id: 'p', new_display_stock: null, effect_id: 'effect', idempotent_replay: false } }));
});

it.each(['receive', 'waste', 'adjust', 'return'] as const)('%s invalidates both variant caches after its confirmed display gesture', async (gesture) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => ({ receive: usePOSReceiveStock(), waste: useWasteDisplay(),
    adjust: useAdjustDisplay(), return: useReturnToKitchen() }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => {
    if (gesture === 'adjust') await result.current.adjust.mutateAsync({ productId: 'p', newQty: 3, reason: 'Physical count', idempotencyKey: 'same-key' });
    else await result.current[gesture].mutateAsync({ productId: 'p', quantity: 3, reason: 'Display update', idempotencyKey: 'same-key' });
  });
  if (gesture === 'adjust') expect(mocks.rpc).toHaveBeenCalledWith('adjust_display_stock_v5', { p_product_id: 'p', p_new_qty: 3, p_reason: 'Physical count', p_idempotency_key: 'same-key' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pos-product-variants'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pos-product-variants-batch'] });
});
