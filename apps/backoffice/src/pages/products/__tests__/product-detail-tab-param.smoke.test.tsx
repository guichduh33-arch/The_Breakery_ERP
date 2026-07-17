// apps/backoffice/src/pages/products/__tests__/product-detail-tab-param.smoke.test.tsx
//
// Session 45 — Wave C — Smoke: ?tab= query param initializes the active tab on
// ProductDetailPage.
//
// Asserts:
//   1. ?tab=general      → General tab is active on mount.
//   2. No ?tab= param    → Overview tab is active (default).
//   3. ?tab=garbage      → Falls back to Overview tab (invalid value guard).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductDetailPage from '@/pages/products/ProductDetailPage.js';

// Stable mock data refs (vi.hoisted prevents OOM from unstable identity in hooks — S39 lesson).
const { MOCK_PRODUCT } = vi.hoisted(() => ({
  MOCK_PRODUCT: {
    id: 'p-tab-test', sku: 'SFG-099', name: 'Tab Param Product', category_id: 'c-sfg',
    retail_price: 25_000, wholesale_price: null, cost_price: 8_000,
    product_type: 'finished', image_url: null,
    current_stock: 10, min_stock_threshold: 2, unit: 'pcs',
    is_active: true, is_favorite: false,
    categories: { name: 'SFG' },
  },
}));

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
    chain.in    = () => chain;
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

function renderPage(path: string) {
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

describe('ProductDetailPage — ?tab= query param [S45 W-C]', () => {
  it('opens the General tab when ?tab=general is in the URL', async () => {
    renderPage('/backoffice/products/p-tab-test?tab=general');
    // Wait for product name to render (data loaded)
    expect(await screen.findByText('Tab Param Product')).toBeInTheDocument();
    // General tab panel must be active
    expect(screen.getByTestId('product-tab-general')).toBeInTheDocument();
    // Overview panel must NOT be active
    expect(screen.queryByTestId('product-tab-overview')).not.toBeInTheDocument();
  });

  it('opens the Overview tab by default when no ?tab= param is present', async () => {
    renderPage('/backoffice/products/p-tab-test');
    expect(await screen.findByText('Tab Param Product')).toBeInTheDocument();
    expect(screen.getByTestId('product-tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('product-tab-general')).not.toBeInTheDocument();
  });

  it('falls back to Overview when ?tab= is an invalid value', async () => {
    renderPage('/backoffice/products/p-tab-test?tab=garbage');
    expect(await screen.findByText('Tab Param Product')).toBeInTheDocument();
    expect(screen.getByTestId('product-tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('product-tab-garbage')).not.toBeInTheDocument();
  });

  it('still allows internal tab switching after deep-link mount', async () => {
    renderPage('/backoffice/products/p-tab-test?tab=general');
    expect(await screen.findByText('Tab Param Product')).toBeInTheDocument();
    // Currently on General
    expect(screen.getByTestId('product-tab-general')).toBeInTheDocument();
    // Click the Units tab button
    fireEvent.click(screen.getByRole('tab', { name: /units/i }));
    expect(screen.getByTestId('product-tab-units')).toBeInTheDocument();
    expect(screen.queryByTestId('product-tab-general')).not.toBeInTheDocument();
  });
});
