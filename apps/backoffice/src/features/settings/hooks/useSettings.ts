// apps/backoffice/src/features/settings/hooks/useSettings.ts
//
// Session 13 / Phase 5.C — Reads a partition of business_config via
// get_settings_by_category_v5. The RPC returns `{ category, settings: { key: value, ... } }`.
// Keys per category are documented in the migration.

import { useQuery } from '@tanstack/react-query';
import type { SettingsCategory } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';

// S73 Phase 3 — category union now lives in the shared dictionary
// (packages/supabase/src/settings-keys.ts), re-exported here so existing
// call sites importing `SettingsCategory` from this hook keep working.
export type { SettingsCategory };

export interface SettingsPayload {
  category: string;
  settings: Record<string, unknown>;
}

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export function useSettings(category: SettingsCategory) {
  return useQuery<SettingsPayload>({
    queryKey: [...SETTINGS_QUERY_KEY, category] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_settings_by_category_v5', {
        p_category: category,
      });
      if (error) throw error;
      // RPC returns JSONB; supabase-js typed it as Json. Coerce.
      return (data ?? { category, settings: {} }) as unknown as SettingsPayload;
    },
  });
}
