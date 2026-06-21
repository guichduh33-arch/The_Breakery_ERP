// apps/backoffice/src/features/products/__tests__/delete-product-dialog.smoke.test.tsx
//
// Session 45 — Wave B — DeleteProductDialog smoke.
//
// Asserts:
//   1. Clicking confirm calls the delete mutation with the product id.
//   2. Clicking cancel closes the dialog without calling the mutation.
//   3. When the mutation rejects with a parent-error message, the error renders.
//   4. (hardening) Pending state: confirm + cancel disabled, pending label shows.
//   5. (hardening) Success lifecycle: toast.success fired and onClose called.
//
// IMPORTANT: mock DATA objects defined via vi.hoisted() so refs are stable across
// re-renders and do not trigger an infinite render loop (S39 B1 lesson).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeleteProductDialog } from '../components/DeleteProductDialog.js';
import type { ProductRow } from '../types.js';

// --- stable mock data (vi.hoisted to avoid re-evaluation across re-renders) ----
const { mutateAsync, mockIsPending } = vi.hoisted(() => {
  const mutateAsync = vi.fn();
  const mockIsPending = { value: false };
  return { mutateAsync, mockIsPending };
});

vi.mock('@/features/products/hooks/useDeleteProduct.js', () => ({
  useDeleteProduct: () => ({
    mutateAsync,
    isPending: mockIsPending.value,
  }),
}));

// Sonner toast — just capture calls, no actual DOM notifications needed.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error:   vi.fn(),
  },
}));

// --------------------------------------------------------------------------

const MOCK_PRODUCT: ProductRow = {
  id:                       'prod-abc',
  name:                     'Croissant Nature',
  sku:                      'CR-NAT',
  category_id:              'cat-1',
  category_name:            'Pastry',
  category_type:            'finished',
  retail_price:             25_000,
  wholesale_price:          null,
  cost_price:               8_000,
  product_type:             'finished',
  tax_inclusive:            true,
  image_url:                null,
  current_stock:            10,
  min_stock_threshold:      5,
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

function renderDialog(product: ProductRow | null, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <DeleteProductDialog product={product} onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe('DeleteProductDialog [S45 W-B]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending.value = false;
    mutateAsync.mockResolvedValue({
      product_id:        'prod-abc',
      deleted:           true,
      idempotent_replay: false,
    });
  });

  it('renders dialog with product name and SKU when product is non-null', () => {
    renderDialog(MOCK_PRODUCT);
    expect(screen.getByTestId('delete-product-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Croissant Nature/)).toBeInTheDocument();
    expect(screen.getByText(/CR-NAT/)).toBeInTheDocument();
  });

  it('does not render dialog content when product is null', () => {
    renderDialog(null);
    expect(screen.queryByTestId('delete-product-dialog')).not.toBeInTheDocument();
  });

  it('confirm click calls mutateAsync with the product id', async () => {
    renderDialog(MOCK_PRODUCT);
    const confirmBtn = screen.getByTestId('delete-product-confirm');
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ productId: 'prod-abc' });
    });
  });

  it('cancel click does not call mutateAsync and calls onClose', () => {
    const onClose = vi.fn();
    renderDialog(MOCK_PRODUCT, onClose);
    const cancelBtn = screen.getByTestId('delete-product-cancel');
    fireEvent.click(cancelBtn);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the mapped parent-error message when RPC rejects with parent_has_active_variants', async () => {
    const parentError = new Error(
      "Ce produit est un parent de variantes actives — dissolvez ou désactivez les variantes d'abord.",
    );
    mutateAsync.mockRejectedValueOnce(parentError);

    renderDialog(MOCK_PRODUCT);
    fireEvent.click(screen.getByTestId('delete-product-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-product-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('delete-product-error')).toHaveTextContent(
      "Ce produit est un parent de variantes actives",
    );
  });

  it('disables confirm and cancel and shows pending label while isPending is true', () => {
    mockIsPending.value = true;
    renderDialog(MOCK_PRODUCT);
    const confirmBtn = screen.getByTestId('delete-product-confirm');
    const cancelBtn  = screen.getByTestId('delete-product-cancel');
    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent('Désactivation…');
  });

  it('calls toast.success and onClose after successful mutation', async () => {
    const onClose = vi.fn();
    renderDialog(MOCK_PRODUCT, onClose);
    fireEvent.click(screen.getByTestId('delete-product-confirm'));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Croissant Nature'),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
