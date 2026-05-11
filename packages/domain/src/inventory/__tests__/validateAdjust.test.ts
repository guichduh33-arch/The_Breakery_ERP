// packages/domain/src/inventory/__tests__/validateAdjust.test.ts

import { describe, expect, it } from 'vitest';
import { validateAdjust } from '../validateAdjust.js';

describe('validateAdjust', () => {
  it('rejects negative new qty', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: -1, reason: 'stock check' })).toEqual({
      ok: false,
      error: 'negative_qty_not_allowed',
    });
  });

  it('rejects NaN qty', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: Number.NaN, reason: 'stock check' })).toEqual({
      ok: false,
      error: 'negative_qty_not_allowed',
    });
  });

  it('rejects empty reason', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: 5, reason: '' })).toEqual({
      ok: false,
      error: 'reason_required',
    });
  });

  it('rejects reason < 3 chars after trim', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: 5, reason: '  a  ' })).toEqual({
      ok: false,
      error: 'reason_required',
    });
  });

  it('accepts zero qty with valid reason (clear-out)', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: 0, reason: 'shrinkage' })).toEqual({ ok: true });
  });

  it('accepts positive qty with valid reason', () => {
    expect(validateAdjust({ productId: 'p-1', newQty: 42, reason: 'physical count' })).toEqual({ ok: true });
  });
});
