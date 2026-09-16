// apps/backoffice/src/__tests__/product-detail-save.smoke.test.tsx
//
// Session 27 / Wave 3 — Smoke test for the ProductDetail save flow.
// Verifies the page transitions from "no dirty" → "dirty" → "saved" and
// calls update_product_v4 with the patch.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const response = vi.hoisted(() => ({ ignored: [] as string[], canEditRecipe: true }));

vi.mock('@/features/recipes/index.js', () => ({
  RecipeBuilder: ({ readOnly }: { readOnly: boolean }) => <div>{readOnly ? 'Recipe read only' : 'Recipe editable'}</div>,
}));

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
        const override = rpcSpy(...args) as Promise<unknown> | undefined;
        return override ?? Promise.resolve({
          data: { product: { ...MOCK_PRODUCT, name: 'Affogato Deluxe' }, ignored_fields: response.ignored },
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
      hasPermission: (code: string) => code !== 'inventory.recipes.update' || response.canEditRecipe,
    }),
}));

function renderDetail(productId = 'p-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/products/${productId}`]}>
        <Routes>
          <Route path="/backoffice/products/:productId" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

describe('ProductDetailPage — save flow (S27)', () => {
  beforeEach(() => { response.ignored = []; response.canEditRecipe = true; rpcSpy.mockReset(); });

  it('preserves edits when a background query refreshes the product', async () => {
    const { qc } = renderDetail();
    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Draft name' } });
    act(() => {
      qc.setQueryData(['products', 'detail', 'p-1'], (old: object) => ({ ...old, current_stock: 99 }));
    });
    expect(screen.getByLabelText('Product name')).toHaveValue('Draft name');
    await waitFor(() => expect(screen.getByLabelText('Current stock')).toHaveValue('99'));
  });

  it('locks the draft while its save is pending', async () => {
    let resolveSave!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveSave = resolve; });
    rpcSpy.mockImplementation((name: string) => name === 'update_product_v4' ? pending : undefined);
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Affogato Deluxe' } });
    fireEvent.click(screen.getByTestId('product-detail-save'));
    await waitFor(() => expect(screen.getByLabelText('Product name')).toBeDisabled());
    expect(screen.getByTestId('product-detail-save')).toBeDisabled();
    await act(async () => { resolveSave({ data: { product: MOCK_PRODUCT, ignored_fields: [] }, error: null }); await pending; });
    await waitFor(() => expect(screen.getByLabelText('Product name')).not.toBeDisabled());
  });

  it('uses the recipe permission separately from product editing', async () => {
    response.canEditRecipe = false;
    renderDetail();
    await screen.findByLabelText('Product name');
    fireEvent.click(screen.getByRole('tab', { name: /recipe/i }));
    expect(await screen.findByText('Recipe read only')).toBeInTheDocument();
  });

  it('keeps the visible draft when switching tabs', async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Draft name' } });
    fireEvent.click(screen.getByRole('tab', { name: /history/i }));
    fireEvent.click(screen.getByRole('tab', { name: /general/i }));
    expect(await screen.findByLabelText('Product name')).toHaveValue('Draft name');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('disables save again when the edit is reverted', async () => {
    renderDetail();
    const input = await screen.findByLabelText('Product name');
    fireEvent.change(input, { target: { value: 'Draft name' } });
    fireEvent.change(input, { target: { value: 'Affogato' } });
    expect(screen.getByTestId('product-detail-save')).toBeDisabled();
  });

  it('keeps rejected fields visible and dirty with an explanation', async () => {
    response.ignored = ['name'];
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Draft name' } });
    fireEvent.click(screen.getByTestId('product-detail-save'));
    expect(await screen.findByText('Some changes were not saved: name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toHaveValue('Draft name');
    expect(screen.getByTestId('product-detail-save')).not.toBeDisabled();
  });

  it('rejects a negative price before sending a mutation', async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Retail price (IDR)'), { target: { value: '-1' } });
    fireEvent.click(screen.getByTestId('product-detail-save'));
    expect(await screen.findByText(/Enter a name, a SKU/)).toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalledWith('update_product_v4', expect.anything());
  });
  it('disables Save Changes when nothing is dirty', async () => {
    renderDetail();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();
    const btn = screen.getByTestId('product-detail-save');
    expect(btn).toBeDisabled();
  });

  it('saves an edited min_stock_threshold through update_product_v4 (audit M7)', async () => {
    rpcSpy.mockClear();
    renderDetail();
    expect(await screen.findByText('Affogato')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /General/i }));

    // The Inventory levels card explains what the threshold drives (audit M7).
    expect(await screen.findByText(/below this threshold/i)).toBeInTheDocument();

    // `findBy` et non `getBy` : ce test tombait par intermittence dans la suite
    // COMPLÈTE — deux fois sur trois exécutions le 2026-08-22 — et passait
    // toujours seul, en 841 ms. La cause n'est pas un délai trop court mais une
    // lecture SYNCHRONE juste après un changement d'onglet : `getBy` jette à
    // l'instant où il ne trouve pas, sans laisser React finir de monter le
    // panneau General. Le test voisin de ce même fichier attend déjà
    // (`await screen.findByDisplayValue('Affogato')`) et n'est jamais tombé —
    // la différence tenait à cette seule ligne. Allonger un délai aurait rendu
    // l'échec plus rare ; attendre le rend impossible.
    const thresholdInput = await screen.findByDisplayValue('5');
    fireEvent.change(thresholdInput, { target: { value: '12' } });

    const btn = await screen.findByTestId('product-detail-save');
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith(
        'update_product_v4',
        expect.objectContaining({
          p_product_id: 'p-1',
          p_patch: expect.objectContaining({ min_stock_threshold: 12 }) as unknown,
        }),
      );
    });
  });

  it('enables Save when a field changes, then calls update_product_v4', async () => {
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
        'update_product_v4',
        expect.objectContaining({
          p_product_id: 'p-1',
          p_patch: expect.objectContaining({ name: 'Affogato Deluxe' }) as unknown,
        }),
      );
    });
  });
});
