// apps/backoffice/src/features/purchasing/hooks/__tests__/useAllProductsForPO.smoke.test.tsx
// Session 46 — R1/R2: picker is restricted to raw-material products and each
// product carries its valid purchase units + default purchase unit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAllProductsForPO } from '../useAllProductsForPO.js';

const eqMock = vi.fn();
const limitMock = vi.fn();

const builder: Record<string, unknown> = {};
function chain(): typeof builder { return builder; }
builder['select'] = vi.fn(chain);
builder['eq']     = vi.fn((...args: unknown[]) => { eqMock(...args); return builder; });
builder['is']     = vi.fn(chain);
builder['order']  = vi.fn(chain);
builder['limit']  = vi.fn((...args: unknown[]) => limitMock(...args));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { from: vi.fn(() => builder) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useAllProductsForPO', () => {
  beforeEach(() => {
    eqMock.mockReset();
    limitMock.mockReset();
    limitMock.mockResolvedValue({
      data: [
        {
          id: 'p-raw', sku: 'FLOUR', name: 'Flour', unit: 'kg', cost_price: 12000,
          categories: { category_type: 'raw_material' },
          product_unit_alternatives: [
            { code: 'sack', factor_to_base: 25, display_order: 2 },
            { code: 'kg',   factor_to_base: 1,  display_order: 1 },  // dup of base → ignored
          ],
          product_unit_contexts: { purchase_unit: 'sack' },
        },
      ],
      error: null,
    });
  });

  it('R1: filters on categories.category_type = raw_material', async () => {
    const { result } = renderHook(() => useAllProductsForPO(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock).toHaveBeenCalledWith('categories.category_type', 'raw_material');
  });

  it('R2: builds unit options (base ∪ alternatives) + default purchase unit', async () => {
    const { result } = renderHook(() => useAllProductsForPO(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row = result.current.data![0]!;
    expect(row.unitOptions).toEqual([
      { code: 'kg',   factor: 1 },
      { code: 'sack', factor: 25 },
    ]);
    expect(row.defaultPurchaseUnit).toBe('sack');
  });
});
