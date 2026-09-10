import { supabase } from '@/lib/supabase';
import type { OrderSnapshot } from '@/stores/orderSnapshot';

export async function fetchOrderSnapshot(orderId: string): Promise<OrderSnapshot> {
  const { data, error } = await supabase.rpc('get_pos_order_snapshot_v1', { p_order_id: orderId });
  if (error) throw new Error(error.message);
  const snapshot = data as unknown as OrderSnapshot;
  if (snapshot.order_id !== orderId || !Array.isArray(snapshot.items)) throw new Error('invalid_order_snapshot');
  return snapshot;
}
