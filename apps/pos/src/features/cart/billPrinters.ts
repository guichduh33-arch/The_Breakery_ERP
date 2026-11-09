// S1-21 — imprimantes capables de sortir une addition, partagées par la caisse
// et la tablette. L'ordre suit BILL_PRINTER_ROLES (caisse d'abord).
import { BILL_PRINTER_ROLES, type BillPrinterRole, type PrinterRole } from '@breakery/domain';

export const BILL_PRINTER_LABEL: Record<BillPrinterRole, string> = {
  cashier: 'Cashier printer',
  waiter: 'Waiter printer',
};

export function availableBillPrinters(printers: ReadonlyMap<PrinterRole, unknown> | undefined): BillPrinterRole[] {
  if (!printers) return [];
  return BILL_PRINTER_ROLES.filter((role) => printers.has(role));
}

/** Message d'erreur lisible pour un échec d'impression d'addition. */
export function billPrintErrorMessage(message: string): string {
  const missing = /^no_(cashier|waiter)_printer$/.exec(message);
  if (missing) return `No ${missing[1]} printer configured`;
  if (message === 'order_not_open') return 'This order is no longer open: no bill to print';
  if (message.startsWith('bill_reconciliation_failed')) {
    return 'Bill not printed: the saved amounts of this order do not add up. Ask the cashier to print the bill.';
  }
  return `Print failed: ${message}`;
}
