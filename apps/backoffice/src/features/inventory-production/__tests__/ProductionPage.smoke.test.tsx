// apps/backoffice/src/features/inventory-production/__tests__/ProductionPage.smoke.test.tsx
//
// Smoke tests for the redesigned station-based Production page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductionPage from '@/pages/inventory/ProductionPage.js';

let currentPerms = new Set<string>(['inventory.read', 'inventory.production.create']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

// Per-table resolver for a fully-chainable thenable mock (any filter order works).
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
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const STATIONS = [
  { id: 'st-pastry', code: 'STN_PASTRY', name: 'Pastry', kind: 'production', display_order: 110 },
  { id: 'st-hot', code: 'STN_HOT_KITCHEN', name: 'Hot Kitchen', kind: 'production', display_order: 120 },
  { id: 'st-cafe', code: 'COFFEE_STATION', name: 'Coffee Station', kind: 'sales', display_order: 30 },
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionPage />
    </QueryClientProvider>,
  );
}

describe('ProductionPage smoke', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.create']);
    resolvers.sections = () => ({ data: STATIONS, error: null });
    resolvers.product_sections = () => ({ data: [], error: null });
    resolvers.production_records = () => ({ data: [], error: null });
    resolvers.products = () => ({ data: [], error: null });
  });

  it('shows only production-station tabs and selects the first', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('station-tab-STN_PASTRY')).toBeInTheDocument();
    });
    expect(screen.getByTestId('station-tab-STN_HOT_KITCHEN')).toBeInTheDocument();
    // Sales section must NOT appear as a production station.
    expect(screen.queryByTestId('station-tab-COFFEE_STATION')).not.toBeInTheDocument();
    expect(screen.getByTestId('station-tab-STN_PASTRY')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the entry card for the active station + empty production log', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Production Entry/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/— Pastry/)).toBeInTheDocument();
    expect(screen.getByTestId('production-datetime')).toBeInTheDocument();
    expect(screen.getByTestId('submit-production')).toBeDisabled();
    expect(screen.getByTestId('kpi-produced')).toHaveTextContent('0');
    expect(screen.getByTestId('kpi-waste')).toHaveTextContent('0');
    expect(await screen.findByTestId('today-production-empty')).toBeInTheDocument();
  });

  it('day navigator shows Today and steps backward', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Today')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Previous day/i }));
    await waitFor(() => {
      expect(screen.queryByText('Today')).not.toBeInTheDocument();
    });
  });

  it('blocks entry (but not the page) without inventory.production.create', async () => {
    currentPerms = new Set(['inventory.read']);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/do not have permission to record production/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('submit-production')).not.toBeInTheDocument();
  });

  it('blocks the whole page without inventory.read', () => {
    currentPerms = new Set();
    renderPage();
    expect(screen.getByText(/do not have permission to view production/i)).toBeInTheDocument();
  });
});
