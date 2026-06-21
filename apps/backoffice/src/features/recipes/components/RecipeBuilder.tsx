// apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx
//
// Unified recipe editor for the product detail "Recipe" tab. Keeps the
// product-tab presentation (gold "Calculation base" callout + cards) and
// grafts the rich features that used to live only in the standalone
// inventory-production/RecipeEditor:
//   - Edit / History sub-tabs
//   - live cost-preview card (cost + margin + recompute badge)
//   - IngredientPicker autocomplete (raw / semi / sub-recipe) + cost graph
//   - units-registry-driven unit dropdown (filtered by material dimension)
//   - drag-to-reorder rows (@dnd-kit) via SortableRecipeRow
//   - baker's-percentage mode (toggle + target flour + preview)
//   - duplicate recipe -> navigates to the new product's Recipe tab
//
// 100% front: all mutations go through the existing Session 13/15 RPC hooks.

import { Plus, Scale } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Card,
  EmptyState,
  IngredientPicker,
  Input,
  SectionLabel,
  Tabs, TabsContent, TabsList, TabsTrigger,
  type IngredientSearchResult,
} from '@breakery/ui';
import type { RecipeGraph, RecipeGraphProduct, RecipeRow } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { useRecipes } from '@/features/inventory-production/hooks/useRecipes.js';
import { useUpsertRecipe, UpsertRecipeError } from '@/features/inventory-production/hooks/useUpsertRecipe.js';
import { useDeactivateRecipe } from '@/features/inventory-production/hooks/useDeactivateRecipe.js';
import { useReorderRecipeRows } from '@/features/inventory-production/hooks/useReorderRecipeRows.js';
import { useUnits, eligibleRecipeUnits } from '@/features/inventory-production/hooks/useUnits.js';
import {
  useBakerRecipeMode,
  useToggleBakerMode,
  useConvertBakerToAbsolute,
} from '@/features/inventory-production/hooks/useBakerRecipeMode.js';
import { RecipeCostPreviewCard } from '@/features/inventory-production/components/RecipeCostPreviewCard.js';
import { RecipeDuplicateModal } from '@/features/inventory-production/components/RecipeDuplicateModal.js';
import { RecipeVersionHistory } from '@/features/inventory-production/components/RecipeVersionHistory.js';
import { BoulangerModeToggle } from '@/features/inventory-production/components/BoulangerModeToggle.js';
import { BakerPreviewPanel } from '@/features/inventory-production/components/BakerPreviewPanel.js';
import { SortableRecipeRow } from './SortableRecipeRow.js';

export interface RecipeBuilderProps {
  productId: string;
  productName: string;
  productUnit: string;
  /** When true, hides edit affordances (add form, reorder, remove, duplicate, baker toggle). */
  readOnly?: boolean;
}

// Module-level (stable) search thunk for IngredientPicker.
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

