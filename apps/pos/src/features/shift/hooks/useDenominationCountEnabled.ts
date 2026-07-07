// apps/pos/src/features/shift/hooks/useDenominationCountEnabled.ts
//
// S67 (12 D2.3) — flag business_config.shift_denomination_count_enabled.
// Miroir du pattern useEnabledPaymentMethods (SELECT direct sous JWT PIN),
// mais FAIL-CLOSED (false) : une panne de config ne doit jamais forcer la
// grille et bloquer une ouverture/clôture. Le serveur (close_shift_v5) reste
// l'autorité — si le flag est réellement ON et le client l'a raté, la clôture
// échoue en denominations_required et l'UI affiche le message mappé.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useDenominationCountEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['business-config', 'shift-denomination-count-enabled'],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('shift_denomination_count_enabled')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.shift_denomination_count_enabled === true;
    },
  });
  return data === true;
}
