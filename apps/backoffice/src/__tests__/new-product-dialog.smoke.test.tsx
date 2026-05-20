// apps/backoffice/src/__tests__/new-product-dialog.smoke.test.tsx
//
// Session 27b — Smoke test for NewProductDialog (create_product_v1 wiring).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewProductDialog } from '@/features/products/components/NewProductDialog.js';
import type { CategoryOption } from '@/features/products/types.js';

const CATEGORIES: CategoryOption[] = [
  { id: 'c-coffee', name: 'Coffee', slug: 'coffee', is_active: true, sort_order: 1 },
  { id: 'c-pastry', name: 'Pastry', slug: 'pastry', is_active: true, sort_order: 2 },
];

const rpcSpy = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve({
        data: {
          product: { id: 'new-p-1', sku: 'COF-002', name: 'Latte' },
          ignored_fields: [],
        },
        error: null,
      });
    },
  },
}));

function renderDialog(onCreated = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onCreated,
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <NewProductDialog
          onClose={onClose}
          onCreated={onCreated}
          categories={CATEGORIES}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('NewProductDialog — create flow (S27b)', () => {
  it('blocks submit on invalid input', async () => {
    rpcSpy.mockClear();
    renderDialog();
    // Initial state: name empty + sku empty → submit should not fire RPC.
    fireEvent.click(screen.getByTestId('new-product-submit'));
    await waitFor(() => {
      expect(screen.queryByText(/at least 2 characters/i)).toBeInTheDocument();
    });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('calls create_product_v1 with normalized payload on valid submit', async () => {
    rpcSpy.mockClear();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderDialog(onCreated, onClose);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Latte' } });
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'cof-002' } });
    fireEvent.click(screen.getByTestId('new-product-submit'));

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith(
        'create_product_v1',
        expect.objectContaining({
          p_payload: expect.objectContaining({
            name: 'Latte',
            sku: 'COF-002',
            category_id: 'c-coffee',
            unit: 'pcs',
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('new-p-1');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
