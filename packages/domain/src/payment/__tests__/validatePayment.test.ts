// packages/domain/src/payment/__tests__/validatePayment.test.ts
import { describe, it, expect } from 'vitest';
import { validatePayment } from '../validatePayment';
import type { PaymentInput } from '../../types/index.js';

describe('validatePayment', () => {
  it('valid cash payment', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000, cash_received: 100000, change_given: 20000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: true });
  });
  it('rejects amount mismatch', () => {
    const p: PaymentInput = { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'amount_mismatch' });
  });
  it('rejects cash without cash_received', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'cash_received_required' });
  });
  it('rejects cash with insufficient cash_received', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000, cash_received: 50000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'cash_received_insufficient' });
  });
  it('valid card payment (no cash_received needed)', () => {
    const p: PaymentInput = { method: 'card', amount: 80000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: true });
  });
});
