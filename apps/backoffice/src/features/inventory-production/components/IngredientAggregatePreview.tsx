// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 17 — Phase 2.A — Server-side cascade via recipe_bom_full_v1.
//
// Previously did 2 static useQueries rounds capped at depth-2 (DEV-S16-2.C-02).
// Now does one round (one RPC call per root), full depth-5 cascade server-side.
// expandRecipeCascade is no longer used here ; it remains exported from
// @breakery/domain for RecipeEditor live preview (which needs to project
// unsaved client-side recipe changes).

import { useMemo, type JSX } from 'react';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { BatchItem } from './BatchSelector.js';

export interface IngredientAggregatePreviewProps { items: BatchItem[]; }

interface BomLeafRow {
  material_id:   string;
  material_name: string;
  material_unit: string;
  qty_per_unit:  number;
  current_stock: number;
  cost_price:    number;
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function IngredientAggregatePreview({ items }: IngredientAggregatePreviewProps): JSX.Element {
  const validRows = useMemo(
    () => items.filter((it) => {
      if (it.productId === null) return false;
      const q = Number.parseFloat(it.quantityProduced);
      return Number.isFinite(q) && q > 0;
    }),
    [items],
  );

  const bomQueries = useQueries({
    queries: validRows.map((row) => ({
      queryKey: ['inv-prod', 'bom-full', row.productId] as const,
      enabled:  row.productId !== null,
      staleTime: 30_000,
      queryFn: async (): Promise<BomLeafRow[]> => {
        const { data, error } = await supabase.rpc('recipe_bom_full_v1', {
          p_product_id: row.productId as string,
          p_max_depth:  5,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as BomLeafRow[];
      },
    })),
  });

  const loading = bomQueries.some((q) => q.isLoading);
  const errorMsg = bomQueries.find((q) => q.error)?.error?.message ?? null;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bomDataUpdatedKeys = bomQueries.map((q) => q.dataUpdatedAt).join(',');

  const rows: AggregatedRow[] = useMemo(() => {
    const acc = new Map<string, { name: string; unit: string; totalQty: number; available: number }>();
    validRows.forEach((row, i) => {
      const bom = bomQueries[i]?.data;
      if (!bom) return;
      const qty = Number.parseFloat(row.quantityProduced) || 0;
      const waste = Number.parseFloat(row.quantityWaste) || 0;
      const mult = qty + waste;
      if (mult <= 0) return;
      for (const leaf of bom) {
        const need = leaf.qty_per_unit * mult;
        const existing = acc.get(leaf.material_id);
        if (existing) {
          existing.totalQty += need;
        } else {
          acc.set(leaf.material_id, {
            name: leaf.material_name, unit: leaf.material_unit,
            totalQty: need, available: leaf.current_stock,
          });
        }
      }
    });
    return Array.from(acc.entries())
      .map(([materialId, x]) => {
        const shortfall = Math.max(0, x.totalQty - x.available);
        return {
          materialId, materialName: x.name, materialUnit: x.unit,
          totalQty: x.totalQty, available: x.available,
          sufficient: shortfall === 0, shortfall,
        };
      })
      .sort((a, b) => {
        if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
        return a.materialName.localeCompare(b.materialName);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, bomDataUpdatedKeys]);

  const anyShortage = rows.some((r) => !r.sufficient);

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

      {errorMsg !== null && <p role="alert" className="text-xs text-red">{errorMsg}</p>}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Pick a recipe and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : loading ? (
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
