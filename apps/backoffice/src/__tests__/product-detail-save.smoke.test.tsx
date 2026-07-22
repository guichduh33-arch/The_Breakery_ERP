// apps/backoffice/src/__tests__/product-detail-save.smoke.test.tsx
//
// Session 27 / Wave 3 — Smoke test for the ProductDetail save flow.
// Verifies the page transitions from "no dirty" → "dirty" → "saved" and
// calls update_product_v2 with the patch.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductDetailPage from '@/pages/products/ProductDetailPage.js';

const MOCK_PRODUCT = {
  id: 'p-1',
  sku: 'COF-001',
  name: 'Affogato',
  category_id: 'c-coffee',
  retail_price: 40000,
  wholesale_price: null,
  cost_price: 9661,
  product_type: 'finished',
  image_url: null,
  current_stock: 50,
  min_stock_threshold: 5,
  unit: 'pcs',
  is_active: true,
  is_favorite: true,
  description: 'Vanilla ice cream drowned in espresso.',
  visible_on_pos: true,
  available_for_sale: true,
  track_inventory: true,
  deduct_stock: true,
  is_semi_finished: false,
  target_gross_margin_pct: null,
  default_shelf_life_hours: null,
  categories: { name: 'Coffee' },
};

const MOCK_CATEGORIES = [
  { id: 'c-coffee', name: 'Coffee', slug: 'coffee', is_active: true, sort_order: 1 },
];

const rpcSpy = vi.fn();

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): unknown {
    const data =
      table === 'products' ? MOCK_PRODUCT :
      table === 'categories' ? MOCK_CATEGORIES :
      null;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.is = () => chain;
    chain.eq = () => chain;
    chain.order = () => Promise.resolve({ data, error: null });
    chain.maybeSingle = () => Promise.resolve({ data, error: null });
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
      rpc: (...args: unknown[]) => {
        rpcSpy(...args);
        return Promise.resolve({
          data: { product: { ...MOCK_PRODUCT, name: 'Affogato Deluxe' }, ignored_fields: [] },
          error: null,
        });
      },
    },
  };
});

// Stub the auth store so the page believes the caller has products.update.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      hasPermission: (_code: string) => true,
    }),
}));

function renderDetail(productId = 'p-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/products/${productId}`]}>
        <Routes>
          <Route path="/backoffice/products/:productId" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage — save flow (S27)', () => {
  it('disables Save Changes when nothing is dirty', async () => {
    renderDetail();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();
    const btn = screen.getByTestId('product-detail-save');
    expect(btn).toBeDisabled();
  });

  it('saves an edited min_stock_threshold through update_product_v2 (audit M7)', async () => {
    rpcSpy.mockClear();
    renderDetail();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /General/i }));

    // The Inventory levels card explains what the threshold drives (audit M7).
    expect(await screen.findByText(/sous ce seuil/i)).toBeInTheDocument();

    const thresholdInput = screen.getByDisplayValue('5');
    fireEvent.change(thresholdInput, { target: { value: '12' } });

    const btn = screen.getByTestId('product-detail-save');
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith(
        'update_product_v2',
        expect.objectContaining({
          p_product_id: 'p-1',
          p_patch: expect.objectContaining({ min_stock_threshold: 12 }) as unknown,
        }),
      );
    });
  });

  it('enables Save when a field changes, then calls update_product_v2', async () => {
    rpcSpy.mockClear();
    renderDetail();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();

    // Switch to General tab to access the editable inputs.
    fireEvent.click(screen.getByRole('tab', { name: /General/i }));

    const nameInput = await screen.findByDisplayValue('Affogato');
    fireEvent.change(nameInput, { target: { value: 'Affogato Deluxe' } });

    const btn = screen.getByTestId('product-detail-save');
    await waitFor(() => expect(btn).not.toBeDisabled());

    fireEvent.click(btn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith(
        'update_product_v2',
        expect.objectContaining({
          p_product_id: 'p-1',
          p_patch: expect.objectContaining({ name: 'Affogato Deluxe' }) as unknown,
        }),
      );
    });
  });
});
