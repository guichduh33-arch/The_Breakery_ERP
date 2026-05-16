// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 15 / Phase 4.A — Aggregate ingredient preview for a multi-recipe batch.
//
// For every selected (productId, quantity_produced + quantity_waste) item :
//   1. Fetch its active recipe rows via list_recipes_v1 (cached by useRecipes).
//   2. Expand each row via `@breakery/domain` expandRecipe to get material qty
//      in the material's stock unit.
//   3. Sum requirements across items by material_id.
//   4. Compare to a stock snapshot (products.current_stock).
//
// Sub-recipe cascade approximation : we only walk depth-1 (each row's
// material as-is). Sub-recipes that ARE themselves recipes will still show
// in the table — but their leaves are NOT recursively expanded. The actual
// server-side validation in record_batch_production_v1 DOES cascade fully,
// so this preview is conservative ; if a sub-recipe is short the server is
// the source of truth on submit.

import { useMemo, type JSX } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { expandRecipe, UnknownUnitConversionError, type RecipeRow } from '@breakery/domain';
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

// Reuse the same recipes hook query shape so cache hits if RecipeEditor also
// loaded the same product.
function useRecipesPerProduct(productIds: string[]) {
  return useQueries({
    queries: productIds.map((pid) => ({
      queryKey: ['inventory-production', 'recipes', pid] as const,
      enabled:  pid !== '',
      staleTime: 30_000,
      queryFn: async (): Promise<RecipeRow[]> => {
        const { data, error } = await supabase.rpc('list_recipes_v1', { p_product_id: pid });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RecipeRow[];
      },
    })),
  });
}

// Snapshot of current_stock for the materials we need. Keyed by material_id.
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
      for (const row of data ?? []) {
        out[row.id as string] = Number(row.current_stock);
      }
      return out;
    },
  });
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function IngredientAggregatePreview({
  items,
}: IngredientAggregatePreviewProps): JSX.Element {
  // Valid rows = product chosen + qty parseable & > 0.
  const validRows = useMemo(
    () =>
      items.filter((it) => {
        if (it.productId === null) return false;
        const q = Number.parseFloat(it.quantityProduced);
        return Number.isFinite(q) && q > 0;
      }),
    [items],
  );

  const productIds = useMemo(
    () => Array.from(new Set(validRows.map((r) => r.productId as string))),
    [validRows],
  );

  const recipeQueries = useRecipesPerProduct(productIds);
  const recipesByProductId = useMemo(() => {
    const map: Record<string, RecipeRow[]> = {};
    productIds.forEach((pid, idx) => {
      const q = recipeQueries[idx];
      if (q?.data !== undefined) map[pid] = q.data;
    });
    return map;
  }, [recipeQueries, productIds]);

  // Aggregate per-leaf totals across items.
  const { aggregated, error } = useMemo<{
    aggregated: Map<string, Omit<AggregatedRow, 'available' | 'sufficient' | 'shortfall'>>;
    error: string | null;
  }>(() => {
    const agg = new Map<string, Omit<AggregatedRow, 'available' | 'sufficient' | 'shortfall'>>();
    try {
      for (const row of validRows) {
        const recipe = recipesByProductId[row.productId as string];
        if (recipe === undefined) continue; // still loading
        const qty   = Number.parseFloat(row.quantityProduced);
        const waste = Number.parseFloat(row.quantityWaste) || 0;
        const multiplier = qty + waste;
        if (multiplier <= 0) continue;
        const expanded = expandRecipe(recipe, multiplier);
        for (const e of expanded) {
          const cur = agg.get(e.material_id);
          if (cur !== undefined) {
            cur.totalQty += e.quantity_in_material_unit;
          } else {
            agg.set(e.material_id, {
              materialId:   e.material_id,
              materialName: e.material_name,
              materialUnit: e.material_unit,
              totalQty:     e.quantity_in_material_unit,
            });
          }
        }
      }
      return { aggregated: agg, error: null };
    } catch (err) {
      if (err instanceof UnknownUnitConversionError) {
        return { aggregated: agg, error: `Unit conversion not supported: ${err.from} -> ${err.to}` };
      }
      return { aggregated: agg, error: 'Failed to compute ingredient preview.' };
    }
  }, [validRows, recipesByProductId]);

  const materialIds = useMemo(() => Array.from(aggregated.keys()), [aggregated]);
  const stockQ = useMaterialStockSnapshot(materialIds);

  const rows: AggregatedRow[] = useMemo(() => {
    const stockMap = stockQ.data ?? {};
    return Array.from(aggregated.values())
      .map((r) => {
        const available = stockMap[r.materialId] ?? 0;
        const shortfall = Math.max(0, r.totalQty - available);
        return { ...r, available, sufficient: shortfall === 0, shortfall };
      })
      .sort((a, b) => {
        // Shortages first, then alphabetical.
        if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
        return a.materialName.localeCompare(b.materialName);
      });
  }, [aggregated, stockQ.data]);

  const recipesLoading = recipeQueries.some((q) => q.isLoading);
  const stockLoading   = stockQ.isLoading;
  const anyShortage    = rows.some((r) => !r.sufficient);

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
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      )}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Pick a recipe and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : recipesLoading || stockLoading ? (
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
