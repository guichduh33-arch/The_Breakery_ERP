// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 17 — Phase 2.A — Server-side cascade via recipe_bom_full_v5.
//
// Monté par ProductionEntryCard (l'écran de production atteignable). Il vivait
// auparavant sur la page batch, inatteignable sans taper son URL : l'écran
// réellement utilisé n'apprenait la pénurie qu'après le refus serveur.
//
// Previously did 2 static useQueries rounds capped at depth-2 (DEV-S16-2.C-02).
// Now does one round (one RPC call per root), cascade résolue côté serveur.
//
// ADR-016 — l'aperçu liste ce qui sera réellement consommé : la cascade
// s'arrête au premier intermédiaire suivi en stock, qui apparaît donc comme
// ingrédient à part entière au lieu de ses matières.
// expandRecipeCascade (in @breakery/domain) is no longer used here. It remains
// exported as a public API for future client-side cascade needs that can't
// round-trip to the server (e.g. unsaved-recipe live previews).

import { useMemo, type JSX } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';
import { formatStockQuantity } from '@/features/inventory/stockQuantity.js';
import { productionRequirementQuanta, stockQuantityQuanta, stockQuantaValue, STOCK_PRECISION_MESSAGE } from '../stockPrecision.js';

/**
 * Une ligne de production à prévisualiser. Les quantités sont dans l'unité de
 * BASE du produit — la même que celle envoyée à la RPC : le BOM est résolu par
 * unité de base, une quantité saisie dans une autre unité fausserait l'aperçu
 * du facteur de conversion. `BatchItemInput` (hook useRecordBatchProduction)
 * satisfait cette forme, ce qui garantit que l'aperçu porte sur ce qui sera
 * réellement soumis.
 */
export interface IngredientPreviewLine {
  productId:        string;
  quantityProduced: number;
  quantityWaste?:   number;
}

export interface IngredientAggregatePreviewProps { items: IngredientPreviewLine[]; }

interface BomLeafRow {
  material_id:   string;
  material_name: string;
  material_unit: string;
  qty_per_unit:  number;
  current_stock: number | null;
  cost_price:    number;
  // recipe qty already converted into the material's stock unit (material_unit),
  // so it can be compared against current_stock directly (both in material_unit).
  qty_in_base:   number;
}

interface AggregatedRow {
  materialId:   string;
  materialName: string;
  materialUnit: string;
  totalQty:     number;
  available:    number | null;
  sufficient:   boolean | null;
  shortfall:    number | null;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return formatStockQuantity(n);
}

