// apps/backoffice/src/pages/products/__tests__/ProductDetailPage.test.tsx
//
// Session 14 / Phase 4.B — Smoke test for the product detail page.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductDetailPage from '@/pages/products/ProductDetailPage.js';

const MOCK_PRODUCT = {
  id: 'p-1', sku: 'SFG-012', name: 'Aioli Sauce', category_id: 'c-sfg',
  retail_price: 0, wholesale_price: null, cost_price: 60452,
  product_type: 'finished', tax_inclusive: true, image_url: null,
  current_stock: 0, min_stock_threshold: 5, unit: 'kg',
  is_active: true, is_favorite: false,
  categories: { name: 'SFG' },
};

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const chain: Record<string, () => unknown> = {};
    chain.select = () => chain;
    chain.eq     = () => chain;
    chain.is     = () => chain;
    chain.order  = () => Promise.resolve({
      data: table === 'categories'
        ? [{ id: 'c-sfg', name: 'SFG', slug: 'sfg', is_active: true, sort_order: 1 }]
        : [],
      error: null,
    });
    chain.maybeSingle = () => Promise.resolve({
      data: table === 'products' ? MOCK_PRODUCT : null,
      error: null,
    });
    chain.in = () => chain;
    chain.limit = () => Promise.resolve({ data: [], error: null });
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
      rpc:  () => Promise.resolve({ data: [], error: null }),
    },
  };
});

function renderPage(path = '/backoffice/products/p-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/products/:productId" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage', () => {
  it('renders the header with the product name and SKU pill', async () => {
    renderPage();
    expect(await screen.findByText('Aioli Sauce')).toBeInTheDocument();
    expect(screen.getByText('SFG-012')).toBeInTheDocument();
    // Default tab is overview.
    expect(screen.getByTestId('product-tab-overview')).toBeInTheDocument();
  });

  it('switches tabs when the user clicks them', async () => {
    renderPage();
    await screen.findByText('Aioli Sauce');
    fireEvent.click(screen.getByRole('tab', { name: /general/i }));
    expect(screen.getByTestId('product-tab-general')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /units/i }));
    expect(screen.getByTestId('product-tab-units')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /recipe/i }));
    expect(screen.getByTestId('product-tab-recipe')).toBeInTheDocument();
  });
});
