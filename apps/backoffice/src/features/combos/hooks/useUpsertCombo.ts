// apps/backoffice/src/features/combos/hooks/useUpsertCombo.ts
//
// Session 47 — mutation hook wrapping upsert_combo_v1 RPC.
// Idempotency key (S25 flavor 1) is a useRef UUID reset on success so that
// retries within the same dialog open are safe, but re-opening generates a
// fresh key.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/**
 * Payload for upsert_combo_v1. Matches the RPC's p_combo JSON argument.
 * combo_product_id === null means create; non-null means update.
 */
export interface UpsertComboPayload {
  combo_product_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  category_id: string;
  base_price: number;
  display_order: number;
  available_from: string | null;
  available_to: string | null;
  is_active: boolean;
  visible_on_pos: boolean;
  groups: Array<{
    name: string;
    group_type: 'single' | 'multi';
    is_required: boolean;
    min_select: number;
    max_select: number;
    sort_order: number;
    options: Array<{
      component_product_id: string;
      surcharge: number;
      is_default: boolean;
      sort_order: number;
    }>;
  }>;
}

export interface UpsertComboResult {
  combo_product_id: string;
  sku: string;
  idempotent_replay: boolean;
}

export function useUpsertCombo() {
  const qc = useQueryClient();
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const mutation = useMutation<UpsertComboResult, Error, UpsertComboPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('upsert_combo_v1', {
        p_combo: payload,
        p_idempotency_key: idempotencyKey.current,
      });
      if (error) throw error;
      return data as unknown as UpsertComboResult;
    },
    onSuccess: async () => {
      // Rotate the idempotency key so a re-save is not a replay
      idempotencyKey.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: ['combos'] });
    },
  });

  return mutation;
}
