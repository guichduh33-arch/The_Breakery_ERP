import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';
import { useAuthStore } from '@/stores/authStore';

export interface OrderHistoryRow {
  id: string;
  order_number: string;
  status: 'paid' | 'completed' | 'voided';
  total: number;
  paid_at: string | null;
  voided_at: string | null;
  customer_id: string | null;
  table_number: string | null;
  order_type: string | null;
  /** Sum of refunds.total for this order (audit-only, partials allowed). */
  total_refunded: number;
  /** Primary payment method (first tender method on the order). */
  primary_payment_method: string | null;
  /** Per-method paid totals for the KPI strip. */
  paid_by_method: { method: string; amount: number }[];
}


interface HistoryPayload {
  financial_visible: boolean;
  orders: OrderHistoryRow[];
}

export function useOrderHistory(enabled = true, receiptNumber: string | null = null) {
  const sessionId = useShiftStore((s) => s.current?.id);
  const actorId = useAuthStore((s) => s.user?.id);
  const role = useAuthStore((s) => s.user?.role_code);
  const query = useQuery<HistoryPayload>({
    queryKey: ['order-history', actorId, role, sessionId, receiptNumber],
    queryFn: async () => {
      if (!sessionId || !enabled) return { financial_visible: false, orders: [] };
      const { data, error } = await supabase.rpc('get_pos_transaction_history_v2', {
        p_session_id: sessionId,
        ...(receiptNumber ? { p_order_number: receiptNumber } : {}),
      });
      if (error) throw new Error(error.message);
      return data as unknown as HistoryPayload;
    },
    enabled: Boolean(sessionId) && enabled,
    staleTime: 10_000,
    gcTime: 0,
  });
  return { ...query, data: query.data?.orders, financialVisible: query.data?.financial_visible === true };
}
