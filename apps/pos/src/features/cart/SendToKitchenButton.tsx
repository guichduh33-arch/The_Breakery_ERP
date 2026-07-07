// apps/pos/src/features/cart/SendToKitchenButton.tsx
// Fires prep tickets to all mapped station printers for unprinted cart items.
import type { ComponentProps } from 'react';
import { ChefHat } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { useFireToStations } from './hooks/useFireToStations';
import { useHoldFiredOrder } from './hooks/useHoldFiredOrder';
import { useDineInTableGuard } from '@/features/tables/hooks/useDineInTableGuard';

interface SendToKitchenButtonProps {
  /** When provided, replaces the default `w-full` styling (e.g. for the bottom bar). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function SendToKitchenButton({ className, variant }: SendToKitchenButtonProps = {}) {
  const { mutation, firableCount, unroutedCount } = useFireToStations();
  const holdFired = useHoldFiredOrder();
  // Fiche 02 D2.5 — dine-in fires need a table (the KOT prints it). The guard
  // opens the floor plan and resumes the fire once a table is picked.
  const tableGuard = useDineInTableGuard({ onSelected: () => { void handleClick(); } });

  // Disabled when there is nothing that routes to a prep station (bread-only
  // orders, products query still loading, everything already printed) or while
  // a fire is in flight.
  const disabled = firableCount === 0 || mutation.isPending;

  async function handleClick() {
    if (disabled) return;
    if (!tableGuard.ensureTable()) return;
    // LOT 3 — snapshot the unrouted count BEFORE firing: the fire marks the
    // items printed, which immediately drops the live counter back to 0.
    const unroutedAtFire = unroutedCount;
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
          toast.error(`${r.role} printer unreachable — ticket saved to KDS, not printed`);
        }
      }
      // LOT 3 — non-blocking warning: some lines route to no station and never
      // reach the kitchen (category dispatch_station 'none' / unmapped). The
      // order still persists for payment; this just makes the silent skip
      // visible so staff can follow up.
      if (unroutedAtFire > 0) {
        toast.warning(
          `${unroutedAtFire} item(s) not routed to any kitchen station — check category routing`,
        );
      }
      // Spec A Bloc 2 — park the fired order in Held Orders and free the
      // terminal for the next customer. The order persists in the DB (held);
      // it reappears in the held list and can be reopened later. Best-effort:
      // a hold failure leaves the order on the terminal (still payable), so we
      // only reset after the hold succeeds.
      const orderId = useCartStore.getState().pickedUpOrderId;
      if (orderId) {
        try {
          await holdFired.mutateAsync(orderId);
          resetCartAfterCheckout();
          toast.info('Order sent & parked in Held Orders');
        } catch (holdErr) {
          const he = holdErr as Error;
          toast.error(`Sent to kitchen, but could not park the order: ${he.message}`);
        }
      }
    } catch (err) {
      const e = err as Error;
      // Server-side net of the dine-in table guard (fire_v4 P0011, _122) —
      // reachable only if the client guard was bypassed (stale state).
      if (e.message.includes('table_required_for_dine_in')) {
        toast.error('Dine-in orders need a table — pick one on the floor plan');
        return;
      }
      toast.error(`Fire to stations failed: ${e.message}`);
    }
  }

  return (
    <>
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
      {tableGuard.modal}
    </>
  );
}
