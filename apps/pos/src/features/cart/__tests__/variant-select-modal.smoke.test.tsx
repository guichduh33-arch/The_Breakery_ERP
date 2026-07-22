// apps/pos/src/features/cart/__tests__/variant-select-modal.smoke.test.tsx
// Session 27c — Wave 7.D — smoke for VariantSelectModal.
//
// Verifies that :
//   T1. The modal renders one tile per active variant (3-col grid).
//   T2. Tapping a tile invokes onPick(variant) and closes the modal.
//   T3. A lone SELLABLE variant is auto-picked (UX shortcut preserved).
//   T4. A lone SOLD-OUT variant is NOT auto-picked (ADR-011 §3) — the modal
//       stays open with the tile disabled.
//
// `useProductVariants` is mocked so we don't hit Supabase. The mock reads
// from a vi.hoisted mutable holder so each test can swap the variant set
// (the holder object identity stays stable — cf. memory vitest-hoisted).
// We mount the modal inside a QueryClientProvider only for parity with the
// rest of the POS test suite — the mock makes the provider unnecessary but
// harmless.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';

const mockState = vi.hoisted(() => ({
  variants: [] as unknown[],
}));

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
  useProductVariants: () => ({ data: mockState.variants }),
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
  beforeEach(() => {
    mockState.variants = mockVariants;
  });

  it('T1: renders a tile per active variant', async () => {
    const { VariantSelectModal } = await import('../VariantSelectModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VariantSelectModal
          open={true}
          onOpenChange={vi.fn()}
          parent={{ id: 'p1', name: 'Croissant' }}
          onPick={vi.fn()}
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

  it('T3: auto-picks a lone sellable variant', async () => {
    mockState.variants = [mockVariants[0]];
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

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(mockVariants[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('T4: does NOT auto-pick a lone sold-out variant (ADR-011 §3)', async () => {
    const soldOut: POSVariantRow = {
      ...mockVariants[0]!,
      current_stock: 0,
    };
    mockState.variants = [soldOut];
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

    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId('variant-tile-v1')).toBeDisabled();
  });
});
