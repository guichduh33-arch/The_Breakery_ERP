// apps/backoffice/src/features/products/hooks/useProductAuditLog.ts
//
// Read-only change-log for ONE product — powers the product detail "History"
// tab. Wraps get_audit_logs_v2 filtered on entity_type='product' +
// entity_id=<this product>. The RPC is SECURITY INVOKER so it inherits the
// audit_logs `admin_read` RLS (ADMIN / SUPER_ADMIN) — a MANAGER sees an empty
// trail, matching the existing reports audit page.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductAuditEntry {
  id:         number;
  action:     string;
  actor_id:   string | null;
  metadata:   unknown;
  created_at: string;
}

export const PRODUCT_AUDIT_LOG_QUERY_KEY = ['product-audit-log'] as const;

// One product accumulates few audit rows; a single 200-row page is plenty.
const PAGE_LIMIT = 200;

export function useProductAuditLog(productId: string | null) {
  return useQuery<ProductAuditEntry[]>({
    queryKey: [...PRODUCT_AUDIT_LOG_QUERY_KEY, productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (productId === null || productId === '') return [];
      const { data, error } = await supabase.rpc('get_audit_logs_v2', {
        p_limit: PAGE_LIMIT,
        p_entity_type: 'product',
        p_entity_id: productId,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id:         Number(r.id),
        action:     r.action,
        actor_id:   r.actor_id,
        metadata:   r.metadata,
        created_at: r.created_at,
      }));
    },
  });
}
