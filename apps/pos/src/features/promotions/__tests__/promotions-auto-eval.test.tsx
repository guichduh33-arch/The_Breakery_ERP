import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartStore } from '@/stores/cartStore';
import { usePromotionsAutoEval } from '../hooks/usePromotionsAutoEval';

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), apply: vi.fn(), promotions: [{}], products: [] }));
vi.mock('../hooks/useEvaluatePromotions', () => ({ useEvaluatePromotions: () => ({ promotions: mocks.promotions, runEvaluation: mocks.evaluate }) }));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: mocks.products }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
const item = { id: 'line', product_id: 'p', name: 'P', quantity: 1, unit_price: 100, modifiers: [] };
beforeEach(() => {
  vi.useFakeTimers();
  mocks.evaluate.mockReset(); mocks.apply.mockReset().mockReturnValue({ addedGifts: [], removedGifts: [] });
  useCartStore.setState({ cart: { items: [item], order_type: 'dine_in' }, attachedCustomer: null, dismissedPromotionIds: new Set(), setAppliedPromotions: mocks.apply } as never);
});
afterEach(() => vi.useRealTimers());

it('does not reevaluate for promotion results or gift lines', async () => {
  mocks.evaluate.mockResolvedValue([]);
  renderHook(() => usePromotionsAutoEval());
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  expect(mocks.evaluate).toHaveBeenCalledTimes(1);
  await act(async () => { useCartStore.setState({ cart: { ...useCartStore.getState().cart, promotionTotal: 50, items: [item, { ...item, id: 'gift', is_promo_gift: true }] } }); await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  expect(mocks.evaluate).toHaveBeenCalledTimes(1);
});

it('ignores a response after the cart changes or the hook unmounts', async () => {
  let resolve!: (value: []) => void;
  mocks.evaluate.mockImplementation(() => new Promise<[]>((done) => { resolve = done; }));
  const { unmount } = renderHook(() => usePromotionsAutoEval());
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  await act(async () => { useCartStore.setState({ cart: { ...useCartStore.getState().cart, items: [{ ...item, quantity: 2 }] } }); await Promise.resolve(); });
  await act(async () => { resolve([]); await Promise.resolve(); });
  expect(mocks.apply).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  unmount();
  await act(async () => { resolve([]); await Promise.resolve(); });
  expect(mocks.apply).not.toHaveBeenCalled();
});

it('keeps the latest customer result when responses arrive in reverse order', async () => {
  const resolvers: ((value: []) => void)[] = [];
  mocks.evaluate.mockImplementation(() => new Promise<[]>((done) => resolvers.push(done)));
  useCartStore.setState({ attachedCustomer: { id: 'a', name: 'A' } } as never);
  renderHook(() => usePromotionsAutoEval());
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  await act(async () => { useCartStore.setState({ attachedCustomer: { id: 'b', name: 'B' } } as never); await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
  await act(async () => { resolvers[1]!([]); await Promise.resolve(); });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  await act(async () => { resolvers[0]!([]); await Promise.resolve(); });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});
