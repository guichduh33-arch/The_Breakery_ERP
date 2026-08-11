// apps/backoffice/src/__tests__/inventory.smoke.test.tsx
// Session 12 — End-to-end smoke test for the inventory module in the BO.
//
// Strategy: we mock @/lib/supabase to simulate the Postgres responses and
// drive the page through the same component tree the user sees:
//   1. MANAGER role → list rendered, Adjust hidden, Waste visible ; Receive
//      absent sans purchasing.po.create (Q3 audit 2026-07-27 : receive_stock_v1
//      droppée, la réception passe par l'achat direct compté /inventory/incoming)
//   2. Row action menu n'offre plus « Receive stock »
//   3. Open Waste → fill form → submit → waste_stock_v1 RPC called
//   4. ADMIN role (re-render with elevated perms) → Adjust visible →
//      open modal → submit → adjust_stock_v1 RPC called

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

const MOCK_ROWS = [
  {
    product_id: 'p-1',
    sku: 'BEV-AMER',
    name: 'Americano',
    category_id: 'c-1',
    category_name: 'Beverage',
    current_stock: 25,
    min_stock_threshold: 30,        // low-stock — badge expected
    track_inventory: true,
    unit: 'pcs',
    stock_value: 250_000,
    last_movement_at: '2026-05-10T10:00:00Z',
  },
  {
    product_id: 'p-2',
    sku: 'PAS-CROI',
    name: 'Croissant',
    category_id: 'c-2',
    category_name: 'Pastry',
    current_stock: 50,
    min_stock_threshold: 0,         // disabled — no badge
    track_inventory: true,
    unit: 'pcs',
    stock_value: 500_000,
    last_movement_at: '2026-05-09T10:00:00Z',
  },
];

const MOCK_CATEGORIES = [
  { id: 'c-1', name: 'Beverage' },
  { id: 'c-2', name: 'Pastry'   },
];

