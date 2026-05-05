import { fromHeldOrder } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useHeldOrdersStore } from '@/stores/heldOrdersStore';

export function useRestoreHeldOrder() {
  return (id: string) => {
    const held = useHeldOrdersStore.getState().entries.find((e) => e.id === id);
    if (!held) return;
    const cart = fromHeldOrder(held);
    useCartStore.getState().restoreCart(cart);
    useHeldOrdersStore.getState().remove(id);
  };
}
