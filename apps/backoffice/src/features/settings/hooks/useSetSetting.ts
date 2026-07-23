// apps/backoffice/src/features/settings/hooks/useSetSetting.ts
//
// Session 13 / Phase 5.C — Wraps set_setting_v7. ADMIN+ via settings.update.
// One mutation per (key, value) pair ; the page commits each row in
// sequence so the audit trail captures one entry per field change.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SETTINGS_QUERY_KEY, type SettingsCategory } from './useSettings.js';

export interface SetSettingArgs {
  key: string;
  value: unknown;
  category: SettingsCategory;
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation<void, Error, SetSettingArgs>({
    mutationFn: async ({ key, value, category }) => {
      const { error } = await supabase.rpc('set_setting_v7', {
        p_key: key,
        // RPC validates JSONB type per key — pass the raw value, supabase-js
        // will JSON-encode it.
        p_value: value as never,
        p_category: category,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}
