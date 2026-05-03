// packages/domain/src/payment/calculateChange.ts
import { roundIdr } from '@breakery/utils';

export function calculateChange(total: number, received: number): number {
  return Math.max(0, roundIdr(received - total));
}
