import { beforeEach, expect, it, vi } from 'vitest';
import { fetchPromotionVariants } from '../hooks/usePromotionVariants';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/lan/hooks/useSaleQueryEnabled', () => ({ useSaleQueryEnabled: () => true }));

beforeEach(() => mocks.from.mockReset());

it('chunks parents by 100, paginates variants and applies sale visibility filters', async () => {
  const pages = [Array.from({ length: 500 }, (_, i) => ({ id: String(i) })), [{ id: 'last' }], []];
  const builder = {
    select: vi.fn().mockReturnThis(), in: vi.fn<(column: string, ids: string[]) => unknown>().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockImplementation(() => Promise.resolve({ data: pages.shift(), error: null })),
  };
  mocks.from.mockReturnValue(builder);
  const ids = Array.from({ length: 101 }, (_, i) => String(i));
  expect(await fetchPromotionVariants(ids)).toHaveLength(501);
  expect(builder.in.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 1]);
  expect(builder.range.mock.calls).toEqual([[0, 499], [500, 999], [0, 499]]);
  expect(builder.eq).toHaveBeenCalledWith('is_active', true);
  expect(builder.eq).toHaveBeenCalledWith('visible_on_pos', true);
  expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
  expect(builder.order).toHaveBeenCalledWith('id', { ascending: true });
});

it('propagates errors instead of publishing a partial catalog', async () => {
  const builder = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: null, error: new Error('offline') }) };
  mocks.from.mockReturnValue(builder);
  await expect(fetchPromotionVariants(['p'])).rejects.toThrow('offline');
});
