# Unify Recipe Editor into the Product Recipe Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product detail **Recipe** tab the single recipe editor, with all the rich features that used to live only in the standalone `/inventory/recipes` editor, then delete the standalone editor and its dead `RecipeStudio` wrapper.

**Architecture:** Rewrite `RecipeBuilder` (the product-tab component) so it keeps its current presentation (gold "Calculation base" callout + cards) and grafts the rich features, reusing the existing `features/inventory-production` sub-components and RPC hooks. Add one new pill-styled, drag-sortable row component co-located in `features/recipes`. Delete `RecipeEditor`, `RecipeEditorPage`, and `RecipeStudio`; redirect the old route; drop the sidebar entry. No DB/RPC/types changes — every mutation uses hooks that already exist.

**Tech Stack:** React + TypeScript, `@breakery/ui`, `@breakery/domain`, `@tanstack/react-query`, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, react-router-dom, Vitest + `@testing-library/react`, pnpm + turbo.

## Global Constraints

- **100% front-end.** No Supabase migration, no `apply_migration`, no types regen, no pgTAP. All RPCs already exist (`list_recipes_v1`, `upsert_recipe_v1`, `deactivate_recipe_v1`, `reorder_recipe_rows_v1`, `search_ingredients_v1`, the baker-mode RPCs, `list_units_v1`).
- **Keep the product-tab look** (gold callout + `Card`s) — do NOT import the standalone `RecipeEditor`'s plain-table layout. (Owner decision Q4.)
- **Keep the Costing tab separate** and **keep** the read-only `/inventory/recipes/:productId` (`RecipeDetailPage`) route — out of scope. (Owner decisions Q3.)
- **Old route redirect target:** `/backoffice/inventory/recipes` → `/backoffice/products` (Owner decision Q2).
- Package manager is **pnpm** + turbo; never `npm`.
- Conventional commits; co-author Claude. Branch: `feat/unify-recipe-editor-into-product-tab`.
- Run tests from repo root with `pnpm --filter @breakery/app-backoffice test <pattern>` and typecheck with `pnpm --filter @breakery/app-backoffice typecheck`.

---

## File Structure

**Created:**
- `apps/backoffice/src/features/recipes/components/SortableRecipeRow.tsx` — pill-styled, `@dnd-kit`-sortable recipe row matching the product-tab look; drag handle + remove button hidden in `readOnly`.
- `apps/backoffice/src/features/recipes/components/__tests__/SortableRecipeRow.test.tsx` — smoke test for the new row.

**Rewritten:**
- `apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx` — the unified editor (callout + Edit/History sub-tabs + cost-preview card + IngredientPicker + registry unit dropdown + DnD reorder + baker mode + duplicate-with-navigate).
- `apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx` — extended smokes for the new surfaces.

**Modified:**
- `apps/backoffice/src/features/recipes/index.ts` — drop the `RecipeStudio` export.
- `apps/backoffice/src/routes/index.tsx` — drop the `RecipeEditorPage` import; turn `inventory/recipes` into a redirect; keep `inventory/recipes/:productId`.
- `apps/backoffice/src/layouts/Sidebar.tsx` — remove the `Recipes` entry.

**Deleted:**
- `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx`
- `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx`
- `apps/backoffice/src/features/recipes/components/RecipeStudio.tsx`
- `apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx`

**Unchanged (intentionally):** `ProductDetailPage.tsx` already imports `RecipeBuilder` from the barrel and passes `productId`/`productName`/`productUnit`; it renders inside a Route so `useNavigate` works. The reused sub-components and hooks under `features/inventory-production/` stay in place.

---

### Task 1: New `SortableRecipeRow` (pill-styled, drag-sortable)

**Files:**
- Create: `apps/backoffice/src/features/recipes/components/SortableRecipeRow.tsx`
- Test: `apps/backoffice/src/features/recipes/components/__tests__/SortableRecipeRow.test.tsx`

