// apps/backoffice/src/features/products/__tests__/variants-panel-parent.smoke.test.tsx
//
// Session 27c — Wave 6.B — VariantsPanel Case 2 (parent) smoke.
//
// Asserts:
//   1. The variants table renders all variants (badge + label per row).
//   2. Clicking "+ Add variant" opens AddVariantDialog.
//   3. Dissolve CTA is hidden when 2+ active variants exist.
//   4. Delete goes through DeleteVariantDialog (ADR-011 §3): the row button
//      opens the confirm dialog, only Confirm fires delete_variant_v1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VariantsPanel } from '../components/VariantsPanel.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => true }),
}));

const mockVariants = [
  {
    id: 'v1',
    name: 'Croissant Amande',
    sku: 'CR-AMD',
    retail_price: 25000,
    cost_price: 8000,
    variant_label: 'Amande',
    variant_axis: 'flavor' as const,
    variant_sort_order: 10,
    is_active: true,
    current_stock: 8,
    unit: 'pcs',
  },
  {
    id: 'v2',
    name: 'Croissant Nature',
    sku: 'CR-NAT',
    retail_price: 20000,
    cost_price: 5000,
    variant_label: 'Nature',
    variant_axis: 'flavor' as const,
    variant_sort_order: 20,
    is_active: true,
    current_stock: 12,
    unit: 'pcs',
  },
];

vi.mock('@/features/products/hooks/useProductVariants.js', () => ({
  useProductVariants: () => ({ data: mockVariants }),
}));
vi.mock('@/features/products/hooks/useProductParent.js', () => ({
  useProductParent: () => ({ data: null }),
}));

const reorderMock = vi.fn().mockResolvedValue(2);
vi.mock('@/features/products/hooks/useReorderVariants.js', () => ({
  useReorderVariants: () => ({ mutateAsync: reorderMock, isPending: false }),
}));
const deleteMock = vi.fn().mockResolvedValue('v1');
vi.mock('@/features/products/hooks/useDeleteVariant.js', () => ({
  useDeleteVariant: () => ({ mutateAsync: deleteMock, isPending: false }),
}));
vi.mock('@/features/products/hooks/useCreateVariant.js', () => ({
  useCreateVariant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useConvertParentToStandalone.js', () => ({
  useConvertParentToStandalone: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useConvertProductToParent.js', () => ({
  useConvertProductToParent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VariantsPanel
          product={{
            id: 'parent-1',
            name: 'Croissant',
            parent_product_id: null,
            variant_label: null,
            variant_axis: null,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VariantsPanel — Case 2 (parent) [S27c W6.B]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the variants table with all variants', () => {
    renderPanel();
    expect(screen.getByTestId('variant-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('variant-row-v2')).toBeInTheDocument();
    expect(screen.getByText('Amande')).toBeInTheDocument();
    expect(screen.getByText('Nature')).toBeInTheDocument();
  });

  it('opens AddVariantDialog when "+ Add variant" clicked', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('add-variant-cta'));
    await waitFor(() => {
      expect(screen.getByTestId('add-variant-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/add variant to "croissant"/i)).toBeInTheDocument();
  });

  it('does not show dissolve CTA when 2+ active variants exist', () => {
    renderPanel();
    expect(screen.queryByTestId('dissolve-parent-cta')).not.toBeInTheDocument();
  });

  it('delete requires confirmation through DeleteVariantDialog (ADR-011 §3)', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('variant-delete-v1'));
    // The click alone must NOT delete — the confirm dialog opens instead.
    expect(deleteMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('delete-variant-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/delete "amande"/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('delete-variant-confirm'));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('v1');
    });
  });
});
