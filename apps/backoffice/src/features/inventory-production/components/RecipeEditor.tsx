// apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx
//
// Standalone recipe editor for finished products. Renders the active recipe
// rows + an "Add ingredient" form + a live BoM cost preview (per 1 produced
// unit). Permission-gated by inventory.recipes.update.
//
// Session 15 / Phase 3.B :
// - Top-of-editor RecipeCostPreviewCard (cost + margin + Recompute badge).
// - Material picker replaced by `IngredientPicker` (autocomplete, kind tabs,
//   live sub-recipe cost preview).
// - "Duplicate recipe" button next to the product picker opens
//   RecipeDuplicateModal.
// - Drag-to-reorder rows via @dnd-kit/sortable ; persisted with
//   reorder_recipe_rows_v1 via useReorderRecipeRows.
//
// Session 15 / Phase 5.B (spec §D13) :
// - BoulangerModeToggle next to the product/Duplicate row to flip the whole
//   recipe between flat-mode (kg/g/pcs absolute qtys) and baker mode (% of
//   flour pivot).
// - When ON : the "Qty / unit" column becomes "% flour", the quantity input
//   in the add-row form is bound to baker_percentage, a target-flour input
//   appears above the table, and a preview panel below shows the absolute
//   qtys produced by convert_baker_recipe_to_absolute_v1.

import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Button,
  IngredientPicker,
  Input,
  Tabs, TabsContent, TabsList, TabsTrigger,
  type IngredientSearchResult,
} from '@breakery/ui';
import type { RecipeGraph, RecipeGraphProduct, RecipeRow } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { useRecipes } from '../hooks/useRecipes.js';
import { useUpsertRecipe, UpsertRecipeError } from '../hooks/useUpsertRecipe.js';
import { useDeactivateRecipe } from '../hooks/useDeactivateRecipe.js';
import { useFinishedProducts } from '../hooks/useFinishedProducts.js';
import { useReorderRecipeRows } from '../hooks/useReorderRecipeRows.js';
import { RecipeVersionHistory } from './RecipeVersionHistory.js';
import { RecipeCostPreviewCard } from './RecipeCostPreviewCard.js';
import { RecipeDuplicateModal } from './RecipeDuplicateModal.js';
import { RecipeRowSortable } from './RecipeRowSortable.js';
import { BoulangerModeToggle } from './BoulangerModeToggle.js';
import { BakerPreviewPanel } from './BakerPreviewPanel.js';
import {
  useBakerRecipeMode,
  useToggleBakerMode,
  useConvertBakerToAbsolute,
} from '../hooks/useBakerRecipeMode.js';

export interface RecipeEditorProps {
  productId: string | null;
  onProductChange: (productId: string | null) => void;
}

const UNIT_OPTIONS = ['g', 'kg', 'mg', 'mL', 'L', 'pcs'] as const;

// Bound to the module-level supabase client. IngredientPicker owns its own
// 200ms debounce + abort logic ; this thunk only wraps the RPC.
async function searchIngredientsFn(
  query: string,
  kind: 'raw' | 'semi_finished' | 'sub_recipe' | 'all',
): Promise<IngredientSearchResult[]> {
  try {
    const { data, error } = await supabase.rpc('search_ingredients_v1', {
      p_query: query,
      p_kind:  kind,
      p_limit: 20,
    });
    if (error) return [];
    return (data ?? []).map((r) => ({
      product_id:    r.product_id as string,
      sku:           r.sku as string,
      name:          r.name as string,
      unit:          r.unit as string,
      cost_price:    Number(r.cost_price),
      current_stock: Number(r.current_stock),
      kind:          r.kind as IngredientSearchResult['kind'],
      has_recipe:    Boolean(r.has_recipe),
    }));
  } catch {
    return [];
  }
}

