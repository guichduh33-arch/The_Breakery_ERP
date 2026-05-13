// apps/backoffice/src/features/inventory-production/__tests__/ProductionForm.smoke.test.tsx
// Session 13 — Phase 2.A — ProductionForm minimal render smoke test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductionForm from '../components/ProductionForm.js';

const mockRpc = vi.fn();

const PRODUCT_ROWS = [
  { id: 'bag-1', sku: 'BAG-1', name: 'Test Baguette', unit: 'pcs', current_stock: 0,   cost_price: 1500 },
  { id: 'flo-1', sku: 'FLO-1', name: 'Test Flour',    unit: 'kg',  current_stock: 100, cost_price: 10000 },
];

interface RpcResult { data: unknown; error: { message: string } | null }
interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  order:  () => MockChain | Promise<RpcResult>;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): MockChain {
    const tableData: RpcResult =
      table === 'products'      ? { data: PRODUCT_ROWS, error: null } :
      table === 'recipes'       ? { data: [{ product_id: 'bag-1' }], error: null } :
      table === 'sections'      ? { data: [{ id: 'sec-1', code: 'KIT', name: 'Kitchen', kind: 'kitchen', display_order: 1 }], error: null } :
      { data: [], error: null };
    const chain: MockChain = {
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
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        if (out !== undefined) return Promise.resolve(out);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-00000000abcd',
  });
}

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionForm />
    </QueryClientProvider>,
  );
}

describe('ProductionForm smoke', () => {
  beforeEach(() => mockRpc.mockReset());

  it('renders all key fields', async () => {
    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Finished product/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Quantity produced/i)).toBeInTheDocument();
    expect(screen.getByText(/Waste/i)).toBeInTheDocument();
    expect(screen.getByText(/Batch number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record production/i })).toBeInTheDocument();
  });

  it('Record production is disabled when no product is selected', async () => {
    renderForm();
    await waitFor(() => screen.getByText(/Finished product/i));
    const btn = screen.getByRole('button', { name: /Record production/i });
    expect(btn).toBeDisabled();
  });
});
