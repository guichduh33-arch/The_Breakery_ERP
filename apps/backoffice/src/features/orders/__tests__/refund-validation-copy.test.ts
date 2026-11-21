// Jetons de validateRefundDraft → phrases lisibles, jamais d'UUID ni de jeton.
import { describe, expect, it } from 'vitest';
import { refundBlocker, refundValidationText, type RefundBlockerFacts } from '../refundValidationCopy.js';

const ITEM = '7f2c1c1e-0000-4000-8000-000000000001';
const nameOf = (id: string): string | undefined => (id === ITEM ? 'Croissant' : undefined);

describe('refundValidationText', () => {
  it('names the product and the remaining quantity, never the line id', () => {
    const text = refundValidationText({ ok: false, error: 'qty_exceeds_remaining', detail: `${ITEM} max=1` }, nameOf);
    expect(text).toBe('Croissant: only 1 left to refund.');
    expect(text).not.toContain(ITEM);
  });

  it('names the method and the amount left on a tender overflow', () => {
    const text = refundValidationText({ ok: false, error: 'tender_method_overflow', detail: 'method=qris avail=20000 requested=30000' }, nameOf);
    expect(text).toMatch(/^QRIS has only Rp\s?20\.000 left to refund\.$/);
  });

  it('never shows a raw token or technical detail', () => {
    const codes = ['no_lines', 'no_tenders', 'reason_too_short', 'unknown_item', 'item_cancelled', 'qty_invalid',
      'cap_exceeded', 'tender_amount_invalid', 'tender_sum_mismatch'] as const;
    for (const error of codes) {
      const text = refundValidationText({ ok: false, error, detail: `${ITEM} prior=1 new=2 > order=3` }, () => undefined);
      expect(text).not.toMatch(/_|prior=|[0-9a-f]{8}-/);
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

describe('refundBlocker', () => {
  const ready: RefundBlockerFacts = { allowed: true, busy: false, pending: false, hasLines: true, pointsOnly: false,
    hasDestination: true, reasonOk: true, pinOk: true, validationShown: false };

  it('says what is missing, in screen order', () => {
    expect(refundBlocker({ ...ready, hasLines: false, reasonOk: false, pinOk: false })).toBe('Select at least one line to refund.');
    expect(refundBlocker({ ...ready, hasDestination: false })).toBe('Choose a refund destination.');
    expect(refundBlocker({ ...ready, hasDestination: false, pointsOnly: true })).toBeNull();
    expect(refundBlocker({ ...ready, reasonOk: false, pinOk: false })).toBe('Enter a reason (at least 3 characters).');
    expect(refundBlocker({ ...ready, pinOk: false })).toBe('Enter the 6-digit manager PIN.');
    expect(refundBlocker({ ...ready, allowed: false })).toMatch(/permission/);
  });

  it('stays silent when another message already explains it, or nothing is missing', () => {
    expect(refundBlocker(ready)).toBeNull();
    expect(refundBlocker({ ...ready, busy: true, pinOk: false })).toBeNull();
    expect(refundBlocker({ ...ready, validationShown: true, reasonOk: false })).toBeNull();
  });

  it('asks only for the PIN on a pending attempt', () => {
    expect(refundBlocker({ ...ready, pending: true, hasLines: false, pinOk: false })).toMatch(/pending refund/);
    expect(refundBlocker({ ...ready, pending: true, hasLines: false })).toBeNull();
  });
});
