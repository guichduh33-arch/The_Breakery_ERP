import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryFn: undefined as undefined | (() => Promise<unknown>),
  rows: [] as Record<string, unknown>[],
  error: null as null | Error,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => Promise<unknown> }) => {
    mocks.queryFn = options.queryFn;
    return {};
  },
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => {
      let rows = mocks.rows.slice();
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        is: (key: string, value: unknown) => query.eq(key, value),
        order: () => query,
        limit: () => Promise.resolve({ data: rows, error: mocks.error }),
      };
      return query;
    },
  },
}));

import { useDeductibleIngredientProducts } from '../useDeductibleIngredientProducts.js';

function product(id: string, patch: Record<string, unknown> = {}) {
  return { id, sku: id, name: id, unit: 'kg', cost_price: 100000,
    product_unit_alternatives: [{ code: 'gr', factor_to_base: '0.001', display_order: 0 }],
    product_type: 'finished', track_inventory: true, is_semi_finished: false,
    is_active: true, deleted_at: null, 'categories.category_type': 'finished', ...patch };
}

beforeEach(() => { mocks.rows = []; mocks.error = null; });

describe('useDeductibleIngredientProducts', () => {
  it('uses category types despite contradictory product flags and preserves units', async () => {
    mocks.rows = [
      product('Mayonnaise', { 'categories.category_type': 'semi_finished' }),
      product('BBQ', { 'categories.category_type': 'raw_material' }),
      product('Aioli', { is_semi_finished: true, 'categories.category_type': 'semi_finished' }),
      product('Sandwich', { is_semi_finished: true }),
      product('untracked', { track_inventory: false }),
      product('inactive', { is_active: false }),
      product('deleted', { deleted_at: '2026-10-01' }),
    ];
    useDeductibleIngredientProducts();
    const rows = await mocks.queryFn!();
    expect(rows).toEqual([
      expect.objectContaining({ id: 'Aioli', is_semi_finished: true }),
      expect.objectContaining({ id: 'BBQ', is_semi_finished: false }),
      expect.objectContaining({ id: 'Mayonnaise', is_semi_finished: true,
        unitOptions: [{ code: 'kg', factor: 1 }, { code: 'gr', factor: 0.001 }] }),
      expect.objectContaining({ id: 'Sandwich', is_semi_finished: false, is_finished: true }),
    ]);
  });

  it('reports a failed ingredient load instead of returning an incomplete list', async () => {
    mocks.error = new Error('ingredient load failed');
    useDeductibleIngredientProducts();
    await expect(mocks.queryFn!()).rejects.toThrow('ingredient load failed');
  });
});
