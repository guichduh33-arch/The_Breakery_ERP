// apps/pos/src/features/cart/__tests__/variant-select-modal.smoke.test.tsx
// Session 27c — Wave 7.D — smoke for VariantSelectModal.
//
// Verifies that :
//   T1. The modal renders one tile per active variant (3-col grid).
//   T2. Tapping a tile invokes onPick(variant) and closes the modal.
//
// `useProductVariants` is mocked so we don't hit Supabase. We mount the modal
// inside a QueryClientProvider only for parity with the rest of the POS
// test suite — the mock makes the provider unnecessary but harmless.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';

const mockVariants: POSVariantRow[] = [
  {
    id: 'v1',
    name: 'Croissant Amande',
    retail_price: 25_000,
    variant_label: 'Amande',
    variant_axis: 'flavor',
    variant_sort_order: 10,
    is_active: true,
    current_stock: 8,
    deduct_stock: true,
  },
  {
    id: 'v2',
    name: 'Croissant Nature',
    retail_price: 20_000,
    variant_label: 'Nature',
    variant_axis: 'flavor',
    variant_sort_order: 20,
    is_active: true,
    current_stock: 12,
    deduct_stock: true,
  },
];

vi.mock('@/features/products/hooks/useProductVariants', () => ({
  useProductVariants: () => ({ data: mockVariants }),
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('VariantSelectModal', () => {
  it('T1: renders a tile per active variant', async () => {
    const { VariantSelectModal } = await import('../VariantSelectModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VariantSelectModal
          open={true}
          onOpenChange={() => {}}
          parent={{ id: 'p1', name: 'Croissant' }}
          onPick={() => {}}
        />
      </Wrapper>,
    );

    expect(screen.getByTestId('variant-tile-v1')).toBeInTheDocument();
    expect(screen.getByTestId('variant-tile-v2')).toBeInTheDocument();
  });

  it('T2: invokes onPick with the variant when tapped and closes the modal', async () => {
    const { VariantSelectModal } = await import('../VariantSelectModal');
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VariantSelectModal
          open={true}
          onOpenChange={onOpenChange}
          parent={{ id: 'p1', name: 'Croissant' }}
          onPick={onPick}
        />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId('variant-tile-v1'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(mockVariants[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
