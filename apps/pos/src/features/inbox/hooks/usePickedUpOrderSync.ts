import { useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { fetchOrderSnapshot } from './fetchOrderSnapshot';

export function usePickedUpOrderSync(): void {
  const orderId = useCartStore((s) => s.pickedUpOrderId);
  useEffect(() => {
    if (!orderId) return;
    const currentOrderId = orderId;
    let disposed = false;
    let running = false;
    let requested = false;
    async function reload(): Promise<void> {
      if (disposed || usePaymentStore.getState().attemptUnsettled) return;
      if (running) { requested = true; return; }
      running = true;
      try {
        const version = useCartStore.getState().orderSnapshotVersion;
        const snapshot = await fetchOrderSnapshot(currentOrderId);
        const state = useCartStore.getState();
        if (disposed || state.pickedUpOrderId !== currentOrderId || usePaymentStore.getState().attemptUnsettled) return;
        if (state.orderSnapshotVersion !== version) { requested = true; return; }
        const known = new Set(state.cart.items.map((item) => item.server_id ?? item.id));
        const added = snapshot.items.filter((item) => !known.has(item.id) && !item.is_cancelled);
        state.applyOrderSnapshot(snapshot);
        if (added.length) toast.info('Order updated — new items received');
        toast.dismiss('order-sync-error');
      } catch {
        if (!disposed) toast.error('Order refresh unavailable — retrying automatically', { id: 'order-sync-error' });
      } finally {
        running = false;
        if (requested && !disposed) { requested = false; void reload(); }
      }
    }
    const channel = supabase.channel(`picked-up-order-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${currentOrderId}`,
      }, () => { void reload(); }).subscribe();
    void reload();
    const timer = setInterval(() => { void reload(); }, 20_000);
    return () => { disposed = true; clearInterval(timer); void supabase.removeChannel(channel); };
  }, [orderId]);
}
