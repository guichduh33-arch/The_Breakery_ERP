// apps/backoffice/src/features/products/__tests__/products-list-filter.smoke.test.tsx
//
// Session 27c — Wave 6.E — Products list filter + variant badge smoke.
//
// Asserts:
//   1. ProductsGrid renders the `badge-variant` testid for rows whose
//      parent_product_id is not null.
//   2. ProductsFilters dispatches onVariantFilter('variants') when the
//      'Variants only' option is picked in the dropdown.
//
// Note on plan deviation:
//   The plan's draft test rendered <ProductsGrid /> with no props and mocked
//   `useProducts.js`. The actual `ProductsGrid` is a presentational component
//   that receives `rows` + `parentIds` from its parent (Products.tsx), and
//   the filter dropdown lives in `ProductsFilters` (state owned by
//   Products.tsx). Testing the page would pull in supabase + the auth store.
//   We test the two halves of the contract in isolation instead.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsGrid } from '../components/ProductsGrid.js';
import { ProductsFilters } from '../components/ProductsFilters.js';
import type { ProductRow, CategoryOption } from '../types.js';

const mockProducts: ReadonlyArray<ProductRow> = [
  {
    id: 'p1',
    name: 'Croissant',
    sku: 'CR',
    category_id: '',
    category_name: null,
    cost_price: 0,
    retail_price: 0,
    wholesale_price: null,
    unit: 'pcs',
    min_stock_threshold: 0,
    current_stock: 0,
    is_active: true,
    is_favorite: false,
    image_url: null,
    product_type: 'finished',
    tax_inclusive: true,
    allergens: [],
    description: null,
    visible_on_pos: true,
    available_for_sale: true,
    track_inventory: true,
    deduct_stock: true,
    is_semi_finished: false,
    target_gross_margin_pct: null,
    default_shelf_life_hours: null,
    parent_product_id: null,
    variant_label: null,
    variant_axis: null,
    variant_sort_order: 0,
  },
  {
    id: 'p2',
    name: 'Croissant Amande',
    sku: 'CR-AMD',
    category_id: '',
    category_name: null,
    cost_price: 8000,
    retail_price: 25000,
    wholesale_price: null,
    unit: 'pcs',
    min_stock_threshold: 0,
    current_stock: 0,
    is_active: true,
    is_favorite: false,
    image_url: null,
    product_type: 'finished',
    tax_inclusive: true,
    allergens: [],
    description: null,
    visible_on_pos: true,
    available_for_sale: true,
    track_inventory: true,
    deduct_stock: true,
    is_semi_finished: false,
    target_gross_margin_pct: null,
    default_shelf_life_hours: null,
    parent_product_id: 'p1', // ← variant
    variant_label: 'Amande',
    variant_axis: 'flavor',
    variant_sort_order: 10,
  },
  {
    id: 'p3',
    name: 'Pain',
    sku: 'PAIN',
    category_id: '',
    category_name: null,
    cost_price: 5000,
    retail_price: 10000,
    wholesale_price: null,
    unit: 'pcs',
    min_stock_threshold: 0,
    current_stock: 0,
    is_active: true,
    is_favorite: false,
    image_url: null,
    product_type: 'finished',
    tax_inclusive: true,
    allergens: [],
    description: null,
    visible_on_pos: true,
    available_for_sale: true,
    track_inventory: true,
    deduct_stock: true,
    is_semi_finished: false,
    target_gross_margin_pct: null,
    default_shelf_life_hours: null,
    parent_product_id: null,
    variant_label: null,
    variant_axis: null,
    variant_sort_order: 0,
  },
];

const categories: ReadonlyArray<CategoryOption> = [];

describe('Products list — filter + variant badge [S27c W6.E]', () => {
  it('shows variant badge on variant rows in ProductsGrid', () => {
    // parentIds set marks 'p1' as a parent (because p2.parent_product_id === 'p1').
    const parentIds = new Set<string>(['p1']);
    render(
      <MemoryRouter>
        <ProductsGrid rows={mockProducts} parentIds={parentIds} />
      </MemoryRouter>,
    );
    // Only p2 has parent_product_id !== null → exactly 1 variant badge.
    expect(screen.getAllByTestId('badge-variant')).toHaveLength(1);
    // And p1 is in parentIds → exactly 1 parent badge.
    expect(screen.getAllByTestId('badge-parent')).toHaveLength(1);
  });

  it('emits onVariantFilter("variants") when ProductsFilters dropdown changes', () => {
    const onVariantFilter = vi.fn();
    render(
      <ProductsFilters
        search=""
        onSearch={() => {}}
        categoryId="all"
        onCategory={() => {}}
        categories={categories}
        view="list"
        onViewChange={() => {}}
        variantFilter="all"
        onVariantFilter={onVariantFilter}
      />,
    );
    const select = screen.getByTestId('products-filter');
    fireEvent.change(select, { target: { value: 'variants' } });
    expect(onVariantFilter).toHaveBeenCalledWith('variants');
  });
});
