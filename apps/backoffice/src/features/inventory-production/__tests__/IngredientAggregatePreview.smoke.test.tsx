// apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx
// Session 15 / Phase 4.A — Aggregate ingredient preview smoke tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IngredientAggregatePreview } from '../components/IngredientAggregatePreview.js';
import type { BatchItem } from '../components/BatchSelector.js';

const mockRpc = vi.fn();
const mockProductsSelectIn = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    from: () => ({
      select: () => ({
        in: (col: string, ids: string[]) => Promise.resolve(mockProductsSelectIn(col, ids)),
      }),
    }),
  },
}));

function row(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    rowId:            crypto.randomUUID(),
    productId:        null,
    productName:      null,
    productUnit:      null,
    quantityProduced: '',
    quantityWaste:    '0',
    ...overrides,
  };
}

function renderPreview(items: BatchItem[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <IngredientAggregatePreview items={items} />
    </QueryClientProvider>,
  );
}

describe('IngredientAggregatePreview smoke', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockProductsSelectIn.mockReset();
  });

  it('renders empty-state hint when no items are valid', () => {
    renderPreview([row()]);
    expect(screen.getByText(/Pick a recipe and enter a quantity/i)).toBeInTheDocument();
  });

  it('aggregates across two items sharing a material and flags shortages', async () => {
    // Two products share Flour (mat-flour). A uses 200g per unit, B uses 300g per unit.
    // For 1 unit of A and 1 unit of B, required = 500g. We have 400g available -> short.
    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'list_recipes_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-A') {
        return Promise.resolve({ data: [{
          recipe_id: 'r-a-1', product_id: 'prod-A', product_name: 'A', product_unit: 'pcs',
          material_id: 'mat-flour', material_name: 'Flour', material_unit: 'g',
          material_cost_price: 10, quantity: 200, unit: 'g', is_active: true, notes: null,
        }], error: null });
      }
      if (args.p_product_id === 'prod-B') {
        return Promise.resolve({ data: [{
          recipe_id: 'r-b-1', product_id: 'prod-B', product_name: 'B', product_unit: 'pcs',
          material_id: 'mat-flour', material_name: 'Flour', material_unit: 'g',
          material_cost_price: 10, quantity: 300, unit: 'g', is_active: true, notes: null,
        }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
    mockProductsSelectIn.mockReturnValue({
      data:  [{ id: 'mat-flour', current_stock: 400 }],
      error: null,
    });

    renderPreview([
      row({ productId: 'prod-A', productName: 'A', productUnit: 'pcs', quantityProduced: '1' }),
      row({ productId: 'prod-B', productName: 'B', productUnit: 'pcs', quantityProduced: '1' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText(/Flour/)).toBeInTheDocument();
    });
    // Status: short (since 500 > 400).
    await waitFor(() => {
      expect(screen.getByTestId('status-short')).toBeInTheDocument();
    });
    // Alert banner is rendered.
    expect(
      screen.getByText(/One or more ingredients are short/i),
    ).toBeInTheDocument();
  });

  it('shows OK status when stock covers requirements', async () => {
    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'list_recipes_v1') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [{
        recipe_id: 'r-a-1', product_id: args.p_product_id, product_name: 'A', product_unit: 'pcs',
        material_id: 'mat-x', material_name: 'Mat X', material_unit: 'g',
        material_cost_price: 5, quantity: 100, unit: 'g', is_active: true, notes: null,
      }], error: null });
    });
    mockProductsSelectIn.mockReturnValue({
      data:  [{ id: 'mat-x', current_stock: 1000 }],
      error: null,
    });

    renderPreview([
      row({ productId: 'prod-A', productName: 'A', productUnit: 'pcs', quantityProduced: '2' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText(/Mat X/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status-ok')).toBeInTheDocument();
    });
  });
});
