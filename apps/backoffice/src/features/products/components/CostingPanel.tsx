// apps/backoffice/src/features/products/components/CostingPanel.tsx
//
// Session 39 — Wave B2 — Costing tab for ProductDetailPage (BO-10).
//
// Shows:
//  - 3 header KPI cards: WAC cost, retail price, gross margin %.
//  - Recipe BOM breakdown table (from recipe_bom_full_v1, S17).
//    If no recipe → EmptyState "No recipe — cost is purchase-driven (WAC)".
//  - "Correct cost price" button (gated inventory.cost_correction, MANAGER+).

import { useRef, useState, type JSX } from 'react';
import { DollarSign, Percent, Tag } from 'lucide-react';
import { Card, EmptyState } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useRecipeDirectCost } from '../hooks/useRecipeDirectCost.js';
import { CorrectCostDialog } from './CorrectCostDialog.js';
import { ModifierCostBreakdown } from './ModifierCostBreakdown.js';
import type { ProductRow } from '../types.js';

export interface CostingPanelProps {
  product: Pick<ProductRow, 'id' | 'cost_price' | 'retail_price'>;
}

// Prices are shown as whole rupiah (owner decision: no decimals anywhere).
function formatIdr(n: number): string {
  return Math.round(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

// Per-unit cost: same whole-rupiah rule.
function formatUnitCost(n: number): string {
  return Math.round(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function computeMargin(cost: number, retail: number): number | null {
  if (retail <= 0) return null;
  return ((retail - cost) / retail) * 100;
}

export function CostingPanel({ product }: CostingPanelProps): JSX.Element {
  const canCorrect = useAuthStore((s) => s.hasPermission('inventory.cost_correction'));

  // Direct (depth-1) recipe lines so the breakdown matches the Recipe tab. A
  // semi-finished line is costed at its own cost_price (which already rolls up
  // its sub-ingredients) — NOT exploded into leaf materials.
  const { data: bom, isLoading, error } = useRecipeDirectCost(product.id);

  const [dialogOpen, setDialogOpen] = useState(false);

  // Idempotency key (flavor 2, S25): stable ref, regenerated on success/dismiss.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  function handleSuccess(): void {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  function handleDialogOpenChange(open: boolean): void {
    if (!open) {
      // Regenerate on dismiss so a re-open uses a fresh key.
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    setDialogOpen(open);
  }

  const margin = computeMargin(product.cost_price, product.retail_price);

  // ── BOM total ──────────────────────────────────────────────────────────────
  // line_cost is computed server-side with the recipe-unit → stock-unit conversion
  // (e.g. 284 gr of a material priced per kg). Summing raw qty × per-kg cost would
  // overstate the total 1000×.
  const bomTotal = (bom ?? []).reduce((acc, row) => acc + row.line_cost, 0);

  return (
    <div className="space-y-6">
      {/* ── Header KPI cards ── */}
      <div className="grid grid-cols-3 gap-4" data-testid="costing-kpi-cards">
        {/* Current cost (WAC) */}
        <Card padding="md" data-testid="costing-card-cost">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gold-soft text-gold">
              <DollarSign className="h-4 w-4" aria-hidden />
            </div>
            <span className="text-xs uppercase tracking-wider text-text-secondary">
              Cost (WAC)
            </span>
          </div>
          <p className="font-mono text-lg font-semibold text-text-primary">
            Rp {formatIdr(product.cost_price)}
          </p>
        </Card>

        {/* Retail price */}
        <Card padding="md" data-testid="costing-card-retail">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-elevated text-text-secondary">
              <Tag className="h-4 w-4" aria-hidden />
            </div>
            <span className="text-xs uppercase tracking-wider text-text-secondary">
              Retail price
            </span>
          </div>
          <p className="font-mono text-lg font-semibold text-text-primary">
            Rp {formatIdr(product.retail_price)}
          </p>
        </Card>

        {/* Margin % */}
        <Card padding="md" data-testid="costing-card-margin">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-elevated text-text-secondary">
              <Percent className="h-4 w-4" aria-hidden />
            </div>
            <span className="text-xs uppercase tracking-wider text-text-secondary">
              Gross margin
            </span>
          </div>
          <p className="font-mono text-lg font-semibold text-text-primary">
            {margin !== null ? `${margin.toFixed(1)}%` : '—'}
          </p>
        </Card>
      </div>

      {/* ── BOM breakdown ── */}
      <Card padding="md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg text-text-primary">Recipe BOM breakdown</h2>
            <p className="text-xs italic text-text-secondary">
              Cost per unit based on current ingredient prices
            </p>
          </div>
          {canCorrect && (
            <button
              type="button"
              data-testid="correct-cost-btn"
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-widest text-bg-base"
            >
              Correct cost price
            </button>
          )}
        </div>

        {isLoading && (
          <p className="text-sm text-text-secondary py-8 text-center">Loading BOM…</p>
        )}

        {!isLoading && error !== null && error !== undefined && (
          <div role="alert" className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red">
            Failed to load BOM: {(error as Error).message}
          </div>
        )}

        {!isLoading && error === null && (bom ?? []).length === 0 && (
          <EmptyState
            icon={DollarSign}
            title="No recipe — cost is purchase-driven (WAC)"
            description="This product has no BOM. Its cost price is updated automatically by the Weighted Average Cost method whenever stock is received."
            size="md"
          />
        )}

        {!isLoading && error === null && (bom ?? []).length > 0 && (
          <div data-testid="bom-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-text-secondary">
                  <th className="py-2 pr-4 text-left font-medium">Ingredient</th>
                  <th className="py-2 pr-4 text-right font-medium">Qty / unit</th>
                  <th className="py-2 pr-4 text-left font-medium">Unit</th>
                  <th className="py-2 pr-4 text-right font-medium">Unit cost</th>
                  <th className="py-2 text-right font-medium">Line cost</th>
                </tr>
              </thead>
              <tbody>
                {bom!.map((row) => {
                  // Unit cost expressed per the recipe line's own unit (e.g. per gr),
                  // not per the material's stock unit (per kg), so qty × unit cost
                  // reconciles with the line cost shown.
                  const unitCostPerRecipeUnit =
                    row.qty_per_unit > 0 ? row.line_cost / row.qty_per_unit : row.cost_price;
                  return (
                    <tr
                      key={row.material_id}
                      data-testid={`bom-row-${row.material_id}`}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="py-2 pr-4 text-text-primary">{row.material_name}</td>
                      <td className="py-2 pr-4 text-right font-mono text-text-primary">
                        {row.qty_per_unit}
                      </td>
                      <td className="py-2 pr-4 text-text-secondary font-mono">{row.recipe_unit}</td>
                      <td className="py-2 pr-4 text-right font-mono text-text-primary whitespace-nowrap">
                        Rp {formatUnitCost(unitCostPerRecipeUnit)}
                        <span className="text-text-secondary"> /{row.recipe_unit}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-text-primary">
                        Rp {formatIdr(row.line_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-subtle">
                  <td colSpan={4} className="py-2 pr-4 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Total BOM cost
                  </td>
                  <td
                    className="py-2 text-right font-mono font-semibold text-text-primary"
                    data-testid="bom-total"
                  >
                    Rp {formatIdr(bomTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Total cost per modifier option ── */}
      <ModifierCostBreakdown productId={product.id} baseCost={product.cost_price} />

      {/* ── Correct cost dialog ── */}
      <CorrectCostDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        productId={product.id}
        currentCost={product.cost_price}
        idempotencyKey={idempotencyKeyRef.current}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
