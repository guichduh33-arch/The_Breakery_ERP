import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { getStationMap } from '@/features/cart/hooks/useStationMap';
import { supabase } from '@/lib/supabase';
import { SALE_SNAPSHOT_KEY, clearSaleSnapshot, restoreSaleSnapshot, saveSaleSnapshot } from '../offlineSaleSnapshot';

const identity = { project: 'dev', terminal: 'pos', user: 'cashier', session: 'session' };
const shift = { id: 'shift', opened_at: '2026-10-02T00:00:00Z', opening_cash: 100000 };
const product = { sku: 'SKU', name: 'Product', retail_price: 35000, wholesale_price: null,
  current_stock: 1, is_active: true, is_favorite: false, has_variants: false, is_sellable: true,
  track_inventory: false, image_url: null, dispatch_station: 'barista' };
const groups = [{ group_name: 'Temperature', group_sort_order: 0, group_required: true,
  group_type: 'single_select', options: [{ option_label: 'Hot', option_sort_order: 0, price_adjustment: 0, is_default: false }] }];
interface Stored { entries: { key: string[]; data: unknown; updatedAt: number }[] }
function completeCache() {
  const client = new QueryClient();
  client.setQueryData(['station-map'], { coffee: ['barista'], large: ['barista', 'display'], meal: ['kitchen'] });
  client.setQueryData(['promotions', 'active'], []);
  client.setQueryData(['products'], [
    { ...product, id: 'coffee', category_id: 'drinks', has_variants: true, product_type: 'finished' },
    { ...product, id: 'meal', category_id: 'food', product_type: 'combo' },
  ]);
  client.setQueryData(['categories'], ['drinks', 'food'].map((id) => ({ id, name: id, slug: id, sort_order: 0, is_active: true })));
  client.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.07, taxInclusive: false });
  client.setQueryData(['business-config', 'enabled-payment-methods'], ['cash', 'qris']);
  client.setQueryData(['pos-product-variants', 'coffee'], [{ id: 'large', name: 'Large coffee', retail_price: 40000,
    variant_label: 'Large', variant_axis: 'size', variant_sort_order: 0, is_active: true, current_stock: 1, deduct_stock: false }]);
  for (const [id, category] of [['coffee', 'drinks'], ['large', 'drinks'], ['meal', 'food']]) {
    client.setQueryData(['product-modifiers', id, category], groups);
  }
  client.setQueryData(['combo-config', 'meal'], { combo_product_id: 'meal', name: 'Meal', base_price: 50000,
    groups: [{ id: 'drink', name: 'Drink', group_type: 'single', is_required: true, min_select: 1, max_select: 1, sort_order: 0,
      options: [{ id: 'coffee', component_product_id: 'coffee', label: 'Coffee', surcharge: 0, is_default: false,
        sort_order: 0, component_modifier_groups: groups }] }] });
  return client;
}
beforeEach(() => sessionStorage.clear());
describe('sale snapshot', () => {
  it('serves the restored routing including variants to the real fire getter without cloud access', async () => {
    const source = completeCache();
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(true);
    const target = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, target, identity)).toEqual(shift);
    const from = vi.spyOn(supabase, 'from').mockImplementation(() => { throw new Error('cloud forbidden'); });
    try {
      expect(await getStationMap(target)).toEqual({ coffee: ['barista'], large: ['barista', 'display'], meal: ['kitchen'] });
      expect(from).not.toHaveBeenCalled();
    } finally { from.mockRestore(); }
  });
  it.each(['coffee', 'large'])('rejects a routing map missing catalogue entry %s', (id) => {
    const source = completeCache();
    const map = { ...source.getQueryData<Record<string, string[]>>(['station-map']) };
    delete map[id];
    source.setQueryData(['station-map'], map);
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(false);
    expect(saveSaleSnapshot(sessionStorage, completeCache(), identity, shift)).toBe(true);
    const snapshot = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as Stored;
    snapshot.entries.find((entry) => entry.key[0] === 'station-map')!.data = map;
    sessionStorage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    const target = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, target, identity)).toBeNull();
    expect(target.getQueryCache().getAll()).toHaveLength(0);
  });
  it.each([null, [], { coffee: null }, { coffee: ['unknown'] }, { coffee: 'barista' }])('rejects malformed routing %j', (data) => {
    const source = completeCache();
    source.setQueryData(['station-map'], data);
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(false);
  });
  it('restores the shift and complete catalogue into a fresh cache without fallback settings', () => {
    const source = completeCache();
    source.setQueryData(['customers'], [{ id: 'private' }]);
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(true);
    const target = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, target, identity)).toEqual(shift);
    expect(target.getQueryData(['business-config', 'tax-config'])).toEqual({ taxRate: 0.07, taxInclusive: false });
    expect(target.getQueryData(['business-config', 'enabled-payment-methods'])).toEqual(['cash', 'qris']);
    expect(target.getQueryData(['product-modifiers', 'large', 'drinks'])).toBeDefined();
    expect(target.getQueryData(['combo-config', 'meal'])).toEqual(source.getQueryData(['combo-config', 'meal']));
    expect(target.getQueryData(['customers'])).toBeUndefined();
  });
  it.each([
    ['product-modifiers', 'large', 'drinks'], ['combo-config', 'meal'], ['business-config', 'tax-config'], ['station-map'],
  ])('does not save a partial preload: %s', (...key) => {
    const source = completeCache();
    source.removeQueries({ queryKey: key, exact: true });
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(false);
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
  });
  it('preserves explicit disabled payments', () => {
    const source = completeCache();
    source.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: false });
    saveSaleSnapshot(sessionStorage, source, identity, shift);
    const target = new QueryClient();
    restoreSaleSnapshot(sessionStorage, target, identity);
    expect(target.getQueryData(['business-config', 'offline-network'])).toEqual({ offlinePaymentsEnabled: false });
  });
  it.each(['project', 'terminal', 'user', 'session'])('rejects a different %s', (field) => {
    saveSaleSnapshot(sessionStorage, completeCache(), identity, shift);
    const target = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, target, { ...identity, [field]: 'different' })).toBeNull();
    expect(target.getQueryCache().getAll()).toHaveLength(0);
  });
  it('rejects malformed or incomplete stored data before hydrating', () => {
    sessionStorage.setItem(SALE_SNAPSHOT_KEY, '{');
    const target = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, target, identity)).toBeNull();
    saveSaleSnapshot(sessionStorage, completeCache(), identity, shift);
    const snapshot = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as Stored;
    snapshot.entries.pop();
    sessionStorage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    expect(restoreSaleSnapshot(sessionStorage, target, identity)).toBeNull();
    expect(target.getQueryCache().getAll()).toHaveLength(0);
  });
  it('reports storage quota failure and clears only the snapshot on invalidation', () => {
    const unavailable = { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } as unknown as Storage;
    expect(saveSaleSnapshot(unavailable, completeCache(), identity, shift)).toBe(false);
    sessionStorage.setItem('other-state', 'preserved');
    saveSaleSnapshot(sessionStorage, completeCache(), identity, shift);
    clearSaleSnapshot(sessionStorage);
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
    expect(sessionStorage.getItem('other-state')).toBe('preserved');
  });
  it.each([null, {}, [{}], ['invalid'], [{ ...groups[0], options: null }], [{ ...groups[0], group_required: 'yes' }]].map((data) => ({ data })))(
    'rejects malformed modifier data before hydrating any query ($data)', ({ data }) => {
      expect(saveSaleSnapshot(sessionStorage, completeCache(), identity, shift)).toBe(true);
      const snapshot = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as Stored;
      snapshot.entries.find((entry) => entry.key[0] === 'product-modifiers')!.data = data;
      sessionStorage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify(snapshot));
      const target = new QueryClient();
      expect(restoreSaleSnapshot(sessionStorage, target, identity)).toBeNull();
      expect(target.getQueryCache().getAll()).toHaveLength(0);
    },
  );
  it.each(['products', 'categories', 'pos-product-variants', 'combo-config', 'business-config', 'station-map'])(
    'rejects malformed %s before hydrating', (family) => {
      saveSaleSnapshot(sessionStorage, completeCache(), identity, shift);
      const snapshot = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as Stored;
      snapshot.entries.find((entry) => entry.key[0] === family)!.data = [{}];
      sessionStorage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify(snapshot));
      const target = new QueryClient();
      expect(restoreSaleSnapshot(sessionStorage, target, identity)).toBeNull();
      expect(target.getQueryCache().getAll()).toHaveLength(0);
    },
  );
});
