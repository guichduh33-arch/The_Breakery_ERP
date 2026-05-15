// apps/backoffice/src/pages/products/__tests__/CombosPage.test.tsx
//
// Session 14 / Phase 4.B — Smoke test for the Combo Management page.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CombosPage from '@/pages/products/CombosPage.js';

const PARENTS = [
  { id: 'cb-1', name: 'French Platter', sku: 'CMB-001', retail_price: 45000, is_active: true,  image_url: null },
  { id: 'cb-2', name: 'Classic Combo',  sku: 'CMB-002', retail_price: 45000, is_active: true,  image_url: null },
];

const ITEMS = [
  { parent_product_id: 'cb-1', component_product_id: 'p-amer',     quantity: 1, sort_order: 1 },
  { parent_product_id: 'cb-1', component_product_id: 'p-cap',      quantity: 1, sort_order: 2 },
  { parent_product_id: 'cb-2', component_product_id: 'p-croissant', quantity: 1, sort_order: 1 },
];

const COMPONENTS = [
  { id: 'p-amer',      name: 'Americano',  retail_price: 35000, cost_price: 8000,  category_id: 'd', categories: { name: 'Drinks' } },
  { id: 'p-cap',       name: 'Capuccino',  retail_price: 35000, cost_price: 8500,  category_id: 'd', categories: { name: 'Drinks' } },
  { id: 'p-croissant', name: 'Croissant',  retail_price: 25000, cost_price: 5000,  category_id: 'p', categories: { name: 'Pastry' } },
];

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    chain.select = () => chain;
    chain.eq     = () => chain;
    chain.is     = () => chain;
    chain.in     = () => chain;
    chain.order  = () => {
      if (table === 'products')    return Promise.resolve({ data: PARENTS, error: null });
      if (table === 'combo_items') return Promise.resolve({ data: ITEMS,   error: null });
      return Promise.resolve({ data: [], error: null });
    };
    // Components fetch chains: from('products').select('...').in('id', ids).
    // The chain ends after `.in(...)` and is awaited. We override `.in` to
    // return a thenable for the components fetch, but `.in` is also chained
    // before `.order` for combo_items. So we make `.in` return chain, and
    // detect the components branch by remembering the table name.
    if (table === 'products' && !chain.__configured) {
      // The hook calls products twice: once to fetch parents (with .eq+.is+.order)
      // and once to fetch components (with .in only). For the components call,
      // there is no .order — instead the chain is awaited after .in. To keep
      // the chain shape simple we make .in return a thenable in addition to
      // chain semantics.
      const inFn = () => {
        const thenable = Object.assign(
          Promise.resolve({ data: COMPONENTS, error: null }),
          chain,
        );
        return thenable;
      };
      chain.in = inFn as unknown as () => unknown;
      chain.__configured = (() => true) as unknown as () => unknown;
    }
    return chain;
  }
  return { supabase: { from: (t: string) => buildChain(t) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CombosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CombosPage', () => {
  it('renders combo cards from the mock parent rows', async () => {
    renderPage();
    expect(await screen.findByText('French Platter')).toBeInTheDocument();
    expect(screen.getByText('Classic Combo')).toBeInTheDocument();
    expect(screen.getByText(/Combo Management/i)).toBeInTheDocument();
  });

  it('filters combos via the search input', async () => {
    renderPage();
    expect(await screen.findByText('French Platter')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search combos/i), { target: { value: 'classic' } });
    expect(screen.queryByText('French Platter')).not.toBeInTheDocument();
    expect(screen.getByText('Classic Combo')).toBeInTheDocument();
  });
});
