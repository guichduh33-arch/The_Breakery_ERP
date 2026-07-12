// apps/pos/src/features/kds/hooks/useKdsConfig.ts
//
// S75 lot 2 (task 6) — server-authoritative KDS ageing/archive thresholds.
//
// Reads `business_config.kds_warning_threshold_minutes` /
// `kds_urgent_threshold_minutes` / `kds_auto_archive_minutes` (task 5, org
// row id=1) so the KDS card colour bands (KdsOrderCard), the urgent re-bip
// (useKdsAlarm) and the ready-item auto-archive (KdsBoard) all read the same
// BO-configurable numbers instead of the hardcoded 300s/600s/5min constants.
//
// Mirrors `useTaxRate` / `useEnabledPaymentMethods`: a config read must never
// block the KDS from rendering, so this hook NEVER returns `undefined` —
// while the query is loading, on a network/permission error, or when a
// legacy row still has NULL columns, it falls back silently to
// `KDS_CONFIG_DEFAULTS` (5min / 10min / 5min, the values already baked into
// the pre-S75 constants).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface KdsConfig {
  warningMs: number;
  urgentMs: number;
  archiveMs: number;
}

export const KDS_CONFIG_DEFAULTS: KdsConfig = {
  warningMs: 300_000,
  urgentMs: 600_000,
  archiveMs: 300_000,
};

const QUERY_KEY = ['kds_config'] as const;

function toMs(minutes: unknown, fallbackMs: number): number {
  // A literal SQL NULL (legacy row) arrives as `null` — treat it as missing.
  // Crucially, `Number(null) === 0` would otherwise pass the `>= 0` guard and
  // yield 0ms (every ticket instantly urgent), so guard nullish FIRST.
  if (minutes == null) return fallbackMs;
  const n = Number(minutes);
  return Number.isFinite(n) && n >= 0 ? n * 60_000 : fallbackMs;
}

/**
 * Live KDS thresholds, always usable synchronously. Returns
 * `KDS_CONFIG_DEFAULTS` while loading, on error, or when the row's columns
 * are NULL — a config read must never block the kitchen board.
 */
export function useKdsConfig(): KdsConfig {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<KdsConfig> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('kds_warning_threshold_minutes, kds_urgent_threshold_minutes, kds_auto_archive_minutes')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        warningMs: toMs(data?.kds_warning_threshold_minutes, KDS_CONFIG_DEFAULTS.warningMs),
        urgentMs: toMs(data?.kds_urgent_threshold_minutes, KDS_CONFIG_DEFAULTS.urgentMs),
        archiveMs: toMs(data?.kds_auto_archive_minutes, KDS_CONFIG_DEFAULTS.archiveMs),
      };
    },
  });
  return data ?? KDS_CONFIG_DEFAULTS;
}
