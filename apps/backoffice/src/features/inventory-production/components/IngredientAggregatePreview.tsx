// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 16 / Phase 2.C — sub-recipe cascade preview (depth-2 BFS).
//
// For each (productId, qty_produced + qty_waste) :
//   1. Build a RecipeGraph via two static `useQueries` rounds
//      (roots + direct children). Products discovered at level-2 that are
//      themselves recipes will appear as leaves in the preview because the
//      builder does NOT iterate to level-3+. For The Breakery's current
//      bakery recipes (typically ≤ 2 levels) this is exact ; for deeper
//      nesting the preview is an approximation and `record_batch_production_v1`
//      server cascade remains the source of truth (DEV-S16-2.C-02 tracks the
//      future `recipe_bom_full_v1` RPC to remove this limitation).
//   2. Call expandRecipeCascade(graph, productId, multiplier) — leaves only,
//      where "leaves" is relative to the level-2-capped graph built above.
//   3. Sum requirements by material_id.
//   4. Compare to a fresh products.current_stock snapshot.

import { useMemo, type JSX } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  expandRecipeCascade,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphProduct,
  type RecipeGraphRow,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import type { BatchItem } from './BatchSelector.js';

export interface IngredientAggregatePreviewProps {
  items: BatchItem[];
}

interface AggregatedRow {
  materialId:   string;
  materialName: string;
  materialUnit: string;
  totalQty:     number;
  available:    number;
  sufficient:   boolean;
  shortfall:    number;
}

interface RpcRecipeRow {
  recipe_id:     string;
  product_id:    string;
  product_name:  string;
  product_unit:  string;
  material_id:   string;
  material_name: string;
  material_unit: string;
  material_cost_price: number;
  quantity:      number;
  unit:          string;
  is_active:     boolean;
  notes:         string | null;
}

const MAX_BFS_DEPTH = 5;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function useGraphBuilder(rootProductIds: string[]): {
  graph: RecipeGraph | null;
  loading: boolean;
} {
  const level1 = useQueries({
    queries: rootProductIds.map((pid) => ({
      queryKey: ['inventory-production', 'recipes', pid] as const,
      enabled:  pid !== '',
      staleTime: 30_000,
      queryFn: async (): Promise<RpcRecipeRow[]> => {
        const { data, error } = await supabase.rpc('list_recipes_v1', { p_product_id: pid });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RpcRecipeRow[];
      },
    })),
  });

  const { discoveredIds, allRows, level1Loading } = useMemo(() => {
    const rowsAcc: RpcRecipeRow[] = [];
    const ids = new Set<string>(rootProductIds);
    let isLoading = false;
    level1.forEach((q) => {
      if (q.isLoading) isLoading = true;
      if (q.data !== undefined) {
        for (const row of q.data) {
          rowsAcc.push(row);
          ids.add(row.material_id);
        }
      }
    });
    return { discoveredIds: Array.from(ids), allRows: rowsAcc, level1Loading: isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level1.map((q) => q.dataUpdatedAt).join(','), rootProductIds.join(',')]);

  const candidates = useMemo(
    () => discoveredIds.filter((id) => !rootProductIds.includes(id)),
    [discoveredIds, rootProductIds],
  );
  const childQueries = useQueries({
    queries: candidates.map((pid) => ({
      queryKey: ['inventory-production', 'recipes', pid] as const,
      enabled:  pid !== '' && !level1Loading,
      staleTime: 30_000,
      queryFn: async (): Promise<RpcRecipeRow[]> => {
        const { data, error } = await supabase.rpc('list_recipes_v1', { p_product_id: pid });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RpcRecipeRow[];
      },
    })),
  });

  const { graph, loading } = useMemo<{ graph: RecipeGraph | null; loading: boolean }>(() => {
    let stillLoading = level1Loading;
    const accRows: RpcRecipeRow[] = [...allRows];
    const productMap: Record<string, RecipeGraphProduct> = {};
    childQueries.forEach((q) => {
      if (q.isLoading) stillLoading = true;
      if (q.data !== undefined) {
        for (const row of q.data) accRows.push(row);
      }
    });

    if (stillLoading) return { graph: null, loading: true };

    const recipes: RecipeGraphRow[] = [];
    for (const row of accRows) {
      productMap[row.product_id] = {
        id: row.product_id, name: row.product_name, unit: row.product_unit, cost_price: 0,
      };
      productMap[row.material_id] = {
        id: row.material_id, name: row.material_name, unit: row.material_unit,
        cost_price: Number(row.material_cost_price) || 0,
      };
      recipes.push({
        product_id: row.product_id, material_id: row.material_id,
        quantity: Number(row.quantity), unit: row.unit,
      });
    }
    return { graph: { products: productMap, recipes }, loading: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level1Loading, allRows, childQueries.map((q) => q.dataUpdatedAt).join(',')]);

  return { graph, loading };
}

function useMaterialStockSnapshot(materialIds: string[]) {
  return useQuery({
    queryKey: ['inventory-production', 'material-stock-snapshot', [...materialIds].sort()] as const,
    enabled:  materialIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, current_stock')
        .in('id', materialIds);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const r of data ?? []) out[r.id as string] = Number(r.current_stock);
      return out;
    },
  });
}

