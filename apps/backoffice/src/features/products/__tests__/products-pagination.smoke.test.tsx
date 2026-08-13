// apps/backoffice/src/features/products/__tests__/products-pagination.smoke.test.tsx
//
// La grille et la table du catalogue doivent paginer PAREIL. La grille rendait
// jusqu'ici tout le résultat filtré (373 cartes, 8 236 nœuds DOM contre 911 en
// vue table) : basculer de vue changeait le comportement, pas seulement
// l'apparence. Ces tests fixent le contrat commun.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductsGrid } from '../components/ProductsGrid.js';
import {
  ListPagination,
  coercePageSize,
  pageSlice,
  LIST_PAGE_SIZE_DEFAULT,
} from '@/components/ListPagination.js';
import type { ProductRow } from '../types.js';

function makeRows(n: number): ProductRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `Product ${i}`, sku: `SKU-${i}`,
    category_id: 'c1', category_name: 'Pastry', category_type: 'finished',
    cost_price: 1000, retail_price: 2000, wholesale_price: null,
    unit: 'pcs', min_stock_threshold: 0, current_stock: 0,
    is_active: true, is_favorite: false, image_url: null,
    product_type: 'finished', description: null,
    visible_on_pos: true, available_for_sale: true, track_inventory: true,
    deduct_stock: true, is_semi_finished: false,
    target_gross_margin_pct: null, default_shelf_life_hours: null,
    is_display_item: false, parent_product_id: null,
    variant_label: null, variant_axis: null, variant_sort_order: 0,
    dispatch_stations: null,
  } satisfies ProductRow));
}

function gridCards(): number {
  return document.querySelectorAll('[data-testid="products-grid"] [class*="grid-cols"] > *').length;
}

describe('coercePageSize', () => {
  it('accepts the offered sizes and rejects everything else', () => {
    expect(coercePageSize('50')).toBe(50);
    expect(coercePageSize('100')).toBe(100);
    // Une valeur d'URL est une entrée non fiable : elle se borne, elle ne
    // devient pas un slice de 99 999 lignes.
    expect(coercePageSize('99999')).toBe(LIST_PAGE_SIZE_DEFAULT);
    expect(coercePageSize('abc')).toBe(LIST_PAGE_SIZE_DEFAULT);
    expect(coercePageSize(null)).toBe(LIST_PAGE_SIZE_DEFAULT);
  });
});

describe('pageSlice', () => {
  it('clamps an out-of-range page to the last real one instead of showing nothing', () => {
    const rows = makeRows(40);
    const { pageRows, current, pageCount } = pageSlice(rows, 99, 15);
    expect(pageCount).toBe(3);
    expect(current).toBe(3);
    expect(pageRows).toHaveLength(10);
  });
});

describe('ProductsGrid — pagination parity with the table', () => {
  it('renders one page of cards, not the whole filtered set', () => {
    render(<ProductsGrid rows={makeRows(40)} />);
    expect(gridCards()).toBe(LIST_PAGE_SIZE_DEFAULT);
    expect(screen.getByTestId('list-page-range')).toHaveTextContent('1–15 of 40');
  });

  it('honours the page it is given', () => {
    render(<ProductsGrid rows={makeRows(40)} page={3} />);
    expect(gridCards()).toBe(10);
    expect(screen.getByTestId('list-page-range')).toHaveTextContent('31–40 of 40');
  });

  it('honours a larger page size', () => {
    render(<ProductsGrid rows={makeRows(120)} pageSize={100} />);
    expect(gridCards()).toBe(100);
    expect(screen.getByTestId('list-page-range')).toHaveTextContent('1–100 of 120');
  });
});

describe('ListPagination', () => {
  it('offers 15 / 50 / 100 and reports the chosen size', () => {
    const onPageSize = vi.fn();
    render(<ListPagination total={373} page={1} pageSize={15} onPageSize={onPageSize} />);

    const select = screen.getByTestId('list-page-size');
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent))
      .toEqual(['15', '50', '100']);

    fireEvent.change(select, { target: { value: '100' } });
    expect(onPageSize).toHaveBeenCalledWith(100);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { unmount } = render(<ListPagination total={40} page={1} pageSize={15} />);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).not.toBeDisabled();
    unmount();

    render(<ListPagination total={40} page={3} pageSize={15} />);
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled();
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  it('shows 0 as the lower bound when there is nothing to page through', () => {
    render(<ListPagination total={0} page={1} pageSize={15} />);
    expect(screen.getByTestId('list-page-range')).toHaveTextContent('0–0 of 0');
  });
});
