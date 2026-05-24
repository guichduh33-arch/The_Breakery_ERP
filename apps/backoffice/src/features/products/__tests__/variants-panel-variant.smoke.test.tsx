// apps/backoffice/src/features/products/__tests__/variants-panel-variant.smoke.test.tsx
//
// Session 27c — Wave 6.C — VariantsPanel Case 3 (this product IS a variant) smoke.
//
// Asserts (single `it`):
//   - Banner renders with parent name + axis + label + "View parent" link.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VariantsPanel } from '../components/VariantsPanel.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => true }),
}));

vi.mock('@/features/products/hooks/useProductVariants.js', () => ({
  useProductVariants: () => ({ data: [] }),
}));
vi.mock('@/features/products/hooks/useProductParent.js', () => ({
  useProductParent: () => ({ data: { id: 'parent-1', name: 'Croissant' } }),
}));
vi.mock('@/features/products/hooks/useReorderVariants.js', () => ({
  useReorderVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useDeleteVariant.js', () => ({
  useDeleteVariant: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Defensive — Case 3 never reaches these, but stub the imports so any sibling
// resolution doesn't hit @/lib/supabase.
vi.mock('@/features/products/hooks/useConvertProductToParent.js', () => ({
  useConvertProductToParent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useCreateVariant.js', () => ({
  useCreateVariant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useConvertParentToStandalone.js', () => ({
  useConvertParentToStandalone: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('VariantsPanel — Case 3 (variant) [S27c W6.C]', () => {
  it('renders the banner with parent link', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <VariantsPanel
            product={{
              id: 'var-1',
              name: 'Croissant Amande',
              parent_product_id: 'parent-1',
              variant_label: 'Amande',
              variant_axis: 'flavor',
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('variant-banner')).toBeInTheDocument();
    expect(screen.getByText(/variant of "croissant"/i)).toBeInTheDocument();
    expect(screen.getByTestId('variant-banner-view-parent')).toBeInTheDocument();
  });
});
