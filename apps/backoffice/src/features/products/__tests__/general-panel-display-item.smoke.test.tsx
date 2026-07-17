// apps/backoffice/src/features/products/__tests__/general-panel-display-item.smoke.test.tsx
//
// POS display-stock isolation (Wave 6 / Task 23) — GeneralPanel display-item toggle smoke.
//
// Asserts that toggling the "Display-case item (POS vitrine)" switch fires the
// panel's onChange patch callback with { is_display_item: true }.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GeneralPanel } from '../components/GeneralPanel.js';
import type { ProductRow, CategoryOption } from '../types.js';

const product: ProductRow = {
  id: 'p1',
  name: 'Croissant',
  sku: 'CR',
  category_id: 'c1',
  category_name: 'Pastry',
  category_type: 'finished',
  cost_price: 0,
  retail_price: 25000,
  wholesale_price: null,
  unit: 'pcs',
  min_stock_threshold: 0,
  current_stock: 0,
  is_active: true,
  is_favorite: false,
  image_url: null,
  product_type: 'finished',
  allergens: [],
  description: null,
  visible_on_pos: true,
  available_for_sale: true,
  track_inventory: true,
  deduct_stock: true,
  is_semi_finished: false,
  target_gross_margin_pct: null,
  default_shelf_life_hours: null,
  is_display_item: false,
  parent_product_id: null,
  variant_label: null,
  variant_axis: null,
  variant_sort_order: 0,
  dispatch_stations: null,
};

const categories: ReadonlyArray<CategoryOption> = [
  { id: 'c1', name: 'Pastry', slug: 'pastry', is_active: true, sort_order: 10 },
];

describe('GeneralPanel — display-item toggle [Wave 6 / Task 23]', () => {
  it('fires onChange with { is_display_item: true } when toggled', () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <GeneralPanel
          product={product}
          categories={categories}
          readOnly={false}
          onChange={onChange}
        />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('switch', { name: /display-case item/i });
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({ is_display_item: true });
  });

  // M7 audit fix — "needs stocking" banner.
  it('hides the vitrine warning for a non-display product', () => {
    render(
      <MemoryRouter>
        <GeneralPanel product={product} categories={categories} readOnly />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('display-stock-warning')).not.toBeInTheDocument();
  });

  it('shows the vitrine warning when flagged and the counter is empty', () => {
    render(
      <MemoryRouter>
        <GeneralPanel
          product={{ ...product, is_display_item: true }}
          categories={categories}
          readOnly
          displayStockQty={0}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('display-stock-warning')).toBeInTheDocument();
  });

  it('shows the vitrine warning when flagged and the counter row is missing (null)', () => {
    render(
      <MemoryRouter>
        <GeneralPanel
          product={{ ...product, is_display_item: true }}
          categories={categories}
          readOnly
          displayStockQty={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('display-stock-warning')).toBeInTheDocument();
  });

  it('hides the vitrine warning once the counter is stocked (> 0)', () => {
    render(
      <MemoryRouter>
        <GeneralPanel
          product={{ ...product, is_display_item: true }}
          categories={categories}
          readOnly
          displayStockQty={12}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('display-stock-warning')).not.toBeInTheDocument();
  });
});
