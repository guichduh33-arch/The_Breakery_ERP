import { describe, it, expect } from 'vitest';
import { ORDER_TYPE_LABELS, orderTypeLabel } from '../orderTypeLabel';

describe('orderTypeLabel', () => {
  it('maps every order_type DB enum member to a human label', () => {
    // DB enum order_type = dine_in | take_out | delivery | b2b
    // (domain OrderType is only 3-member — see DEV-S36-B-01 — so the labels are
    // keyed on an explicit 4-member union to cover b2b too).
    expect(ORDER_TYPE_LABELS.dine_in).toBe('Dine-in');
    expect(ORDER_TYPE_LABELS.take_out).toBe('Takeaway');
    expect(ORDER_TYPE_LABELS.delivery).toBe('Delivery');
    expect(ORDER_TYPE_LABELS.b2b).toBe('B2B');
    expect(Object.keys(ORDER_TYPE_LABELS)).toHaveLength(4);
  });

  it('resolves known values', () => {
    expect(orderTypeLabel('take_out')).toBe('Takeaway');
    expect(orderTypeLabel('dine_in')).toBe('Dine-in');
    expect(orderTypeLabel('b2b')).toBe('B2B');
  });

  it('falls back to the raw string for unknown values (no crash on drift)', () => {
    expect(orderTypeLabel('weird_value')).toBe('weird_value');
    expect(orderTypeLabel('')).toBe('');
  });
});
