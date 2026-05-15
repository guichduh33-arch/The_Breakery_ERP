// apps/backoffice/src/features/recipes/__tests__/RecipeBuilder.test.tsx
//
// Session 14 / Phase 4.B — Smoke test for the recipe builder.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeBuilder } from '@/features/recipes/index.js';

const RECIPE_ROWS = [
  {
    recipe_id: 'r-1', product_id: 'p-1', product_name: 'Aioli Sauce', product_unit: 'kg',
    material_id: 'm-1', material_name: 'Mayonnaise', material_unit: 'kg', material_cost_price: 50000,
    quantity: 0.9, unit: 'kg', is_active: true, notes: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  },
  {
    recipe_id: 'r-2', product_id: 'p-1', product_name: 'Aioli Sauce', product_unit: 'kg',
    material_id: 'm-2', material_name: 'Olive Oil', material_unit: 'l', material_cost_price: 100000,
    quantity: 0.083, unit: 'l', is_active: true, notes: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  },
];

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const chain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      order:  () => Promise.resolve({
        data: table === 'products' ? [
          { id: 'p-1', sku: 'SFG-012', name: 'Aioli Sauce', unit: 'kg', current_stock: 0, cost_price: 60452 },
          { id: 'p-2', sku: 'SFG-013', name: 'Garlic Paste', unit: 'kg', current_stock: 0, cost_price: 0 },
        ] : table === 'recipes' ? [{ product_id: 'p-1' }] : [],
        error: null,
      }),
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
      rpc: (fn: string) => {
        if (fn === 'list_recipes_v1') {
          return Promise.resolve({ data: RECIPE_ROWS, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

function renderBuilder() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecipeBuilder
        productId="p-1"
        productName="Aioli Sauce"
        productUnit="kg"
      />
    </QueryClientProvider>,
  );
}

describe('RecipeBuilder', () => {
  it('renders the calculation-base callout and recipe rows', async () => {
    renderBuilder();
    expect(await screen.findByText('Mayonnaise')).toBeInTheDocument();
    expect(screen.getByText('Olive Oil')).toBeInTheDocument();
    expect(screen.getByText(/Calculation base: 1 kg of finished product/i)).toBeInTheDocument();
    // Footer total row + header label both mention "2 ingredients" — assert at least one.
    expect(screen.getAllByText(/2 ingredients/i).length).toBeGreaterThan(0);
  });

  it('exposes the add-ingredient form when not read-only', async () => {
    renderBuilder();
    await screen.findByText('Mayonnaise');
    expect(screen.getByLabelText('Ingredient')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add ingredient/i })).toBeInTheDocument();
  });
});
