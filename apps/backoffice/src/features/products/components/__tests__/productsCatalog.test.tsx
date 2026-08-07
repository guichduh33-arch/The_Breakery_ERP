// apps/backoffice/src/features/products/components/__tests__/productsCatalog.test.tsx
//
// Écran 2a — les règles de lecture du catalogue, celles qui changent une
// décision : ce que compte la bande de compteurs, la distinction entre « marge
// nulle » et « marge inconnue », les seuils de la colonne Stock, et le fait que
// les actions groupées sont posées mais inertes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ProductsCounterStrip } from '../ProductsCounterStrip.js';
import { ProductsTable, PRODUCTS_PAGE_SIZE } from '../ProductsTable.js';
import { productMarginPct, type ProductRow, type ProductsKpis } from '../../types.js';

afterEach(cleanup);

function row(over: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p-1', name: 'Croissant beurre', sku: 'CRO-001',
    category_id: 'c-1', category_name: 'Viennoiserie', category_type: 'finished',
    retail_price: 15_000, wholesale_price: 12_000, cost_price: 6_200,
    product_type: 'finished', image_url: null,
    current_stock: 18, min_stock_threshold: 5, unit: 'pc',
    is_active: true, is_favorite: false,
    description: null, visible_on_pos: true, available_for_sale: true,
    track_inventory: true, deduct_stock: true, is_semi_finished: false,
    target_gross_margin_pct: null, default_shelf_life_hours: null,
    is_display_item: false,
    parent_product_id: null, variant_label: null, variant_axis: null,
    variant_sort_order: 0, dispatch_stations: null,
    ...over,
  };
}

function renderTable(rows: ProductRow[], extra: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ProductsTable rows={rows} {...extra} />
    </MemoryRouter>,
  );
}

// ── productMarginPct ───────────────────────────────────────────────────────

describe('productMarginPct', () => {
  it('computes the margin on the selling price', () => {
    expect(productMarginPct({ retail_price: 15_000, cost_price: 6_200 })).toBeCloseTo(58.67, 1);
  });

  it('returns null — never 0 — when the cost is missing', () => {
    // Une marge INCONNUE et une marge NULLE sont deux faits différents ; les
    // confondre ferait passer pour vendu à prix coûtant un produit dont on
    // ignore simplement le coût.
    expect(productMarginPct({ retail_price: 15_000, cost_price: 0 })).toBeNull();
    expect(productMarginPct({ retail_price: 0, cost_price: 6_200 })).toBeNull();
  });
});

// ── Bande de compteurs ─────────────────────────────────────────────────────

const KPIS: ProductsKpis = {
  total: 318, finished: 184, semi_finished: 37, raw_material: 89, combo: 8,
  inactive: 12, no_cost_price: 6,
};

describe('ProductsCounterStrip', () => {
  it('renders the seven counters, data-quality ones included', () => {
    render(<ProductsCounterStrip kpis={KPIS} active="all" onSelect={vi.fn()} />);
    expect(within(screen.getByTestId('counter-all')).getByText('318')).toBeInTheDocument();
    expect(within(screen.getByTestId('counter-inactive')).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('counter-no-cost')).getByText('6')).toBeInTheDocument();
  });

  it('paints a non-zero "no cost price" count as a defect', () => {
    render(<ProductsCounterStrip kpis={KPIS} active="all" onSelect={vi.fn()} />);
    expect(within(screen.getByTestId('counter-no-cost')).getByText('6').className)
      .toMatch(/text-danger/);
  });

  it('does not paint the defect counter when it is at zero', () => {
    render(<ProductsCounterStrip kpis={{ ...KPIS, no_cost_price: 0 }} active="all" onSelect={vi.fn()} />);
    expect(within(screen.getByTestId('counter-no-cost')).getByText('0').className)
      .not.toMatch(/text-danger/);
  });

  it('selects a counter, and a second click on the active one clears back to all', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ProductsCounterStrip kpis={KPIS} active="all" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId('counter-no-cost'));
    expect(onSelect).toHaveBeenLastCalledWith('no-cost');

    rerender(<ProductsCounterStrip kpis={KPIS} active="no-cost" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('counter-no-cost'));
    expect(onSelect).toHaveBeenLastCalledWith('all');
  });

  it('marks the active counter for assistive tech, not only in colour', () => {
    render(<ProductsCounterStrip kpis={KPIS} active="inactive" onSelect={vi.fn()} />);
    expect(screen.getByTestId('counter-inactive')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── Table ──────────────────────────────────────────────────────────────────

describe('ProductsTable — colonnes Stock et Margin', () => {
  it('renders the margin as a percentage', () => {
    renderTable([row()]);
    expect(screen.getByText('58,7%')).toBeInTheDocument();
  });

  it('renders a missing cost in red and its margin as a dash', () => {
    renderTable([row({ cost_price: 0 })]);
    const table = screen.getByTestId('products-table');
    const reds = within(table).getAllByText('—', { selector: '.text-danger' });
    expect(reds.length).toBeGreaterThan(0);
  });

  it('escalates the stock colour at the threshold and at zero', () => {
    renderTable([
      row({ id: 'a', name: 'A', current_stock: 18, min_stock_threshold: 5 }),
      row({ id: 'b', name: 'B', current_stock: 3,  min_stock_threshold: 5 }),
      row({ id: 'c', name: 'C', current_stock: 0,  min_stock_threshold: 5 }),
    ]);
    expect(screen.getByText('18 pc').className).toMatch(/text-text-secondary/);
    expect(screen.getByText('3 pc').className).toMatch(/text-warning/);
    expect(screen.getByText('0 pc').className).toMatch(/text-danger/);
  });

  it('renders a dash — not a zero — when the product is not stock-tracked', () => {
    renderTable([row({ track_inventory: false, current_stock: 0 })]);
    expect(screen.queryByText('0 pc')).not.toBeInTheDocument();
  });

  it('hides a column the caller has switched off', () => {
    renderTable([row()], { hiddenColumns: new Set(['margin']) });
    expect(screen.queryByText('58,7%')).not.toBeInTheDocument();
    expect(screen.getByText('CRO-001')).toBeInTheDocument();
  });
});

describe('ProductsTable — pagination et sélection', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    row({ id: `p-${i}`, name: `Product ${i}`, sku: `SKU-${i}` }));

  it('shows one page at a time and says which slice is displayed', () => {
    renderTable(many, { page: 1 });
    expect(screen.getByText('Product 0')).toBeInTheDocument();
    expect(screen.queryByText(`Product ${PRODUCTS_PAGE_SIZE}`)).not.toBeInTheDocument();
    expect(screen.getByText('1–15 of 40')).toBeInTheDocument();
  });

  it('asks the page for the next slice instead of paging on its own', () => {
    const onPage = vi.fn();
    renderTable(many, { page: 1, onPage });
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('disables the previous control on the first page', () => {
    renderTable(many, { page: 1 });
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
  });

  it('selects every row of the CURRENT page, not the whole result set', () => {
    const onToggleAll = vi.fn();
    renderTable(many, { page: 1, onToggleAll });
    fireEvent.click(screen.getByLabelText('Select all products on this page'));
    const [ids, allSelected] = onToggleAll.mock.calls[0] as [string[], boolean];
    expect(ids).toHaveLength(PRODUCTS_PAGE_SIZE);
    expect(allSelected).toBe(false);
  });

  it('keeps the bulk actions visible but inert — the gated RPCs do not exist yet', () => {
    renderTable(many, { page: 1, selected: new Set(['p-0']) });
    for (const label of ['Change prices', 'Move category', 'Deactivate']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
