// Relevé prod du 2026-11-27 : une query par produit (~360 sur la caisse)
// rechargeait chacune `product_modifiers` à chaque push catalogue. Ces tests
// prouvent qu'elles partagent désormais une seule lecture réseau, sans rendre
// un état d'avant un changement du catalogue.
import { QueryClient, QueryObserver, type QueryObserverOptions } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModifierGroup, ProductModifierRow } from '@breakery/domain';

interface Page { data: unknown[] | null; error: Error | null }

const mocks = vi.hoisted(() => ({
  /** Une tranche lue : `after` vaut l'id de curseur (null pour la première). */
  page: vi.fn<(after: string | null) => Promise<Page>>(),
  eq: vi.fn(),
  is: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function pageQuery(after: string | null) {
    return {
      gt: (_column: string, value: unknown) => pageQuery(String(value)),
      order: () => pageQuery(after),
      limit: () => mocks.page(after),
    };
  }
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: (column: string, value: unknown) => {
            mocks.eq(column, value);
            return {
              is: (c: string, v: unknown) => {
                mocks.is(c, v);
                return pageQuery(null);
              },
            };
          },
        }),
      }),
    },
  };
});
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: (ready: boolean) => ready }));

import {
  ALL_PRODUCT_MODIFIERS_KEY,
  invalidateProductModifiers,
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

const unsubscribers: (() => void)[] = [];
/** Observers comme dans l'app : ce sont eux que le push catalogue relit. */
function observe(client: QueryClient, productId: string, categoryId: string | null) {
  // Les options de l'app visent useQuery ; l'observer brut a une signature voisine.
  const options = productModifiersOptions({ productId, categoryId }) as unknown as QueryObserverOptions<ModifierGroup[]>;
  const observer = new QueryObserver<ModifierGroup[]>(client, options);
  unsubscribers.push(observer.subscribe(() => undefined));
  return observer;
}

beforeEach(() => {
  mocks.page.mockReset();
  mocks.eq.mockReset();
  mocks.is.mockReset();
  mocks.page.mockResolvedValue({ data: rows, error: null });
});
afterEach(() => { unsubscribers.splice(0).forEach((stop) => stop()); });

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
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(results[1]?.map((g) => g.group_name)).toEqual(['Size', 'Milk']);
    expect(results[2]?.map((g) => g.group_name)).toEqual(['Size', 'Milk']);
  });

  it('un push catalogue relit la liste une seule fois pour cinquante produits observés', async () => {
    const client = newClient();
    const observers = Array.from({ length: 50 }, (_, i) => observe(client, `p${i}`, null));
    await vi.waitFor(() => expect(observers.every((o) => o.getCurrentResult().isSuccess)).toBe(true));
    expect(mocks.page).toHaveBeenCalledTimes(1);

    await invalidateProductModifiers(client);
    expect(mocks.page).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(['product-modifiers', 'p7', null])?.dataUpdateCount).toBe(2);
  });

  it('un second push pendant une lecture en cours ne rend pas l’état d’avant', async () => {
    const before = [row('old', { product_id: 'p1' }, 'Old')];
    const after = [row('new', { product_id: 'p1' }, 'New')];
    let releaseFirst: (page: Page) => void = () => undefined;
    mocks.page.mockResolvedValueOnce({ data: before, error: null });
    const client = newClient();
    const observer = observe(client, 'p1', null);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.[0]?.group_name).toBe('Old'));

    // Premier push : la lecture F1 part et reste en vol (elle lira l'état d'avant).
    mocks.page.mockImplementationOnce(() => new Promise<Page>((resolve) => { releaseFirst = resolve; }));
    void invalidateProductModifiers(client);
    await vi.waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(2));

    // Second push pendant F1 : la relecture doit partir à neuf, pas rejoindre F1.
    mocks.page.mockResolvedValueOnce({ data: after, error: null });
    const second = invalidateProductModifiers(client);
    releaseFirst({ data: before, error: null });
    await second;

    expect(mocks.page).toHaveBeenCalledTimes(3);
    expect(observer.getCurrentResult().data?.[0]?.group_name).toBe('New');
    expect(client.getQueryData<ProductModifierRow[]>(ALL_PRODUCT_MODIFIERS_KEY)?.map((r) => r.id)).toEqual(['new']);
  });

  it('lit la liste par curseur quand elle dépasse une page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(`r${String(i).padStart(4, '0')}`, { product_id: 'big' }, `G${i}`));
    mocks.page.mockImplementation((afterId) => Promise.resolve({ data: afterId === null ? full : [row('z-last', { product_id: 'big' }, 'Last')], error: null }));
    const client = newClient();
    const groups = await client.fetchQuery(productModifiersOptions({ productId: 'big', categoryId: null }));
    expect(mocks.page.mock.calls.map((call) => call[0])).toEqual([null, 'r0999']);
    expect(groups).toHaveLength(1001);
  });

  it('remonte l’erreur réseau à la query du produit, sans nouvelle tentative partagée', async () => {
    mocks.page.mockResolvedValue({ data: null, error: new Error('boom') });
    const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
    await expect(client.fetchQuery({ ...productModifiersOptions({ productId: 'p1', categoryId: null }), retry: false })).rejects.toThrow('boom');
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });
});
