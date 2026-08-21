// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 17 — Phase 2.A — Server-side cascade via recipe_bom_full_v2.
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
import { supabase } from '@/lib/supabase.js';

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
  current_stock: number;
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
  available:    number;
  sufficient:   boolean;
  shortfall:    number;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  // Locale métier, comme les soixante-trois autres appels du back-office.
  // `en-US` ici rendait « 1,234.56 » à côté d'un « Rp 1.234 » de la même carte.
  return n.toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

export function IngredientAggregatePreview({ items }: IngredientAggregatePreviewProps): JSX.Element {
  const validRows = useMemo(
    () => items.filter((it) => Number.isFinite(it.quantityProduced) && it.quantityProduced > 0),
    [items],
  );

  const bomQueries = useQueries({
    queries: validRows.map((row) => ({
      queryKey: ['inv-prod', 'bom-full', row.productId] as const,
      staleTime: 30_000,
      queryFn: async (): Promise<BomLeafRow[]> => {
        const { data, error } = await supabase.rpc('recipe_bom_full_v2', {
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

  const rows: AggregatedRow[] = useMemo(() => {
    const acc = new Map<string, { name: string; unit: string; totalQty: number; available: number }>();
    validRows.forEach((row, i) => {
      const bom = bomQueries[i]?.data;
      if (!bom) return;
      const waste = row.quantityWaste ?? 0;
      const mult = row.quantityProduced + (Number.isFinite(waste) ? waste : 0);
      if (mult <= 0) return;
      for (const leaf of bom) {
        // qty_in_base is in the material's stock unit (kg/lt/pcs), matching
        // current_stock — using the raw recipe qty (gr/ml) would overstate needs 1000×.
        const need = leaf.qty_in_base * mult;
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
        <h3 className="text-lg">Aggregate ingredient preview</h3>
        {/* Le point médian et le compteur qui le suit tiennent sur une seule
            ligne : JSX avale le saut de ligne, et « ·6 » s'affichait collé. */}
        {validRows.length > 0 && (
          <span className="text-xs text-text-secondary">
            {validRows.length} item{validRows.length === 1 ? '' : 's'} · {rows.length} ingredient{rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {errorMsg !== null && <p role="alert" className="text-xs text-red">{errorMsg}</p>}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Add a product and enter a quantity to see the aggregate ingredient totals.
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Required quantity, available stock and shortage status per material</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th scope="col" className="py-1">Material</th>
                  <th scope="col" className="py-1 text-right">Required</th>
                  <th scope="col" className="py-1 text-right">Available</th>
                  <th scope="col" className="py-1 text-right">Status</th>
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
          </div>
        </>
      )}
    </div>
  );
}
