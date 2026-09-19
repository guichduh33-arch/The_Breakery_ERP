import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useUpsertRecipe } from '../useUpsertRecipe.js';
import { useDeactivateRecipe } from '../useDeactivateRecipe.js';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

describe('recipe mutation refreshes visible costs', () => {
  it.each(['save', 'remove'] as const)('%s refreshes parent costs before finishing', async (action) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let serverCost = 100;
    const keys = [
      ['products', 'detail', 'parent'],
      ['inventory-production', 'product-summary', 'parent'],
      ['recipe-direct-cost', 'parent'],
      ['recipe-bom-full', 'parent'],
      ['margin-alerts'],
    ];
    const observers = keys.map((queryKey) => {
      client.setQueryData(queryKey, serverCost);
      return new QueryObserver(client, { queryKey, queryFn: () => Promise.resolve(serverCost) });
    });
    const unsubscribe = observers.map((observer) => observer.subscribe(vi.fn()));
    rpc.mockImplementation(() => {
      serverCost = 200;
      return Promise.resolve({ data: 'recipe-id', error: null });
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => ({ save: useUpsertRecipe(), remove: useDeactivateRecipe() }), { wrapper });
    try {
      await act(async () => {
        if (action === 'save') {
          await result.current.save.mutateAsync({ productId: 'child', materialId: 'ingredient', quantity: 2, unit: 'pcs' });
        } else {
          await result.current.remove.mutateAsync({ productId: 'child', recipeId: 'recipe-id' });
        }
      });
      for (const key of keys) expect(client.getQueryData(key)).toBe(200);
    } finally {
      unmount();
      unsubscribe.forEach((stop) => stop());
      client.clear();
    }
  });
});
