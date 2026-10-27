import { describe, expect, it } from 'vitest';
import { computeRefundBreakdown } from '../computeRefund.js';
import { validateRefundDraft } from '../validateRefund.js';
import type { RefundableItem } from '../types.js';

const item = (id = 'a', amount = 100_000, quantity = 1, refunded = 0): RefundableItem => ({
  order_item_id: id, line_total: amount, quantity, qty_already_refunded: refunded, is_cancelled: false,
});
const context = { order_total: 90_000, prior_refunds_total: 0, points_redeemed: 1000 };

describe('refund of a sale with redeemed loyalty points', () => {
  it('returns the amount actually paid and the redeemed points for a full return', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }], new Map([['a', item()]]), context);
    expect(quote.total).toBe(90_000);
    expect(quote.points_restored).toBe(1000);
    expect(quote.line_amounts.get('a')).toBe(90_000);
  });

  it('preserves both totals over three separate returns, including the last point', () => {
    let money = 0;
    let points = 0;
    for (let returned = 0; returned < 3; returned++) {
      const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }],
        new Map([['a', item('a', 100_000, 3, returned)]]), { ...context, prior_refunds_total: money });
      expect(quote.total).toBe(30_000);
      expect(quote.points_restored).toBe(returned === 2 ? 334 : 333);
      money += quote.total;
      points += quote.points_restored;
    }
    expect({ money, points }).toEqual({ money: 90_000, points: 1000 });
  });

  it('keeps an exact final monetary remainder from a historical unrounded payment', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }],
      new Map([['a', item('a', 100_000, 3, 2)]]),
      { ...context, order_total: 90_001, prior_refunds_total: 60_000 });
    expect(quote.total).toBe(30_001);
    expect(quote.points_restored).toBe(334);
  });

  it('carries currency rounding between partial returns instead of rounding each independently', () => {
    let money = 0;
    const amounts: number[] = [];
    for (let returned = 0; returned < 3; returned++) {
      const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }],
        new Map([['a', item('a', 300_000, 3, returned)]]),
        { ...context, order_total: 290_000, prior_refunds_total: money });
      amounts.push(quote.total);
      money += quote.total;
    }
    expect(amounts).toEqual([96_700, 96_600, 96_700]);
    expect(money).toBe(290_000);
  });

  it('excludes cancelled lines and gives a free gift no monetary or points weight', () => {
    const items = new Map([['a', item()], ['gift', item('gift', 0)],
      ['cancelled', { ...item('cancelled', 500_000), is_cancelled: true }]]);
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }], items,
      { ...context, order_total: 90_001 });
    expect(quote.total).toBe(90_001);
    expect(quote.points_restored).toBe(1000);
  });

  it('allocates line amounts so their sum equals the net tender total', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }, { order_item_id: 'b', qty: 1 }],
      new Map([['a', item('a', 33_333)], ['b', item('b', 66_667)]]), context);
    expect([...quote.line_amounts.values()]).toEqual([30_000, 60_000]);
    expect([...quote.line_amounts.values()].reduce((a, b) => a + b, 0)).toBe(quote.total);
    expect(quote.points_restored).toBe(1000);
  });

  it('does not retroactively restore points for lines refunded by an older implementation', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }],
      new Map([['a', item('a', 100_000, 2, 1)]]), { ...context, prior_refunds_total: 50_000 });
    expect(quote.total).toBe(40_000);
    expect(quote.points_restored).toBe(500);
  });

  it('uses the same millesimal quantity as SQL before allocating currency and points', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 0.3335 }], new Map([['a', item()]]), context);
    expect(quote.total).toBe(30_100);
    expect(quote.points_restored).toBe(334);
  });

  it('accepts the exact last tenth despite floating subtraction of 1 minus 0.9', () => {
    expect(validateRefundDraft({ draft_lines: [{ order_item_id: 'a', qty: 0.1 }],
      draft_tenders: [{ method: 'cash', amount: 9000 }], reason: 'Final fractional return',
      items_by_id: new Map([['a', item('a', 100000, 1, 0.9)]]), order_total: 90000,
      prior_refunds_total: 81000, loyalty_points_redeemed: 1000,
      method_ledger: [{ method: 'cash', paid: 90000, refunded: 81000 }] }))
      .toEqual({ ok: true, refund_total: 9000 });
  });

  it('allows a final points-only return after currency rounding consumed the monetary balance', () => {
    const items = new Map([['a', item('a', 10_000, 1, 0.999)]]);
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 0.001 }], items,
      { order_total: 9000, prior_refunds_total: 9000, points_redeemed: 100 });
    expect(quote.total).toBe(0);
    expect(quote.points_restored).toBe(1);
    expect(validateRefundDraft({ draft_lines: [{ order_item_id: 'a', qty: 0.001 }], draft_tenders: [],
      reason: 'Final return', items_by_id: items, order_total: 9000, prior_refunds_total: 9000,
      loyalty_points_redeemed: 100, method_ledger: [] })).toEqual({ ok: true, refund_total: 0 });
  });

  it('validates net tenders while rejecting the gross tender amount', () => {
    const input = {
      draft_lines: [{ order_item_id: 'a', qty: 1 }], reason: 'Customer return',
      items_by_id: new Map([['a', item()]]), order_total: 90_000, prior_refunds_total: 0,
      loyalty_points_redeemed: 1000,
      method_ledger: [{ method: 'cash' as const, paid: 90_000, refunded: 0 }],
    };
    expect(validateRefundDraft({ ...input, draft_tenders: [{ method: 'cash', amount: 90_000 }] }))
      .toEqual({ ok: true, refund_total: 90_000 });
    expect(validateRefundDraft({ ...input, draft_tenders: [{ method: 'cash', amount: 100_000 }] }).ok).toBe(false);
  });

  it('keeps the original calculation for a sale without redeemed points', () => {
    const quote = computeRefundBreakdown([{ order_item_id: 'a', qty: 1 }], new Map([['a', item()]]),
      { ...context, points_redeemed: 0 });
    expect(quote.total).toBe(100_000);
    expect(quote.points_restored).toBe(0);
  });

  it('refuses invalid, duplicate or excessive selections instead of estimating a payment', () => {
    const items = new Map([['a', item()]]);
    for (const draft of [[{ order_item_id: 'missing', qty: 1 }], [{ order_item_id: 'a', qty: 2 }],
      [{ order_item_id: 'a', qty: 1 }, { order_item_id: 'a', qty: 1 }]]) {
      expect(Number.isNaN(computeRefundBreakdown(draft, items, context).total)).toBe(true);
    }
  });
});