export default function RecipeEditor({ productId, onProductChange }: RecipeEditorProps): JSX.Element {
  const products = useFinishedProducts();
  const recipes = useRecipes(productId);
  const upsertMut = useUpsertRecipe();
  const deactivateMut = useDeactivateRecipe();
  const reorderMut = useReorderRecipeRows();

  // Picker integration : we manage the selected material via state populated
  // by IngredientPicker's `onChange`. The picker fetches results live via
  // useIngredientSearch through the searchFn closure.
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [materialUnit, setMaterialUnit] = useState<string>('kg');
  const [qtyStr, setQtyStr] = useState('');
  const [unit, setUnit] = useState<string>('g');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [targetFlourStr, setTargetFlourStr] = useState('1000');

  // Baker's-percentage mode (spec §D13). The flag is read from the DB per
  // product ; toggling flips ALL active rows. The preview is debounced so
  // typing in the target-flour input doesn't hammer the RPC.
  const bakerMode = useBakerRecipeMode(productId);
  const toggleBakerMut = useToggleBakerMode();
  const isBakerMode = bakerMode.data === true;

  const targetFlour = Number.parseFloat(targetFlourStr);
  const [debouncedTarget, setDebouncedTarget] = useState<number>(
    Number.isFinite(targetFlour) ? targetFlour : 1000,
  );
  useEffect(() => {
    if (!Number.isFinite(targetFlour) || targetFlour <= 0) return;
    const t = setTimeout(() => setDebouncedTarget(targetFlour), 250);
    return () => clearTimeout(t);
  }, [targetFlour]);

  const convertQry = useConvertBakerToAbsolute(
    productId,
    debouncedTarget,
    isBakerMode,
  );

  // Local copy of the row order so DnD feels instant ; sync to server-truth
  // on every recipes refetch.
  const recipe: RecipeRow[] = recipes.data ?? [];

  // IngredientPicker requires a stable searchFn reference — the module-level
  // thunk is naturally stable (no closure over component state).
  const searchFn = searchIngredientsFn;

  // Build a light costGraph for the picker's live preview (sub-recipes only).
  // Includes the current product and every material referenced in the active
  // recipe rows ; cost cascade is handled by tryCalculateRecipeCost inside the
  // picker.
  const costGraph: RecipeGraph = useMemo(() => {
    const productsMap: Record<string, RecipeGraphProduct> = {};
    if (productId !== null && recipes.data && recipes.data.length > 0) {
      const first = recipes.data[0];
      if (first !== undefined) {
        productsMap[productId] = {
          id:         productId,
          name:       first.product_name,
          unit:       first.product_unit,
          cost_price: 0,
        };
      }
    }
    for (const r of recipe) {
      if (!productsMap[r.material_id]) {
        productsMap[r.material_id] = {
          id:         r.material_id,
          name:       r.material_name,
          unit:       r.material_unit,
          cost_price: Number(r.material_cost_price),
        };
      }
    }
    return {
      products: productsMap,
      recipes:  recipe.map((r) => ({
        product_id:  r.product_id,
        material_id: r.material_id,
        quantity:    Number(r.quantity),
        unit:        r.unit,
      })),
    };
  }, [productId, recipes.data, recipe]);

  const numericQty = Number.parseFloat(qtyStr);
  // In baker mode `qtyStr` carries the percentage (0..1000) and the row's
  // absolute quantity is computed from the target flour mass so the DB row
  // still satisfies `recipes.quantity > 0`.
  const bakerPctValid = isBakerMode
    ? Number.isFinite(numericQty) && numericQty > 0 && numericQty <= 1000
    : true;
  const targetFlourValid = !isBakerMode || (Number.isFinite(targetFlour) && targetFlour > 0);
  const canAdd =
    productId !== null &&
    materialId !== null &&
    materialId !== '' &&
    materialId !== productId &&
    Number.isFinite(numericQty) && numericQty > 0 &&
    unit !== '' &&
    bakerPctValid &&
    targetFlourValid &&
    !upsertMut.isPending;

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canAdd || productId === null || materialId === null) return;
    setFormError(null);
    try {
      const absoluteQty = isBakerMode
        ? Math.round((numericQty / 100) * targetFlour * 10000) / 10000
        : numericQty;
      const args: Parameters<typeof upsertMut.mutateAsync>[0] = {
        productId,
        materialId,
        quantity: absoluteQty,
        unit,
        notes: notes.trim() === '' ? null : notes.trim(),
      };
      if (isBakerMode) {
        args.isBakerPercentage = true;
        args.bakerPercentage   = numericQty;
      }
      await upsertMut.mutateAsync(args);
      setMaterialId(null);
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

  async function handleToggleBaker(next: boolean): Promise<void> {
    if (productId === null) return;
    setFormError(null);
    try {
      await toggleBakerMut.mutateAsync({ productId, next });
    } catch {
      setFormError('Failed to switch baker mode.');
    }
  }

  // ── DnD sensors + handler ──────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id || productId === null) return;
    const oldIndex = recipe.findIndex((r) => r.recipe_id === active.id);
    const newIndex = recipe.findIndex((r) => r.recipe_id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(recipe, oldIndex, newIndex);
    const ids = reordered.map((r) => r.recipe_id);
    reorderMut.mutate({ productId, recipeIds: ids });
  }

  const selectedProduct = (products.data ?? []).find((p) => p.id === productId);
  const productExcludeIds = productId !== null ? [productId] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDuplicateOpen(true)}
          disabled={productId === null || recipe.length === 0}
          data-testid="duplicate-recipe-button"
        >
          Duplicate recipe
        </Button>
        {productId !== null && (
          <BoulangerModeToggle
            value={isBakerMode}
            onChange={(next) => { void handleToggleBaker(next); }}
            disabled={toggleBakerMut.isPending}
          />
        )}
      </div>

      {productId !== null && (
        <Tabs defaultValue="edit" className="space-y-4">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="space-y-4">
            <RecipeCostPreviewCard productId={productId} rows={recipe} />

            {isBakerMode && (
              <div
                className="flex flex-wrap items-end gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
                data-testid="baker-target-flour-block"
              >
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="baker-target-flour"
                    className="text-xs uppercase tracking-widest text-text-secondary"
                  >
                    Target flour qty (g)
                  </label>
                  <Input
                    id="baker-target-flour"
                    data-testid="baker-target-flour-input"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step="1"
                    value={targetFlourStr}
                    onChange={(e) => setTargetFlourStr(e.target.value)}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-text-secondary max-w-md">
                  Quantities below are expressed as a percentage of this flour mass.
                  Use 1000 g (1 kg) for an easy mental reference.
                </p>
              </div>
            )}

            <div className="border border-border-subtle rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevated text-xs uppercase tracking-widest text-text-secondary">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left">Material</th>
                    <th
                      className="px-3 py-2 text-right"
                      data-testid="recipe-qty-header"
                      title={isBakerMode ? 'Percentage of the flour pivot row' : 'Quantity per produced unit'}
                    >
                      {isBakerMode ? '% flour' : 'Qty / unit'}
                    </th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={recipe.map((r) => r.recipe_id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <tbody>
                      {recipe.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-6 text-text-muted">
                          No active recipe rows yet — add ingredients below.
                        </td></tr>
                      )}
                      {recipe.map((r) => (
                        <RecipeRowSortable
                          key={r.recipe_id}
                          row={r}
                          onRemove={(id) => void deactivateMut.mutate({ recipeId: id, productId })}
                          isRemoving={deactivateMut.isPending}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </DndContext>
              </table>
            </div>

            {isBakerMode && (
              <BakerPreviewPanel
                data={convertQry.data}
                targetFlourQty={debouncedTarget}
                isLoading={convertQry.isFetching && convertQry.data === undefined}
              />
            )}

            <form onSubmit={(e) => { void handleAdd(e); }} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <label className="text-xs uppercase tracking-widest text-text-secondary">
                  Material
                </label>
                <IngredientPicker
                  value={materialId}
                  onChange={(id, row) => {
                    setMaterialId(id);
                    if (row !== null) {
                      setMaterialUnit(row.unit);
                      // Default the row unit to the material's stock unit when
                      // the user hasn't typed anything yet.
                      if (qtyStr === '') setUnit(row.unit);
                    }
                  }}
                  searchFn={searchFn}
                  excludeIds={productExcludeIds}
                  costGraph={costGraph}
                  showCostPreview
                  placeholder="Search ingredient or sub-recipe…"
                />
                {materialId !== null && (
                  <p className="mt-1 text-xs text-text-secondary" data-testid="picked-material-unit">
                    Stock unit: {materialUnit}
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <label
                  className="text-xs uppercase tracking-widest text-text-secondary"
                  data-testid="add-row-qty-label"
                >
                  {isBakerMode ? '% flour' : 'Quantity'}
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0.001}
                  step="0.001"
                  max={isBakerMode ? 1000 : undefined}
                  value={qtyStr}
                  onChange={(e) => setQtyStr(e.target.value)}
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
              <div className="col-span-12">
                <Input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                />
              </div>
              {formError !== null && (
                <div className="col-span-12 text-red text-xs" role="alert">{formError}</div>
              )}
            </form>
          </TabsContent>

          <TabsContent value="history">
            <RecipeVersionHistory productId={productId} />
          </TabsContent>
        </Tabs>
      )}

      {productId !== null && duplicateOpen && (
        <RecipeDuplicateModal
          sourceProductId={productId}
          sourceProductName={selectedProduct?.name}
          sourceRowsCount={recipe.length}
          open={duplicateOpen}
          onClose={() => setDuplicateOpen(false)}
          onSuccess={(targetId) => {
            setDuplicateOpen(false);
            onProductChange(targetId);
          }}
        />
      )}
    </div>
  );
}
