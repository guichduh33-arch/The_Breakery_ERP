// apps/pos/src/features/cart/SendToKitchenButton.tsx
// Fires prep tickets to all mapped station printers for unprinted cart items.
import type { ComponentProps } from 'react';
import { ChefHat } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useFireToStations } from './hooks/useFireToStations';

interface SendToKitchenButtonProps {
  /** When provided, replaces the default `w-full` styling (e.g. for the bottom bar). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function SendToKitchenButton({ className, variant }: SendToKitchenButtonProps = {}) {
  const { mutation, firableCount } = useFireToStations();

  // Disabled when there is nothing that routes to a prep station (bread-only
  // orders, products query still loading, everything already printed) or while
  // a fire is in flight.
  const disabled = firableCount === 0 || mutation.isPending;

  async function handleClick() {
    if (disabled) return;
    const rawTable = useCartStore.getState().cart.tableNumber;
    const ctx = rawTable ? { tableNumber: rawTable } : {};
    try {
      const results = await mutation.mutateAsync(ctx);
      // Defensive: the disabled gate should prevent this, but never lie about
      // a no-op — info, not success.
      if (results.length === 0) {
        toast.info('No kitchen items to send');
        return;
      }
      // Toast per station — honest about partial failures.
      for (const r of results) {
        if (r.ok) {
          toast.success(`Sent to ${r.role} (${r.itemIds.length} item(s))`);
        } else {
          toast.error(`${r.role} printer unreachable — not printed`);
        }
      }
    } catch (err) {
      const e = err as Error;
      toast.error(`Fire to stations failed: ${e.message}`);
    }
  }

  return (
    <Button
      variant={variant ?? 'secondary'}
      size="lg"
      className={className ?? 'w-full'}
      disabled={disabled}
      onClick={() => { void handleClick(); }}
    >
      <ChefHat className="h-4 w-4" aria-hidden />
      {mutation.isPending ? 'Sending…' : 'Send to Kitchen'}
    </Button>
  );
}
