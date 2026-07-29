// apps/backoffice/src/features/inventory-production/__tests__/production-force-negative.test.tsx
//
// ADR-008 D4 — l'échappatoire « forcer malgré le stock insuffisant » :
//   - n'apparaît qu'APRÈS un refus serveur (insufficient_stock), jamais d'emblée
//   - n'apparaît que pour un porteur de `inventory.production.force_negative`
//   - une fois cochée, le re-submit envoie bien p_batch.force_negative = true

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionEntryCard } from '../components/ProductionEntryCard.js';

let currentPerms = new Set<string>(['inventory.read', 'inventory.production.create']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const mockRpc = vi.fn();
const resolvers: Record<string, () => { data: unknown; error: unknown }> = {};

vi.mock('@/lib/supabase.js', () => {
  const methods = ['select', 'eq', 'in', 'is', 'order', 'gte', 'lte', 'limit'] as const;
  function makeChain(table: string) {
    const resolve = () => (resolvers[table] ?? (() => ({ data: [], error: null })))();
    const chain: Record<string, unknown> = {};
    for (const m of methods) chain[m] = () => chain;
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      rpc: (fn: string, args: unknown) =>
        Promise.resolve(mockRpc(fn, args) as { data: unknown; error: unknown }),
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

const SHORTAGE_ERROR = {
  data: null,
  error: {
    message: 'insufficient_stock',
    details: JSON.stringify([
      { material_id: 'm-1', material_name: 'Flour', required: 5, available: 4, shortfall: 1, unit: 'kg' },
    ]),
  },
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionEntryCard sectionId="st-1" sectionName="Pastry" selectedDate={new Date('2026-07-27T08:00:00Z')} />
    </QueryClientProvider>,
  );
}

/** Add the seeded product to the entry table via the search box. */
async function addBaguetteRow(): Promise<void> {
  fireEvent.focus(screen.getByTestId('production-search'));
  fireEvent.change(screen.getByTestId('production-search'), { target: { value: 'Bag' } });
  const option = await screen.findByText('Baguette');
  fireEvent.mouseDown(option);
  await waitFor(() => {
    expect(screen.getByTestId('entry-row-SKU-BAG')).toBeInTheDocument();
  });
}

describe('ADR-008 D4 — force-negative escape hatch (ProductionEntryCard)', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.create', 'inventory.production.force_negative']);
    mockRpc.mockReset();
    mockRpc.mockReturnValue(SHORTAGE_ERROR);
    resolvers.product_sections = () => ({ data: [{ product_id: 'p-bag' }], error: null });
    resolvers.products = () => ({
      data: [{ id: 'p-bag', sku: 'SKU-BAG', name: 'Baguette', unit: 'pcs', current_stock: 0, product_type: 'finished' }],
      error: null,
    });
    resolvers.recipes = () => ({ data: [{ product_id: 'p-bag' }], error: null });
    resolvers.product_unit_alternatives = () => ({ data: [], error: null });
  });

  it('hides the force toggle until the server refuses for insufficient stock', async () => {
    renderCard();
    await addBaguetteRow();
    expect(screen.queryByTestId('force-negative-toggle')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('submit-production'));

    await waitFor(() => {
      expect(screen.getByTestId('production-shortages')).toBeInTheDocument();
    });
    expect(screen.getByTestId('force-negative-toggle')).toBeInTheDocument();
  });

  it('never offers the force toggle without inventory.production.force_negative', async () => {
    currentPerms = new Set(['inventory.read', 'inventory.production.create']);
    renderCard();
    await addBaguetteRow();
    fireEvent.click(screen.getByTestId('submit-production'));

    await waitFor(() => {
      expect(screen.getByTestId('production-shortages')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('force-negative-toggle')).not.toBeInTheDocument();
  });

  it('sends force_negative=true on the confirming re-submit', async () => {
    renderCard();
    await addBaguetteRow();

    fireEvent.click(screen.getByTestId('submit-production'));
    await waitFor(() => {
      expect(screen.getByTestId('force-negative-toggle')).toBeInTheDocument();
    });

    // First attempt carried no force flag.
    const firstBatch = (mockRpc.mock.calls[0]?.[1] as { p_batch: Record<string, unknown> }).p_batch;
    expect(firstBatch.force_negative).toBeUndefined();

    fireEvent.click(screen.getByTestId('force-negative-toggle'));
    fireEvent.click(screen.getByTestId('submit-production'));

    await waitFor(() => {
      expect(mockRpc.mock.calls.length).toBeGreaterThan(1);
    });
    const lastCall = mockRpc.mock.calls[mockRpc.mock.calls.length - 1] as [string, { p_batch: Record<string, unknown> }];
    // ADR-016 (20260729000001) fused the old _v3 impl + _v4 date wrapper into
    // a single orchestrator, bumped again to record_batch_production_v6 by
    // ADR-008 D5/D6 (20260729000003) — the hook now calls _v6.
    expect(lastCall[0]).toBe('record_batch_production_v6');
    expect(lastCall[1].p_batch.force_negative).toBe(true);
  });
});
