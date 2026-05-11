// apps/backoffice/src/features/inventory/__tests__/WasteModal.test.tsx
// Session 12 — Unit tests for the WasteModal component.
//
// Contract:
//   - Quantity > current_stock is rejected client-side (disabled submit + inline error)
//   - Reason preset "Other" reveals a textarea (3+ chars required)
//   - Submit calls waste_stock_v1 with productId, quantity (positive), reason, idempotencyKey

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WasteModal } from '../components/WasteModal.js';

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
      return Promise.resolve(out ?? { data: { movement_id: 'm-1', new_current_stock: 95 }, error: null });
    },
    from: () => emptyChain,
  },
}));

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

const STOCK_ROW = {
  product_id: 'p-1',
  sku: 'SKU-WAS',
  name: 'Waste Sample',
  category_id: null,
  category_name: null,
  current_stock: 25,
  min_stock_threshold: 0,
  last_movement_at: null,
  total_count: 1,
};

function renderModal(initial?: typeof STOCK_ROW) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WasteModal
        open
        {...(initial !== undefined ? { initialProduct: initial } : {})}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('WasteModal', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders with locked product and preset Expired by default', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Record waste — Waste Sample/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason$/i)).toHaveValue('Expired');
  });

  it('Record waste button is disabled until qty within stock + preset selected', () => {
    renderModal(STOCK_ROW);
    const submit = screen.getByRole('button', { name: /Record waste|Recording/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    expect(submit).toBeEnabled();
  });

  it('shows error message when qty > current_stock', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '999' } });
    expect(screen.getByText(/Cannot exceed current stock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record waste|Recording/i })).toBeDisabled();
  });

  it('Other preset reveals describe textarea (>= 3 chars required)', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/^Reason$/i), { target: { value: 'Other' } });
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });

    // Submit disabled because the Describe textarea is empty
    const submit = screen.getByRole('button', { name: /Record waste|Recording/i });
    expect(submit).toBeDisabled();

    const desc = screen.getByLabelText(/Describe/i);
    fireEvent.change(desc, { target: { value: 'Custom shrinkage' } });
    expect(submit).toBeEnabled();
  });

  it('submits with positive quantity + preset reason + idempotencyKey', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-1', new_current_stock: 22 }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Record waste|Recording/i }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('waste_stock_v1');
    expect(call[1]).toMatchObject({
      p_product_id: 'p-1',
      p_quantity:   3,
      p_reason:     'Expired',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('surfaces insufficient_stock error from RPC', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'insufficient_stock' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Record waste|Recording/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/stock changed elsewhere/i);
    });
  });
});
