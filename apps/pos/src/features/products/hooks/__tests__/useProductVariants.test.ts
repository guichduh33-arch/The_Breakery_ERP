// apps/pos/src/features/products/hooks/__tests__/useProductVariants.test.ts
//
// Session 59 (05 D1.1 review finding) — proves useProductVariants filters
// `visible_on_pos = true` in addition to `is_active`. A variant hidden from
// the counter in BO must not remain selectable via VariantSelectModal.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const orderMock = vi.fn();
const isMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
  },
}));

import { useProductVariants } from '../useProductVariants';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // .select().eq('parent_product_id', ...).eq('is_active', true)
  //   .eq('visible_on_pos', true).is('deleted_at', null).order(...)
  orderMock.mockResolvedValue({ data: [], error: null });
  isMock.mockReturnValue({ order: orderMock });
  eqMock.mockReturnValue({ eq: eqMock, is: isMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
});

describe('useProductVariants — visible_on_pos (session 59 review finding)', () => {
  it('filters on visible_on_pos = true in addition to is_active', async () => {
    const { result } = renderHook(() => useProductVariants('parent-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(eqMock).toHaveBeenCalledWith('parent_product_id', 'parent-1');
    expect(eqMock).toHaveBeenCalledWith('is_active', true);
    expect(eqMock).toHaveBeenCalledWith('visible_on_pos', true);
  });

  it('does not fetch when parentId is null', () => {
    renderHook(() => useProductVariants(null), { wrapper });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
