// apps/backoffice/src/features/inventory-production/__tests__/RecipeDuplicateModal.smoke.test.tsx
// Session 15 — Phase 3.B — RecipeDuplicateModal render + error display + confirm path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeDuplicateModal } from '../components/RecipeDuplicateModal.js';

// ── Mock supabase (used by useFinishedProducts + useDuplicateRecipe) ──────────

const PRODUCT_ROWS = [
  { id: 'src',    sku: 'SRC', name: 'Source Bread',   unit: 'pcs', current_stock: 0, cost_price: 1500 },
  { id: 'tgt-1',  sku: 'T1',  name: 'Target Bread',   unit: 'pcs', current_stock: 0, cost_price: 1500 },
  { id: 'tgt-2',  sku: 'T2',  name: 'Already Has',    unit: 'pcs', current_stock: 0, cost_price: 1500 },
];
const RECIPE_PRODUCT_ROWS = [
  { product_id: 'src' },     // source has active recipes
  { product_id: 'tgt-2' },   // tgt-2 already has active recipes — should be filtered
];

let rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;

vi.mock('@/lib/supabase.js', () => {
  type RpcResult = { data: unknown; error: { message: string } | null };
  function buildChain(table: string) {
    const tableData: RpcResult =
      table === 'products' ? { data: PRODUCT_ROWS, error: null } :
      table === 'recipes'  ? { data: RECIPE_PRODUCT_ROWS, error: null } :
      { data: [], error: null };
    const chain: {
      select: () => typeof chain;
      eq:     () => typeof chain;
      is:     () => typeof chain;
      order:  () => typeof chain;
      limit:  () => Promise<RpcResult>;
    } = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      order:  () => chain,
      limit:  () => Promise.resolve(tableData),
    };
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
      rpc: (fn: string, args: unknown) => rpcImpl(fn, args),
    },
  };
});

function renderModal(overrides: Partial<{
  open: boolean;
  sourceRowsCount: number;
  onClose: () => void;
  onSuccess: (id: string) => void;
}> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecipeDuplicateModal
        sourceProductId="src"
        sourceProductName="Source Bread"
        sourceRowsCount={overrides.sourceRowsCount ?? 3}
        open={overrides.open ?? true}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onSuccess, qc };
}

describe('RecipeDuplicateModal smoke', () => {
  beforeEach(() => {
    rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
  });

  it('renders the modal title and description with the row count', async () => {
    renderModal({ sourceRowsCount: 3 });
    expect(screen.getByRole('heading', { name: /Duplicate recipe/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/3 rows/)).toBeInTheDocument();
    });
  });

  it('Confirm is disabled when no target is selected', async () => {
    renderModal();
    await waitFor(() => screen.getByTestId('duplicate-target-select'));
    expect(screen.getByTestId('duplicate-confirm')).toBeDisabled();
  });

  it('lists only products without active recipes (filters source and tgt-2)', async () => {
    renderModal();
    const select = await waitFor(() => screen.getByTestId('duplicate-target-select') as HTMLSelectElement);
    // Wait for useFinishedProducts to resolve
    await waitFor(() => {
      const opts = Array.from(select.options).map((o) => o.value);
      expect(opts).toContain('tgt-1');
    });
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).not.toContain('src');     // source filtered
    expect(opts).not.toContain('tgt-2');   // already has active recipes — filtered
  });

  it('renders an inline error when mutation returns target_has_active_recipes', async () => {
    rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'target_has_active_recipes' },
    });
    renderModal();
    const select = await waitFor(() => screen.getByTestId('duplicate-target-select') as HTMLSelectElement);
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).toContain('tgt-1');
    });
    fireEvent.change(select, { target: { value: 'tgt-1' } });
    const confirm = screen.getByTestId('duplicate-confirm');
    expect(confirm).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => {
      const err = screen.getByTestId('duplicate-error');
      expect(err).toHaveAttribute('data-error-code', 'target_has_active_recipes');
    });
  });

  it('calls onSuccess(targetId) when the RPC succeeds', async () => {
    rpcImpl = vi.fn().mockResolvedValue({
      data: {
        source_product_id: 'src',
        target_product_id: 'tgt-1',
        rows_copied: 3,
        idempotent_replay: false,
      },
      error: null,
    });
    const { onSuccess } = renderModal();
    const select = await waitFor(() => screen.getByTestId('duplicate-target-select') as HTMLSelectElement);
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).toContain('tgt-1');
    });
    fireEvent.change(select, { target: { value: 'tgt-1' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('duplicate-confirm'));
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('tgt-1');
    });
  });
});
