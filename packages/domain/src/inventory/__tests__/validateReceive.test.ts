// packages/domain/src/inventory/__tests__/validateReceive.test.ts

import { describe, expect, it } from 'vitest';
import { validateReceive } from '../validateReceive.js';

describe('validateReceive', () => {
  it('rejects qty = 0', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 0, supplierId: 's-1' })).toEqual({
      ok: false,
      error: 'quantity_must_be_positive',
    });
  });

  it('rejects negative qty', () => {
    expect(validateReceive({ productId: 'p-1', quantity: -10, supplierId: 's-1' })).toEqual({
      ok: false,
      error: 'quantity_must_be_positive',
    });
  });

  it('rejects missing supplier (empty string)', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: '' })).toEqual({
      ok: false,
      error: 'supplier_required',
    });
  });

  it('rejects negative unit cost', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: 's-1', unitCost: -100 })).toEqual({
      ok: false,
      error: 'negative_unit_cost',
    });
  });

  it('accepts unit cost = 0 (free sample)', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: 's-1', unitCost: 0 })).toEqual({ ok: true });
  });

  it('accepts undefined unit cost (legacy supplier with no cost)', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: 's-1' })).toEqual({ ok: true });
  });

  it('rejects reason that is non-empty but too short', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: 's-1', reason: 'ab' })).toEqual({
      ok: false,
      error: 'reason_too_short',
    });
  });

  it('accepts empty-string reason (treated as no reason)', () => {
    expect(validateReceive({ productId: 'p-1', quantity: 5, supplierId: 's-1', reason: '' })).toEqual({ ok: true });
  });

  it('accepts full valid input with reason', () => {
    expect(
      validateReceive({
        productId: 'p-1',
        quantity: 12,
        supplierId: 's-1',
        unitCost: 2500,
        reason: 'weekly restock',
      }),
    ).toEqual({ ok: true });
  });
});
