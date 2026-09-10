// A manual send owns the current cart until its acknowledgement is processed.
// Payment auto-printing does not own the cart: the sale is already confirmed.
let sending = false;
export function isOrderSending(): boolean { return sending; }
export function beginOrderSend(): void {
  if (sending) throw new Error('An order is already being sent — wait for confirmation');
  sending = true;
}
export function finishOrderSend(): void { sending = false; }
