import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { OrderDetail } from './useOrderDetail.js';
import { auditMetadata, type OrderAuditEvent } from '../orderHistory.js';

const PAGE_SIZE = 100;
const PARTICIPANT_ROLES: Record<string, string> = {
  authorized_by: 'Authorized by', acting_cashier_id: 'Performed by', cashier_id: 'Cashier', waiter_id: 'Waiter',
};

export function useOrderHistory(order: OrderDetail) {
  const canReadAudit = useAuthStore((state) => state.hasPermission('reports.audit.read'));
  const ids = [order.id, ...order.items.map((item) => item.id)].sort();
  return useInfiniteQuery({
    queryKey: ['order-detail', order.id, 'history', ids],
    enabled: canReadAudit,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<OrderAuditEvent[]> => {
      const { data, error } = await supabase.from('audit_logs')
        .select('id, action, actor_id, entity_id, created_at, metadata, actor:user_profiles!audit_logs_actor_id_fkey(full_name)')
        .in('entity_type', ['order', 'orders', 'order_item', 'order_items'])
        .in('entity_id', ids)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      const participantIds = new Set<string>();
      for (const event of data) {
        const metadata = auditMetadata(event);
        for (const key of Object.keys(PARTICIPANT_ROLES)) {
          const id = metadata[key];
          if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && id !== event.actor_id) participantIds.add(id);
        }
      }
      if (participantIds.size === 0) return data;
      const profiles = await supabase.from('user_profiles').select('id, full_name').in('id', [...participantIds]);
      if (profiles.error) throw profiles.error;
      const names = new Map(profiles.data.map((profile) => [profile.id, profile.full_name]));
      return data.map((event) => {
        const metadata = auditMetadata(event);
        const participants: string[] = [];
        for (const [key, role] of Object.entries(PARTICIPANT_ROLES)) {
          const id = metadata[key];
          const name = typeof id === 'string' && id !== event.actor_id ? names.get(id) : undefined;
          if (name) participants.push(`${role}: ${name}`);
        }
        return { ...event, participants };
      });
    },
    getNextPageParam: (lastPage, pages) => lastPage.length === PAGE_SIZE ? pages.length : undefined,
  });
}
