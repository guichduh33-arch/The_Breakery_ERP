import { PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useHoldOrder } from '../hooks/useHoldOrder';

interface HoldOrderButtonProps {
  disabled?: boolean;
}

/**
 * Session 35 (F-003) — DB-backed hold. Reads the live cart, persists it as a
 * held draft via `hold_order_v1`, then clears the local cart. Prompts for an
 * optional note (preserving the pre-S35 UX) before firing the mutation.
 */
export function HoldOrderButton({ disabled }: HoldOrderButtonProps) {
  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const clearCart = useCartStore((s) => s.clear);
  const holdOrder = useHoldOrder();

  async function handleClick() {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    const raw = window.prompt('Hold note (optional):');

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
        notes: raw ?? null,
      });
      clearCart();
      toast.success('Held');
    } catch {
      toast.error('Could not hold order');
    }
  }

  return (
    <Button
      variant="outlineGold"
      size="lg"
      className="w-full"
      onClick={handleClick}
      disabled={disabled || holdOrder.isPending || cart.items.length === 0}
    >
      <PauseCircle className="h-4 w-4 mr-2" aria-hidden />
      Hold
    </Button>
  );
}
