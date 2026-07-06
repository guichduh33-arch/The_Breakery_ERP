// apps/backoffice/src/features/settings/hooks/useSettings.ts
//
// Session 13 / Phase 5.C — Reads a partition of business_config via
// get_settings_by_category_v1. The RPC returns `{ category, settings: { key: value, ... } }`.
// Keys per category are documented in the migration.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type SettingsCategory = 'business' | 'localization' | 'tax' | 'pos' | 'inventory' | 'payments';

export interface SettingsPayload {
  category: string;
  settings: Record<string, unknown>;
}

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export function useSettings(category: SettingsCategory) {
  return useQuery<SettingsPayload>({
    queryKey: [...SETTINGS_QUERY_KEY, category] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_settings_by_category_v1', {
        p_category: category,
      });
      if (error) throw error;
      // RPC returns JSONB; supabase-js typed it as Json. Coerce.
      return (data ?? { category, settings: {} }) as unknown as SettingsPayload;
    },
  });
}
