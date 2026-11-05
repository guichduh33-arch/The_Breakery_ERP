import { beforeEach, expect, it, vi } from 'vitest';
import { fetchPromotionVariants } from '../hooks/usePromotionVariants';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: () => true }));
beforeEach(() => mocks.rpc.mockReset());
it('returns every matching visible active variant across more than 100 parents', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => String(i));
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i), parent_product_id: ids[i % ids.length],
    is_active: true, visible_on_pos: true, variant_sort_order: i, track_inventory: true, current_stock: null,
    display_stock: { quantity: null }, is_sellable: true }));
  mocks.rpc.mockResolvedValue({ data: [...rows, { ...rows[0], id: 'hidden', visible_on_pos: false },
    { ...rows[0], id: 'inactive', is_active: false }, { ...rows[0], id: 'other', parent_product_id: 'other' }], error: null });
  expect(await fetchPromotionVariants(ids)).toEqual(rows);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it('propagates errors instead of publishing a partial catalogue', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
  await expect(fetchPromotionVariants(['p'])).rejects.toThrow('offline');
});
it('does not request a catalogue without promotion parents', async () => {
  expect(await fetchPromotionVariants([])).toEqual([]);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
