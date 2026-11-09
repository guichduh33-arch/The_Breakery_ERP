// apps/pos/src/features/cart/PrintBillButton.tsx
// Session 34 — W2.6 — "Print Bill" action for the Active Order panel.
// S1-21 — la personne qui imprime choisit l'imprimante : une entrée par
// imprimante d'addition configurée (caisse, serveur). Aucune configurée → une
// entrée désactivée qui dit pourquoi.
import type { ComponentProps } from 'react';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import type { BillPrinterRole } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePrintBill } from './hooks/usePrintBill';
import { useStationPrinters } from './hooks/useStationPrinters';
import { BILL_PRINTER_LABEL, availableBillPrinters, billPrintErrorMessage } from './billPrinters';

interface PrintBillButtonProps {
  /** When provided, replaces the default `w-full` styling (e.g. for the bottom bar). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function PrintBillButton({ className, variant }: PrintBillButtonProps = {}) {
  const items = useCartStore((s) => s.cart.items);
  const printers = useStationPrinters();
  const roles = availableBillPrinters(printers.data);
  const mutation = usePrintBill();

  // Disabled when there are no active (non-cancelled) items or while printing.
  const hasItems = items.some((item) => !item.is_cancelled);
  const disabled = !hasItems || mutation.isPending;
  const buttonProps = { variant: variant ?? 'secondary', size: 'lg', className: className ?? 'w-full' } as const;

  function handleClick(role: BillPrinterRole) {
    mutation.mutate(
      { role },
      {
        onSuccess: () => { toast.success(`Bill printed (${BILL_PRINTER_LABEL[role].toLowerCase()})`); },
        onError: (err) => { toast.error(billPrintErrorMessage(err.message)); },
      },
    );
  }

  if (roles.length === 0) {
    const reason = printers.isLoading ? 'Loading printers…' : 'No cashier or waiter printer configured';
    return (
      <Button {...buttonProps} disabled title={reason}>
        <Printer className="h-4 w-4" aria-hidden />
        <span>Print bill · {reason}</span>
      </Button>
    );
  }

  return (
    <>
      {roles.map((role) => (
        <Button key={role} {...buttonProps} disabled={disabled} onClick={() => handleClick(role)}>
          <Printer className="h-4 w-4" aria-hidden />
          {mutation.isPending && mutation.variables?.role === role
            ? 'Printing…'
            : `Print bill · ${BILL_PRINTER_LABEL[role]}`}
        </Button>
      ))}
    </>
  );
}
