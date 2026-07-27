// apps/pos/src/features/settings/hooks/useOfflineNetworkConfig.ts
//
// ADR-015 — réglages org de la catégorie `network` (migration _252) côté POS.
// Miroir du pattern useEnabledPaymentMethods : SELECT direct business_config
// sous le JWT PIN (pas de gate settings.read), staleTime court.
//
// FAIL-CLOSED sur offline_payments_enabled (défaut false — l'activation du
// hors-ligne est explicite). En coupure cloud, TanStack sert la dernière valeur
// cachée : la config lue AVANT la coupure fait foi pendant la coupure —
// comportement voulu.
//
// La fenêtre offline_max_hours a été supprimée par ADR-015 : une coupure longue
// ne bloque plus les encaissements.

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface OfflineNetworkConfig {
  offlinePaymentsEnabled: boolean;
}

export const OFFLINE_NETWORK_DEFAULTS: OfflineNetworkConfig = {
  offlinePaymentsEnabled: false,
};

const QUERY_KEY = ['business-config', 'offline-network'] as const;

async function fetchConfig(): Promise<OfflineNetworkConfig> {
  const { data, error } = await supabase
    .from('business_config')
    .select('offline_payments_enabled')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { offlinePaymentsEnabled: data?.offline_payments_enabled === true };
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
