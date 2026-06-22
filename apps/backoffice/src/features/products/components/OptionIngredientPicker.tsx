// apps/backoffice/src/features/products/components/OptionIngredientPicker.tsx
//
// Edits a modifier option's `ingredients_to_deduct` array. Raw materials come
// from useAllProductsForPO (category_type='raw_material'). Stock deduction at
// order-time ships in Phase 2 (S49); here we additionally surface the material
// COST of the option (Σ qty × factor_to_base × cost_price) so the owner can see
// how the COGS varies per option (e.g. Oat milk vs Fresh) when pricing it.

import { useMemo, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import {
  modifierIngredientLineCost,
  modifierOptionMaterialCost,
  type ModifierIngredient,
  type ModifierCostMaterial,
} from '@breakery/domain';
import { useAllProductsForPO } from '@/features/purchasing/hooks/useAllProductsForPO.js';

export interface OptionIngredientPickerProps {
  value: ModifierIngredient[];
  onChange: (next: ModifierIngredient[]) => void;
}

function formatIdr(n: number): string {
  return Math.round(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

export function OptionIngredientPicker({
  value,
  onChange,
}: OptionIngredientPickerProps): JSX.Element {
  const { data: materials = [] } = useAllProductsForPO();

  // PoProductRow is structurally a ModifierCostMaterial (cost_price + unitOptions).
  const materialsById = useMemo(
    () => new Map<string, ModifierCostMaterial>(materials.map((m) => [m.id, m])),
    [materials],
  );

  const optionCost = useMemo(
    () => modifierOptionMaterialCost(value, materialsById),
    [value, materialsById],
  );

  function updateRow(idx: number, patch: Partial<ModifierIngredient>): void {
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    const first = materials[0];
    onChange([
      ...value,
      { product_id: first?.id ?? '', qty: 1, unit: first?.unit ?? '' },
    ]);
  }

  function removeRow(idx: number): void {
    onChange(value.filter((_, i) => i !== idx));
  }

  function unitsFor(productId: string): string[] {
    const m = materials.find((x) => x.id === productId);
    if (!m) return [];
    return m.unitOptions.map((u) => u.code);
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-widest text-text-muted">
        Ingredients to deduct (applied once stock-by-option ships)
      </p>
      {value.map((row, idx) => {
        const lineCost = modifierIngredientLineCost(row, materialsById.get(row.product_id));
        return (
          <div key={idx} className="flex items-center gap-2">
            <select
              aria-label="Raw material"
              className="flex-1 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
              value={row.product_id}
              onChange={(e) => {
                const pid = e.target.value;
                const units = unitsFor(pid);
                updateRow(idx, { product_id: pid, unit: units[0] ?? row.unit });
              }}
            >
              <option value="">— Select material —</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              type="number"
              min={0}
              step="any"
              className="w-24 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
              value={row.qty}
              onChange={(e) => updateRow(idx, { qty: Number(e.target.value) || 0 })}
            />
            <select
              aria-label="Unit"
              className="w-24 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
              value={row.unit}
              onChange={(e) => updateRow(idx, { unit: e.target.value })}
            >
              {unitsFor(row.product_id).map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <span
              className="w-24 text-right font-mono text-xs text-text-secondary tabular-nums"
              data-testid={`ingredient-cost-${idx}`}
              title="Material cost for one unit of the product"
            >
              {lineCost === null ? '—' : `Rp ${formatIdr(lineCost)}`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove ingredient"
              onClick={() => removeRow(idx)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" /> Add ingredient
        </Button>
        {value.length > 0 && (
          <span
            className="text-xs font-mono text-text-secondary"
            data-testid="option-material-cost"
          >
            Material cost / unit:{' '}
            <span className="font-semibold text-text-primary tabular-nums">
              Rp {formatIdr(optionCost.total)}
            </span>
            {!optionCost.complete && (
              <span className="text-text-muted" title="Some ingredients have no cost price yet">
                {' '}+ ?
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
