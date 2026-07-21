// apps/pos/src/features/settings/hooks/useOfflineNetworkConfig.ts
//
// Spec 006x lot 4 — réglages org de la catégorie `network` (migration _197)
// côté POS. Miroir du pattern useEnabledPaymentMethods : SELECT direct
// business_config sous le JWT PIN (pas de gate settings.read), staleTime court.
//
// FAIL-CLOSED sur offline_cash_enabled (défaut false — l'activation du cash
// offline est explicite, arbitrage A1b) ; défaut 4 h sur la fenêtre (A5).
// En coupure cloud, TanStack sert la dernière valeur cachée : la config lue
// AVANT la coupure fait foi pendant la coupure — comportement voulu.

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface OfflineNetworkConfig {
  offlineCashEnabled: boolean;
  offlineMaxHours: number;
}

export const OFFLINE_NETWORK_DEFAULTS: OfflineNetworkConfig = {
  offlineCashEnabled: false,
  offlineMaxHours: 4,
};

const QUERY_KEY = ['business-config', 'offline-network'] as const;

async function fetchConfig(): Promise<OfflineNetworkConfig> {
  const { data, error } = await supabase
    .from('business_config')
    .select('offline_cash_enabled, offline_max_hours')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    offlineCashEnabled: data?.offline_cash_enabled === true,
    offlineMaxHours:
      typeof data?.offline_max_hours === 'number' && data.offline_max_hours >= 1
        ? data.offline_max_hours
        : OFFLINE_NETWORK_DEFAULTS.offlineMaxHours,
  };
}

export function useOfflineNetworkConfig(): OfflineNetworkConfig {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: fetchConfig,
  });
  return data ?? OFFLINE_NETWORK_DEFAULTS;
}

/** Lecture ponctuelle (mutations) — cache d'abord, fetch sinon ; défauts
 *  fail-closed si tout échoue (cloud down + cache froid). */
export async function getOfflineNetworkConfig(queryClient: QueryClient): Promise<OfflineNetworkConfig> {
  const cached = queryClient.getQueryData<OfflineNetworkConfig>(QUERY_KEY);
  if (cached !== undefined) return cached;
  try {
    return await queryClient.fetchQuery({ queryKey: QUERY_KEY, queryFn: fetchConfig });
  } catch {
    return OFFLINE_NETWORK_DEFAULTS;
  }
}
