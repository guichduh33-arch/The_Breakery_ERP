// apps/backoffice/src/features/promotions/hooks/useDeletePromotion.ts
//
// Mutation: SOFT-DELETE a promotion via the delete_promotion_v1 RPC (S78,
// migration _167). L'UPDATE direct de deleted_at est impossible sous RLS :
// la policy SELECT auth_read (deleted_at IS NULL) s'applique au NEW row et
// rejette l'écriture (42501) — la RPC SECURITY DEFINER gatée
// `promotions.delete` est la seule voie. Hard DELETE reste interdit
// (promotion_applications.promotion_id ON DELETE RESTRICT, audit trail).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.5, §7

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PROMOTIONS_QUERY_KEY } from './usePromotionsList.js';

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('delete_promotion_v1', {
        p_promotion_id: id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PROMOTIONS_QUERY_KEY });
    },
  });
}