**Interfaces:**
- Consumes: `RecipeRow` from `@breakery/domain`; `useSortable` from `@dnd-kit/sortable`; `CSS` from `@dnd-kit/utilities` (same imports the existing `RecipeRowSortable.tsx` uses).
- Produces: `export function SortableRecipeRow(props: SortableRecipeRowProps): JSX.Element` with
  ```ts
  export interface SortableRecipeRowProps {
    row: RecipeRow;
    readOnly: boolean;
    isRemoving: boolean;
    onRemove: (recipeId: string) => void;
  }
  ```
  Renders a `<tr data-testid={`recipe-row-${row.recipe_id}`}>`. In `readOnly`, omits the drag-handle `<td>` and the remove `<td>` (and `useSortable` is `disabled`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/backoffice/src/features/recipes/components/__tests__/SortableRecipeRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { SortableRecipeRow } from '../SortableRecipeRow.js';
import type { RecipeRow } from '@breakery/domain';

const ROW: RecipeRow = {
  recipe_id: 'r1', product_id: 'p1', product_name: 'Bread', product_unit: 'pcs',
  material_id: 'm1', material_name: 'Flour', material_unit: 'kg',
  material_cost_price: 12000, quantity: 500, unit: 'gr', is_active: true, notes: null,
};

function renderRow(readOnly: boolean, onRemove = vi.fn()) {
  return render(
    <table><DndContext><SortableContext items={['r1']}>
      <tbody>
        <SortableRecipeRow row={ROW} readOnly={readOnly} isRemoving={false} onRemove={onRemove} />
      </tbody>
    </SortableContext></DndContext></table>,
  );
}

describe('SortableRecipeRow', () => {
  it('shows the material, quantity, unit and a drag handle + remove when editable', () => {
    renderRow(false);
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('gr')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag Flour')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Flour')).toBeInTheDocument();
  });

  it('hides the drag handle and remove button in readOnly mode', () => {
    renderRow(true);
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.queryByLabelText('Drag Flour')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Flour')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice test SortableRecipeRow`
Expected: FAIL — cannot find module `../SortableRecipeRow.js`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/backoffice/src/features/recipes/components/SortableRecipeRow.tsx
//
// Pill-styled, drag-sortable recipe row for the product-tab RecipeBuilder.
// Mirrors the original product-tab row look (mono pills for qty/unit) and adds
// a @dnd-kit drag handle + remove button. Reorder + remove are hidden in
// readOnly mode.

import { GripVertical, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RecipeRow } from '@breakery/domain';

export interface SortableRecipeRowProps {
  row: RecipeRow;
  readOnly: boolean;
  isRemoving: boolean;
  onRemove: (recipeId: string) => void;
}

export function SortableRecipeRow({
  row,
  readOnly,
  isRemoving,
  onRemove,
}: SortableRecipeRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.recipe_id, disabled: readOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-t border-border-subtle"
      data-testid={`recipe-row-${row.recipe_id}`}
    >
      {!readOnly && (
        <td className="w-8 px-2 py-3 text-center">
          <button
            type="button"
            aria-label={`Drag ${row.material_name}`}
            className="cursor-grab touch-none select-none text-text-muted hover:text-text-primary"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        </td>
      )}
      <td className="px-4 py-3 text-text-primary">
        <div className="font-display text-base">{row.material_name}</div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono tabular-nums text-text-primary">
          {Number(row.quantity).toLocaleString()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono text-text-secondary">
          {row.unit}
        </span>
      </td>
      {!readOnly && (
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            aria-label={`Remove ${row.material_name}`}
            onClick={() => onRemove(row.recipe_id)}
            disabled={isRemoving}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </td>
      )}
    </tr>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice test SortableRecipeRow`
Expected: PASS (2 tests).

> If `@dnd-kit/utilities` fails to resolve, confirm the import path against the existing `apps/backoffice/src/features/inventory-production/components/RecipeRowSortable.tsx` (it uses the same `useSortable` + `CSS.Transform` pattern) and match it.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/recipes/components/SortableRecipeRow.tsx apps/backoffice/src/features/recipes/components/__tests__/SortableRecipeRow.test.tsx
git commit -m "feat(recipes): add pill-styled drag-sortable recipe row for the product tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rewrite `RecipeBuilder` as the unified editor

**Files:**
- Modify (rewrite): `apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx`
- Test (extend): `apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx`

**Interfaces:**
- Consumes: `SortableRecipeRow` (Task 1); hooks `useRecipes`, `useUpsertRecipe` + `UpsertRecipeError`, `useDeactivateRecipe`, `useReorderRecipeRows`, `useUnits` + `eligibleRecipeUnits`, `useBakerRecipeMode`, `useToggleBakerMode`, `useConvertBakerToAbsolute` (all from `features/inventory-production/hooks`); components `RecipeCostPreviewCard`, `RecipeDuplicateModal`, `RecipeVersionHistory`, `BoulangerModeToggle`, `BakerPreviewPanel` (from `features/inventory-production/components`); `IngredientPicker` + `IngredientSearchResult`, `Card`, `EmptyState`, `Input`, `SectionLabel`, `Button`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@breakery/ui`; `RecipeGraph`, `RecipeGraphProduct`, `RecipeRow` from `@breakery/domain`; `useNavigate` from `react-router-dom`; `supabase` from `@/lib/supabase.js`.
- Produces: unchanged public surface `export function RecipeBuilder(props: RecipeBuilderProps)` with the same `RecipeBuilderProps { productId; productName; productUnit; readOnly? }`. (`ProductDetailPage` and the barrel keep working with no change.)

- [ ] **Step 1: Write the failing tests**

Replace the body of `apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx` with the following. It mocks the heavy sub-components and the data/baker hooks, keeps `Card`/`Tabs`/`BoulangerModeToggle` real, and wraps in `MemoryRouter` (the component now uses `useNavigate`).

```tsx
// apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RecipeRow } from '@breakery/domain';

const ROWS: RecipeRow[] = [
  {
    recipe_id: 'r1', product_id: 'p1', product_name: 'Bread', product_unit: 'pcs',
    material_id: 'm1', material_name: 'Flour', material_unit: 'kg',
    material_cost_price: 12000, quantity: 500, unit: 'gr', is_active: true, notes: null,
  },
];

// --- hook mocks ------------------------------------------------------------
const upsertMutateAsync = vi.fn().mockResolvedValue('r2');
const deactivateMutate = vi.fn();
const reorderMutate = vi.fn();
const toggleMutateAsync = vi.fn().mockResolvedValue(undefined);
let recipesData: RecipeRow[] = ROWS;
let bakerData = false;

vi.mock('@/features/inventory-production/hooks/useRecipes.js', () => ({
  useRecipes: () => ({ data: recipesData, isLoading: false }),
}));
vi.mock('@/features/inventory-production/hooks/useUpsertRecipe.js', () => ({
  useUpsertRecipe: () => ({ mutateAsync: upsertMutateAsync, isPending: false }),
  UpsertRecipeError: class extends Error { code = 'unknown'; },
}));
vi.mock('@/features/inventory-production/hooks/useDeactivateRecipe.js', () => ({
  useDeactivateRecipe: () => ({ mutate: deactivateMutate, isPending: false }),
}));
vi.mock('@/features/inventory-production/hooks/useReorderRecipeRows.js', () => ({
  useReorderRecipeRows: () => ({ mutate: reorderMutate }),
}));
vi.mock('@/features/inventory-production/hooks/useUnits.js', async (orig) => ({
  ...(await orig<typeof import('@/features/inventory-production/hooks/useUnits.js')>()),
  useUnits: () => ({ data: [
    { code: 'kg', label: 'kg', dimension: 'mass', factor_to_canonical: 1000 },
    { code: 'gr', label: 'gr', dimension: 'mass', factor_to_canonical: 1 },
  ] }),
}));
vi.mock('@/features/inventory-production/hooks/useBakerRecipeMode.js', () => ({
  useBakerRecipeMode: () => ({ data: bakerData }),
  useToggleBakerMode: () => ({ mutateAsync: toggleMutateAsync, isPending: false }),
  useConvertBakerToAbsolute: () => ({ data: undefined, isFetching: false }),
}));

// --- heavy sub-component mocks --------------------------------------------
vi.mock('@/features/inventory-production/components/RecipeCostPreviewCard.js', () => ({
  RecipeCostPreviewCard: () => <div data-testid="cost-preview-card" />,
}));
vi.mock('@/features/inventory-production/components/RecipeVersionHistory.js', () => ({
  RecipeVersionHistory: () => <div data-testid="version-history" />,
}));
vi.mock('@/features/inventory-production/components/BakerPreviewPanel.js', () => ({
  BakerPreviewPanel: () => <div data-testid="baker-preview" />,
}));
vi.mock('@/features/inventory-production/components/RecipeDuplicateModal.js', () => ({
  RecipeDuplicateModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="duplicate-modal" /> : null,
}));
vi.mock('@breakery/ui', async (orig) => {
  const actual = await orig<typeof import('@breakery/ui')>();
  return {
    ...actual,
    IngredientPicker: (props: { onChange: (id: string, row: unknown) => void }) => (
      <button
        type="button"
        data-testid="ingredient-picker"
        onClick={() => props.onChange('m9', { unit: 'kg' })}
      >
        picker
      </button>
    ),
  };
});

import { RecipeBuilder } from '../components/RecipeBuilder.js';

function renderBuilder(readOnly = false) {
  return render(
    <MemoryRouter>
      <RecipeBuilder productId="p1" productName="Bread" productUnit="pcs" readOnly={readOnly} />
    </MemoryRouter>,
  );
}

describe('RecipeBuilder (unified)', () => {
  beforeEach(() => {
    recipesData = ROWS;
    bakerData = false;
    vi.clearAllMocks();
  });

  it('keeps the calculation-base callout and shows the cost-preview card + ingredient picker', () => {
    renderBuilder();
    expect(screen.getByText(/Calculation base: 1 pcs/i)).toBeInTheDocument();
    expect(screen.getByTestId('cost-preview-card')).toBeInTheDocument();
    expect(screen.getByTestId('ingredient-picker')).toBeInTheDocument();
    expect(screen.getByText('Flour')).toBeInTheDocument();
  });

  it('opens the duplicate modal from the Duplicate button', () => {
    renderBuilder();
    expect(screen.queryByTestId('duplicate-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('duplicate-recipe-button'));
    expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument();
  });

  it('shows the History tab content when selected', () => {
    renderBuilder();
    fireEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.getByTestId('version-history')).toBeInTheDocument();
  });

  it('reveals the target-flour block when baker mode is on', () => {
    bakerData = true;
    renderBuilder();
    expect(screen.getByTestId('baker-target-flour-block')).toBeInTheDocument();
  });

  it('hides the add form and duplicate button in readOnly mode', () => {
    renderBuilder(true);
    expect(screen.queryByTestId('ingredient-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('duplicate-recipe-button')).not.toBeInTheDocument();
    expect(screen.getByText('Flour')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @breakery/app-backoffice test RecipeBuilder`
Expected: FAIL — the current `RecipeBuilder` has no cost-preview card, ingredient picker, duplicate button, History tab, or baker block.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx` with:

```tsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @breakery/app-backoffice test RecipeBuilder`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: no errors. (Common pitfalls: a missing `@dnd-kit/*` import, or a `@breakery/ui` export name mismatch — fix against the real export.)

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx
git commit -m "feat(recipes): make the product Recipe tab the full editor

Graft cost preview, ingredient picker, registry units, DnD reorder, baker
mode and duplicate-with-navigate onto RecipeBuilder, keeping the product-tab
look. No DB change — reuses existing RPC hooks and sub-components.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Remove the standalone editor + dead `RecipeStudio`; redirect the route; drop the sidebar entry

**Files:**
- Modify: `apps/backoffice/src/routes/index.tsx` (recipe route block + remove import)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (remove the Recipes entry)
- Modify: `apps/backoffice/src/features/recipes/index.ts` (drop `RecipeStudio` export)
- Delete: `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx`
- Delete: `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx`
- Delete: `apps/backoffice/src/features/recipes/components/RecipeStudio.tsx`
- Delete: `apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx`
- Create: `apps/backoffice/src/routes/__tests__/recipe-redirect.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `/backoffice/inventory/recipes` now renders `<Navigate to="/backoffice/products" replace />`; `/backoffice/inventory/recipes/:productId` (`RecipeDetailPage`) is untouched.

- [ ] **Step 1: Write the failing redirect test**

```tsx
// apps/backoffice/src/routes/__tests__/recipe-redirect.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

// Mirrors the redirect wired in routes/index.tsx so a wrong target path is
// caught here. (The full route tree requires auth and is verified manually.)
function MiniRouter() {
  return (
    <MemoryRouter initialEntries={['/backoffice/inventory/recipes']}>
      <Routes>
        <Route path="/backoffice/inventory/recipes" element={<Navigate to="/backoffice/products" replace />} />
        <Route path="/backoffice/products" element={<div>Products list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('inventory/recipes redirect', () => {
  it('redirects the old standalone recipe route to the products list', () => {
    render(<MiniRouter />);
    expect(screen.getByText('Products list')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (it should already pass — it documents the target)**

Run: `pnpm --filter @breakery/app-backoffice test recipe-redirect`
Expected: PASS. (This test guards the redirect target string; the real wiring change is verified by Step 6 typecheck + the sweep + the manual browser check.)

- [ ] **Step 3: Rewire the route**

In `apps/backoffice/src/routes/index.tsx`:

1. Remove the import line:
   ```tsx
   import RecipeEditorPage from '@/pages/inventory/RecipeEditorPage.js';
   ```
2. Replace the standalone recipe route element. Change:
   ```tsx
   <Route
     path="inventory/recipes"
     element={
       <PermissionGate required="inventory.read">
         <RecipeEditorPage />
       </PermissionGate>
     }
   />
   ```
   to:
   ```tsx
   <Route path="inventory/recipes" element={<Navigate to="/backoffice/products" replace />} />
   ```
   Leave the `inventory/recipes/:productId` → `RecipeDetailPage` route exactly as-is. (`Navigate` is already imported at the top of this file.)

- [ ] **Step 4: Drop the sidebar entry**

In `apps/backoffice/src/layouts/Sidebar.tsx`, delete the line:
```tsx
{ to: '/backoffice/inventory/recipes', label: 'Recipes', icon: BookOpen, permission: 'inventory.read', indent: 1 },
```
If `BookOpen` is now unused anywhere else in the file, remove it from the `lucide-react` import to keep typecheck/lint clean (verify with a search before removing).

- [ ] **Step 5: Drop the dead `RecipeStudio` export and delete the files**

1. In `apps/backoffice/src/features/recipes/index.ts`, remove:
   ```tsx
   export { RecipeStudio, type RecipeStudioProps } from './components/RecipeStudio.js';
   ```
   (Leave the `RecipeBuilder` export.)
2. Delete the files:
   ```bash
   git rm apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx \
          apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx \
          apps/backoffice/src/features/recipes/components/RecipeStudio.tsx \
          apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx
   ```

- [ ] **Step 6: Verify no orphan references + typecheck**

Run a search to confirm nothing still imports the deleted modules:
```bash
git grep -nE "RecipeEditor|RecipeEditorPage|RecipeStudio" -- apps/backoffice/src
```
Expected: no matches (other than possibly the plan/spec docs, which are outside `apps/`). Then:

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: no errors.

- [ ] **Step 7: Run the recipe redirect + builder tests together**

Run: `pnpm --filter @breakery/app-backoffice test recipe-redirect RecipeBuilder SortableRecipeRow`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(recipes): remove standalone editor + dead RecipeStudio; redirect old route

Delete RecipeEditor/RecipeEditorPage/RecipeStudio, redirect
/backoffice/inventory/recipes to the products list, and drop the Stock>Recipes
sidebar entry. The product Recipe tab is now the single recipe editor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full backoffice verification

**Files:** none (verification only).

- [ ] **Step 1: Full backoffice test sweep**

Run: `pnpm --filter @breakery/app-backoffice test`
Expected: green. Pre-existing `waitFor` flakes under coverage+load are the known baseline (see CLAUDE.md S42–S46); re-run any flaky file in isolation to confirm it passes. There must be **no failure referencing recipes, RecipeBuilder, SortableRecipeRow, the redirect, or a missing RecipeEditor/RecipeStudio import.**

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: 6/6 packages PASS.

- [ ] **Step 3: Manual browser check (note for the reviewer/owner)**

Verify in the running app:
1. *Products → (a product with a recipe) → Recipe tab* shows the gold callout, cost-preview card, ingredient autocomplete, unit dropdown, drag-to-reorder, baker toggle, Duplicate, and the History sub-tab.
2. Duplicating a recipe lands on the new product's Recipe tab (`/backoffice/products/<new>?tab=recipe`).
3. Visiting `/backoffice/inventory/recipes` redirects to the products list.
4. The sidebar no longer shows *Stock → Recipes*.
5. *Costing* tab and the read-only `/backoffice/inventory/recipes/:productId` page still work.

- [ ] **Step 4: Final commit (only if Steps 1-2 required a fix)**

```bash
git add -A
git commit -m "test(recipes): verification fixes for unified recipe editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Onglet Recipe = éditeur complet (look conservé + fonctions riches) → Task 2 (callout + cost card + picker + registry units + DnD + baker + duplicate + history).
- DnD row matching the tab look → Task 1.
- Supprimer l'éditeur standalone + redirection route + entrée sidebar → Task 3.
- Dead `RecipeStudio` removed (third surface) → Task 3 (additive to spec; documented above).
- Costing + read-only `/inventory/recipes/:productId` unchanged → enforced by Global Constraints + Task 3 leaves the `:productId` route intact.
- Tests (extend RecipeBuilder, delete RecipeEditor smoke, redirect smoke, sidebar) → Tasks 1-4.
- 100% front, no migration → Global Constraints; no task touches `supabase/`.

**Placeholder scan:** No TBD/TODO; every code step shows complete file content or an exact find/replace.

**Type consistency:** `SortableRecipeRowProps` (Task 1) is consumed verbatim in Task 2's `<SortableRecipeRow … readOnly … isRemoving … onRemove />`. Hook return shapes (`mutate`/`mutateAsync`/`isPending`/`data`) match the signatures gathered from the codebase. `RecipeBuilderProps` is unchanged, so `ProductDetailPage` and the barrel keep compiling with no edit. `upsertMut.mutateAsync` arg uses the real `UpsertRecipeArgs` optional `isBakerPercentage`/`bakerPercentage` fields.

**Risk note:** The biggest typecheck risks are (a) `@dnd-kit/utilities` import path and (b) `@breakery/ui` export names — both are mitigated by mirroring the existing `RecipeRowSortable.tsx`/`RecipeEditor.tsx`, and caught by the Task 2 Step 5 and Task 4 typecheck steps.
