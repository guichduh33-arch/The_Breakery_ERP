// apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx
//
// Standalone recipe editor for finished products. Renders the active recipe
// rows + an "Add ingredient" form + a live BoM cost preview (per 1 produced
// unit). Permission-gated by inventory.recipes.update.

import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { bomCost, type RecipeRow } from '@breakery/domain';
import { useRecipes } from '../hooks/useRecipes.js';
import { useUpsertRecipe, UpsertRecipeError } from '../hooks/useUpsertRecipe.js';
import { useDeactivateRecipe } from '../hooks/useDeactivateRecipe.js';
import { useFinishedProducts } from '../hooks/useFinishedProducts.js';

export interface RecipeEditorProps {
  productId: string | null;
  onProductChange: (productId: string | null) => void;
}

const UNIT_OPTIONS = ['g', 'kg', 'mg', 'mL', 'L', 'pcs'] as const;

export default function RecipeEditor({ productId, onProductChange }: RecipeEditorProps): JSX.Element {
  const products = useFinishedProducts();
  const recipes = useRecipes(productId);
  const upsertMut = useUpsertRecipe();
  const deactivateMut = useDeactivateRecipe();

  const [materialId, setMaterialId] = useState('');
  const [qtyStr, setQtyStr] = useState('');
  const [unit, setUnit] = useState<string>('g');
  const [notes, setNotes] = useState('');
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

  const numericQty = Number.parseFloat(qtyStr);
  const canAdd =
    productId !== null &&
    materialId !== '' &&
    materialId !== productId &&
    Number.isFinite(numericQty) && numericQty > 0 &&
    unit !== '' &&
    !upsertMut.isPending;

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canAdd || productId === null) return;
    setFormError(null);
    try {
      await upsertMut.mutateAsync({
        productId,
        materialId,
        quantity: numericQty,
        unit,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      setMaterialId('');
      setQtyStr('');
      setNotes('');
    } catch (err) {
      if (err instanceof UpsertRecipeError) {
        setFormError(err.code === 'forbidden'
          ? 'You do not have permission to edit recipes.'
          : `Error: ${err.code}.`);
      } else {
        setFormError('Failed to save row.');
      }
    }
  }

  const materialOptions = (products.data ?? []).filter((p) => p.id !== productId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs uppercase tracking-widest text-text-secondary">
          Finished product
        </label>
        <select
          className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
          value={productId ?? ''}
          onChange={(e) => onProductChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">— select —</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
          ))}
        </select>
      </div>

      {productId !== null && (
        <>
          <div className="border border-border-subtle rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-xs uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Qty / unit</th>
                  <th className="px-3 py-2 text-left">Unit</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {recipe.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-text-muted">
                    No active recipe rows yet — add ingredients below.
                  </td></tr>
                )}
                {recipe.map((r: RecipeRow) => (
                  <tr key={r.recipe_id} className="border-t border-border-subtle">
                    <td className="px-3 py-2">{r.material_name}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.quantity).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.unit}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(r.material_cost_price).toLocaleString()} /{r.material_unit}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => void deactivateMut.mutate({ recipeId: r.recipe_id, productId })}
                        disabled={deactivateMut.isPending}
                      >Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {cost !== null && (
                <tfoot className="bg-bg-elevated text-xs">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 uppercase tracking-widest text-text-secondary">
                      Material cost per produced unit
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gold">
                      {Math.round(cost.unit_cost).toLocaleString()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <form onSubmit={(e) => { void handleAdd(e); }} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-5">
              <label className="text-xs uppercase tracking-widest text-text-secondary">Material</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
              >
                <option value="">— select material —</option>
                {materialOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs uppercase tracking-widest text-text-secondary">Quantity</label>
              <Input
                type="number" inputMode="decimal" min={0.001} step="0.001"
                value={qtyStr} onChange={(e) => setQtyStr(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs uppercase tracking-widest text-text-secondary">Unit</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
                value={unit} onChange={(e) => setUnit(e.target.value)}
              >
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <Button type="submit" variant="primary" disabled={!canAdd}>
                {upsertMut.isPending ? 'Saving…' : 'Add ingredient'}
              </Button>
            </div>
            {formError !== null && (
              <div className="col-span-12 text-red text-xs" role="alert">{formError}</div>
            )}
          </form>
        </>
      )}
    </div>
  );
}
