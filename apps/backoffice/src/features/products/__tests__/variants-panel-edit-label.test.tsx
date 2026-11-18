// apps/backoffice/src/features/products/__tests__/variants-panel-edit-label.test.tsx
//
// S3-14 — le libellé d'une variante se modifie depuis l'onglet Variantes.
// Le vrai crochet `useUpdateVariant` tourne ; seul le client Supabase est
// simulé, pour vérifier l'appel exact à `update_variant_v2`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VariantsPanel } from '../components/VariantsPanel.js';

const perms = vi.hoisted(() => ({ canWrite: true }));
const rpcMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => perms.canWrite }),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const mockVariants = [
  {
    id: 'v1', name: 'Croissant Amande', sku: 'CR-AMD', retail_price: 25000, cost_price: 8000,
    variant_label: 'Amande', variant_axis: 'flavor' as const, variant_sort_order: 10,
    is_active: true, current_stock: 8, unit: 'pcs',
  },
  {
    id: 'v2', name: 'Croissant Nature', sku: 'CR-NAT', retail_price: 20000, cost_price: 5000,
    variant_label: 'Nature', variant_axis: 'flavor' as const, variant_sort_order: 20,
    is_active: true, current_stock: 12, unit: 'pcs',
  },
];

vi.mock('@/features/products/hooks/useProductVariants.js', () => ({
  useProductVariants: () => ({ data: mockVariants }),
}));
vi.mock('@/features/products/hooks/useProductParent.js', () => ({
  useProductParent: () => ({ data: null }),
}));
vi.mock('@/features/products/hooks/useReorderVariants.js', () => ({
  useReorderVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useDeleteVariant.js', () => ({
  useDeleteVariant: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

function renderPanel(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VariantsPanel
          product={{ id: 'parent-1', name: 'Croissant', parent_product_id: null, variant_label: null, variant_axis: null }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VariantsPanel — edit variant label (S3-14)', () => {
  beforeEach(() => {
    perms.canWrite = true;
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: 'v1', error: null });
  });

  it('renames a variant through update_variant_v2 with a trimmed label', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('variant-edit-v1'));
    const input = await screen.findByTestId('edit-variant-label');
    expect(input).toHaveValue('Amande');

    fireEvent.change(input, { target: { value: '  Almond  ' } });
    fireEvent.click(screen.getByTestId('edit-variant-submit'));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_variant_v2', {
        p_variant_id: 'v1',
        p_patch:      { variant_label: 'Almond' },
      });
    });
    await waitFor(() => expect(screen.queryByTestId('edit-variant-dialog')).not.toBeInTheDocument());
  });

  it('blocks an empty label without calling the RPC', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('variant-edit-v2'));
    const input = await screen.findByTestId('edit-variant-label');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('edit-variant-submit'));

    expect(await screen.findByTestId('edit-variant-error')).toHaveTextContent('Label is required.');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-variant-dialog')).toBeInTheDocument();
  });

  it('shows the server error and keeps the dialog open', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    renderPanel();
    fireEvent.click(screen.getByTestId('variant-edit-v1'));
    const input = await screen.findByTestId('edit-variant-label');
    fireEvent.change(input, { target: { value: 'Almond' } });
    fireEvent.click(screen.getByTestId('edit-variant-submit'));

    expect(await screen.findByTestId('edit-variant-error')).toHaveTextContent('forbidden');
    expect(screen.getByTestId('edit-variant-dialog')).toBeInTheDocument();
  });

  it('hides the Edit button without products.variants.write', () => {
    perms.canWrite = false;
    renderPanel();
    expect(screen.queryByTestId('variant-edit-v1')).not.toBeInTheDocument();
  });
});
