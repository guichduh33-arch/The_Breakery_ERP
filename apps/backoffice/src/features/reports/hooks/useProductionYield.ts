// apps/backoffice/src/features/reports/hooks/useProductionYield.ts
//
// Lot A1 (campagne Reports 2026-08-15) — extrait de ProductionYieldPage, où ce
// hook vivait en local : seule source de données du module hors du dossier
// hooks. Lecture directe de `production_records` (pas de RPC dédiée —
// l'agrégation client est bon marché aux volumes 30 jours typiques) ; le
// contrôle d'accès repose sur la RLS des tables, pas sur une gate reports.*.
//
// `production_records.yield_variance_pct` est un NUMERIC(7,4) stocké en
// FRACTION (`-0.1667` = `-16.67%`) : tout le calcul garde cette forme, seule la
// couche d'affichage multiplie par 100.

import { useQuery } from '@tanstack/react-query';
import { toLocalDayStartUTC, toLocalDayEndUTC } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export interface YieldRow {
  id:                 string;
  production_number:  string;
  product_id:         string;
  product_name:       string;
  production_date:    string;
  expected_yield_qty: number | null;
  actual_yield_qty:   number | null;
  yield_variance_pct: number | null;
  yield_variance_reason: string | null;
}

/** Server-side row cap — surfaced to the user via `truncated`. */
export const YIELD_ROW_CAP = 1000;

export interface YieldResult {
  rows:      YieldRow[];
  truncated: boolean;
}

export function useProductionYield(start: string, end: string) {
  return useQuery<YieldResult>({
    queryKey: ['reports', 'production-yield', start, end] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<YieldResult> => {
      // production_date is timestamptz. Audit R-03 : les bornes étaient écrites
      // `${start}T00:00:00Z` / `${end}T23:59:59Z`, donc en UTC, alors que
      // `start`/`end` sont des dates MÉTIER (Asia/Makassar, UTC+8). La fenêtre
      // était décalée de 8 h dans les deux sens. On passe par les helpers du
      // domaine, qui résolvent le fuseau.
      const startTs = toLocalDayStartUTC(start).toISOString();
      const endTs   = toLocalDayEndUTC(end).toISOString();
      const { data, error } = await supabase
        .from('production_records')
        .select('id, production_number, product_id, production_date, expected_yield_qty, actual_yield_qty, yield_variance_pct, yield_variance_reason')
        .gte('production_date', startTs)
        .lte('production_date', endTs)
        .is('reverted_at', null)
        .order('production_date', { ascending: false })
        .limit(YIELD_ROW_CAP);
      if (error) throw error;
      const rows = data ?? [];

      const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
      const nameById: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: prods, error: pe } = await supabase
          .from('products')
          .select('id, name')
          .in('id', productIds);
        if (pe) throw pe;
        for (const p of prods ?? []) nameById[p.id] = p.name;
      }

      return {
        rows: rows.map((r): YieldRow => ({
          id: r.id,
          production_number: r.production_number,
          product_id: r.product_id,
          product_name: nameById[r.product_id] ?? '—',
          production_date: r.production_date,
          expected_yield_qty: r.expected_yield_qty === null ? null : Number(r.expected_yield_qty),
          actual_yield_qty:   r.actual_yield_qty   === null ? null : Number(r.actual_yield_qty),
          yield_variance_pct: r.yield_variance_pct === null ? null : Number(r.yield_variance_pct),
          yield_variance_reason: r.yield_variance_reason,
        })),
        truncated: rows.length >= YIELD_ROW_CAP,
      };
    },
  });
}
