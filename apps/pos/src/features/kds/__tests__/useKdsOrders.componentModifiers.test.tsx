// apps/pos/src/features/kds/__tests__/useKdsOrders.componentModifiers.test.tsx
//
// ADR-017 (conséquence 5) — the KDS reads the combo line's composition:
// `order_items.combo_components` carries, per component, the modifiers
// answered on it. The hook resolves each component's product name (second
// query on `products`) and exposes a flattened `component_modifiers` list
// ready for the card to render.
//
// We mock the Supabase builder chain per-table:
//   - order_items → the KDS rows under test
//   - products    → the component-name resolution query

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Supabase mock — per-table builders
// ---------------------------------------------------------------------------

let fakeKdsRows: unknown[] = [];
let fakeProductRows: unknown[] = [];
const productsInMock = vi.fn();

const kdsBuilder = {
  or: () => kdsBuilder,
  in: () => kdsBuilder,
  eq: () => kdsBuilder,
  order: () => Promise.resolve({ data: fakeKdsRows, error: null }),
};

const productsBuilder = {
  in: (...a: unknown[]) => {
    productsInMock(...a);
    return Promise.resolve({ data: fakeProductRows, error: null });
  },
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'products'
        ? { select: () => productsBuilder }
        : { select: () => kdsBuilder },
  },
}));

// ---------------------------------------------------------------------------
// Import hook AFTER the mock is set up
// ---------------------------------------------------------------------------

import { useKdsOrders } from '../hooks/useKdsOrders';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function makeRawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-combo',
    quantity: 1,
    unit_price: 65000,
    modifiers: [
      { group_name: 'Choose a drink', option_label: 'Capuccino', price_adjustment: 0 },
    ],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'barista',
    dispatch_stations: ['barista'],
    combo_components: null,
    sent_to_kitchen_at: '2026-07-30T10:00:00.000Z',
    ready_at: null,
    prep_started_at: null,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    products: { name: 'French Plater', categories: null },
    orders: { order_number: '#A-001', status: 'pending_payment', notes: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKdsOrders — component modifiers (ADR-017 conséquence 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeKdsRows = [];
    fakeProductRows = [];
  });

  it('flattens combo_components modifiers with the resolved component name', async () => {
    fakeKdsRows = [
      makeRawRow({
        combo_components: [
          {
            product_id: 'prod-capu',
            quantity: 1,
            modifiers: [
              { group_name: 'HOT/ICED', option_label: 'Iced', price_adjustment: 0 },
              { group_name: 'Milk', option_label: 'Oat Milk', price_adjustment: 8000 },
            ],
          },
          { product_id: 'prod-croissant', quantity: 1, modifiers: [] },
        ],
      }),
    ];
    fakeProductRows = [{ id: 'prod-capu', name: 'Capuccino' }];

    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const item = result.current.data![0]!;
    expect(item.component_modifiers).toEqual([
      { component_name: 'Capuccino', group_name: 'HOT/ICED', option_label: 'Iced' },
      { component_name: 'Capuccino', group_name: 'Milk', option_label: 'Oat Milk' },
    ]);
    // Only components that actually carry modifiers are name-resolved.
    expect(productsInMock).toHaveBeenCalledWith('id', ['prod-capu']);
  });

  it('returns an empty component_modifiers for non-combo lines (combo_components null)', async () => {
    fakeKdsRows = [makeRawRow({ combo_components: null })];

    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0]!.component_modifiers).toEqual([]);
    // No component carries modifiers → the products query is skipped entirely.
    expect(productsInMock).not.toHaveBeenCalled();
  });

  it('skips the products query when components carry no modifiers', async () => {
    fakeKdsRows = [
      makeRawRow({
        combo_components: [
          { product_id: 'prod-capu', quantity: 1 },
          { product_id: 'prod-croissant', quantity: 1, modifiers: [] },
        ],
      }),
    ];

    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0]!.component_modifiers).toEqual([]);
    expect(productsInMock).not.toHaveBeenCalled();
  });

  it('falls back to "unknown" when a component product cannot be resolved', async () => {
    fakeKdsRows = [
      makeRawRow({
        combo_components: [
          {
            product_id: 'prod-deleted',
            quantity: 1,
            modifiers: [{ group_name: 'HOT/ICED', option_label: 'Hot', price_adjustment: 0 }],
          },
        ],
      }),
    ];
    fakeProductRows = []; // product no longer exists

    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0]!.component_modifiers).toEqual([
      { component_name: 'unknown', group_name: 'HOT/ICED', option_label: 'Hot' },
    ]);
  });

  it('resolves names once across lines and preserves per-line attribution', async () => {
    fakeKdsRows = [
      makeRawRow({
        id: 'oi-1',
        combo_components: [
          {
            product_id: 'prod-capu',
            quantity: 1,
            modifiers: [{ group_name: 'HOT/ICED', option_label: 'Iced', price_adjustment: 0 }],
          },
        ],
      }),
      makeRawRow({
        id: 'oi-2',
        combo_components: [
          {
            product_id: 'prod-ame',
            quantity: 1,
            modifiers: [{ group_name: 'HOT/ICED', option_label: 'Hot', price_adjustment: 0 }],
          },
        ],
      }),
    ];
    fakeProductRows = [
      { id: 'prod-capu', name: 'Capuccino' },
      { id: 'prod-ame', name: 'Americano' },
    ];

    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productsInMock).toHaveBeenCalledTimes(1);
    const ids = productsInMock.mock.calls[0]![1] as string[];
    expect([...ids].sort()).toEqual(['prod-ame', 'prod-capu']);

    const byId = new Map(result.current.data!.map((i) => [i.id, i]));
    expect(byId.get('oi-1')!.component_modifiers).toEqual([
      { component_name: 'Capuccino', group_name: 'HOT/ICED', option_label: 'Iced' },
    ]);
    expect(byId.get('oi-2')!.component_modifiers).toEqual([
      { component_name: 'Americano', group_name: 'HOT/ICED', option_label: 'Hot' },
    ]);
  });
});
