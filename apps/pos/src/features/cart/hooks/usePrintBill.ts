// apps/pos/src/features/cart/hooks/usePrintBill.ts
// Session 34 — W2.6 — print a "bill" (addition) to the cashier or waiter printer.
// The bill shows the whole order with totals, pre-payment, re-printable at will.
// S1-21 — l'addition est chiffrée (montant par ligne + remises + taxe) et la
// personne qui imprime choisit l'imprimante ; le payload vient du builder pur
// du domaine `cartToBillPayload`.
import { useMutation } from '@tanstack/react-query';
import { cartToBillPayload, type BillPrinterRole } from '@breakery/domain';
import { printStationTicket } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useStationPrinters } from './useStationPrinters';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';

export interface PrintBillInput {
  /** Imprimante choisie par la personne qui imprime. */
  role: BillPrinterRole;
}

export function usePrintBill() {
  const { data: printersMap } = useStationPrinters();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');
  // D1 (S51) — the bill is printed BEFORE the order exists, so there is no v15
  // server response yet. It stays a client-side computation, but at the SERVER
  // tax config (useTaxConfig: rate + inclusive mode, mirror of _pb1_split_v1).
  const { taxRate, taxInclusive } = useTaxConfig();

  return useMutation<void, Error, PrintBillInput>({
    mutationFn: async ({ role }) => {
      const printer = printersMap?.get(role);
      if (!printer) {
        throw new Error(`no_${role}_printer`);
      }

      // Snapshot hors cycle de rendu. ADR-013 D11 — `cart.promotionTotal` est
      // renseigné par le store : l'addition inclut les promotions.
      const { cart } = useCartStore.getState();
      const payload = cartToBillPayload(cart, taxRate, taxInclusive, {
        role,
        created_at: new Date().toISOString(),
        server_name: serverName,
      });

      const { success, error } = await printStationTicket(printer, payload);
      if (!success) {
        throw new Error(error ?? 'print_failed');
      }
      // No markPrinted / markLocked — bills are re-printable on demand.
    },
  });
}
