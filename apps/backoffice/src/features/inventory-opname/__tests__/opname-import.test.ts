import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: mock }));
import { importCountRows, loadCountProducts } from '../opnameImport.js';

const products = [{ id: 'a', sku: '001', name: 'Flour', unit: 'kg' }];
const row = { productId: 'a', sku: '001', unit: 'kg', quantity: 0, notes: '' };
function setup(items: { id: string; product_id: string; unit: string }[] = []) {
  mock.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'get_opname_items_v1' ? { data: items, error: null } : { error: null }));
  mock.from.mockImplementation((table: string) => {
    const result = { data: table === 'products' ? products : items, error: null };
    const builder = {
      select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue(result),
    };
    return builder;
  });
}
beforeEach(() => { vi.resetAllMocks(); setup(); });
describe('opname import RPC orchestration', () => {
  it('fetches tracked inventory with pagination', async () => {
    expect(await loadCountProducts()).toEqual(products);
    const query = mock.from.mock.results[0]?.value as { eq: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn> };
    expect(query.eq).toHaveBeenCalledWith('track_inventory', true);
    expect(query.range).toHaveBeenCalledWith(0, 499);
  });
  it('adds new items then records zero without overriding expected stock', async () => {
    mock.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'get_opname_items_v1' ? [] : fn === 'add_opname_item_v3' ? { item_id: 'item' } : null, error: null }));
    const saved = vi.fn();
    await importCountRows('count', [row], saved);
    expect(mock.rpc.mock.calls).toEqual([
      ['get_opname_items_v1', { p_count_id: 'count' }],
      ['add_opname_item_v3', { p_count_id: 'count', p_product_id: 'a' }],
      ['set_opname_count_v3', { p_count_item_id: 'item', p_counted_qty: 0, p_notes: '' }],
    ]);
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it('reuses existing items on retry without resetting expected stock', async () => {
    setup([{ id: 'item', product_id: 'a', unit: 'kg' }]);
    await importCountRows('count', [row], vi.fn());
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(mock.rpc.mock.calls[1]?.[0]).toBe('set_opname_count_v3');
  });
  it('rejects a changed item unit before any write', async () => {
    setup([{ id: 'item', product_id: 'a', unit: 'g' }]);
    await expect(importCountRows('count', [row], vi.fn())).rejects.toThrow('unit changed');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0]?.[0]).toBe('get_opname_items_v1');
  });
  it('stops on server rejection and does not mark the failed row saved', async () => {
    setup([{ id: 'item', product_id: 'a', unit: 'kg' }]);
    mock.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'get_opname_items_v1' ? { data: [{ id: 'item', product_id: 'a', unit: 'kg' }], error: null } : { error: { message: 'set_count_not_allowed_in_status' } }));
    const saved = vi.fn();
    await expect(importCountRows('count', [row, row], saved)).rejects.toThrow('set_count_not_allowed_in_status');
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(saved).not.toHaveBeenCalled();
  });
});
