// apps/backoffice/src/features/inventory-production/components/BatchSelector.tsx
//
// Session 15 / Phase 4.A — Single row in the batch production form.
//
// Combines an IngredientPicker (limited to sub-recipe / finished products with
// an active recipe) + qty / waste inputs + remove button. Stateless ; the
// parent BatchProductionPage owns the BatchItem array.

import { useCallback, type JSX } from 'react';
import { Button, IngredientPicker, Input, type IngredientSearchResult } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

export interface BatchItem {
  /** Stable React key — generated once by the parent. */
  rowId:            string;
  productId:        string | null;
  productName:      string | null;
  productUnit:      string | null;
  quantityProduced: string;
  quantityWaste:    string;
}

export interface BatchSelectorProps {
  value:    BatchItem;
  onChange: (next: BatchItem) => void;
  onRemove: () => void;
  /** Hide the remove button when the row is the only one in the form. */
  removable?: boolean;
  disabled?:  boolean;
  /** product_ids already chosen in other rows — excluded from the picker. */
  excludeIds?: string[];
}

// Picker can be 'sub_recipe' (recipes that themselves have recipes) — but since
// the batch form is about producing FINISHED goods, we want anything with an
// active recipe. Use 'all' kind tabs but display only rows where has_recipe is
// true ; that is naturally enforced because we'd hit `recipe_not_found` on
// submit. Letting the user pick anything keeps the UX consistent with the
// single-recipe form.
async function searchProductsWithRecipeFn(
  query: string,
  kind: 'raw' | 'semi_finished' | 'sub_recipe' | 'all',
): Promise<IngredientSearchResult[]> {
  try {
    const { data, error } = await supabase.rpc('search_ingredients_v1', {
      p_query: query,
      p_kind:  kind,
      p_limit: 30,
    });
    if (error) return [];
    return (data ?? [])
      .map((r) => ({
        product_id:    r.product_id as string,
        sku:           r.sku as string,
        name:          r.name as string,
        unit:          r.unit as string,
        cost_price:    Number(r.cost_price),
        current_stock: Number(r.current_stock),
        kind:          r.kind as IngredientSearchResult['kind'],
        has_recipe:    Boolean(r.has_recipe),
      }))
      // Only surface rows with an active recipe — record_batch_production_v1
      // RAISEs `recipe_not_found` otherwise.
      .filter((r) => r.has_recipe);
  } catch {
    return [];
  }
}

export function BatchSelector({
  value,
  onChange,
  onRemove,
  removable = true,
  disabled = false,
  excludeIds = [],
}: BatchSelectorProps): JSX.Element {
  const handlePicked = useCallback(
    (productId: string | null, row: IngredientSearchResult | null): void => {
      onChange({
        ...value,
        productId,
        productName: row?.name ?? null,
        productUnit: row?.unit ?? null,
      });
    },
    [onChange, value],
  );

  return (
    <div
      data-testid="batch-selector-row"
      className="rounded-md border border-border-subtle bg-bg-elevated p-3 space-y-2"
    >
      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 sm:col-span-6 space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">
            Recipe / finished product
          </label>
          {value.productId !== null && value.productName !== null ? (
            <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm">
              <span className="truncate">
                {value.productName}
                {value.productUnit !== null && (
                  <span className="text-text-secondary"> · {value.productUnit}</span>
                )}
              </span>
              <button
                type="button"
                className="text-xs text-text-secondary hover:text-text-primary"
                onClick={() => handlePicked(null, null)}
                disabled={disabled}
              >
                Change
              </button>
            </div>
          ) : (
            <IngredientPicker
              value={value.productId}
              onChange={handlePicked}
              searchFn={searchProductsWithRecipeFn}
              kind="all"
              showKindTabs={false}
              excludeIds={excludeIds}
              placeholder="Search recipe…"
              disabled={disabled}
            />
          )}
        </div>

        <div className="col-span-6 sm:col-span-3 space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Qty produced</label>
          <Input
            type="number"
            inputMode="decimal"
            min={0.001}
            step="0.001"
            value={value.quantityProduced}
            onChange={(e) => onChange({ ...value, quantityProduced: e.target.value })}
            disabled={disabled}
            aria-label="Quantity produced"
          />
        </div>

        <div className="col-span-6 sm:col-span-2 space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Waste</label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.001"
            value={value.quantityWaste}
            onChange={(e) => onChange({ ...value, quantityWaste: e.target.value })}
            disabled={disabled}
            aria-label="Waste quantity"
          />
        </div>

        <div className="col-span-12 sm:col-span-1 flex sm:justify-end pt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={onRemove}
            disabled={disabled || !removable}
            aria-label="Remove this row"
          >
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
