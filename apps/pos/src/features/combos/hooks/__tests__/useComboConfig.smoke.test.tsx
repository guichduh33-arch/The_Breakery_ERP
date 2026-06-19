// apps/pos/src/features/combos/hooks/__tests__/useComboConfig.smoke.test.tsx
//
// Session 47 — smoke test for useComboConfig.
// Verifies the mapping from the PostgREST embed shape to ComboDefinition:
//   - groups and options sorted by sort_order
//   - base_price derived from combo_base_price (not retail_price)
//   - options mapped to ComboOption with is_default, label, surcharge
//
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Supabase mock — a .from()...select()...eq()...single() chain
// ---------------------------------------------------------------------------

const singleMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: () => singleMock(),
        }),
      }),
    }),
  },
}));

// Import AFTER mocks are hoisted.
import { useComboConfig } from '../useComboConfig';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Simulates the raw PostgREST response for one combo product.
const RAW_COMBO_ROW = {
  id: 'prod-combo-001',
  name: 'Breakfast Set',
  retail_price: 70000,
  combo_base_price: 75000, // should take precedence over retail_price
  combo_groups: [
    {
      id: 'g2',
      name: 'Choose a pastry',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 2, // higher sort_order — should end up SECOND
      combo_group_options: [
        {
          component_product_id: 'prod-croi',
          surcharge: 0,
          is_default: true,
          sort_order: 0,
          component: { name: 'Croissant' }, // scalar embed (not array)
        },
      ],
    },
    {
      id: 'g1',
      name: 'Choose a drink',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 1, // lower sort_order — should end up FIRST
      combo_group_options: [
        {
          component_product_id: 'prod-latte',
          surcharge: 5000,
          is_default: false,
          sort_order: 1, // second option in the group
          component: [{ name: 'Latte' }], // array embed shape
        },
        {
          component_product_id: 'prod-amer',
          surcharge: 0,
          is_default: true,
          sort_order: 0, // first option (by sort_order)
          component: { name: 'Americano' },
        },
      ],
    },
  ],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useComboConfig mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    singleMock.mockResolvedValue({ data: RAW_COMBO_ROW, error: null });
  });

  it('returns a ComboDefinition with base_price from combo_base_price (not retail_price)', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.base_price).toBe(75000);
  });

  it('sorts groups by sort_order ascending', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const groups = result.current.data?.groups ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.name).toBe('Choose a drink');   // sort_order=1
    expect(groups[1]?.name).toBe('Choose a pastry'); // sort_order=2
  });

  it('sorts options within a group by sort_order ascending', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const drinkGroup = result.current.data?.groups[0];
    expect(drinkGroup?.options[0]?.label).toBe('Americano'); // sort_order=0
    expect(drinkGroup?.options[1]?.label).toBe('Latte');     // sort_order=1
  });

  it('maps is_default correctly — first option in drink group is default', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const drinkGroup = result.current.data?.groups[0];
    expect(drinkGroup?.options[0]?.is_default).toBe(true);  // Americano is default
    expect(drinkGroup?.options[1]?.is_default).toBe(false); // Latte is not
  });

  it('maps labels from the component embed (both scalar and array shapes)', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const drinkOptions = result.current.data?.groups[0]?.options ?? [];
    // Americano used scalar embed; Latte used array embed — both should resolve.
    expect(drinkOptions.find((o) => o.component_product_id === 'prod-amer')?.label).toBe('Americano');
    expect(drinkOptions.find((o) => o.component_product_id === 'prod-latte')?.label).toBe('Latte');
  });

  it('sets id = component_product_id on each option', async () => {
    const { result } = renderHook(() => useComboConfig('prod-combo-001'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstOption = result.current.data?.groups[0]?.options[0];
    expect(firstOption?.id).toBe(firstOption?.component_product_id);
  });

  it('is disabled when comboProductId is empty string', () => {
    const { result } = renderHook(() => useComboConfig(''), { wrapper: wrap() });
    // Query stays in idle/pending state — singleMock never called.
    expect(singleMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
