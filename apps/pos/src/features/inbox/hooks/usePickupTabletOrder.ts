import { isCartPaymentLocked } from '@/stores/cartPaymentGuard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { fetchOrderSnapshot } from './fetchOrderSnapshot';

export function usePickupTabletOrder(onClose: () => void) {
  const queryClient = useQueryClient();
  const sessionId = useShiftStore((s) => s.current?.id);

  return useMutation({
    mutationFn: async (orderId: string) => {
      if (isCartPaymentLocked()) throw new Error('cart_in_progress');
      if (!sessionId) throw new Error('no_open_shift');

      // S72 audit P1: picking up restores (overwrites) the whole POS cart. Refuse
      // when a walk-in is being composed (unlocked lines) or another tablet order
      // is already loaded — otherwise that in-progress work is silently wiped.
      const cart = useCartStore.getState();
      if (cart.unlockedItemIds().length > 0 || cart.pickedUpOrderId !== null) {
        throw new Error('cart_in_progress');
      }

      const { error: pickupError } = await supabase.rpc('pickup_tablet_order', {
        p_order_id: orderId,
        p_session_id: sessionId,
      });
      if (pickupError) throw Object.assign(new Error(pickupError.message), { details: pickupError });
      const snapshot = await fetchOrderSnapshot(orderId);
      const current = useCartStore.getState();
      if (current.cart !== cart.cart || current.pickedUpOrderId !== cart.pickedUpOrderId) {
        throw new Error('cart_in_progress');
      }
      current.applyOrderSnapshot(snapshot, true);
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
