// apps/backoffice/src/features/inventory/__tests__/IncomingStockForm.test.tsx
// Session 12 — Phase 2 — Unit tests for the standalone IncomingStockForm.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IncomingStockForm from '../components/IncomingStockForm.js';

const mockRpc = vi.fn();

const MOCK_SUPPLIERS = [
  { id: 's-1', code: 'SUP-A', name: 'Supplier A' },
  { id: 's-2', code: 'SUP-B', name: 'Supplier B' },
];
const MOCK_CATEGORIES = [
  { id: 'c-1', name: 'Beverage' },
];
const MOCK_PRODUCTS = [
  { id: 'p-1', sku: 'BEV-AMER', name: 'Americano', current_stock: 100 },
];

interface RpcResult { data: unknown; error: { message: string; code?: string } | null }

interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  ilike:  () => MockChain;
  order:  () => MockChain | Promise<RpcResult>;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): MockChain {
    const tableData: RpcResult =
      table === 'categories' ? { data: MOCK_CATEGORIES, error: null } :
      table === 'suppliers'  ? { data: MOCK_SUPPLIERS,  error: null } :
      table === 'products'   ? { data: MOCK_PRODUCTS,   error: null } :
      { data: [], error: null };
    const chain: MockChain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      ilike:  () => chain,
      order:  () => {
        // Reference-data hook awaits .order() directly (categories/suppliers).
        // Typeahead hook chains .order().limit(); return a chain for that path.
        if (table === 'products') return chain;
        return Promise.resolve(tableData);
      },
      limit:  () => Promise.resolve(tableData),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? { data: { movement_id: 'm-1', product_id: 'p-1', new_current_stock: 110 }, error: null });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IncomingStockForm />
    </QueryClientProvider>,
  );
}

async function pickProduct() {
  // Type 2+ chars into the typeahead so the listbox opens, then click the result.
  const input = screen.getByPlaceholderText(/Search by name/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'am' } });
  const option = await screen.findByRole('option', { name: /Americano/i });
  fireEvent.mouseDown(option);
}

describe('IncomingStockForm', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('renders all fields including the "No supplier" option', async () => {
    renderForm();
    // Fields
    expect(screen.getByPlaceholderText(/Search by name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity received/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Unit cost/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record receipt/i })).toBeInTheDocument();
    // Supplier dropdown with "No supplier" first option + active suppliers
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /No supplier \(free-form receipt\)/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Supplier A \(SUP-A\)/i })).toBeInTheDocument();
    });
  });

  it('Record receipt is disabled until product + quantity > 0 are set', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: /Record receipt|Recording/i });
    expect(submit).toBeDisabled();

    // Quantity alone is not enough — product is required too.
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '5' } });
    expect(submit).toBeDisabled();

    await pickProduct();
    await waitFor(() => expect(submit).toBeEnabled());

    // Drop qty back to 0 → disabled again.
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '0' } });
    expect(submit).toBeDisabled();
  });

  it('submits without supplier when none is picked (no p_supplier_id key)', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-1', product_id: 'p-1', new_current_stock: 105 }, error: null });
    renderForm();
    await pickProduct();
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'Stock receipt' } });

    fireEvent.click(screen.getByRole('button', { name: /Record receipt|Recording/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('record_incoming_stock_v1');
    expect(call[1]).toMatchObject({
      p_product_id: 'p-1',
      p_quantity:   5,
      p_reason:     'Stock receipt',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
    expect(call[1]).not.toHaveProperty('p_supplier_id');
  });

  it('submits with p_supplier_id when a supplier is picked', async () => {
    mockRpc.mockReturnValue({ data: { movement_id: 'm-2', product_id: 'p-1', new_current_stock: 110 }, error: null });
    renderForm();
    await pickProduct();
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '10' } });
    await waitFor(() => screen.getByRole('option', { name: /Supplier A \(SUP-A\)/i }));
    fireEvent.change(screen.getByLabelText(/Supplier/i), { target: { value: 's-1' } });

    fireEvent.click(screen.getByRole('button', { name: /Record receipt|Recording/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    const args = (mockRpc.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(args).toMatchObject({
      p_product_id:  'p-1',
      p_quantity:    10,
      p_supplier_id: 's-1',
    });
  });

  it('shows a permission error when the RPC returns forbidden', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'forbidden', code: 'P0003' } });
    renderForm();
    await pickProduct();
    fireEvent.change(screen.getByLabelText(/Quantity received/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Record receipt|Recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/permission/i);
    });
  });
});
