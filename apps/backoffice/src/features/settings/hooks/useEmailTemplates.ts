// apps/backoffice/src/features/settings/hooks/useEmailTemplates.ts
//
// Session 13 / Phase 5.C — Customer-facing email template management.
// Distinct from Phase 5.B notification_templates (system events). See
// D-W5-5C-04.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type EmailTemplateRow    = Database['public']['Tables']['email_templates']['Row'];
export type EmailTemplateInsert = Database['public']['Tables']['email_templates']['Insert'];
export type EmailTemplateUpdate = Database['public']['Tables']['email_templates']['Update'];

export const EMAIL_TEMPLATES_QUERY_KEY = ['email-templates'] as const;

export function useEmailTemplatesList() {
  return useQuery<EmailTemplateRow[]>({
    queryKey: EMAIL_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation<EmailTemplateRow, Error, { id: string; values: EmailTemplateUpdate }>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('email_templates')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: EMAIL_TEMPLATES_QUERY_KEY });
    },
  });
}

export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation<EmailTemplateRow, Error, EmailTemplateInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('email_templates')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: EMAIL_TEMPLATES_QUERY_KEY });
    },
  });
}
