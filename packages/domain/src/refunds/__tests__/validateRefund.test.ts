// packages/domain/src/refunds/__tests__/validateRefund.test.ts

import { describe, expect, it } from 'vitest';
import { validateRefundDraft } from '../validateRefund.js';
import type { RefundableItem, MethodLedgerEntry, RefundLineDraft, RefundTender } from '../types.js';

const baseItems = (): Map<string, RefundableItem> => new Map([
  ['oi-1', { order_item_id: 'oi-1', quantity: 2, line_total: 60_000, qty_already_refunded: 0, is_cancelled: false }],
  ['oi-2', { order_item_id: 'oi-2', quantity: 1, line_total: 40_000, qty_already_refunded: 0, is_cancelled: false }],
]);

const baseLedger: MethodLedgerEntry[] = [
  { method: 'cash', paid: 60_000, refunded: 0 },
  { method: 'card', paid: 40_000, refunded: 0 },
];

const valid = (
  draft_lines: RefundLineDraft[],
  draft_tenders: RefundTender[],
  overrides: Partial<Parameters<typeof validateRefundDraft>[0]> = {},
) =>
  validateRefundDraft({
    draft_lines,
    draft_tenders,
    reason: 'customer return',
    items_by_id: baseItems(),
    order_total: 100_000,
    prior_refunds_total: 0,
    method_ledger: baseLedger,
    ...overrides,
  });

describe('validateRefundDraft', () => {
  it('rejects no lines', () => {
    expect(valid([], [{ method: 'cash', amount: 10_000 }])).toMatchObject({ ok: false, error: 'no_lines' });
  });
  it('rejects no tenders', () => {
    expect(valid([{ order_item_id: 'oi-1', qty: 1 }], [])).toMatchObject({ ok: false, error: 'no_tenders' });
  });
  it('rejects short reason', () => {
    expect(valid([{ order_item_id: 'oi-1', qty: 1 }], [{ method: 'cash', amount: 30_000 }], { reason: 'no' }))
      .toMatchObject({ ok: false, error: 'reason_too_short' });
  });
  it('rejects unknown item', () => {
    expect(valid([{ order_item_id: 'oi-X', qty: 1 }], [{ method: 'cash', amount: 30_000 }]))
      .toMatchObject({ ok: false, error: 'unknown_item' });
  });
  it('rejects cancelled item', () => {
    const items = baseItems();
    items.set('oi-1', { ...items.get('oi-1')!, is_cancelled: true });
    expect(valid([{ order_item_id: 'oi-1', qty: 1 }], [{ method: 'cash', amount: 30_000 }], { items_by_id: items }))
      .toMatchObject({ ok: false, error: 'item_cancelled' });
  });
  it('rejects qty <= 0', () => {
    expect(valid([{ order_item_id: 'oi-1', qty: 0 }], [{ method: 'cash', amount: 0 }]))
      .toMatchObject({ ok: false, error: 'qty_invalid' });
  });
  it('rejects qty exceeding remaining (minus already refunded)', () => {
    const items = baseItems();
    items.set('oi-1', { ...items.get('oi-1')!, qty_already_refunded: 1 });
    expect(valid([{ order_item_id: 'oi-1', qty: 2 }], [{ method: 'cash', amount: 60_000 }], { items_by_id: items }))
      .toMatchObject({ ok: false, error: 'qty_exceeds_remaining' });
  });
  it('rejects cap exceeded', () => {
    expect(valid(
      [{ order_item_id: 'oi-1', qty: 2 }, { order_item_id: 'oi-2', qty: 1 }],
      [{ method: 'cash', amount: 60_000 }, { method: 'card', amount: 40_000 }],
      { prior_refunds_total: 50_000 },
    )).toMatchObject({ ok: false, error: 'cap_exceeded' });
  });
  it('rejects tender method overflow', () => {
    expect(valid(
      [{ order_item_id: 'oi-1', qty: 2 }],
      [{ method: 'card', amount: 60_000 }],
    )).toMatchObject({ ok: false, error: 'tender_method_overflow' });
  });
  it('rejects tender sum mismatch', () => {
    expect(valid(
      [{ order_item_id: 'oi-1', qty: 1 }],  // refund_total = 30_000
      [{ method: 'cash', amount: 25_000 }],
    )).toMatchObject({ ok: false, error: 'tender_sum_mismatch' });
  });
  it('accepts valid single-line single-tender', () => {
    const r = valid(
      [{ order_item_id: 'oi-1', qty: 1 }],     // 30_000
      [{ method: 'cash', amount: 30_000 }],
    );
    expect(r).toEqual({ ok: true, refund_total: 30_000 });
  });
  it('accepts valid multi-line multi-tender within ledger limits', () => {
    const r = valid(
      [{ order_item_id: 'oi-1', qty: 2 }, { order_item_id: 'oi-2', qty: 1 }],
      [{ method: 'cash', amount: 60_000 }, { method: 'card', amount: 40_000 }],
    );
    expect(r).toEqual({ ok: true, refund_total: 100_000 });
  });
});
