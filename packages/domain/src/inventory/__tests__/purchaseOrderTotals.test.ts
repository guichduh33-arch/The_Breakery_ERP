import { describe, expect, it } from 'vitest';
import { computePurchaseOrderTotals, receiptShare, splitProRataCents } from '../purchaseOrderTotals.js';

describe('receiptShare', () => {
  it('adds partial receipts up to the exact line share', () => {
    const first = receiptShare(100, 3, 0, 1);
    const second = receiptShare(100, 3, 1, 1);
    const third = receiptShare(100, 3, 2, 1);
    expect([first, second, third]).toEqual([33.33, 33.34, 33.33]);
    expect(Math.round((first + second + third) * 100)).toBe(10_000);
  });

  it('returns zero for a line with no ordered quantity', () => {
    expect(receiptShare(100, 0, 0, 1)).toBe(0);
  });
});

describe('splitProRataCents', () => {
  it('splits 30 000 IDR over three lines without losing a cent', () => {
    const shares = splitProRataCents(3_000_000, [10_000_000, 10_000_000, 10_000_100]);
    expect(shares).toEqual([999_997, 999_997, 1_000_006]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(3_000_000);
  });

  it('gives leftover cents by largest remainder, ties by rank', () => {
    expect(splitProRataCents(10_000, [1, 1, 1])).toEqual([3_334, 3_333, 3_333]);
  });

  it('splits equally when every weight is zero', () => {
    expect(splitProRataCents(1_000, [0, 0])).toEqual([500, 500]);
  });

  it('returns an empty list for no weights and refuses a negative amount', () => {
    expect(splitProRataCents(100, [])).toEqual([]);
    expect(() => splitProRataCents(-1, [1])).toThrow('split_amount_invalid');
  });
});

describe('computePurchaseOrderTotals', () => {
  it('adds the delivery fee to the total and to the line shares', () => {
    const t = computePurchaseOrderTotals({
      lines: [
        { quantity: 10, unitCost: 10_000 },
        { quantity: 5, unitCost: 20_000 },
        { quantity: 4, unitCost: 25_000.25 },
      ],
      deliveryFee: 30_000,
      vatRate: 0,
    });
    expect(t.total).toBe(330_001);
    expect(t.lines.map((l) => l.feeShare)).toEqual([9_999.97, 9_999.97, 10_000.06]);
    const sumCents = t.lines.reduce((a, l) => a + Math.round(l.lineTotal * 100), 0);
    expect(sumCents).toBe(Math.round(t.total * 100));
  });

  it('applies line and global discounts before VAT, and leaves the fee untaxed', () => {
    const t = computePurchaseOrderTotals({
      lines: [
        { quantity: 3, unitCost: 10_000, discountAmount: 1_000 },
        { quantity: 7, unitCost: 3_333.33 },
      ],
      discountAmount: 1_000,
      deliveryFee: 7_000,
      vatRate: 0.11,
    });
    expect(t.subtotal).toBe(52_333.31);
    expect(t.vatAmount).toBe(5_646.66);
    expect(t.total).toBe(63_979.97);
    const sum = (k: 'discountShare' | 'vatShare' | 'feeShare'): number =>
      t.lines.reduce((a, l) => a + Math.round(l[k] * 100), 0);
    expect(sum('discountShare')).toBe(100_000);
    expect(sum('vatShare')).toBe(564_666);
    expect(sum('feeShare')).toBe(700_000);
  });

  it('uses the stored VAT amount when one is given', () => {
    const t = computePurchaseOrderTotals({
      lines: [{ quantity: 1, unitCost: 1_000 }, { quantity: 1, unitCost: 1_000 }],
      vatRate: 0.11,
      vatAmount: 221,
    });
    expect(t.vatAmount).toBe(221);
    expect(t.lines.map((l) => l.vatShare)).toEqual([110.5, 110.5]);
  });

  it('caps a line discount at the line value and a global discount at the subtotal', () => {
    const t = computePurchaseOrderTotals({
      lines: [{ quantity: 1, unitCost: 100, discountAmount: 500 }, { quantity: 1, unitCost: 50 }],
      discountAmount: 1_000,
      vatRate: 0.11,
    });
    expect(t.lines[0]?.net).toBe(0);
    expect(t.discountAmount).toBe(50);
    expect(t.total).toBe(0);
  });
});
