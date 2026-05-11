// apps/backoffice/src/features/inventory/__tests__/ReceiveModal.test.tsx
// Session 12 — Unit tests for the ReceiveModal component.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceiveModal } from '../components/ReceiveModal.js';

const mockRpc = vi.fn();
const MOCK_SUPPLIERS = [
  { id: 's-1', code: 'SUP-A', name: 'Supplier A' },
  { id: 's-2', code: 'SUP-B', name: 'Supplier B' },
];
const MOCK_CATEGORIES = [
  { id: 'c-1', name: 'Beverage' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  ilike:  () => MockChain;
  order:  () => Promise<RpcResult>;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  // The reference-data hook calls Promise.all([categories, suppliers]).
  function buildChain(table: string): MockChain {
    const tableData: RpcResult =
      table === 'categories' ? { data: MOCK_CATEGORIES, error: null } :
      table === 'suppliers'  ? { data: MOCK_SUPPLIERS,  error: null } :
      { data: [], error: null };
    const chain: MockChain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      ilike:  () => chain,
      order:  () => Promise.resolve(tableData),
      limit:  () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? { data: { movement_id: 'm-1', new_current_stock: 110 }, error: null });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

const STOCK_ROW = {
  product_id: 'p-1',
  sku: 'SKU-RCV',
  name: 'Receive Sample',
  category_id: null,
  category_name: null,
  current_stock: 100,
  min_stock_threshold: 0,
  last_movement_at: null,
  total_count: 1,
};

function renderModal(initial?: typeof STOCK_ROW) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReceiveModal
        open
        {...(initial !== undefined ? { initialProduct: initial } : {})}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ReceiveModal', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the supplier dropdown populated with active suppliers', async () => {
    renderModal(STOCK_ROW);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Supplier A \(SUP-A\)/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Supplier B \(SUP-B\)/i })).toBeInTheDocument();
    });
  });

  it('Receive button is disabled until product + supplier + qty > 0 are set', async () => {
    renderModal(STOCK_ROW);
    const submit = screen.getByRole('button', { name: /Receive$|Receiving/i });
    expect(submit).toBeDisabled();

    await waitFor(() => screen.getByRole('option', { name: /Supplier A/i }));
    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '10' } });

    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('rejects qty <= 0 — Receive stays disabled', async () => {
    renderModal(STOCK_ROW);
    await waitFor(() => screen.getByRole('option', { name: /Supplier A/i }));
    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Receive$|Receiving/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '-5' } });
    expect(screen.getByRole('button', { name: /Receive$|Receiving/i })).toBeDisabled();
  });

  it('submits with productId + supplierId + qty + idempotencyKey', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-1', new_current_stock: 130 }, error: null });
    renderModal(STOCK_ROW);
    await waitFor(() => screen.getByRole('option', { name: /Supplier A/i }));

    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '30' } });

    fireEvent.click(screen.getByRole('button', { name: /Receive$|Receiving/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('receive_stock_v1');
    expect(call[1]).toMatchObject({
      p_product_id:  'p-1',
      p_quantity:    30,
      p_supplier_id: 's-1',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('passes unit_cost when supplied', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-1', new_current_stock: 110 }, error: null });
    renderModal(STOCK_ROW);
    await waitFor(() => screen.getByRole('option', { name: /Supplier A/i }));

    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Unit cost/i), { target: { value: '4250' } });

    fireEvent.click(screen.getByRole('button', { name: /Receive$|Receiving/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const args = (mockRpc.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(args).toMatchObject({ p_unit_cost: 4250 });
  });

  it('shows forbidden error when RPC denies the call', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'forbidden' } });
    renderModal(STOCK_ROW);
    await waitFor(() => screen.getByRole('option', { name: /Supplier A/i }));

    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Receive$|Receiving/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no longer have permission/i);
    });
  });
});
