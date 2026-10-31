import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { useProductVariants, normalizeVariantStock } from '../useProductVariants';
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
}
const variant = { id: 'v', parent_product_id: 'p', is_active: true, visible_on_pos: true, variant_sort_order: 1,
  track_inventory: true, current_stock: null, display_stock: { quantity: null }, is_sellable: true };
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({ data: [], error: null }); });
it('keeps only active visible variants of the requested parent, sorted, without converting masked stock', async () => {
  mocks.rpc.mockResolvedValue({ data: [variant, { ...variant, id: 'first', variant_sort_order: 0 },
    { ...variant, id: 'hidden', visible_on_pos: false }, { ...variant, id: 'inactive', is_active: false },
    { ...variant, id: 'other', parent_product_id: 'other' }], error: null });
  const { result } = renderHook(() => useProductVariants('p'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map((v) => v.id)).toEqual(['first', 'v']);
  expect(result.current.data?.[0]).toMatchObject({ current_stock: null, display_stock: { quantity: null }, is_sellable: true });
});
it('does not fetch without a parent', () => {
  renderHook(() => useProductVariants(null), { wrapper });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps legacy snapshot relation normalization readable', () => {
  expect(normalizeVariantStock({ display_stock: [{ quantity: 4 }] }).display_stock).toEqual({ quantity: 4 });
  expect(normalizeVariantStock({ display_stock: [] }).display_stock).toBeNull();
  expect(normalizeVariantStock({ display_stock: null }).display_stock).toBeNull();
  expect(normalizeVariantStock({}).display_stock).toBeNull();
});
