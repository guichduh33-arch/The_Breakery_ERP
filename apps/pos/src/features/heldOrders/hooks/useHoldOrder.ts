import { toast } from 'sonner';
import { toHeldOrder } from '@breakery/domain';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { useHeldOrdersStore, HeldOrdersLimitError } from '@/stores/heldOrdersStore';

export function useHoldOrder() {
  return (notes?: string) => {
    const cart = useCartStore.getState().cart;
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    try {
      const tableNumber = cart.tableNumber ?? null;
      const opts = notes ? { notes, tableNumber } : { tableNumber };
      useHeldOrdersStore.getState().add(toHeldOrder(cart, opts));
      resetCartAfterCheckout();
      toast.success('Held');
    } catch (e) {
      if (e instanceof HeldOrdersLimitError) {
        toast.error('Held orders limit reached');
      } else {
        throw e;
      }
    }
  };
}
