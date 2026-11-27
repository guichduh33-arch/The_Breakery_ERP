// Relevé prod du 2026-11-27 : une query par produit (~360 sur la caisse)
// rechargeait chacune `product_modifiers` à chaque push catalogue. Ces tests
// prouvent qu'elles partagent désormais une seule lecture réseau.
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductModifierRow } from '@breakery/domain';

const mocks = vi.hoisted(() => ({
  range: vi.fn<(from: number, to: number) => Promise<{ data: unknown[] | null; error: Error | null }>>(),
  eq: vi.fn(),
  is: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          mocks.eq(column, value);
          return {
            is: (c: string, v: unknown) => {
              mocks.is(c, v);
              return { order: () => ({ range: mocks.range }) };
            },
          };
        },
      }),
    }),
  },
}));
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: (ready: boolean) => ready }));

import {
  ALL_PRODUCT_MODIFIERS_KEY,
  modifierRowsFor,
  productModifiersOptions,
} from '../hooks/useProductModifiers';

function row(id: string, scope: { product_id?: string; category_id?: string }, group = 'Size'): ProductModifierRow {
  const value: ProductModifierRow = {
    id,
    product_id: scope.product_id ?? null,
    category_id: scope.category_id ?? null,
    group_name: group,
    group_sort_order: 1,
    group_required: false,
    group_type: 'single_select',
    option_label: id,
    option_icon: null,
    option_sort_order: 1,
    price_adjustment: 0,
    is_default: false,
    is_active: true,
  };
  return value;
}

const rows = [
  row('p1-own', { product_id: 'p1' }),
  row('cat-a', { category_id: 'cat-a' }, 'Milk'),
  row('p2-own', { product_id: 'p2' }),
  row('cat-b', { category_id: 'cat-b' }),
];

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
}

beforeEach(() => {
  mocks.range.mockReset();
  mocks.eq.mockReset();
  mocks.is.mockReset();
  mocks.range.mockResolvedValue({ data: rows, error: null });
});

describe('modifiers partagés', () => {
  it('garde le filtre produit OU catégorie de la requête par produit', () => {
    expect(modifierRowsFor(rows, 'p1', 'cat-a').map((r) => r.id)).toEqual(['p1-own', 'cat-a']);
    expect(modifierRowsFor(rows, 'p2', null).map((r) => r.id)).toEqual(['p2-own']);
    expect(modifierRowsFor(rows, 'p9', 'cat-b').map((r) => r.id)).toEqual(['cat-b']);
  });

  it('ne lit que les options actives et non supprimées', async () => {
    const client = newClient();
    await client.fetchQuery(productModifiersOptions({ productId: 'p1', categoryId: 'cat-a' }));
    expect(mocks.eq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('cent produits chargés ensemble ne font qu’un appel réseau', async () => {
    const client = newClient();
    const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const results = await Promise.all(ids.map((id) =>
      client.fetchQuery(productModifiersOptions({ productId: id, categoryId: 'cat-a' }))));
    expect(mocks.range).toHaveBeenCalledTimes(1);
    expect(results[1]?.map((g) => g.group_name)).toEqual(['Size', 'Milk']);
    expect(results[2]?.map((g) => g.group_name)).toEqual(['Size', 'Milk']);
  });

  it('un push catalogue relit la liste une seule fois pour toutes les queries actives', async () => {
    const client = newClient();
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    await Promise.all(ids.map((id) => client.fetchQuery(productModifiersOptions({ productId: id, categoryId: null }))));
    expect(mocks.range).toHaveBeenCalledTimes(1);

    // Même geste que useCatalogRealtime : invalidation du préfixe, puis relecture.
    await client.invalidateQueries({ queryKey: ['product-modifiers'], refetchType: 'none' });
    expect(client.getQueryState(ALL_PRODUCT_MODIFIERS_KEY)?.isInvalidated).toBe(true);
    // Dans l'app, seules les queries par produit ont des observers (refetch « active ») ;
    // la liste partagée n'est relue qu'à travers elles.
    await client.refetchQueries({ queryKey: ['product-modifiers'], type: 'all', predicate: (q) => q.queryKey.length === 3 });
    expect(mocks.range).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(['product-modifiers', 'p7', null])?.dataUpdateCount).toBe(2);
  });

  it('lit la liste par tranches quand elle dépasse une page', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => row(`r${i}`, { product_id: 'big' }, `G${i}`));
    mocks.range.mockImplementation((from: number) => Promise.resolve({ data: from === 0 ? page : [row('last', { product_id: 'big' }, 'Last')], error: null }));
    const client = newClient();
    const groups = await client.fetchQuery(productModifiersOptions({ productId: 'big', categoryId: null }));
    expect(mocks.range.mock.calls.map((call) => call[0])).toEqual([0, 1000]);
    expect(groups).toHaveLength(1001);
  });

  it('remonte l’erreur réseau à la query du produit', async () => {
    mocks.range.mockResolvedValue({ data: null, error: new Error('boom') });
    const client = newClient();
    await expect(client.fetchQuery(productModifiersOptions({ productId: 'p1', categoryId: null }))).rejects.toThrow('boom');
  });
});
