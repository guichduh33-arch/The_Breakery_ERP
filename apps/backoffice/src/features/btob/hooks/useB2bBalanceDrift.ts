// apps/backoffice/src/features/btob/hooks/useB2bBalanceDrift.ts
//
// S76 — câblage inventaire ⚫ #12 : expose reconcile_b2b_balance_v1
// (alerte drift solde cache customers.b2b_current_balance ↔ ledger dérivé).
// Lecture pure, gate serveur b2b.read (P0003) — n'activer la query que si
// le caller a la permission pour éviter le bruit d'erreurs.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bBalanceDriftRow {
  customer_id:     string;
  customer_name:   string;
  cached_balance:  number;
  derived_balance: number;
  drift:           number;
  has_drift:       boolean;
}

export const B2B_DRIFT_QK = ['b2b', 'balance-drift'] as const;

export function useB2bBalanceDrift(enabled: boolean) {
  return useQuery({
    queryKey: B2B_DRIFT_QK,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<B2bBalanceDriftRow[]> => {
      const { data, error } = await supabase.rpc('reconcile_b2b_balance_v1');
      if (error) throw error;
      return data ?? [];
    },
  });
}