export function IngredientAggregatePreview({ items }: IngredientAggregatePreviewProps): JSX.Element {
  const owner = useAuthStore((state) => state.user?.role_code === 'SUPER_ADMIN');
  const validRows = useMemo(
    () => items.filter((it) => Number.isFinite(it.quantityProduced) && it.quantityProduced > 0),
    [items],
  );

  const bomQueries = useQueries({
    queries: validRows.map((row) => ({
      queryKey: ['inv-prod', 'bom-full', row.productId] as const,
      staleTime: 30_000,
      queryFn: async (): Promise<BomLeafRow[]> => {
        const { data, error } = await supabase.rpc('recipe_bom_full_v5', {
          p_product_id: row.productId,
          p_max_depth:  5,
        });
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    })),
  });

  const loading = bomQueries.some((q) => q.isLoading);
  const errorMsg = bomQueries.find((q) => q.error)?.error?.message ?? null;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bomDataUpdatedKeys = bomQueries.map((q) => q.dataUpdatedAt).join(',');

  const { rows, precisionError } = useMemo((): { rows: AggregatedRow[]; precisionError: string | null } => {
    const acc = new Map<string, { name: string; unit: string; totalQty: bigint; available: bigint | null }>();
    try {
      validRows.forEach((row, i) => {
        const bom = bomQueries[i]?.data;
        if (!bom) return;
        const waste = row.quantityWaste ?? 0;
        if (row.quantityProduced + (Number.isFinite(waste) ? waste : 0) <= 0) return;
        // La RPC BOM agrège déjà ses chemins par matériau. On conserve ce regroupement
        // avant l'arrondi par item, puis on somme les quanta de tous les items du lot.
        const itemMaterials = new Map<string, { leaf: BomLeafRow; quantities: number[] }>();
        for (const leaf of bom) {
          const material = itemMaterials.get(leaf.material_id);
          if (material) material.quantities.push(leaf.qty_in_base);
          else itemMaterials.set(leaf.material_id, { leaf, quantities: [leaf.qty_in_base] });
        }
        for (const { leaf, quantities } of itemMaterials.values()) {
          const need = productionRequirementQuanta(quantities, row.quantityProduced, Number.isFinite(waste) ? waste : 0);
          const existing = acc.get(leaf.material_id);
          if (existing) {
            existing.totalQty += need;
            if (!Number.isFinite(leaf.current_stock)) existing.available = null;
          } else {
            acc.set(leaf.material_id, {
              name: leaf.material_name, unit: leaf.material_unit,
              totalQty: need, available: owner && leaf.current_stock !== null && Number.isFinite(leaf.current_stock)
                ? stockQuantityQuanta(leaf.current_stock) : null,
            });
          }
        }
      });
      const calculatedRows = Array.from(acc.entries())
        .map(([materialId, x]) => {
          const difference = x.available === null ? null : x.totalQty - x.available;
          const shortfall = difference === null ? null : difference > 0n ? difference : 0n;
          return {
            materialId, materialName: x.name, materialUnit: x.unit,
            totalQty: stockQuantaValue(x.totalQty), available: x.available === null ? null : stockQuantaValue(x.available),
            sufficient: shortfall === null ? null : shortfall === 0n,
            shortfall: shortfall === null ? null : stockQuantaValue(shortfall),
          };
        })
        .sort((a, b) => {
          if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
          return a.materialName.localeCompare(b.materialName);
        });
      return { rows: calculatedRows, precisionError: null };
    } catch (error) {
      return { rows: [], precisionError: error instanceof Error && error.message === 'quantity_below_stock_precision'
        ? STOCK_PRECISION_MESSAGE : 'Could not calculate ingredient requirements.' };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, bomDataUpdatedKeys, owner]);

  const anyShortage = owner && rows.some((r) => r.sufficient === false);

  return (
    <div data-testid="ingredient-aggregate-preview"
         className="rounded-md border border-border-subtle bg-bg-elevated p-4 space-y-2 text-text-primary">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg">Aggregate ingredient preview</h3>
        {/* Le point médian et le compteur qui le suit tiennent sur une seule
            ligne : JSX avale le saut de ligne, et « ·6 » s'affichait collé. */}
        {validRows.length > 0 && (
          <span className="text-xs text-text-secondary">
            {validRows.length} item{validRows.length === 1 ? '' : 's'} · {rows.length} ingredient{rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {(errorMsg ?? precisionError) !== null && <p role="alert" className="text-xs text-red">{errorMsg ?? precisionError}</p>}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Add a product and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : loading ? (
        <p className="text-sm text-text-secondary">Computing requirements…</p>
      ) : precisionError !== null ? null : rows.length === 0 ? (
        <p className="text-sm text-text-secondary">No recipes resolved yet.</p>
      ) : (
        <>
          {anyShortage && (
            <p role="alert" className="text-xs text-red">
              One or more ingredients are short. The server will reject submission.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{owner ? 'Required quantity, available stock and shortage status per material' : 'Required quantity per material'}</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th scope="col" className="py-1">Material</th>
                  <th scope="col" className="py-1 text-right">Required</th>
                  {owner && <th scope="col" className="py-1 text-right">Available</th>}
                  {owner && <th scope="col" className="py-1 text-right">Status</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.materialId} className="border-t border-border-subtle">
                    <td className="py-1.5">{r.materialName}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmt(r.totalQty)} {r.materialUnit}
                    </td>
                    {owner && <td className="py-1.5 text-right tabular-nums">
                      {r.available === null ? '–' : fmt(r.available)} {r.materialUnit}
                    </td>}
                    {owner && <td className="py-1.5 text-right">
                      {r.sufficient === null ? '–' : r.sufficient ? (
                        <span className="text-success" data-testid="status-ok">OK</span>
                      ) : (
                        <span className="text-red" data-testid="status-short">
                          short {fmt(r.shortfall!)}
                        </span>
                      )}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
