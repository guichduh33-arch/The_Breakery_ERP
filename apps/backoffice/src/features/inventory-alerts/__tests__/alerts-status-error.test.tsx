// apps/backoffice/src/features/inventory-alerts/__tests__/alerts-status-error.test.tsx
// Audit M4 — AlertsPage Status tile must never show 'All clear' when the
// underlying low-stock query has errored. TDD: write → FAIL → fix → PASS.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AlertsPage from '@/pages/inventory/AlertsPage.js';
import * as lowStockMod from '../hooks/useLowStock.js';

// ---- minimal mocks for child components that make their own queries ----

// LowStockTab, ReorderTab, ProductionAlertsTab each import hooks that call
// supabase. Mock the whole supabase client so those renders don't error.
vi.mock('@/lib/supabase.js', () => {
  const chain: Record<string, unknown> = {};
  const methods = ['select','eq','is','in','order','limit','neq','gt','lt','gte','lte','not','contains','filter','range'];
  for (const m of methods) chain[m] = () => Promise.resolve({ data: [], error: null });
  // Make every method chainable and terminal.
  for (const m of methods) {
    chain[m] = () => {
      const sub: Record<string, unknown> = {};
      for (const sm of methods) sub[sm] = () => Promise.resolve({ data: [], error: null });
      return sub;
    };
  }
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

// Mock authStore for components that read permissions.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeQuery(overrides: Partial<{ data: unknown; error: Error | null; isLoading: boolean }>): any {
  return { data: undefined, error: null, isLoading: false, ...overrides };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AlertsPage — Status KPI tile error handling (audit M4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "All clear" when data is empty and there is no error', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: [], error: null, isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('shows "Action needed" when there are low-stock items and no error', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({
        data: [{ product_id: 'p1', current_qty: 0, shortfall: 5 }],
        error: null,
        isLoading: false,
      }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.getByText('Action needed')).toBeInTheDocument();
    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('shows "Unavailable" (not "All clear") when the query errored with empty data', () => {
    // This is the core M4 regression: counts.total === 0 because data is
    // undefined/empty due to the error, NOT because everything is fine.
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: undefined, error: new Error('boom'), isLoading: false }),
    );
    render(wrap(<AlertsPage />));

    // Must NOT show the false positive.
    expect(screen.queryByText('All clear')).toBeNull();
    // Must show the honest error state.
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows "Unavailable" footer text when the query errored', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: undefined, error: new Error('network error'), isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    // Footer should explain the error; check for the explanatory copy.
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });

  it('does NOT show "Unavailable" when data loaded successfully (no false negatives)', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: [], error: null, isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});
