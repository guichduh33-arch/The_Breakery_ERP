// apps/backoffice/src/features/combos/__tests__/useCombos.smoke.test.tsx
//
// Session 47 — smoke tests for useCombos + useComboDetail.
// Verifies: group mapping, priceRange derivation, valuePrice, and
// ComboDefinition shape returned by useComboDetail.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCombos } from '../hooks/useCombos.js';
import { useComboDetail } from '../hooks/useComboDetail.js';

// ------------------------------------------------------------------
// Mock data representing the choice-group model
// ------------------------------------------------------------------
const MOCK_COMBOS = [
  {
    id: 'cb-1',
    name: 'Morning Set',
    sku: 'CMB-001',
    retail_price: 50000,
    combo_base_price: 45000,
    is_active: true,
    image_url: null,
    combo_groups: [
      {
        id: 'g-1',
        name: 'Drinks',
        group_type: 'single',
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        combo_group_options: [
          {
            component_product_id: 'p-amer',
            surcharge: 0,
            is_default: true,
            sort_order: 0,
            component: { name: 'Americano', retail_price: 35000 },
          },
          {
            component_product_id: 'p-latte',
            surcharge: 5000,
            is_default: false,
            sort_order: 1,
            component: { name: 'Latte', retail_price: 40000 },
          },
        ],
      },
      {
        id: 'g-2',
        name: 'Food',
        group_type: 'single',
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 1,
        combo_group_options: [
          {
            component_product_id: 'p-cros',
            surcharge: 0,
            is_default: true,
            sort_order: 0,
            component: { name: 'Croissant', retail_price: 25000 },
          },
        ],
      },
    ],
  },
];

// Chain builder that resolves with data on the terminal methods
function buildChain(data: unknown[], singleData: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['eq', 'is', 'neq', 'in', 'not', 'filter', 'limit', 'range'];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.select = () => chain;
  chain.order = () => Promise.resolve({ data, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: singleData, error: null });
  return chain;
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => buildChain(MOCK_COMBOS, MOCK_COMBOS[0]),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCombos', () => {
  it('maps combo_groups to ComboGroupSummary with options', async () => {
    const { result } = renderHook(() => useCombos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const combos = result.current.data!;
    expect(combos).toHaveLength(1);
    const combo = combos[0]!;
    expect(combo.name).toBe('Morning Set');
    expect(combo.groups).toHaveLength(2);
    const g0 = combo.groups[0]!;
    expect(g0.name).toBe('Drinks');
    expect(g0.options).toHaveLength(2);
    expect(g0.options[0]!.label).toBe('Americano');
    expect(g0.options[1]!.surcharge).toBe(5000);
  });

  it('derives price_min and price_max via priceRange', async () => {
    const { result } = renderHook(() => useCombos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const combo = result.current.data![0]!;
    // min = base(45000) + required cheapest: Drinks(0) + Food(0) = 45000
    expect(combo.price_min).toBe(45000);
    // max = base(45000) + max surcharge per group: Drinks(5000) + Food(0) = 50000
    expect(combo.price_max).toBe(50000);
  });

  it('derives value_price from default options retail prices', async () => {
    const { result } = renderHook(() => useCombos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const combo = result.current.data![0]!;
    // valuePrice = Americano(35000) + Croissant(25000) = 60000
    expect(combo.value_price).toBe(60000);
  });

  it('sets retail_price from combo_base_price', async () => {
    const { result } = renderHook(() => useCombos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const combo = result.current.data![0]!;
    expect(combo.retail_price).toBe(45000);
  });
});

describe('useComboDetail', () => {
  it('returns a ComboDetailMeta with a full definition', async () => {
    const { result } = renderHook(() => useComboDetail('cb-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const detail = result.current.data!;
    expect(detail).not.toBeNull();
    expect(detail.combo_product_id).toBe('cb-1');
    expect(detail.name).toBe('Morning Set');
    expect(detail.base_price).toBe(45000);
    expect(detail.definition.groups).toHaveLength(2);
    expect(detail.definition.groups[0]!.options[0]!.label).toBe('Americano');
  });

  it('is disabled when comboId is undefined', () => {
    const { result } = renderHook(() => useComboDetail(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
