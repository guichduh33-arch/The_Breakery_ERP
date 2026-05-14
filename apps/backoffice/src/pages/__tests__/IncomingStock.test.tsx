// apps/backoffice/src/pages/__tests__/IncomingStock.test.tsx
// Session 12 — Phase 2 — Smoke tests for the IncomingStock page.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import IncomingStockPage from '@/pages/IncomingStock.js';

// Mutable permission set per test — vi.mock is hoisted, but the closure
// inside reads `currentPerms` at call time so each test can swap it.
let currentPerms = new Set<string>();

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_SUPPLIERS = [
  { id: 's-1', code: 'SUP-A', name: 'Supplier A' },
];

interface RpcResult { data: unknown; error: { message: string } | null }
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
      table === 'suppliers' ? { data: MOCK_SUPPLIERS, error: null } :
      { data: [], error: null };
    const chain: MockChain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      ilike:  () => chain,
      order:  () => {
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
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IncomingStockPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IncomingStockPage', () => {
  beforeEach(() => { currentPerms = new Set(); });

  it('CASHIER role (no inventory.receive) is blocked by the permission gate', () => {
    currentPerms = new Set(['orders.create']);
    renderPage();
    expect(screen.getByText(/do not have permission to record incoming stock/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Incoming Stock/i })).not.toBeInTheDocument();
  });

  it('MANAGER role (inventory.receive) renders the heading and Record receipt button', async () => {
    currentPerms = new Set(['inventory.read', 'inventory.receive']);
    renderPage();
    expect(screen.getByRole('heading', { name: /Incoming Stock/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record receipt/i })).toBeInTheDocument();
    });
  });
});
