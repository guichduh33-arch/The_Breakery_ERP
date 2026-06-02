// apps/pos/src/features/payment/format.ts
// Shared by PaymentTerminal + its extracted presentation components.
// Moved verbatim from PaymentTerminal.tsx (was the trailing helper).

export function formatLabel(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`;
}
