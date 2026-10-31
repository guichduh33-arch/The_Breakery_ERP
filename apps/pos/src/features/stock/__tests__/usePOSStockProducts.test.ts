import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { usePOSStockProducts } from '../hooks/usePOSStockProducts';
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
}
const product = { id: 'p', sku: 'SKU', name: 'Croissant', unit: 'pcs', image_url: null, is_active: true,
  is_display_item: true, current_stock: 999, min_stock_threshold: 2, retail_price: 25000, category_id: 'cat',
  categories: { name: 'Pastry', slug: 'pastry' }, display_stock: { quantity: 7 }, is_sellable: true };
beforeEach(() => mocks.rpc.mockReset());
it('uses the display counter, excluding inactive and non-display items', async () => {
  mocks.rpc.mockResolvedValue({ data: [product, { ...product, id: 'inactive', is_active: false },
    { ...product, id: 'global', is_display_item: false }], error: null });
  const { result } = renderHook(() => usePOSStockProducts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(1);
  expect(result.current.data?.[0]).toMatchObject({ display_stock: 7, category_name: 'Pastry' });
});
it.each([null, { quantity: null }])('preserves unavailable display quantities as hidden: %s', async (display_stock) => {
  mocks.rpc.mockResolvedValue({ data: [{ ...product, display_stock, categories: null }], error: null });
  const { result } = renderHook(() => usePOSStockProducts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.[0]).toMatchObject({ display_stock: null, category_name: 'Uncategorized', is_sellable: true });
});
