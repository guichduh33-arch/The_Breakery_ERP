// apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts
//
// Session 15 — Phase 2.B — fetch recipe_versions for a product, DESC by
// version_number, joining created_by → user_profiles.full_name in a second
// pass (mirrors useProductionRecords pattern, avoids PostgREST relation
// typing complexity).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Single ingredient snapshot row inside `recipe_versions.snapshot` (JSONB). */
export interface RecipeVersionSnapshotRow {
  recipe_id:     string;
  material_id:   string;
  material_name: string;
  quantity:      number;
  unit:          string;
  notes?:        string | null;
}

export interface RecipeVersionRow {
  id:               string;
  product_id:       string;
  version_number:   number;
  snapshot:         RecipeVersionSnapshotRow[];
  created_at:       string;
  created_by:       string | null;
  created_by_name?: string;
  change_note:      string | null;
}

export function useRecipeVersions(productId: string | null) {
  return useQuery<RecipeVersionRow[]>({
    queryKey: ['inventory-production', 'recipe-versions', productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async (): Promise<RecipeVersionRow[]> => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('id, product_id, version_number, snapshot, created_at, created_by, change_note')
        .eq('product_id', productId!)
        .order('version_number', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        product_id: string;
        version_number: number;
        snapshot: unknown;
        created_at: string;
        created_by: string | null;
        change_note: string | null;
      }>;

      // Resolve created_by → full_name in a second pass.
      const userIds = Array.from(new Set(
        rows.map((r) => r.created_by).filter((v): v is string => v !== null),
      ));
      const nameById: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users, error: userErr } = await supabase
          .from('user_profiles')
          .select('id, full_name')
          .in('id', userIds);
        if (userErr) throw userErr;
        for (const u of users ?? []) {
          nameById[u.id as string] = u.full_name as string;
        }
      }

      return rows.map((r): RecipeVersionRow => {
        const snap = Array.isArray(r.snapshot)
          ? (r.snapshot as RecipeVersionSnapshotRow[])
          : [];
        const base: RecipeVersionRow = {
          id:             r.id,
          product_id:     r.product_id,
          version_number: r.version_number,
          snapshot:       snap,
          created_at:     r.created_at,
          created_by:     r.created_by,
          change_note:    r.change_note,
        };
        if (r.created_by !== null) {
          const name = nameById[r.created_by];
          if (name !== undefined) base.created_by_name = name;
        }
        return base;
      });
    },
  });
}
