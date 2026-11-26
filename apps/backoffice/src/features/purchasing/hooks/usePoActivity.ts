// apps/backoffice/src/features/purchasing/hooks/usePoActivity.ts
//
// Lit l'historique d'un bon de commande (voir poActivity.ts).
//
// Le journal d'audit n'est lisible qu'avec `reports.audit.read` (RLS) : sans
// cette permission, la requête n'est pas lancée et la carte le DIT, au lieu
// d'afficher un historique vide.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { PoAuditRow } from '../poActivity.js';

/** Un bon porte quelques dizaines d'événements ; le plafond n'est qu'un garde-fou. */
export const PO_ACTIVITY_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usePoActivity(poId: string, grnIds: readonly string[]) {
  const canReadAudit = useAuthStore((s) => s.hasPermission('reports.audit.read'));
  // Les identifiants entrent dans un filtre `or` PostgREST : seuls des UUID passent.
  const grns = grnIds.filter((g) => UUID.test(g));
  const ok = UUID.test(poId);

  const audit = useQuery<PoAuditRow[]>({
    queryKey: ['po-activity', poId, grns],
    enabled: canReadAudit && ok,
    queryFn: async () => {
      const filters = [`and(entity_type.in.(purchase_order,purchase_orders),entity_id.eq.${poId})`];
      if (grns.length > 0) {
        filters.push(`and(entity_type.eq.goods_receipt_notes,entity_id.in.(${grns.join(',')}))`);
      }
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, created_at, metadata, payload, actor:user_profiles!audit_logs_actor_id_fkey(full_name)')
        .or(filters.join(','))
        .order('created_at', { ascending: false })
        .limit(PO_ACTIVITY_LIMIT);
      if (error) throw error;
      return (data ?? []) as unknown as PoAuditRow[];
    },
  });

  return { canReadAudit, audit };
}
