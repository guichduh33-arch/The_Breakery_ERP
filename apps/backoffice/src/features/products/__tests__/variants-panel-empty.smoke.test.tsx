// apps/backoffice/src/features/products/__tests__/variants-panel-empty.smoke.test.tsx
//
// Session 27c — Wave 6.A — VariantsPanel Case 1 (standalone) smoke.
//
// Asserts:
//   1. EmptyState renders with the convert-to-parent CTA.
//   2. Clicking the CTA opens the ConvertToParentDialog.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VariantsPanel } from '../components/VariantsPanel.js';

// Mock the auth store — selector(state) pattern matches authStore.ts shape.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => true }),
}));

// Mock the hooks — Case 1 means no variants AND no parent.
vi.mock('@/features/products/hooks/useProductVariants.js', () => ({
  useProductVariants: () => ({ data: [] }),
}));
vi.mock('@/features/products/hooks/useProductParent.js', () => ({
  useProductParent: () => ({ data: null }),
}));
vi.mock('@/features/products/hooks/useReorderVariants.js', () => ({
  useReorderVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useDeleteVariant.js', () => ({
  useDeleteVariant: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useConvertProductToParent.js', () => ({
  useConvertProductToParent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// Defensive: CASE 1 never reaches the parent-branch hooks, but mock them so
// any sibling import in VariantsPanel resolves without touching @/lib/supabase.
vi.mock('@/features/products/hooks/useCreateVariant.js', () => ({
  useCreateVariant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/products/hooks/useConvertParentToStandalone.js', () => ({
  useConvertParentToStandalone: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VariantsPanel
          product={{
            id: 'prod-1',
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

describe('VariantsPanel — Case 1 (standalone) [S27c W6.A]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the EmptyState with the convert CTA', () => {
    renderPanel();
    expect(screen.getByText(/no variants yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('convert-to-parent-cta')).toBeInTheDocument();
  });

  it('opens the ConvertToParentDialog when CTA clicked', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('convert-to-parent-cta'));
    await waitFor(() => {
      expect(screen.getByTestId('convert-to-parent-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/convert "croissant" to a parent/i)).toBeInTheDocument();
  });
});
