// apps/backoffice/src/__tests__/products-list.smoke.test.tsx
//
// Session 14 / Phase 4.B — Smoke test for the rewritten Products page.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductsPage from '@/pages/Products.js';

const MOCK_PRODUCTS = [
  {
    id: '1', sku: 'COF-001', name: 'Affogato', category_id: 'c-coffee',
    retail_price: 40000, wholesale_price: null, cost_price: 9661,
    product_type: 'finished', image_url: null,
    current_stock: 50, min_stock_threshold: 5, unit: 'pcs',
    is_active: true, is_favorite: true,
    categories: { name: 'Coffee' },
  },
  {
    id: '2', sku: 'SFG-012', name: 'Aioli Sauce', category_id: 'c-sfg',
    retail_price: 0, wholesale_price: null, cost_price: 60452,
    product_type: 'finished', image_url: null,
    current_stock: 0, min_stock_threshold: 0, unit: 'kg',
    is_active: true, is_favorite: false,
    categories: { name: 'SFG' },
  },
];

const MOCK_CATEGORIES = [
  { id: 'c-coffee', name: 'Coffee', slug: 'coffee', is_active: true, sort_order: 1 },
  { id: 'c-sfg',    name: 'SFG',    slug: 'sfg',    is_active: true, sort_order: 2 },
];

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const data =
      table === 'products' ? MOCK_PRODUCTS :
      table === 'categories' ? MOCK_CATEGORIES :
      [];
    const chain = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      order:  () => Promise.resolve({ data, error: null }),
    };
    return chain;
  }
  return { supabase: { from: (t: string) => buildChain(t) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsPage', () => {
  it('renders the catalog header and rows for both products', async () => {
    renderPage();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();
    expect(screen.getByText('Aioli Sauce')).toBeInTheDocument();
    // SKU column shows the codes.
    expect(screen.getByText('COF-001')).toBeInTheDocument();
    expect(screen.getByText('SFG-012')).toBeInTheDocument();
    // Header card title.
    expect(screen.getByText(/Product Catalog/i)).toBeInTheDocument();
  });

  it('filters rows by search input', async () => {
    renderPage();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();
    const input = screen.getByLabelText(/Search products/i);
    fireEvent.change(input, { target: { value: 'aioli' } });
    expect(screen.queryByText('Affogato')).not.toBeInTheDocument();
    expect(screen.getByText('Aioli Sauce')).toBeInTheDocument();
  });

  it('switches to grid view when the grid toggle is pressed', async () => {
    renderPage();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Grid view/i));
    // Grid view still shows the names but the table testid disappears.
    expect(screen.queryByTestId('products-table')).not.toBeInTheDocument();
    expect(screen.getByText('Affogato')).toBeInTheDocument();
  });
});
