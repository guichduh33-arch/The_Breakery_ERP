// apps/backoffice/src/features/products/__tests__/products-table-pricing-wiring.smoke.test.tsx
//
// Session 45 — Wave C — ProductsTable pricing-button wiring smoke.
//
// Asserts:
//   1. DollarSign ($) button (pricing-btn-<id>) is rendered when onPricing is passed.
//   2. DollarSign ($) button is absent when onPricing is undefined.
//   3. Clicking the button calls onPricing with the correct row.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProductsTable } from '../components/ProductsTable.js';
import type { ProductRow } from '../types.js';

const MOCK_ROW: ProductRow = {
  id:                       'prod-pricing-1',
  name:                     'Croissant',
  sku:                      'PAS-CRO',
  category_id:              'cat-pastry',
  category_name:            'Pastry',
  retail_price:             18_000,
  wholesale_price:          null,
  cost_price:               5_500,
  product_type:             'finished',
  tax_inclusive:            true,
  image_url:                null,
  current_stock:            12,
  min_stock_threshold:      3,
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
};

function renderTable(onPricing?: (row: ProductRow) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsTable
          rows={[MOCK_ROW]}
          isLoading={false}
          {...(onPricing !== undefined ? { onPricing } : {})}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsTable — pricing button wiring [S45 W-C]', () => {
  it('renders the $ pricing button when onPricing is provided', () => {
    renderTable(vi.fn());
    expect(screen.getByTestId('pricing-btn-prod-pricing-1')).toBeInTheDocument();
  });

  it('does not render the $ pricing button when onPricing is undefined', () => {
    renderTable(undefined);
    expect(screen.queryByTestId('pricing-btn-prod-pricing-1')).not.toBeInTheDocument();
  });

  it('calls onPricing with the correct row when $ button is clicked', () => {
    const onPricing = vi.fn();
    renderTable(onPricing);
    const btn = screen.getByTestId('pricing-btn-prod-pricing-1');
    fireEvent.click(btn);
    expect(onPricing).toHaveBeenCalledWith(MOCK_ROW);
  });
});
