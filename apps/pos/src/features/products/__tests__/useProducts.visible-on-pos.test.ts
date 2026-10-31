import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { useProducts } from '../hooks/useProducts';
const product = { id: 'p1', sku: 'CR', name: 'Croissant', category_id: null, retail_price: 25000,
  current_stock: null, is_active: true, visible_on_pos: true, parent_product_id: null,
  categories: null, display_stock: { quantity: null }, is_sellable: true, has_variants: false };
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
}
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({ data: [product], error: null }); });
it('excludes hidden, inactive and child products while preserving masked sellability', async () => {
  mocks.rpc.mockResolvedValue({ data: [product, { ...product, id: 'hidden', visible_on_pos: false },
    { ...product, id: 'inactive', is_active: false }, { ...product, id: 'child', parent_product_id: 'p1' }], error: null });
  const { result } = renderHook(() => useProducts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(1);
  expect(result.current.data?.[0]).toMatchObject({ id: 'p1', current_stock: null, is_sellable: true });
  expect(mocks.rpc).toHaveBeenCalledWith('get_operational_products_v1');
});
it('keeps a parent grouped when its active variants are hidden', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ ...product, has_variants: true }], error: null });
  const { result } = renderHook(() => useProducts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.[0]?.has_variants).toBe(true);
});
it('propagates catalogue refusal instead of publishing an empty catalogue', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
  const { result } = renderHook(() => useProducts(), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
