// apps/backoffice/src/features/btob/hooks/useB2bOrderActivity.ts
//
// Lit l'historique d'une commande B2B (voir b2bOrderActivity.ts).
//
// Le journal d'audit n'est lisible qu'avec `reports.audit.read` (RLS) : sans
// cette permission, la requête n'est pas lancée et la page le DIT, au lieu de
// présenter les seuls paiements comme l'historique complet. Les allocations
// de paiement, elles, sont lisibles par tout compte connecté.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { B2bOrderAllocationRow, B2bOrderAuditRow } from '../b2bOrderActivity.js';

/** Une commande B2B porte quelques événements ; le plafond n'est qu'un garde-fou. */
export const B2B_ORDER_ACTIVITY_LIMIT = 200;

export function useB2bOrderActivity(orderId: string) {
  const canReadAudit = useAuthStore((s) => s.hasPermission('reports.audit.read'));

  const audit = useQuery<B2bOrderAuditRow[]>({
    queryKey: ['b2b-invoices', 'activity', orderId, 'audit'],
    enabled: canReadAudit && orderId !== '',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, created_at, metadata, actor:user_profiles!audit_logs_actor_id_fkey(full_name)')
        .in('entity_type', ['order', 'orders'])
        .eq('entity_id', orderId)
        .order('created_at', { ascending: false })
        .limit(B2B_ORDER_ACTIVITY_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });

  const payments = useQuery<B2bOrderAllocationRow[]>({
    queryKey: ['b2b-invoices', 'activity', orderId, 'payments'],
    enabled: orderId !== '',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('b2b_payment_allocations')
        .select('id, amount_applied, created_at, payment:b2b_payments!b2b_payment_allocations_payment_id_fkey(payment_number, method, paid_at, created_at, creator:user_profiles!b2b_payments_created_by_fkey(full_name))')
        .eq('invoice_id', orderId)
        .order('created_at', { ascending: false })
        .limit(B2B_ORDER_ACTIVITY_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });

  return { canReadAudit, audit, payments };
}
