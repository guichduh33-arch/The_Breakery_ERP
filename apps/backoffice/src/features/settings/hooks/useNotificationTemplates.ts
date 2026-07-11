// apps/backoffice/src/features/settings/hooks/useNotificationTemplates.ts
// S73 Lot 3 — system notification templates (channel in_app/email; consumed by
// enqueue_notification_v1). Update-only: codes are system events.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type NotificationTemplateRow    = Database['public']['Tables']['notification_templates']['Row'];
export type NotificationTemplateUpdate = Database['public']['Tables']['notification_templates']['Update'];

export const NOTIFICATION_TEMPLATES_QUERY_KEY = ['notification-templates'] as const;

export function useNotificationTemplatesList() {
  return useQuery<NotificationTemplateRow[]>({
    queryKey: NOTIFICATION_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_templates').select('*').order('code', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation<NotificationTemplateRow, Error, { id: string; values: NotificationTemplateUpdate }>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('notification_templates').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: NOTIFICATION_TEMPLATES_QUERY_KEY }); },
  });
}
