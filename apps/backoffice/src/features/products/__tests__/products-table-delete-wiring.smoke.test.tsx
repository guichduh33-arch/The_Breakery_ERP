// apps/backoffice/src/features/products/__tests__/products-table-delete-wiring.smoke.test.tsx
//
// Session 45 — Wave B — ProductsTable delete-button wiring smoke.
//
// Asserts:
//   1. Trash2 button (delete-btn-<id>) is rendered when onDelete is passed.
//   2. Trash2 button is absent when onDelete is undefined.
//   3. Clicking the Trash2 button calls onDelete with the correct row.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProductsTable } from '../components/ProductsTable.js';
import type { ProductRow } from '../types.js';

const MOCK_ROW: ProductRow = {
  id:                       'prod-xyz',
  name:                     'Pain au Chocolat',
  sku:                      'PAIN-CHO',
  category_id:              'cat-1',
  category_name:            'Bakery',
  category_type:            'finished',
  retail_price:             20_000,
  wholesale_price:          null,
  cost_price:               6_000,
  product_type:             'finished',
  tax_inclusive:            true,
  image_url:                null,
  current_stock:            8,
  min_stock_threshold:      2,
  unit:                     'pcs',
  is_active:                true,
  is_favorite:              false,
  allergens:                [],
  description:              null,
  visible_on_pos:           true,
  available_for_sale:       true,
  track_inventory:          true,
  deduct_stock:             true,
  is_semi_finished:         false,
  target_gross_margin_pct:  null,
  default_shelf_life_hours: null,
  is_display_item:          false,
  parent_product_id:        null,
  variant_label:            null,
  variant_axis:             null,
  variant_sort_order:       0,
  dispatch_stations:        null,
};

function renderTable(onDelete?: (row: ProductRow) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsTable
          rows={[MOCK_ROW]}
          isLoading={false}
          {...(onDelete !== undefined ? { onDelete } : {})}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsTable — delete button wiring [S45 W-B]', () => {
  it('renders the Trash2 delete button when onDelete is provided', () => {
    renderTable(vi.fn());
    expect(screen.getByTestId('delete-btn-prod-xyz')).toBeInTheDocument();
  });

  it('does not render the Trash2 delete button when onDelete is undefined', () => {
    renderTable(undefined);
    expect(screen.queryByTestId('delete-btn-prod-xyz')).not.toBeInTheDocument();
  });

  it('calls onDelete with the correct row when Trash2 is clicked', () => {
    const onDelete = vi.fn();
    renderTable(onDelete);
    const btn = screen.getByTestId('delete-btn-prod-xyz');
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith(MOCK_ROW);
  });
});
