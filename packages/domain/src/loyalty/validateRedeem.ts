import { MIN_REDEEM } from './constants.js';
import { pointsToValue } from './redeemValue.js';

export interface ValidationError {
  code: string;
  message: string;
}

export function validateRedeem(
  points: number,
  balance: number,
  items_total: number,
  customer_attached: boolean,
): ValidationError[] {
  if (points === 0) return [];

  const errors: ValidationError[] = [];

  if (!customer_attached) {
    errors.push({ code: 'customer_required', message: 'A customer must be attached to redeem points.' });
    return errors;
  }

  if (points < MIN_REDEEM) {
    errors.push({ code: 'below_minimum', message: `Minimum redemption is ${MIN_REDEEM} points.` });
  }

  if (points % 100 !== 0) {
    errors.push({ code: 'not_multiple_of_100', message: 'Points must be a multiple of 100.' });
  }

  if (points > balance) {
    errors.push({ code: 'insufficient_balance', message: `Insufficient points balance (have ${balance}, need ${points}).` });
  }

  if (pointsToValue(points) > items_total) {
    errors.push({ code: 'exceeds_order_total', message: 'Redemption value exceeds order total.' });
  }

  return errors;
}
