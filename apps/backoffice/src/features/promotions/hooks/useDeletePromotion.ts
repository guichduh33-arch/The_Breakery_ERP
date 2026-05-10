// apps/backoffice/src/features/promotions/hooks/useDeletePromotion.ts
//
// Mutation: SOFT-DELETE a promotion (UPDATE deleted_at = now()). Hard DELETE
// is forbidden because promotion_applications.promotion_id references this
// row with ON DELETE RESTRICT (preserves audit trail).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.5, §7

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PROMOTIONS_QUERY_KEY } from './usePromotionsList.js';

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('promotions')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PROMOTIONS_QUERY_KEY });
    },
  });
}
