import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));
import { useProductsForInventory } from '../hooks/useProductsForInventory.js';
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
}
beforeEach(() => mocks.rpc.mockReset());
it('includes inactive tracked ingredients and excludes untracked products', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ id: 'tracked', name: 'Flour', sku: 'FLOUR', track_inventory: true, is_active: false, current_stock: null },
    { id: 'untracked', name: 'Flour bag', sku: 'BAG', track_inventory: false, is_active: true }], error: null });
  const { result } = renderHook(() => useProductsForInventory('flour'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([expect.objectContaining({ id: 'tracked', current_stock: null })]);
});
it('does not fetch for fewer than two characters', () => {
  const { result } = renderHook(() => useProductsForInventory('f'), { wrapper });
  expect(result.current.fetchStatus).toBe('idle');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['T_PROD_FLOUR', 'Flour,"(white)', '100% flour', 'path\\flour'])('matches search as literal text: %s', async (term) => {
  mocks.rpc.mockResolvedValue({ data: [{ id: 'match', name: term, sku: 'MATCH', track_inventory: true },
    { id: 'other', name: 'Unrelated flour', sku: 'OTHER', track_inventory: true }], error: null });
  const { result } = renderHook(() => useProductsForInventory(term), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map((p) => p.id)).toEqual(['match']);
  expect(mocks.rpc).toHaveBeenCalledWith('get_operational_products_v1');
});