const MOCK_SUPPLIERS = [
  { id: 's-1', code: 'SUP-ROAST', name: 'Roastery' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  ilike:  () => MockChain;
  order:  () => Promise<RpcResult>;
  limit:  () => Promise<RpcResult>;
  range:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
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
      range:  () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_stock_levels_v3') {
          return Promise.resolve({ data: MOCK_ROWS, error: null });
        }
        if (fn === 'get_stock_counters_v1') {
          return Promise.resolve({
            data: [{ total_count: 2, low_count: 1, zero_count: 0, negative_count: 0, untracked_count: 0 }],
            error: null,
          });
        }
        // Common shape for the three write RPCs.
        return Promise.resolve({
          data: { movement_id: `mvt-${Date.now()}`, product_id: args.p_product_id, new_current_stock: 100, idempotent_replay: false },
          error: null,
        });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

let currentPerms = new Set<string>();
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

async function renderAs(perms: string[]) {
  currentPerms = new Set(perms);
  const InventoryPage = (await import('@/pages/Inventory.js')).default;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InventoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Inventory smoke E2E', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    cleanup();
  });

  it('MANAGER flow: list + low-stock badge visible, Adjust hidden, Waste shown, Receive absent sans purchasing.po.create', { timeout: 40_000 }, async () => {
    const r = await renderAs(['inventory.read', 'inventory.receive', 'inventory.waste']);
    const w = within(r.container);
    // First test in the file pays the vite transformer cold-start (~15-20s under
    // full-suite load on Windows + jsdom), so the waitFor timeout is intentionally large.
    await waitFor(() => expect(w.getByText('Americano')).toBeInTheDocument(), { timeout: 35_000 });

    // Low-stock row stamps the badge (current=25 < threshold=30, threshold > 0).
    const americanoRow = w.getByText('Americano').closest('tr')!;
    expect(within(americanoRow).getByText(/low/i)).toBeInTheDocument();

    // Non-low row does not show the badge.
    const croissantRow = w.getByText('Croissant').closest('tr')!;
    expect(within(croissantRow).queryByText(/low/i)).not.toBeInTheDocument();

    // Toolbar perms: Adjust hidden ; Receive gated by purchasing.po.create (Q3) ;
    // Waste shown.
    expect(w.queryByRole('button', { name: /^Adjust$/i })).not.toBeInTheDocument();
    expect(w.queryByRole('button', { name: /Receive/i })).not.toBeInTheDocument();
    expect(w.getByRole('button', { name: /Waste/i  })).toBeInTheDocument();
  });

  it('Q3: toolbar Receive visible avec purchasing.po.create ; row menu sans « Receive stock »', { timeout: 20_000 }, async () => {
    const r = await renderAs(['inventory.read', 'purchasing.po.create', 'inventory.waste']);
    const w = within(r.container);
    await waitFor(() => w.getByText('Americano'), { timeout: 15_000 });

    // Toolbar : Receive présent (navigue vers /backoffice/inventory/incoming).
    expect(w.getByRole('button', { name: /Receive/i })).toBeInTheDocument();

    // Row action menu : plus d'entrée « Receive stock » (receive_stock_v1 droppée).
    const americanoRow = w.getByText('Americano').closest('tr')!;
    fireEvent.click(within(americanoRow).getByRole('button', { name: /Actions for Americano/i }));
    expect(w.queryByRole('menuitem', { name: /Receive stock/i })).not.toBeInTheDocument();
    expect(w.getByRole('menuitem', { name: /Record waste/i })).toBeInTheDocument();
  });

  it('MANAGER flow: open Waste from row → submit → waste_stock_v1 RPC fired', { timeout: 20_000 }, async () => {
    const r = await renderAs(['inventory.read', 'inventory.receive', 'inventory.waste']);
    const w = within(r.container);
    await waitFor(() => w.getByText('Croissant'), { timeout: 15_000 });

    const croissantRow = w.getByText('Croissant').closest('tr')!;
    fireEvent.click(within(croissantRow).getByRole('button', { name: /Actions for Croissant/i }));
    fireEvent.click(w.getByRole('menuitem', { name: /Record waste/i }));

    // Modal content is rendered via Radix Portal — query the global screen.
    await waitFor(() => screen.getByText(/Record waste — Croissant/i));
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });

    mockRpc.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Record waste|Recording/i }));

    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'waste_stock_v1');
      expect(call).toBeDefined();
      expect((call as [string, Record<string, unknown>])[1]).toMatchObject({
        p_product_id: 'p-2',
        p_quantity:   3,
        p_reason:     'Expired',
      });
    });
  });

  it('ADMIN flow: Adjust button visible → submit → adjust_stock_v1 RPC fired', { timeout: 20_000 }, async () => {
    const r = await renderAs(['inventory.read', 'inventory.adjust', 'inventory.receive', 'inventory.waste']);
    const w = within(r.container);
    await waitFor(() => w.getByText('Americano'), { timeout: 15_000 });

    expect(w.getByRole('button', { name: /^Adjust$/i })).toBeInTheDocument();

    const americanoRow = w.getByText('Americano').closest('tr')!;
    fireEvent.click(within(americanoRow).getByRole('button', { name: /Actions for Americano/i }));
    fireEvent.click(w.getByRole('menuitem', { name: /Adjust stock/i }));

    // Modal content is rendered via Radix Portal — query the global screen.
    await waitFor(() => screen.getByText(/Adjust stock — Americano/i));
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '40' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Physical recount after audit' } });

    mockRpc.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Apply$|Applying/i }));

    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'adjust_stock_v1');
      expect(call).toBeDefined();
      expect((call as [string, Record<string, unknown>])[1]).toMatchObject({
        p_product_id: 'p-1',
        p_new_qty:    40,
        p_reason:     'Physical recount after audit',
      });
    });
  });
});
