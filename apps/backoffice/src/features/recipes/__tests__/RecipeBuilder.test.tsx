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
    fireEvent.mouseDown(screen.getByRole('tab', { name: /history/i }));
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
