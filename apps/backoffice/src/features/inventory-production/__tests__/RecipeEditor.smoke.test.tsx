// apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx
// Session 13 — Phase 2.A — RecipeEditor render + add row smoke test.
// Session 15 — Phase 3.B — extended for Duplicate button + IngredientPicker.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecipeEditor from '../components/RecipeEditor.js';

const mockRpc = vi.fn();

const PRODUCT_ROWS = [
  { id: 'bag-1', sku: 'BAG-1', name: 'Test Baguette', unit: 'pcs', current_stock: 0,   cost_price: 1500 },
  { id: 'flo-1', sku: 'FLO-1', name: 'Test Flour',    unit: 'kg',  current_stock: 100, cost_price: 10000 },
];
const RECIPE_ROW_JSONB = [
  {
    recipe_id: 'r-1', product_id: 'bag-1', product_name: 'Test Baguette', product_unit: 'pcs',
    material_id: 'flo-1', material_name: 'Test Flour', material_unit: 'kg',
    material_cost_price: 10000, quantity: 250, unit: 'g',
    is_active: true, notes: null,
  },
];

interface RpcResult { data: unknown; error: { message: string } | null }
interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  order:  () => MockChain | Promise<RpcResult>;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): MockChain {
    const tableData: RpcResult =
      table === 'products' ? { data: PRODUCT_ROWS, error: null } :
      table === 'recipes'  ? { data: [{ product_id: 'bag-1' }], error: null } :
      { data: [], error: null };
    const chain: MockChain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      order:  () => chain,
      limit:  () => Promise.resolve(tableData),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc: (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        if (out !== undefined) return Promise.resolve(out);
        if (fn === 'list_recipes_v1') {
          return Promise.resolve({ data: RECIPE_ROW_JSONB, error: null });
        }
        if (fn === 'upsert_recipe_v1') {
          return Promise.resolve({ data: 'r-2', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

function renderEditor(productId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let currentId = productId;
  const setId = (id: string | null) => { currentId = id; };
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <RecipeEditor productId={currentId} onProductChange={setId} />
      </QueryClientProvider>,
    ),
  };
}

describe('RecipeEditor smoke', () => {
  beforeEach(() => mockRpc.mockReset());

  it('renders the product picker', async () => {
    renderEditor(null);
    await waitFor(() => {
      expect(screen.getByText(/Finished product/i)).toBeInTheDocument();
    });
  });

  it('renders the empty-recipe table when a product is selected', async () => {
    renderEditor('bag-1');
    await waitFor(() => {
      expect(screen.getByText(/Add ingredient/i)).toBeInTheDocument();
    });
  });

  it('disables Add until material + quantity are valid', async () => {
    renderEditor('bag-1');
    await waitFor(() => screen.getByText(/Add ingredient/i));
    const addBtn = screen.getByRole('button', { name: /Add ingredient/i });
    expect(addBtn).toBeDisabled();
  });

  it('shows the Duplicate recipe button and opens the modal on click', async () => {
    renderEditor('bag-1');
    const dupBtn = await waitFor(() =>
      screen.getByTestId('duplicate-recipe-button') as HTMLButtonElement
    );
    // Wait for recipe rows so the button becomes enabled.
    await waitFor(() => expect(dupBtn).not.toBeDisabled());
    fireEvent.click(dupBtn);
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-target-select')).toBeInTheDocument();
    });
  });
});
