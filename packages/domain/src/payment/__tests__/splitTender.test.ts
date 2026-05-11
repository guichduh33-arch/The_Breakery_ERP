// packages/domain/src/payment/__tests__/splitTender.test.ts
// Session 10 — splitTender helpers.

import { describe, expect, it } from 'vitest';
import { computeRemaining, sumTenders, validateTenders, MAX_TENDERS } from '../splitTender.js';
import type { Tender } from '../../types/index.js';

const cash = (amount: number, cash_received?: number): Tender =>
  cash_received === undefined ? { method: 'cash', amount } : { method: 'cash', amount, cash_received };
const card = (amount: number): Tender => ({ method: 'card', amount });

describe('sumTenders', () => {
  it('returns 0 for empty', () => {
    expect(sumTenders([])).toBe(0);
  });
  it('sums multi-tender', () => {
    expect(sumTenders([cash(60_000), card(40_000)])).toBe(100_000);
  });
});

describe('computeRemaining', () => {
  it('positive when under', () => {
    expect(computeRemaining(100_000, [cash(60_000)])).toBe(40_000);
  });
  it('zero when exact', () => {
    expect(computeRemaining(100_000, [cash(60_000), card(40_000)])).toBe(0);
  });
  it('clamps to zero on overage', () => {
    expect(computeRemaining(100_000, [cash(120_000)])).toBe(0);
  });
});

describe('validateTenders', () => {
  it('rejects empty', () => {
    expect(validateTenders(100_000, [])).toEqual({ ok: false, error: 'no_tenders' });
  });

  it(`rejects more than ${MAX_TENDERS}`, () => {
    const tenders: Tender[] = Array.from({ length: MAX_TENDERS + 1 }, () => cash(10_000));
    const r = validateTenders(10_000 * (MAX_TENDERS + 1), tenders);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('too_many_tenders');
  });

  it('rejects non-positive amount', () => {
    expect(validateTenders(100_000, [cash(0)]).ok).toBe(false);
    expect(validateTenders(100_000, [cash(-10)]).ok).toBe(false);
  });

  it('rejects sum mismatch', () => {
    const r = validateTenders(100_000, [cash(60_000), card(30_000)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('sum_mismatch');
  });

  it('accepts exact single-tender', () => {
    expect(validateTenders(100_000, [cash(100_000)])).toEqual({ ok: true });
  });

  it('accepts exact split', () => {
    expect(validateTenders(100_000, [cash(60_000), card(40_000)])).toEqual({ ok: true });
  });

  it('accepts cash overpay on LAST tender', () => {
    expect(validateTenders(100_000, [card(40_000), cash(60_000, 70_000)])).toEqual({ ok: true });
  });

  it('rejects cash overpay on intermediate tender', () => {
    const r = validateTenders(100_000, [cash(50_000, 70_000), card(50_000)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('intermediate_cash_overpay');
  });

  it('accepts cash exact on intermediate tender', () => {
    expect(validateTenders(100_000, [cash(60_000, 60_000), card(40_000)])).toEqual({ ok: true });
  });
});
