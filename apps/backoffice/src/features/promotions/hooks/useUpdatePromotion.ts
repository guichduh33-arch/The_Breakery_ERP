// apps/backoffice/src/features/promotions/hooks/useUpdatePromotion.ts
//
// Mutation: UPDATE an existing promotion. RLS enforces 'promotions.update'.
// Used both for full edits and quick toggles (is_active).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.5, §4.5

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PromotionFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { toRow } from './promotionRowMappers.js';
import { PROMOTIONS_QUERY_KEY, type PromotionListRow } from './usePromotionsList.js';

export interface UpdatePromotionInput {
  id: string;
  values: Partial<PromotionFormValues>;
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation<PromotionListRow, Error, UpdatePromotionInput>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('promotions')
        .update(toRow(values))
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PROMOTIONS_QUERY_KEY });
    },
  });
}
