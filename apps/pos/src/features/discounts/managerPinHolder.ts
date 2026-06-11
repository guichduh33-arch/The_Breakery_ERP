// apps/pos/src/features/discounts/managerPinHolder.ts
//
// S37 SEC-01 — transient in-memory holder for the manager PIN captured by the
// discount-authorization modal. complete_order_with_payment_v11 re-validates the
// PIN server-side at checkout time, so the POS must carry it from authorization
// to checkout. Module-scoped on purpose:
//   - NEVER persisted (no localStorage / no Zustand persist),
//   - NEVER part of the cart object (the customer-display BroadcastChannel
//     mirrors the cart — the PIN must not travel on that channel),
//   - cleared on successful checkout and on holder reset.
let managerPin: string | null = null;

export function setManagerPin(pin: string): void {
  managerPin = pin;
}

export function getManagerPin(): string | null {
  return managerPin;
}

export function clearManagerPin(): void {
  managerPin = null;
}
