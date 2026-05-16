// apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx
// Session 17 / Phase 2.A — Rewired to mock recipe_bom_full_v1 (server-side cascade).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IngredientAggregatePreview } from '../components/IngredientAggregatePreview.js';
import type { BatchItem } from '../components/BatchSelector.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
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

// BomLeafRow shape returned by recipe_bom_full_v1
function leaf(overrides: {
  material_id: string;
  material_name: string;
  material_unit?: string;
  qty_per_unit: number;
  current_stock?: number;
  cost_price?: number;
}) {
  return {
    material_id:   overrides.material_id,
    material_name: overrides.material_name,
    material_unit: overrides.material_unit ?? 'kg',
    qty_per_unit:  overrides.qty_per_unit,
    current_stock: overrides.current_stock ?? 1000,
    cost_price:    overrides.cost_price ?? 0,
  };
}

describe('IngredientAggregatePreview smoke', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('renders empty-state hint when no items are valid', () => {
    renderPreview([row()]);
    expect(screen.getByText(/Pick a recipe and enter a quantity/i)).toBeInTheDocument();
  });

  it('calls recipe_bom_full_v1 once per root and aggregates across two items sharing a material', async () => {
    // croissant : flour=0.05/unit, butter=0.02/unit, chocolate=0.05/unit (server-side flattened from dough sub-recipe)
    // pain_au_choco : flour=0.075/unit, butter=0.03/unit, chocolate=0.03/unit
    // Producing 10 croissants + 20 pain_au_choco:
    //   flour     = 10×0.05 + 20×0.075 = 0.5 + 1.5 = 2.0
    //   butter    = 10×0.02 + 20×0.03  = 0.2 + 0.6 = 0.8
    //   chocolate = 10×0.05 + 20×0.03  = 0.5 + 0.6 = 1.1

    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'recipe_bom_full_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-croissant') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-flour',     material_name: 'Flour',     material_unit: 'kg', qty_per_unit: 0.05,  current_stock: 10 }),
          leaf({ material_id: 'mat-butter',    material_name: 'Butter',    material_unit: 'kg', qty_per_unit: 0.02,  current_stock: 10 }),
          leaf({ material_id: 'mat-chocolate', material_name: 'Chocolate', material_unit: 'kg', qty_per_unit: 0.05,  current_stock: 10 }),
        ], error: null });
      }
      if (args.p_product_id === 'prod-pain-au-choco') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-flour',     material_name: 'Flour',     material_unit: 'kg', qty_per_unit: 0.075, current_stock: 10 }),
          leaf({ material_id: 'mat-butter',    material_name: 'Butter',    material_unit: 'kg', qty_per_unit: 0.03,  current_stock: 10 }),
          leaf({ material_id: 'mat-chocolate', material_name: 'Chocolate', material_unit: 'kg', qty_per_unit: 0.03,  current_stock: 10 }),
        ], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    renderPreview([
      row({ productId: 'prod-croissant',     productName: 'Croissant',     productUnit: 'pcs', quantityProduced: '10' }),
      row({ productId: 'prod-pain-au-choco', productName: 'Pain au Choco', productUnit: 'pcs', quantityProduced: '20' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('Flour')).toBeInTheDocument();
    });

    // recipe_bom_full_v1 called exactly twice — once per root product
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('recipe_bom_full_v1', { p_product_id: 'prod-croissant',     p_max_depth: 5 });
    expect(mockRpc).toHaveBeenCalledWith('recipe_bom_full_v1', { p_product_id: 'prod-pain-au-choco', p_max_depth: 5 });

    // 3 leaf materials rendered — dough sub-recipe must NOT appear
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('Butter')).toBeInTheDocument();
    expect(screen.getByText('Chocolate')).toBeInTheDocument();
    expect(screen.queryByText(/^Dough$/)).not.toBeInTheDocument();

    // Verify tbody has exactly 3 rows
    const tbody = document.querySelector('tbody');
    expect(tbody?.querySelectorAll('tr')).toHaveLength(3);

    // All OK because current_stock=10 > required (<3 each)
    const okBadges = screen.getAllByTestId('status-ok');
    expect(okBadges).toHaveLength(3);
  });

  it('flags shortage when current_stock < totalQty for a material', async () => {
    // croissant produces 10 units; flour need = 10 × 0.05 = 0.5 kg; stock = 0.3 kg → short
    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'recipe_bom_full_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-croissant') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-flour', material_name: 'Flour', material_unit: 'kg', qty_per_unit: 0.05, current_stock: 0.3 }),
        ], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    renderPreview([
      row({ productId: 'prod-croissant', productName: 'Croissant', productUnit: 'pcs', quantityProduced: '10' }),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('status-short')).toBeInTheDocument();
    });
    expect(screen.getByText(/One or more ingredients are short/i)).toBeInTheDocument();
  });

  it('shows OK status when stock covers requirements', async () => {
    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'recipe_bom_full_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-A') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-x', material_name: 'Mat X', material_unit: 'g', qty_per_unit: 100, current_stock: 1000 }),
        ], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    renderPreview([
      row({ productId: 'prod-A', productName: 'A', productUnit: 'pcs', quantityProduced: '2' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('Mat X')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status-ok')).toBeInTheDocument();
    });
  });

  it('3-level fixture: server returns flat leaves; dough intermediate is absent from rendered output', async () => {
    // Recipe hierarchy (server resolves):
    //   croissant  → dough (0.1/unit) + chocolate (0.05/unit)
    //   dough      → flour (0.5/kg)  + butter (0.2/kg)
    // Server cascade for croissant @ depth-5 flattens to:
    //   flour=0.05, butter=0.02, chocolate=0.05
    //
    //   pain_au_choco → dough (0.15/unit) + chocolate (0.03/unit)
    // Server cascade for pain_au_choco @ depth-5:
    //   flour=0.075, butter=0.03, chocolate=0.03
    //
    // Producing: 10 croissants + 20 pain_au_choco
    //   flour     = 10×0.05  + 20×0.075 = 0.5  + 1.5  = 2.0
    //   butter    = 10×0.02  + 20×0.03  = 0.2  + 0.6  = 0.8
    //   chocolate = 10×0.05  + 20×0.03  = 0.5  + 0.6  = 1.1

    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'recipe_bom_full_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-croissant') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-flour',     material_name: 'Flour',     material_unit: 'kg', qty_per_unit: 0.05,  current_stock: 100 }),
          leaf({ material_id: 'mat-butter',    material_name: 'Butter',    material_unit: 'kg', qty_per_unit: 0.02,  current_stock: 100 }),
          leaf({ material_id: 'mat-chocolate', material_name: 'Chocolate', material_unit: 'kg', qty_per_unit: 0.05,  current_stock: 100 }),
        ], error: null });
      }
      if (args.p_product_id === 'prod-pain-au-choco') {
        return Promise.resolve({ data: [
          leaf({ material_id: 'mat-flour',     material_name: 'Flour',     material_unit: 'kg', qty_per_unit: 0.075, current_stock: 100 }),
          leaf({ material_id: 'mat-butter',    material_name: 'Butter',    material_unit: 'kg', qty_per_unit: 0.03,  current_stock: 100 }),
          leaf({ material_id: 'mat-chocolate', material_name: 'Chocolate', material_unit: 'kg', qty_per_unit: 0.03,  current_stock: 100 }),
        ], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    renderPreview([
      row({ productId: 'prod-croissant',     productName: 'Croissant',     productUnit: 'pcs', quantityProduced: '10' }),
      row({ productId: 'prod-pain-au-choco', productName: 'Pain au Choco', productUnit: 'pcs', quantityProduced: '20' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('Flour')).toBeInTheDocument();
    });

    // Sub-recipe Dough must NOT appear
    expect(screen.queryByText(/^Dough$/)).not.toBeInTheDocument();

    // Exactly 3 ingredient rows
    const tbody = document.querySelector('tbody');
    expect(tbody?.querySelectorAll('tr')).toHaveLength(3);

    // Verify aggregated quantities appear in the table cells
    // flour = 2.0, butter = 0.8, chocolate = 1.1
    const cells = Array.from(document.querySelectorAll('td')).map((el) => el.textContent?.trim() ?? '');
    const allText = cells.join(' ');
    expect(allText).toContain('2'); // flour total = 2.0
    expect(allText).toContain('0.8'); // butter total
    expect(allText).toContain('1.1'); // chocolate total

    // All sufficient (stock=100 >> required)
    const okBadges = screen.getAllByTestId('status-ok');
    expect(okBadges).toHaveLength(3);
  });
});
