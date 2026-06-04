// apps/pos/src/features/cart/PrintBillButton.tsx
// Session 34 — W2.6 — "Print Bill" action for the Active Order panel.
// Prints the whole order (items + totals, no payment) as a `bill` document to
// the cashier printer (walk-in / take-out) or waiter printer (dine-in / tablet).
import type { ComponentProps } from 'react';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { usePrintBill } from './hooks/usePrintBill';

interface PrintBillButtonProps {
  /** When provided, replaces the default `w-full` styling (e.g. for the bottom bar). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function PrintBillButton({ className, variant }: PrintBillButtonProps = {}) {
  const items = useCartStore((s) => s.cart.items);
  const tableNumber = useCartStore((s) => s.cart.tableNumber);
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);

  // Target role: waiter for dine-in / tablet pickup, cashier otherwise.
  const role = tableNumber != null || pickedUpOrderId != null ? 'waiter' : 'cashier';

  const mutation = usePrintBill();

  // Disabled when there are no active (non-cancelled) items or while printing.
  const hasItems = items.some((item) => !item.is_cancelled);
  const disabled = !hasItems || mutation.isPending;

  function handleClick() {
    mutation.mutate(
      { role },
      {
        onSuccess: () => {
          toast.success(`Bill printed (${role})`);
        },
        onError: (err) => {
          const msg = err.message;
          if (msg === `no_${role}_printer`) {
            toast.error(`No ${role} printer configured`);
          } else {
            toast.error(`Print failed: ${msg}`);
          }
        },
      },
    );
  }

  return (
    <Button
      variant={variant ?? 'secondary'}
      size="lg"
      className={className ?? 'w-full'}
      disabled={disabled}
      onClick={handleClick}
    >
      <Printer className="h-4 w-4" aria-hidden />
      {mutation.isPending ? 'Printing…' : 'Print Bill'}
    </Button>
  );
}
