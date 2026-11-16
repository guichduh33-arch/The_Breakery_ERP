// S1-21 — « Print bill » sur une commande tablette ouverte, avec le choix de
// l'imprimante (caisse ou serveur). Hors ligne, l'action est désactivée et le
// dit : une addition n'est jamais mise en file.
import type { JSX } from 'react';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import type { BillPrinterRole } from '@breakery/domain';
import { useStationPrinters } from '@/features/cart/hooks/useStationPrinters';
import { BILL_PRINTER_LABEL, availableBillPrinters, billPrintErrorMessage } from '@/features/cart/billPrinters';
import { useTabletConnectionState } from '../hooks/useTabletConnectionState';
import { usePrintTabletBill } from '../hooks/usePrintTabletBill';

interface TabletBillActionProps {
  orderId: string;
  orderNumber: string;
}

export function TabletBillAction({ orderId, orderNumber }: TabletBillActionProps): JSX.Element {
  const { isOnline } = useTabletConnectionState();
  const printers = useStationPrinters();
  const roles = availableBillPrinters(printers.data);
  const mutation = usePrintTabletBill();

  function handlePrint(role: BillPrinterRole): void {
    mutation.mutate(
      { orderId, role },
      {
        onSuccess: () => { toast.success(`Bill printed (${BILL_PRINTER_LABEL[role].toLowerCase()})`); },
        onError: (err) => { toast.error(billPrintErrorMessage(err.message)); },
      },
    );
  }

  const hint = !isOnline
    ? 'Offline: the bill needs a connection to read the order amounts'
    : roles.length === 0
      ? printers.isLoading ? 'Loading printers…' : 'No cashier or waiter printer configured'
      : null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {hint !== null ? (
        <>
          <Button variant="secondary" size="lg" className="w-full" disabled aria-describedby={`bill-hint-${orderId}`}>
            <Printer className="h-4 w-4" aria-hidden />
            Print bill
          </Button>
          <p id={`bill-hint-${orderId}`} className="text-xs text-text-secondary">{hint}</p>
        </>
      ) : (
        roles.map((role) => (
          <Button
            key={role}
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => handlePrint(role)}
            aria-label={`Print bill for order ${orderNumber} on the ${BILL_PRINTER_LABEL[role].toLowerCase()}`}
          >
            <Printer className="h-4 w-4" aria-hidden />
            {mutation.isPending && mutation.variables?.role === role ? 'Printing…' : `Print bill · ${BILL_PRINTER_LABEL[role]}`}
          </Button>
        ))
      )}
    </div>
  );
}
