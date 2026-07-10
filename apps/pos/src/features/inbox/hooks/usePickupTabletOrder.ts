import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import type { CartItem } from '@breakery/domain';

interface OrderRow {
  id: string;
  order_type: 'dine_in' | 'take_out';
  table_number: string | null;
  order_number: string;
}

// NB: the column is `name_snapshot` (frozen at order time) — there is no
// `order_items.name`. Selecting `name` 42703s the whole pickup (silent in
// mocked tests, fatal in prod).
interface OrderItemRow {
  id: string;
  product_id: string;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  modifiers: unknown;
}

function toCartItem(row: OrderItemRow): CartItem {
  return {
    id: row.id,
    product_id: row.product_id,
    name: row.name_snapshot,
    unit_price: row.unit_price,
    quantity: row.quantity,
    modifiers: (row.modifiers as CartItem['modifiers']) ?? [],
  };
}

export function usePickupTabletOrder(onClose: () => void) {
  const queryClient = useQueryClient();
  const sessionId = useShiftStore((s) => s.current?.id);

  return useMutation({
    mutationFn: async (orderId: string) => {
      if (!sessionId) throw new Error('no_open_shift');

      // S72 audit P1: picking up restores (overwrites) the whole POS cart. Refuse
      // when a walk-in is being composed (unlocked lines) or another tablet order
      // is already loaded — otherwise that in-progress work is silently wiped.
      const cart = useCartStore.getState();
      if (cart.unlockedItemIds().length > 0 || cart.pickedUpOrderId !== null) {
        throw new Error('cart_in_progress');
      }

      const { data: orderData, error: pickupError } = await supabase.rpc('pickup_tablet_order', {
        p_order_id: orderId,
        p_session_id: sessionId,
      });
      if (pickupError) throw Object.assign(new Error(pickupError.message), { details: pickupError });
      const order = orderData as unknown as OrderRow;

      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('id, product_id, name_snapshot, unit_price, quantity, modifiers')
        .eq('order_id', orderId);
      if (itemsError) throw new Error(itemsError.message);

      const items = (itemsData as unknown as OrderItemRow[]).map(toCartItem);
      const cartStore = useCartStore.getState();
      const restoredCart = {
        items,
        order_type: order.order_type,
        ...(order.table_number ? { tableNumber: order.table_number } : {}),
      };
      cartStore.restoreCart(restoredCart);
      cartStore.markLocked(items.map((i) => i.id));
      cartStore.setPickedUpOrderId(orderId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
      toast.success('Order picked up');
      onClose();
    },
    onError: (err) => {
      const msg = err.message ?? 'pickup_failed';
      if (msg.includes('cart_in_progress')) {
        toast.error('Finish or clear the current order before picking up a tablet order');
      } else if (msg.includes('P0012') || msg.includes('already picked up')) {
        toast.error('Already picked up by another cashier');
      } else {
        toast.error(msg);
      }
    },
  });
}
