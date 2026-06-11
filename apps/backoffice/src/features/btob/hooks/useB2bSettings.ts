// apps/backoffice/src/features/btob/hooks/useB2bSettings.ts
//
// Session 39 / Wave C2 — fetch b2b_settings singleton via get_b2b_settings_v1 RPC.
// Gate: settings.read (enforced server-side by RPC).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface AgingBucket {
  label: string;
  min: number;
  max: number | null;
}

export interface B2bSettings {
  default_payment_terms: string;
  available_payment_terms: string[];
  critical_overdue_days: number;
  aging_buckets: AgingBucket[];
}

export const B2B_SETTINGS_QUERY_KEY = ['b2b-settings'] as const;

export function useB2bSettings() {
  return useQuery<B2bSettings>({
    queryKey: B2B_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_b2b_settings_v1');
      if (error) throw error;
      return data as unknown as B2bSettings;
    },
  });
}
