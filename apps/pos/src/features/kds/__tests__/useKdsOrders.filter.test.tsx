// apps/pos/src/features/kds/__tests__/useKdsOrders.filter.test.tsx
//
// Spec B-1 Ph2 — verifies the dual-branch PostgREST filter on useKdsOrders:
//   NEW rows:    dispatch_stations @> [station]  (array contains)
//   LEGACY rows: dispatch_stations IS NULL + dispatch_station = station
//
// We mock the Supabase builder chain and assert:
//   1. .or() is called with the correct PostgREST filter string.
//   2. New-style rows (dispatch_stations populated) are mapped correctly.
//   3. Legacy rows (dispatch_stations null) are mapped correctly.
//   4. The hook surfaces dispatch_stations on each returned KdsItemRow.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Supabase mock — captures the .or() call and returns controlled rows
// ---------------------------------------------------------------------------

const orMock = vi.fn();
let fakeDbRows: unknown[] = [];

// Each method in the builder chain returns the same builder (fluent), except
// .order() which resolves the promise with fakeDbRows.
const builder = {
  or: (...a: unknown[]) => { orMock(...a); return builder; },
  in: () => builder,
  eq: () => builder,
  order: () => Promise.resolve({ data: fakeDbRows, error: null }),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => builder }),
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
    product_id: 'prod-1',
    quantity: 1,
    unit_price: 35000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    dispatch_stations: null,
    sent_to_kitchen_at: '2026-06-26T10:00:00.000Z',
    ready_at: null,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    products: { name: 'Americano' },
    orders: { order_number: '#A-001', status: 'pending_payment' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKdsOrders — multi-station filter (Spec B-1 Ph2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeDbRows = [];
  });

  it('calls .or() with the dual-branch PostgREST filter string for "kitchen"', async () => {
    fakeDbRows = [];
    const { result } = renderHook(() => useKdsOrders('kitchen'), { wrapper: wrap() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(orMock).toHaveBeenCalledOnce();
    expect(orMock).toHaveBeenCalledWith(
      'dispatch_stations.cs.{kitchen},and(dispatch_stations.is.null,dispatch_station.eq.kitchen)',
    );
  });

  it('calls .or() with the correct filter for "barista" station', async () => {
    fakeDbRows = [];
    const { result } = renderHook(() => useKdsOrders('barista'), { wrapper: wrap() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(orMock).toHaveBeenCalledWith(
      'dispatch_stations.cs.{barista},and(dispatch_stations.is.null,dispatch_station.eq.barista)',
    );
  });

  it('maps a new-style row (dispatch_stations populated) and exposes the array', async () => {
    fakeDbRows = [
      makeRawRow({
        id: 'oi-new',
        dispatch_stations: ['kitchen', 'display'],
        dispatch_station: 'kitchen',
        products: { name: 'Croissant' },
      }),
    ];

    const { result } = renderHook(() => useKdsOrders('kitchen'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const items = result.current.data!;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('oi-new');
    expect(items[0]!.dispatch_stations).toEqual(['kitchen', 'display']);
    expect(items[0]!.product_name).toBe('Croissant');
  });

  it('maps a legacy row (dispatch_stations null) and preserves dispatch_station', async () => {
    fakeDbRows = [
      makeRawRow({
        id: 'oi-legacy',
        dispatch_stations: null,
        dispatch_station: 'kitchen',
        products: { name: 'Espresso' },
      }),
    ];

    const { result } = renderHook(() => useKdsOrders('kitchen'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const items = result.current.data!;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('oi-legacy');
    expect(items[0]!.dispatch_stations).toBeNull();
    expect(items[0]!.dispatch_station).toBe('kitchen');
    expect(items[0]!.product_name).toBe('Espresso');
  });

  it('returns both new-style and legacy rows in a mixed result set', async () => {
    fakeDbRows = [
      makeRawRow({
        id: 'oi-new',
        dispatch_stations: ['kitchen'],
        dispatch_station: 'kitchen',
        products: { name: 'Latte' },
        sent_to_kitchen_at: '2026-06-26T10:00:00.000Z',
      }),
      makeRawRow({
        id: 'oi-legacy',
        dispatch_stations: null,
        dispatch_station: 'kitchen',
        products: { name: 'Flat White' },
        sent_to_kitchen_at: '2026-06-26T10:01:00.000Z',
      }),
    ];

    const { result } = renderHook(() => useKdsOrders('kitchen'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const items = result.current.data!;
    expect(items).toHaveLength(2);

    const newRow = items.find((i) => i.id === 'oi-new')!;
    expect(newRow.dispatch_stations).toEqual(['kitchen']);

    const legacyRow = items.find((i) => i.id === 'oi-legacy')!;
    expect(legacyRow.dispatch_stations).toBeNull();
    expect(legacyRow.dispatch_station).toBe('kitchen');
  });
});
