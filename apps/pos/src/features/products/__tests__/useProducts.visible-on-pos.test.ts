// apps/pos/src/features/products/__tests__/useProducts.visible-on-pos.test.ts
//
// Session 59 (05 D1.1) — proves useProducts filters BOTH the parent query
// and the variant-existence probe on `visible_on_pos = true`. Before this
// fix, the BO toggle `products.visible_on_pos` (GeneralPanel.tsx) had no
// effect at the counter — only `is_active` was enforced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

interface Chain {
  is: (...args: unknown[]) => Chain;
  eq: (...args: unknown[]) => Chain;
  not: (...args: unknown[]) => Chain;
  order: (...args: unknown[]) => Promise<{ data: unknown[]; error: null }>;
  then: Promise<{ data: unknown[]; error: null }>['then'];
}

function makeChain(data: unknown[]): Chain {
  const result = Promise.resolve({ data, error: null });
  const chain: Chain = {
    is: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => result),
    then: result.then.bind(result),
  };
  return chain;
}

const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
  },
}));

import { useProducts } from '../hooks/useProducts';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const VISIBLE_PRODUCT = {
  id: 'p1',
  sku: 'CR',
  name: 'Croissant',
  category_id: 'cat-1',
  retail_price: 25_000,
  wholesale_price: null,
  product_type: 'finished',
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: false,
  parent_product_id: null,
  track_inventory: false,
  categories: null,
  display_stock: null,
};

let productsChain: Chain;
let variantsChain: Chain;

beforeEach(() => {
  vi.clearAllMocks();
  // Step 1 (parents/standalones) resolves with the "visible" fixture only —
  // a product with visible_on_pos:false is expected to never reach this
  // array in production because the server-side .eq() excludes it.
  productsChain = makeChain([VISIBLE_PRODUCT]);
  variantsChain = makeChain([]);

  let callCount = 0;
  fromMock.mockImplementation(() => {
    callCount += 1;
    const chain = callCount === 1 ? productsChain : variantsChain;
    return { select: (...args: unknown[]) => (selectMock(...args), chain) };
  });
});

describe('useProducts — visible_on_pos (session 59, 05 D1.1)', () => {
  it('filters the parent/standalone query on visible_on_pos = true (in addition to is_active)', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productsChain.eq).toHaveBeenCalledWith('is_active', true);
    expect(productsChain.eq).toHaveBeenCalledWith('visible_on_pos', true);
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Croissant');
  });

  it('filters the variant-existence probe on visible_on_pos = true too', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(variantsChain.eq).toHaveBeenCalledWith('is_active', true);
    expect(variantsChain.eq).toHaveBeenCalledWith('visible_on_pos', true);
  });

  it('still excludes is_active = false as before (non-regression)', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Both eq('is_active', true) calls happened before/independently of the
    // new visible_on_pos filter — the fix is additive, not a replacement.
    expect(productsChain.eq).toHaveBeenCalledWith('is_active', true);
  });
});
