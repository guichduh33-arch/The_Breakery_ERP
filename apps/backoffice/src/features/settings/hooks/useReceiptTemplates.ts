// apps/backoffice/src/features/settings/hooks/useReceiptTemplates.ts
//
// Session 13 / Phase 5.C — Receipt print template management.
// At-most-one default is enforced at the DB via partial unique index.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type ReceiptTemplateRow    = Database['public']['Tables']['receipt_templates']['Row'];
export type ReceiptTemplateInsert = Database['public']['Tables']['receipt_templates']['Insert'];
export type ReceiptTemplateUpdate = Database['public']['Tables']['receipt_templates']['Update'];

export type PaperSize = '58mm' | '80mm' | 'A4';

export const RECEIPT_TEMPLATES_QUERY_KEY = ['receipt-templates'] as const;

export function useReceiptTemplatesList() {
  return useQuery<ReceiptTemplateRow[]>({
    queryKey: RECEIPT_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('receipt_templates')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateReceiptTemplate() {
  const qc = useQueryClient();
  return useMutation<ReceiptTemplateRow, Error, { id: string; values: ReceiptTemplateUpdate }>({
    mutationFn: async ({ id, values }) => {
      // If the caller is flipping is_default=true, demote any existing default
      // first so the partial unique index does not collide.
      if (values.is_default === true) {
        await supabase
          .from('receipt_templates')
          .update({ is_default: false })
          .eq('is_default', true)
          .neq('id', id);
      }
      const { data, error } = await supabase
        .from('receipt_templates')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: RECEIPT_TEMPLATES_QUERY_KEY });
    },
  });
}

export function useCreateReceiptTemplate() {
  const qc = useQueryClient();
  return useMutation<ReceiptTemplateRow, Error, ReceiptTemplateInsert>({
    mutationFn: async (values) => {
      if (values.is_default === true) {
        await supabase
          .from('receipt_templates')
          .update({ is_default: false })
          .eq('is_default', true);
      }
      const { data, error } = await supabase
        .from('receipt_templates')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: RECEIPT_TEMPLATES_QUERY_KEY });
    },
  });
}
