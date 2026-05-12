// packages/domain/src/inventory/__tests__/validateWaste.test.ts

import { describe, expect, it } from 'vitest';
import { validateWaste } from '../validateWaste.js';

describe('validateWaste', () => {
  it('rejects qty > currentStock', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: 10, reason: 'expired', currentStock: 5 }),
    ).toEqual({ ok: false, error: 'insufficient_stock' });
  });

  it('rejects qty = 0', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: 0, reason: 'expired', currentStock: 5 }),
    ).toEqual({ ok: false, error: 'quantity_must_be_positive' });
  });

  it('rejects negative qty', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: -2, reason: 'expired', currentStock: 5 }),
    ).toEqual({ ok: false, error: 'quantity_must_be_positive' });
  });

  it('rejects reason < 3 chars', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: 1, reason: 'no', currentStock: 5 }),
    ).toEqual({ ok: false, error: 'reason_required' });
  });

  it('accepts qty = currentStock (full waste)', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: 5, reason: 'expired batch', currentStock: 5 }),
    ).toEqual({ ok: true });
  });

  it('accepts valid partial waste', () => {
    expect(
      validateWaste({ productId: 'p-1', quantity: 2, reason: 'dropped tray', currentStock: 10 }),
    ).toEqual({ ok: true });
  });
});
