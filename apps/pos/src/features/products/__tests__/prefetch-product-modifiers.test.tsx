import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Product } from '@breakery/domain';
import { usePrefetchProductModifiers, usePrefetchModifierOptions } from '../hooks/usePrefetchProductModifiers';

const mocks = vi.hoisted(() => ({ prefetch: vi.fn<(options: { productId: string }) => Promise<void>>(), enabled: true }));
const client = { prefetchQuery: mocks.prefetch };
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => client }));
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: (ready: boolean) => ready && mocks.enabled }));
vi.mock('../hooks/useProductModifiers', () => ({ productModifiersOptions: (args: unknown) => args }));
const products = Array.from({ length: 20 }, (_, i) => ({ id: String(i), category_id: 'cat', has_variants: false, product_type: 'finished' })) as Product[];
beforeEach(() => { mocks.prefetch.mockReset(); mocks.enabled = true; });

it('preloads every tablet option with at most two requests and stops when cloud is unavailable', async () => {
  const candidates = products.map((product) => ({ productId: product.id, categoryId: product.category_id }));
  let active = 0;
  let peak = 0;
  mocks.prefetch.mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
  });
  const { rerender } = renderHook(() => usePrefetchModifierOptions(candidates, true));
  await waitFor(() => expect(mocks.prefetch).toHaveBeenCalledTimes(20));
  expect(peak).toBeLessThanOrEqual(2);
  mocks.enabled = false;
  rerender();
  expect(mocks.prefetch).toHaveBeenCalledTimes(20);
});

it('limits the queue to twelve simple products and two concurrent requests across category changes', async () => {
  const resolvers: (() => void)[] = [];
  mocks.prefetch.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)));
  const { rerender, unmount } = renderHook(({ rows }) => usePrefetchProductModifiers(rows, true), { initialProps: { rows: products } });
  await waitFor(() => expect(mocks.prefetch).toHaveBeenCalledTimes(2));
  rerender({ rows: products.slice(10) });
  expect(mocks.prefetch).toHaveBeenCalledTimes(2);
  await act(async () => { resolvers.splice(0).forEach((resolve) => resolve()); await Promise.resolve(); });
  await waitFor(() => expect(mocks.prefetch).toHaveBeenCalledTimes(4));
  unmount();
  await act(async () => { resolvers.splice(0).forEach((resolve) => resolve()); await Promise.resolve(); });
  expect(mocks.prefetch).toHaveBeenCalledTimes(4);
});

it('excludes combos and variant parents and does not start when offline', async () => {
  mocks.prefetch.mockResolvedValue(undefined);
  const rows = [{ ...products[0], id: 'combo', product_type: 'combo' }, { ...products[0], id: 'parent', has_variants: true }, ...products] as Product[];
  const { unmount } = renderHook(() => usePrefetchProductModifiers(rows, true));
  await waitFor(() => expect(mocks.prefetch).toHaveBeenCalledTimes(12));
  expect(mocks.prefetch.mock.calls.map((call) => call[0].productId)).toEqual(products.slice(0, 12).map((product) => product.id));
  unmount();
  mocks.enabled = false;
  renderHook(() => usePrefetchProductModifiers(rows, true));
  expect(mocks.prefetch).toHaveBeenCalledTimes(12);
});
