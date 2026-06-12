import { useState, type ComponentProps } from 'react';
import { PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useHoldOrder } from '../hooks/useHoldOrder';
import { HoldNoteModal } from './HoldNoteModal';

interface HoldOrderButtonProps {
  disabled?: boolean;
  /** When provided, replaces the default `w-full` styling (e.g. bottom-bar menu item). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

/**
 * Session 35 (F-003) — DB-backed hold. Reads the live cart, persists it as a
 * held draft via `hold_order_v1`, then clears the local cart.
 * Session 43 (P2-2) — the optional note is collected via a proper modal
 * (HoldNoteModal) instead of `window.prompt`.
 */
export function HoldOrderButton({ disabled, className, variant }: HoldOrderButtonProps) {
  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const clearCart = useCartStore((s) => s.clear);
  const holdOrder = useHoldOrder();
  const [noteOpen, setNoteOpen] = useState(false);

  function handleClick() {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    setNoteOpen(true);
  }

  async function handleConfirm(note: string | null) {
    try {
      await holdOrder.mutateAsync({
        cartPayload: {
          order_type: cart.order_type,
          customerId: attachedCustomer?.id ?? null,
          items: cart.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            modifiers: i.modifiers,
          })),
        },
        tableNumber: cart.tableNumber ?? null,
        notes: note,
      });
      clearCart();
      setNoteOpen(false);
      toast.success('Held');
    } catch {
      // Keep the modal open so the cashier can retry.
      toast.error('Could not hold order');
    }
  }

  return (
    <>
      <Button
        variant={variant ?? 'outlineGold'}
        size="lg"
        className={className ?? 'w-full'}
        onClick={handleClick}
        disabled={(disabled ?? false) || holdOrder.isPending || cart.items.length === 0}
      >
        <PauseCircle className="h-4 w-4 mr-2" aria-hidden />
        Hold
      </Button>

      <HoldNoteModal
        open={noteOpen}
        onOpenChange={setNoteOpen}
        isPending={holdOrder.isPending}
        onConfirm={(note) => { void handleConfirm(note); }}
      />
    </>
  );
}
