// apps/backoffice/src/features/inventory-production/hooks/useUnits.ts
//
// Reads the central units registry (public.units, RLS-read for authenticated).
// Single source of truth for the app's unit dropdowns + dimensional metadata.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface UnitRow {
  code:                string;
  label:               string;
  dimension:           'mass' | 'volume' | 'count' | 'container';
  factor_to_canonical: number | null;
}

export const UNITS_QUERY_KEY = ['units'] as const;

export function useUnits() {
  return useQuery<UnitRow[]>({
    queryKey: UNITS_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units')
        .select('code, label, dimension, factor_to_canonical')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return (data ?? []) as UnitRow[];
    },
  });
}

/**
 * Units a recipe line may use for a material whose base/stock unit is
 * `materialUnit`: every registry unit sharing the material's dimension
 * (so a kg-based material offers mg/g/gr/kg). Falls back to just the
 * material's own unit when it isn't in the registry. Pure + testable.
 */
export function eligibleRecipeUnits(materialUnit: string, units: UnitRow[]): string[] {
  if (materialUnit === '') return units.map((u) => u.code);
  const dim = units.find((u) => u.code === materialUnit)?.dimension;
  if (dim === undefined) return [materialUnit];
  const sameDim = units.filter((u) => u.dimension === dim).map((u) => u.code);
  return sameDim.includes(materialUnit) ? sameDim : [materialUnit, ...sameDim];
}
