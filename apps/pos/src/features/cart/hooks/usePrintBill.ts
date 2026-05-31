// apps/pos/src/features/cart/hooks/usePrintBill.ts
// Session 34 — W2.6 — print a "bill" (addition) to the cashier or waiter printer.
// The bill shows the whole order with totals, pre-payment, re-printable at will.
import { useMutation } from '@tanstack/react-query';
import { calculateTotals } from '@breakery/domain';
import type { PrinterRole } from '@breakery/domain';
import { printStationTicket } from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useStationPrinters } from './useStationPrinters';

// Matches the constant used in ActiveOrderPanel, PaymentTerminal, SuccessModal.
const TAX_RATE = 0.10;

export interface PrintBillInput {
  /** Which counter to target: cashier (walk-in/take-out) or waiter (dine-in/tablet). */
  role: 'cashier' | 'waiter';
}

export function usePrintBill() {
  const { data: printersMap } = useStationPrinters();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');

  return useMutation<void, Error, PrintBillInput>({
    mutationFn: async ({ role }) => {
      // 1. Resolve the target printer from the live map.
      const printer = printersMap?.get(role as PrinterRole);
      if (!printer) {
        throw new Error(`no_${role}_printer`);
      }

      // 2. Snapshot current cart state (read outside render cycle).
      const { cart } = useCartStore.getState();
      const { items, tableNumber } = cart;

      // 3. Build items list — whole order, non-cancelled only.
      const billItems = items
        .filter((item) => !item.is_cancelled)
        .map((item) => ({
          name: item.name,
          quantity: item.quantity,
          modifiers: item.modifiers.map((m) => m.option_label),
        }));

      // 4. Compute totals (includes tax extraction, discounts, loyalty).
      const t = calculateTotals(cart, TAX_RATE);

      // 5. Build a human-readable order label.
      //    A real order_number isn't available pre-payment; use table / walk-in
      //    (mirrors useFireToStations).
      const orderLabel = tableNumber ? `Table ${tableNumber}` : 'Walk-in';

      const payload: StationTicketPayload = {
        kind: 'bill',
        role: role as PrinterRole,
        order_number: orderLabel,
        ...(tableNumber != null ? { table_number: tableNumber } : {}),
        created_at: new Date().toISOString(),
        server_name: serverName,
        items: billItems,
        totals: {
          subtotal: t.subtotal,
          tax: t.tax_amount,
          total: t.total,
        },
        // No `payment` field — this is pre-payment.
      };

      // 6. Fire the print request. On failure, throw so onError fires.
      const { success, error } = await printStationTicket(printer, payload);
      if (!success) {
        throw new Error(error ?? 'print_failed');
      }
      // No markPrinted / markLocked — bills are re-printable on demand.
    },
  });
}