export function IngredientAggregatePreview({
  items,
}: IngredientAggregatePreviewProps): JSX.Element {
  const validRows = useMemo(
    () => items.filter((it) => {
      if (it.productId === null) return false;
      const q = Number.parseFloat(it.quantityProduced);
      return Number.isFinite(q) && q > 0;
    }),
    [items],
  );

  const rootProductIds = useMemo(
    () => Array.from(new Set(validRows.map((r) => r.productId as string))),
    [validRows],
  );

  const { graph, loading: graphLoading } = useGraphBuilder(rootProductIds);

  const { aggregated, error } = useMemo<{
    aggregated: Map<string, { name: string; unit: string; totalQty: number }>;
    error:      string | null;
  }>(() => {
    const out = new Map<string, { name: string; unit: string; totalQty: number }>();
    if (graph === null) return { aggregated: out, error: null };
    try {
      for (const row of validRows) {
        const productId = row.productId as string;
        const qty   = Number.parseFloat(row.quantityProduced);
        const waste = Number.parseFloat(row.quantityWaste) || 0;
        const multiplier = qty + waste;
        if (multiplier <= 0) continue;
        const leaves = expandRecipeCascade(graph, productId, multiplier, { maxDepth: MAX_BFS_DEPTH });
        for (const [matId, leaf] of leaves) {
          const cur = out.get(matId);
          if (cur !== undefined) cur.totalQty += leaf.qty;
          else out.set(matId, { name: leaf.name, unit: leaf.unit, totalQty: leaf.qty });
        }
      }
      return { aggregated: out, error: null };
    } catch (err) {
      if (err instanceof RecipeCycleError) {
        return { aggregated: out, error: `Recipe cycle detected (${err.path.join(' -> ')}).` };
      }
      if (err instanceof RecipeDepthExceededError) {
        return { aggregated: out, error: `Recipe nesting too deep (>${MAX_BFS_DEPTH}).` };
      }
      return { aggregated: out, error: 'Failed to compute ingredient preview.' };
    }
  }, [validRows, graph]);

  const materialIds = useMemo(() => Array.from(aggregated.keys()), [aggregated]);
  const stockQ = useMaterialStockSnapshot(materialIds);

  const rows: AggregatedRow[] = useMemo(() => {
    const stockMap = stockQ.data ?? {};
    return Array.from(aggregated.entries())
      .map(([materialId, leaf]) => {
        const available = stockMap[materialId] ?? 0;
        const shortfall = Math.max(0, leaf.totalQty - available);
        return {
          materialId, materialName: leaf.name, materialUnit: leaf.unit,
          totalQty: leaf.totalQty, available,
          sufficient: shortfall === 0, shortfall,
        };
      })
      .sort((a, b) => {
        if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
        return a.materialName.localeCompare(b.materialName);
      });
  }, [aggregated, stockQ.data]);

  const anyShortage = rows.some((r) => !r.sufficient);
  const stockLoading = stockQ.isLoading;

  return (
    <div data-testid="ingredient-aggregate-preview"
         className="rounded-md border border-border-subtle bg-bg-elevated p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-lg">Aggregate ingredient preview</h3>
        {validRows.length > 0 && (
          <span className="text-xs text-text-secondary">
            {validRows.length} item{validRows.length === 1 ? '' : 's'} ·
            {rows.length} ingredient{rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-xs text-red">{error}</p>
      )}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Pick a recipe and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : graphLoading || stockLoading ? (
        <p className="text-sm text-text-secondary">Computing requirements…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary">No recipes resolved yet.</p>
      ) : (
        <>
          {anyShortage && (
            <p role="alert" className="text-xs text-red">
              One or more ingredients are short. The server will reject submission.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="py-1">Material</th>
                <th className="py-1 text-right">Required</th>
                <th className="py-1 text-right">Available</th>
                <th className="py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.materialId} className="border-t border-border-subtle">
                  <td className="py-1.5">{r.materialName}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(r.totalQty)} {r.materialUnit}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(r.available)} {r.materialUnit}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.sufficient ? (
                      <span className="text-success" data-testid="status-ok">OK</span>
                    ) : (
                      <span className="text-red" data-testid="status-short">
                        short {fmt(r.shortfall)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
