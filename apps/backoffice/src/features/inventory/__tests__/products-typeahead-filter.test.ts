// apps/backoffice/src/features/inventory/__tests__/products-typeahead-filter.test.ts
//
// Audit M1 — verify that the inventory product typeahead filters on
// `track_inventory=true` and NOT on `is_active=true`.
//
// Background: ingredients are `is_active=false` but `track_inventory=true`.
// The old filter `.eq('is_active', true)` made them invisible in the
// Adjust/Receive/Waste modals while the stock-levels table showed them fine.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- Spy on the PostgREST query-builder chain --------------------------------
// We capture every `.eq(col, val)` call so we can assert which filters are applied.

const eqSpy = vi.fn().mockReturnThis();
const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      eq: eqSpy,
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: limitMock,
    })),
  },
}));

import { useProductsForInventory } from '../hooks/useProductsForInventory.js';

// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useProductsForInventory — audit M1 filter contract', () => {
  beforeEach(() => {
    eqSpy.mockClear();
    limitMock.mockClear();
    limitMock.mockResolvedValue({ data: [], error: null });
  });

  it('filters on track_inventory=true (not is_active)', async () => {
    const { result } = renderHook(() => useProductsForInventory('flour'), { wrapper });

    // Wait for the query to settle (enabled: term.length >= 2 = 'flour' qualifies)
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Must filter on track_inventory
    expect(eqSpy).toHaveBeenCalledWith('track_inventory', true);

    // Must NOT filter on is_active
    expect(eqSpy).not.toHaveBeenCalledWith('is_active', true);
  });

  it('does not fire when search term is shorter than 2 chars', () => {
    const { result } = renderHook(() => useProductsForInventory('f'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(eqSpy).not.toHaveBeenCalled();
  });
});
