// packages/domain/src/discounts/validateDiscount.ts
// Spec §4.1 (critical note 3): validate a Discount against a base amount.

import type { Discount } from './types.js';

export interface DiscountValidationError {
  code: string;
  message: string;
}

/**
 * Validate a Discount against the order base amount.
 * Returns an empty array when valid; one entry per failed check (in spec order).
 */
export function validateDiscount(d: Discount, base: number): DiscountValidationError[] {
  const errors: DiscountValidationError[] = [];

  if (d.reason.trim().length < 5) {
    errors.push({ code: 'reason_too_short', message: 'Reason required (min 5 chars)' });
  }

  const valueInvalid =
    d.type === 'percentage'
      ? d.value <= 0 || d.value > 100
      : d.value <= 0;

  if (valueInvalid) {
    errors.push({ code: 'value_invalid', message: 'Discount value is out of range' });
  }

  if (d.amount <= 0) {
    errors.push({ code: 'value_invalid', message: 'Discount amount must be greater than zero' });
  } else if (d.amount > base) {
    errors.push({ code: 'exceeds_base', message: 'Discount amount exceeds order total' });
  }

  return errors;
}
