// apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx
//
// Session 14 / Phase 4.B — Recipe builder for the product detail "Recipe"
// tab. Mirrors `product recette.jpg`:
//   - Calculation-base callout (Calculation base: 1 <unit> of <product>)
//   - Recipe Components card with INGREDIENT / QUANTITY / UNIT columns
//   - Add-ingredient form
//   - Total row in the footer
//
// Wraps the Session 13 recipe RPCs:
//   list_recipes_v1 / upsert_recipe_v1 / deactivate_recipe_v1.

import { Plus, Scale, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { Card, EmptyState, Input, SectionLabel } from '@breakery/ui';
import { bomCost, type RecipeRow } from '@breakery/domain';
import { useRecipes } from '@/features/inventory-production/hooks/useRecipes.js';
import { useUpsertRecipe, UpsertRecipeError } from '@/features/inventory-production/hooks/useUpsertRecipe.js';
import { useDeactivateRecipe } from '@/features/inventory-production/hooks/useDeactivateRecipe.js';
import { useFinishedProducts } from '@/features/inventory-production/hooks/useFinishedProducts.js';

const UNIT_OPTIONS = ['g', 'kg', 'mg', 'ml', 'l', 'pcs'] as const;

export interface RecipeBuilderProps {
  productId: string;
  productName: string;
  productUnit: string;
  /** When true, hides the "Add ingredient" form (e.g. user lacks update perm). */
  readOnly?: boolean;
}

export function RecipeBuilder({
  productId,
  productName,
  productUnit,
  readOnly = false,
}: RecipeBuilderProps): JSX.Element {
  const recipes = useRecipes(productId);
  const products = useFinishedProducts();
  const upsertMut = useUpsertRecipe();
  const deactivateMut = useDeactivateRecipe();

  const [materialId, setMaterialId] = useState('');
  const [qtyStr, setQtyStr] = useState('');
  const [unit, setUnit] = useState<string>('g');
  const [formError, setFormError] = useState<string | null>(null);

  const recipe = recipes.data ?? [];
  const cost = useMemo(() => {
    if (recipe.length === 0) return null;
    try {
      return bomCost(recipe, 1);
    } catch {
      return null;
    }
  }, [recipe]);

  const totalQty = useMemo(() => {
    return recipe.reduce((acc, r) => acc + Number(r.quantity), 0);
  }, [recipe]);

  const numericQty = Number.parseFloat(qtyStr);
  const canAdd =
    !readOnly &&
    materialId !== '' &&
    materialId !== productId &&
    Number.isFinite(numericQty) && numericQty > 0 &&
    unit !== '' &&
    !upsertMut.isPending;

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canAdd) return;
    setFormError(null);
    try {
      await upsertMut.mutateAsync({
        productId,
        materialId,
        quantity: numericQty,
        unit,
        notes: null,
      });
      setMaterialId('');
      setQtyStr('');
    } catch (err) {
      if (err instanceof UpsertRecipeError) {
        setFormError(err.code === 'forbidden'
          ? 'You do not have permission to edit recipes.'
          : `Error: ${err.code.replace(/_/g, ' ')}.`);
      } else {
        setFormError('Failed to save row.');
      }
    }
  }

  const materialOptions = (products.data ?? []).filter((p) => p.id !== productId);

  return (
    <div className="space-y-6">
      <Card padding="md" className="border-l-4 border-l-gold">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-soft text-gold">
            <Scale className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <div className="font-display text-base text-gold">
              Calculation base: 1 {productUnit} of finished product
            </div>
            <div className="text-xs italic text-text-secondary">
              The quantities below are to produce 1 {productUnit} of {productName}
            </div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-text-primary">Recipe Components</h2>
          <span className="text-xs text-text-secondary">
            {recipe.length} ingredient{recipe.length === 1 ? '' : 's'}
          </span>
        </div>

        {recipes.isLoading ? (
          <div className="py-8 text-center text-sm text-text-secondary">Loading recipe…</div>
        ) : recipe.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No ingredients yet"
            description="Add the first ingredient below to start the recipe."
            size="sm"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="border-b border-border-subtle bg-bg-base/40">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <SectionLabel as="span" size="xs">Ingredient</SectionLabel>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SectionLabel as="span" size="xs">Quantity</SectionLabel>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SectionLabel as="span" size="xs">Unit</SectionLabel>
                  </th>
                  {!readOnly && (
                    <th className="px-4 py-3 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {recipe.map((r: RecipeRow) => (
                  <tr key={r.recipe_id} className="border-t border-border-subtle">
                    <td className="px-4 py-3 text-text-primary">
                      <div className="font-display text-base">{r.material_name}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono tabular-nums text-text-primary">
                        {Number(r.quantity).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono text-text-secondary">
                        {r.unit}
                      </span>
                    </td>
                    {!readOnly && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`Remove ${r.material_name}`}
                          onClick={() => deactivateMut.mutate({ recipeId: r.recipe_id, productId })}
                          disabled={deactivateMut.isPending}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-bg-base/40">
                <tr>
                  <td className="px-4 py-3">
                    <SectionLabel as="span" size="xs">
                      Total ({recipe.length} ingredients)
                    </SectionLabel>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-gold">
                    {totalQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {productUnit}
                  </td>
                  {!readOnly && <td />}
                </tr>
                {cost !== null && (
                  <tr>
                    <td className="px-4 py-3">
                      <SectionLabel as="span" size="xs">Material cost / {productUnit}</SectionLabel>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-gold">
                      Rp {Math.round(cost.unit_cost).toLocaleString()}
                    </td>
                    <td />
                    {!readOnly && <td />}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {!readOnly && (
          <form
            onSubmit={(e) => { void handleAdd(e); }}
            className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end"
          >
            <div className="md:col-span-6">
              <SectionLabel as="div" size="xs">Ingredient</SectionLabel>
              <select
                aria-label="Ingredient"
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="mt-1.5 h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <option value="">Select an ingredient...</option>
                {materialOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <SectionLabel as="div" size="xs">Quantity</SectionLabel>
              <Input
                aria-label="Quantity"
                type="number"
                inputMode="decimal"
                min={0.001}
                step="0.001"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <SectionLabel as="div" size="xs">Unit</SectionLabel>
              <select
                aria-label="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="mt-1.5 h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={!canAdd}
                className="inline-flex h-touch-min w-full items-center justify-center gap-2 rounded-full bg-gold px-4 text-xs font-semibold uppercase tracking-widest text-bg-base hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {upsertMut.isPending ? 'Saving…' : 'Add ingredient'}
              </button>
            </div>
            {formError !== null && (
              <div role="alert" className="md:col-span-12 rounded-md border border-red bg-red-soft px-3 py-2 text-xs text-red">
                {formError}
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
