// apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts
//
// S73 Lot 2 — org-level customer-display copy + payment auto-toggles, read
// straight off business_config (RLS auth_read; kiosk JWT on the paired
// display). Degrades to the built-in defaults while loading / on error — a
// config read must never block an encaissement (pattern: useTaxRate).
// Writes go through set_setting_v1 (settings.update gate, audit-logged).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'org-display-settings'] as const;

export interface OrgDisplaySettings {
  displayFooterMessage: string;
  displaySlogan: string;
  autoPrint: boolean;
  autoOpenDrawer: boolean;
}

const DEFAULTS: OrgDisplaySettings = {
  displayFooterMessage: '',
  displaySlogan: '',
  autoPrint: true,
  autoOpenDrawer: true,
};

export function useOrgDisplaySettings(): OrgDisplaySettings & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_config')
        .select('display_footer_message, display_slogan, pos_auto_print_receipt, pos_auto_open_drawer')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  return {
    displayFooterMessage: data?.display_footer_message ?? DEFAULTS.displayFooterMessage,
    displaySlogan: data?.display_slogan ?? DEFAULTS.displaySlogan,
    autoPrint: data?.pos_auto_print_receipt ?? DEFAULTS.autoPrint,
    autoOpenDrawer: data?.pos_auto_open_drawer ?? DEFAULTS.autoOpenDrawer,
    isLoading,
  };
}

export function useSetOrgDisplaySetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value, category }: {
      key: 'display_footer_message' | 'display_slogan' | 'pos_auto_print_receipt' | 'pos_auto_open_drawer';
      value: string | boolean;
      category: 'customer_display' | 'printing';
    }) => {
      const { error } = await supabase.rpc('set_setting_v1', {
        p_key: key,
        p_value: value as unknown as Json,
        p_category: category,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
