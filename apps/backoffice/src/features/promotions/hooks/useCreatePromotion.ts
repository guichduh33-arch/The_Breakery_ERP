// apps/backoffice/src/features/promotions/hooks/useCreatePromotion.ts
//
// Mutation: INSERT a new promotion. RLS enforces the 'promotions.create'
// permission server-side; the UI button is also gated on the same code.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.5, §4.5

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PromotionFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { toRow, type PromotionInsert } from './promotionRowMappers.js';
import { PROMOTIONS_QUERY_KEY, type PromotionListRow } from './usePromotionsList.js';

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation<PromotionListRow, Error, PromotionFormValues>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('promotions')
        .insert(toRow(values) as PromotionInsert)
        .select()
        .single();
      if (error) throw error;
      // supabase types `threshold_type` as `string|null` from the TEXT column;
      // the DB CHECK constraint pins it to 'subtotal'|'quantity'|null so the
      // unknown-cast is safe.
      return data as unknown as PromotionListRow;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PROMOTIONS_QUERY_KEY });
    },
  });
}
