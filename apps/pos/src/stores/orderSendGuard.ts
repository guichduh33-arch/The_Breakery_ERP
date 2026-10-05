// A manual send owns the current cart until its acknowledgement is processed.
// Payment auto-printing does not own the cart: the sale is already confirmed.
import { hasPendingCounterFire } from '@/features/cart/hooks/counterFireRecovery';
let sending = false;
export function isOrderSending(): boolean { return sending || hasPendingCounterFire(); }
export function beginOrderSend(): void {
  if (sending) throw new Error('An order is already being sent — wait for confirmation');
  sending = true;
}
export function finishOrderSend(): void { sending = false; }
