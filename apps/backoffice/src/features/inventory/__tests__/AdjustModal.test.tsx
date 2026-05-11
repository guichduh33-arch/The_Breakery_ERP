// apps/backoffice/src/features/inventory/__tests__/AdjustModal.test.tsx
// Session 12 — Unit tests for the AdjustModal component.
//
// Strategy:
//   - Mock @/lib/supabase to inspect rpc calls without hitting Postgres.
//   - Mock @breakery/domain validateAdjust to keep the unit boundary tight.
//   - Render via @testing-library/react inside a QueryClientProvider.
//
// Behavioural contract:
//   - Locked-product mode (initialProduct provided) hides the typeahead.
//   - The "Apply" button is disabled until product + non-negative integer
//     newQty + 3+-char reason are all valid.
//   - Submitting calls supabase.rpc('adjust_stock_v1', {...}) with the
//     correct args (productId, newQty, reason, idempotencyKey).
//   - The delta preview reflects (newQty - current_stock).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdjustModal } from '../components/AdjustModal.js';

// ---- Mocks ----------------------------------------------------------------

const mockRpc = vi.fn();
interface RpcResult { data: unknown; error: { message: string } | null }
const emptyResult: RpcResult = { data: [], error: null };
const emptyChain = {
  select: () => emptyChain,
  is:     () => emptyChain,
  eq:     () => emptyChain,
  ilike:  () => emptyChain,
  order:  () => emptyChain,
  limit:  () => Promise.resolve(emptyResult),
};
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(out ?? { data: { movement_id: 'mock-id', new_current_stock: 99 }, error: null });
    },
    from: () => emptyChain,
  },
}));

// crypto.randomUUID is invoked at mount for the idempotency key.
if (typeof crypto.randomUUID !== 'function') {
  // jsdom in CI may miss crypto.randomUUID — polyfill.
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function renderModal(initial?: Parameters<typeof AdjustModal>[0]['initialProduct']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdjustModal
        open
        {...(initial !== undefined ? { initialProduct: initial } : {})}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const STOCK_ROW = {
  product_id: 'p-1',
  sku: 'SKU-ADJ',
  name: 'Adjust Sample',
  category_id: null,
  category_name: null,
  current_stock: 10,
  min_stock_threshold: 0,
  last_movement_at: null,
  total_count: 1,
};

describe('AdjustModal', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('locked-product mode hides the typeahead and shows product name in title', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Adjust stock — Adjust Sample/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Product$/i)).not.toBeInTheDocument();
  });

  it('shows current stock and renders Apply button (initially disabled)', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Current stock:/)).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: /Apply/i });
    expect(apply).toBeDisabled();
  });

  it('shows the delta preview when newQty is valid', () => {
    renderModal(STOCK_ROW);
    const newQty = screen.getByLabelText(/New on-hand quantity/i);
    fireEvent.change(newQty, { target: { value: '15' } });
    // Preview "10 → 15 (Δ +5)" — assert on the Δ token.
    expect(screen.getByText(/Δ \+5/)).toBeInTheDocument();
  });

  it('rejects negative newQty (validator) — Apply stays disabled', () => {
    renderModal(STOCK_ROW);
    const newQty = screen.getByLabelText(/New on-hand quantity/i);
    fireEvent.change(newQty, { target: { value: '-3' } });
    const reason = screen.getByPlaceholderText(/At least 3 characters/i);
    fireEvent.change(reason, { target: { value: 'Some reason here' } });
    expect(screen.getByRole('button', { name: /Apply/i })).toBeDisabled();
  });

  it('submits with productId + newQty + reason + idempotencyKey when valid', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-1', new_current_stock: 22 }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '22' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Manual recount after closing' } });

    const apply = screen.getByRole('button', { name: /Apply/i });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('adjust_stock_v1');
    expect(call[1]).toMatchObject({
      p_product_id: 'p-1',
      p_new_qty:    22,
      p_reason:     'Manual recount after closing',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('shows error banner when RPC returns a forbidden error', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'forbidden' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Going to fail with forbidden' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no longer have permission/i);
    });
  });

  it('rejects reason < 3 chars (Apply disabled)', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '20' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: /Apply/i })).toBeDisabled();
  });
});
