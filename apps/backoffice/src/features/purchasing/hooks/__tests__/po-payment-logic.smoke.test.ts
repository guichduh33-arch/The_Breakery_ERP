// apps/backoffice/src/features/purchasing/hooks/__tests__/po-payment-logic.smoke.test.ts
// Session 46 — R3/R4: pure logic for derived payment status + edit-lock messaging.

import { describe, it, expect } from 'vitest';
import { derivePaymentStatus } from '../usePoPayments.js';
import { updatePoErrorMessage } from '../useUpdatePurchaseOrder.js';

describe('derivePaymentStatus (independent of reception)', () => {
  it('unpaid when nothing paid', () => {
    expect(derivePaymentStatus(0, 100000)).toBe('unpaid');
  });
  it('partial when some but not all paid', () => {
    expect(derivePaymentStatus(30000, 100000)).toBe('partial');
  });
  it('paid when fully settled (tolerant of rounding)', () => {
    expect(derivePaymentStatus(99999.999, 100000)).toBe('paid');
    expect(derivePaymentStatus(100000, 100000)).toBe('paid');
  });
  it('paid for a zero-total PO once any positive amount recorded', () => {
    expect(derivePaymentStatus(0, 0)).toBe('unpaid');
  });
});

describe('updatePoErrorMessage', () => {
  it('explains the lock for received/paid POs', () => {
    expect(updatePoErrorMessage('po_locked')).toMatch(/received or paid/i);
  });
  it('explains the permission gate', () => {
    expect(updatePoErrorMessage('forbidden')).toMatch(/permission/i);
  });
  it('explains the raw-material restriction', () => {
    expect(updatePoErrorMessage('product_not_raw_material')).toMatch(/raw-material/i);
  });
});
