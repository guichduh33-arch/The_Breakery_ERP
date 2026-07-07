// apps/backoffice/src/features/products/components/ModifierCostBreakdown.tsx
//
// Costing tab add-on: shows the TOTAL product cost per modifier option
// (base cost_price + the option's material cost). Rendered only when at least
// one modifier group has cost-bearing ingredients_to_deduct — i.e. when the
// cost is actually variable across options (e.g. Oat milk vs Fresh).
//
// The material cost mirrors the server resolver _resolve_modifier_ingredients_v1
// (qty × factor_to_base × cost_price, line_qty = 1), via the shared domain helper.

import { useMemo, type JSX } from 'react';
import { Card } from '@breakery/ui';
import {
  modifierOptionMaterialCost,
  type ModifierCostMaterial,
  type EditableModifierGroup,
} from '@breakery/domain';
import { useProductModifiersAdmin } from '../hooks/useProductModifiersAdmin.js';
import { useDeductibleIngredientProducts } from '../hooks/useDeductibleIngredientProducts.js';

export interface ModifierCostBreakdownProps {
  productId: string;
  /** Base product cost (WAC / recipe roll-up), excludes modifiers. */
  baseCost: number;
}

function formatIdr(n: number): string {
  return Math.round(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function groupTypeLabel(g: EditableModifierGroup): string {
  const sel = g.group_type === 'single_select' ? 'single choice' : 'multiple choice';
  return g.group_required ? `${sel} · required` : `${sel} · optional`;
}

export function ModifierCostBreakdown({
  productId,
  baseCost,
}: ModifierCostBreakdownProps): JSX.Element | null {
  const { data: groups = [], isLoading: groupsLoading } = useProductModifiersAdmin(productId);
  const { data: materials = [], isLoading: materialsLoading } = useDeductibleIngredientProducts();

  const materialsById = useMemo(
    () => new Map<string, ModifierCostMaterial>(materials.map((m) => [m.id, m])),
    [materials],
  );

  // Keep only groups where at least one option actually deducts an ingredient —
  // a price-only group does not change the cost, so it would be noise here.
  const costGroups = useMemo(
    () => groups.filter((g) => g.options.some((o) => o.ingredients_to_deduct.length > 0)),
    [groups],
  );

  if (groupsLoading || materialsLoading) return null;
  if (costGroups.length === 0) return null;

  return (
    <Card padding="md">
      <div className="mb-1">
        <h2 className="font-display text-lg text-text-primary">Cost with modifiers</h2>
        <p className="text-xs italic text-text-secondary">
          Total cost = base cost (Rp {formatIdr(baseCost)}) + the option&apos;s ingredient cost
        </p>
      </div>

      <div className="space-y-5">
        {costGroups.map((g) => (
          <div key={g.group_name} data-testid={`modifier-cost-group-${g.group_name}`}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-text-primary">{g.group_name}</span>
              <span className="text-[11px] uppercase tracking-wider text-text-secondary">
                {groupTypeLabel(g)}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-text-secondary">
                  <th className="py-1.5 pr-4 text-left font-medium">Option</th>
                  <th className="py-1.5 pr-4 text-right font-medium">Ingredient cost</th>
                  <th className="py-1.5 text-right font-medium">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {g.options.map((o) => {
                  const mat = modifierOptionMaterialCost(o.ingredients_to_deduct, materialsById);
                  const total = baseCost + mat.total;
                  return (
                    <tr
                      key={o.option_label}
                      data-testid={`modifier-cost-row-${g.group_name}-${o.option_label}`}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="py-1.5 pr-4 text-text-primary">
                        {o.option_label}
                        {o.is_default && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">
                            default
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-right font-mono text-text-secondary tabular-nums whitespace-nowrap">
                        {mat.total > 0 ? `+ Rp ${formatIdr(mat.total)}` : '—'}
                        {!mat.complete && (
                          <span className="text-text-muted" title="Some ingredients have no cost price yet">
                            {' '}+ ?
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono font-semibold text-text-primary tabular-nums whitespace-nowrap">
                        Rp {formatIdr(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}
