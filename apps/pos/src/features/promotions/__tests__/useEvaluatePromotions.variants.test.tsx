import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Product, Promotion } from '@breakery/domain';
import { useEvaluatePromotions } from '../hooks/useEvaluatePromotions';
import { restoreSaleSnapshot, saveSaleSnapshot } from '@/features/lan/offlineSaleSnapshot';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, supabaseUrl: 'https://test.invalid' }));
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: () => false }));

const parent: Product = { id: 'parent', sku: 'COFFEE', name: 'Coffee', category_id: 'drinks', retail_price: 30000,
  wholesale_price: null, product_type: 'finished', image_url: null, current_stock: 1, is_active: true, is_favorite: false,
  has_variants: true, is_sellable: true, track_inventory: false, dispatch_station: 'barista' };
const variant = { id: 'large', name: 'Large coffee', retail_price: 35000, variant_label: 'Large', variant_axis: 'size',
  variant_sort_order: 0, is_active: true, current_stock: 1, deduct_stock: false };
const identity = { project: 'dev', terminal: 'pos', user: 'cashier', session: 'session' };
const shift = { id: 'shift', opened_at: '2026-10-02T00:00:00Z', opening_cash: 0 };

function restoredCache(category: string) {
  const source = new QueryClient();
  const promo: Promotion = { id: 'promo', name: 'Ten percent', slug: 'ten', description: null, type: 'percentage', scope: 'category',
    discount_value: 10, max_discount_amount: null, scope_product_ids: [], scope_category_ids: [category],
    bogo_trigger_product_ids: [], bogo_reward_product_ids: [], bogo_trigger_qty: null, bogo_reward_qty: null,
    bogo_reward_discount_pct: null, gift_product_id: null, gift_qty: 1, min_items_total: 0,
    customer_category_ids: [], customer_tier_ids: [], start_at: null, end_at: null, day_of_week_mask: 127,
    start_hour: null, end_hour: null, priority: 1, stackable_with_promo: true, stackable_with_manual: true,
    is_active: true, created_at: '2026-10-02T00:00:00Z' };
  source.setQueryData(['products'], [parent]);
  source.setQueryData(['station-map'], { parent: ['barista'], large: ['barista'] });
  source.setQueryData(['categories'], [{ id: 'drinks', name: 'Drinks', slug: 'drinks', sort_order: 0, is_active: true }]);
  source.setQueryData(['pos-product-variants', 'parent'], [variant]);
  source.setQueryData(['product-modifiers', 'parent', 'drinks'], []);
  source.setQueryData(['product-modifiers', 'large', 'drinks'], []);
  source.setQueryData(['promotions', 'active'], [promo]);
  source.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  source.setQueryData(['business-config', 'tax-config'], { taxRate: 0.1, taxInclusive: true });
  source.setQueryData(['business-config', 'enabled-payment-methods'], ['cash']);
  expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(true);
  const target = new QueryClient();
  expect(restoreSaleSnapshot(sessionStorage, target, identity)).toEqual(shift);
  return target;
}
beforeEach(() => {
  sessionStorage.clear();
  rpc.mockReset().mockRejectedValue(new TypeError('cloud unavailable'));
});

it.each(['drinks', 'other'])('evaluates a category promotion on a restored variant (%s)', async (category) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const client = restoredCache(category);
  const { result } = renderHook(() => useEvaluatePromotions(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  expect(result.current.catalog.productCategory.large).toBe('drinks');
  expect(result.current.catalog.productPrice.large).toBe(35000);
  const applied = await result.current.runEvaluation({ order_type: 'take_out', items: [
    { id: 'line', product_id: 'large', name: 'Large coffee', unit_price: 35000, quantity: 1, modifiers: [] },
  ] }, null);
  expect(rpc).toHaveBeenCalled();
  expect(applied).toEqual(category === 'drinks'
    ? [expect.objectContaining({ promotion_id: 'promo', amount: 3500 })] : []);
  act(() => {
    client.setQueryData(['pos-product-variants', 'parent'], [{ ...variant, retail_price: 40000 }]);
  });
  await waitFor(() => expect(result.current.catalog.productPrice.large).toBe(40000));
  warn.mockRestore();
});
