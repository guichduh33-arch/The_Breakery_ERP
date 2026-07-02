import { describe, expect, it } from 'vitest';
import { classify as classifyPayment } from '../hooks/useRecordB2bPayment.js';
import { classify as classifyCancel } from '../hooks/useCancelB2bOrder.js';
import { classify as classifyOrder } from '../hooks/useCreateB2bOrder.js';

const MSG = 'period_undefined: no fiscal period covers 2027-01-05';

describe('period_undefined classification (S54 fail-closed guard)', () => {
  it('useRecordB2bPayment', () => expect(classifyPayment(MSG)).toBe('fiscal_period_closed'));
  it('useCancelB2bOrder',    () => expect(classifyCancel(MSG)).toBe('fiscal_period_closed'));
  it('useCreateB2bOrder',    () => expect(classifyOrder(MSG)).toBe('fiscal_period_closed'));
});