export function RecipeBuilder({
  productId,
  productName,
  productUnit,
  readOnly = false,
}: RecipeBuilderProps): JSX.Element {
  const navigate = useNavigate();
  const recipes = useRecipes(productId);
  const upsertMut = useUpsertRecipe();
  const deactivateMut = useDeactivateRecipe();
  const reorderMut = useReorderRecipeRows();
  const { data: allUnits = [] } = useUnits();

  const [materialId, setMaterialId] = useState<string | null>(null);
  const [materialUnit, setMaterialUnit] = useState<string>('kg');
  const [qtyStr, setQtyStr] = useState('');
  const [unit, setUnit] = useState<string>('gr');
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [targetFlourStr, setTargetFlourStr] = useState('1000');

  const recipe: RecipeRow[] = recipes.data ?? [];

  const eligibleUnits = useMemo(
    () => eligibleRecipeUnits(materialUnit, allUnits),
    [materialUnit, allUnits],
  );

  // Baker's-percentage mode.
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

  const convertQry = useConvertBakerToAbsolute(productId, debouncedTarget, isBakerMode);

  const totalQty = useMemo(
    () => recipe.reduce((acc, r) => acc + Number(r.quantity), 0),
    [recipe],
  );

  // Light cost graph for the picker's sub-recipe preview.
  const costGraph: RecipeGraph = useMemo(() => {
    const productsMap: Record<string, RecipeGraphProduct> = {};
    productsMap[productId] = { id: productId, name: productName, unit: productUnit, cost_price: 0 };
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
  }, [productId, productName, productUnit, recipe]);

  const numericQty = Number.parseFloat(qtyStr);
  const bakerPctValid = isBakerMode
    ? Number.isFinite(numericQty) && numericQty > 0 && numericQty <= 1000
    : true;
  const targetFlourValid = !isBakerMode || (Number.isFinite(targetFlour) && targetFlour > 0);
  const canAdd =
    !readOnly &&
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
    if (!canAdd || materialId === null) return;
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
        notes: null,
      };
      if (isBakerMode) {
        args.isBakerPercentage = true;
        args.bakerPercentage   = numericQty;
      }
      await upsertMut.mutateAsync(args);
      setMaterialId(null);
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

  async function handleToggleBaker(next: boolean): Promise<void> {
    setFormError(null);
    try {
      await toggleBakerMut.mutateAsync({ productId, next });
    } catch {
      setFormError('Failed to switch baker mode.');
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = recipe.findIndex((r) => r.recipe_id === active.id);
    const newIndex = recipe.findIndex((r) => r.recipe_id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(recipe, oldIndex, newIndex);
    reorderMut.mutate({ productId, recipeIds: reordered.map((r) => r.recipe_id) });
  }

  return (
    <div className="space-y-6">
      {/* Calculation-base callout — kept from the original product-tab look */}
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

      <Tabs defaultValue="edit" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <BoulangerModeToggle
                value={isBakerMode}
                onChange={(next) => { void handleToggleBaker(next); }}
                disabled={toggleBakerMut.isPending}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDuplicateOpen(true)}
                disabled={recipe.length === 0}
                data-testid="duplicate-recipe-button"
              >
                Duplicate recipe
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="edit" className="space-y-6">
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
                      {!readOnly && <th className="w-8 px-2 py-3" />}
                      <th className="px-4 py-3 text-left">
                        <SectionLabel as="span" size="xs">Ingredient</SectionLabel>
                      </th>
                      <th className="px-4 py-3 text-right">
                        <SectionLabel as="span" size="xs">
                          {isBakerMode ? '% flour' : 'Quantity'}
                        </SectionLabel>
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
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    accessibility={{ container: document.body }}
                  >
                    <SortableContext
                      items={recipe.map((r) => r.recipe_id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <tbody>
                        {recipe.map((r) => (
                          <SortableRecipeRow
                            key={r.recipe_id}
                            row={r}
                            readOnly={readOnly}
                            isRemoving={deactivateMut.isPending}
                            onRemove={(id) => deactivateMut.mutate({ recipeId: id, productId })}
                          />
                        ))}
                      </tbody>
                    </SortableContext>
                  </DndContext>
                  <tfoot className="bg-bg-base/40">
                    <tr>
                      {!readOnly && <td />}
                      <td className="px-4 py-3">
                        <SectionLabel as="span" size="xs">
                          Total ({recipe.length} ingredients)
                        </SectionLabel>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-gold">
                        {totalQty.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-text-secondary">{productUnit}</td>
                      {!readOnly && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {isBakerMode && (
              <div className="mt-4">
                <BakerPreviewPanel
                  data={convertQry.data}
                  targetFlourQty={debouncedTarget}
                  isLoading={convertQry.isFetching && convertQry.data === undefined}
                />
              </div>
            )}

            {!readOnly && (
              <form
                onSubmit={(e) => { void handleAdd(e); }}
                className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end"
              >
                <div className="md:col-span-6">
                  <SectionLabel as="div" size="xs">Ingredient</SectionLabel>
                  <div className="mt-1.5">
                    <IngredientPicker
                      value={materialId}
                      onChange={(id, row) => {
                        setMaterialId(id);
                        if (row !== null) {
                          setMaterialUnit(row.unit);
                          setUnit(row.unit);
                        }
                      }}
                      searchFn={searchIngredientsFn}
                      excludeIds={[productId]}
                      costGraph={costGraph}
                      showCostPreview
                      placeholder="Search ingredient or sub-recipe…"
                    />
                  </div>
                  {materialId !== null && (
                    <p className="mt-1 text-xs text-text-secondary" data-testid="picked-material-unit">
                      Stock unit: {materialUnit}
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <SectionLabel as="div" size="xs">{isBakerMode ? '% flour' : 'Quantity'}</SectionLabel>
                  <Input
                    aria-label="Quantity"
                    type="number"
                    inputMode="decimal"
                    min={0.001}
                    step="0.001"
                    max={isBakerMode ? 1000 : undefined}
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
                    {eligibleUnits.map((u) => <option key={u} value={u}>{u}</option>)}
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
        </TabsContent>

        <TabsContent value="history">
          <RecipeVersionHistory productId={productId} />
        </TabsContent>
      </Tabs>

      {duplicateOpen && (
        <RecipeDuplicateModal
          sourceProductId={productId}
          sourceProductName={productName}
          sourceRowsCount={recipe.length}
          open={duplicateOpen}
          onClose={() => setDuplicateOpen(false)}
          onSuccess={(targetId) => {
            setDuplicateOpen(false);
            navigate(`/backoffice/products/${targetId}?tab=recipe`);
          }}
        />
      )}
    </div>
  );
}
