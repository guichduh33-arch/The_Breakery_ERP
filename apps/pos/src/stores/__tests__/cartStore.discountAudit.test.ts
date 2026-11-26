import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore } from '../cartStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));

// Journal 2026-11-26 : la remise était journalisée sans approbateur ni saisie
// (seul « authorized » subsistait). Le détail permet de relire qui a validé quoi.
describe('discount journal detail', () => {
  beforeEach(() => vi.mocked(emitPosEvent).mockClear());

  it('records the discount input and its approver on an order discount', () => {
    useCartStore.getState().setCartDiscount({
      type: 'percentage', value: 50, amount: 50000, reason: 'Staff meal', authorized_by: 'mgr-1',
    });
    expect(emitPosEvent).toHaveBeenLastCalledWith('discount_applied', {
      amount: 50000,
      reason: 'authorized',
      payload: {
        scope: 'order', type: 'percentage', value: 50, discount_reason: 'Staff meal', authorized_by: 'mgr-1',
      },
    });
  });

  it('keeps the removal event bare', () => {
    useCartStore.getState().setCartDiscount(null);
    expect(emitPosEvent).toHaveBeenLastCalledWith('discount_removed', { payload: { scope: 'order' } });
  });
});
