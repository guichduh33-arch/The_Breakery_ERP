// apps/backoffice/src/pages/reports/__tests__/ProductionYieldPage.smoke.test.tsx
// Session 15 — Phase 2.B — ProductionYieldPage render smoke. Mocks supabase to
// return a small set of production_records with varied variance, asserts the
// outliers table appears and the worst row is at the top.
//
// CRITICAL : `production_records.yield_variance_pct` is NUMERIC(7,4) ; the DB
// stores FRACTIONS (e.g. -0.5 = -50.00%). The page multiplies by 100 for
// display. The fixtures here mirror that contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductionYieldPage from '@/pages/reports/ProductionYieldPage.js';

const PROD_ROWS = [
  {
    id: 'pr-1', production_number: 'PROD-001', product_id: 'p1',
    production_date: '2026-05-10T08:00:00Z',
    expected_yield_qty: 100, actual_yield_qty: 50,
    // DB-shape : fraction → -0.5 displays as -50.00%
    yield_variance_pct: -0.5, yield_variance_reason: 'oven failure',
    reverted_at: null,
  },
  {
    id: 'pr-2', production_number: 'PROD-002', product_id: 'p2',
    production_date: '2026-05-11T08:00:00Z',
    expected_yield_qty: 100, actual_yield_qty: 90,
    yield_variance_pct: -0.1, yield_variance_reason: null,
    reverted_at: null,
  },
  {
    id: 'pr-3', production_number: 'PROD-003', product_id: 'p1',
    production_date: '2026-05-12T08:00:00Z',
    expected_yield_qty: 100, actual_yield_qty: 102,
    yield_variance_pct: 0.02, yield_variance_reason: null,
    reverted_at: null,
  },
];

const PRODUCT_ROWS = [
  { id: 'p1', name: 'Baguette' },
  { id: 'p2', name: 'Croissant' },
];

interface QueryResult { data: unknown; error: { message: string } | null }
interface Chain {
  select: () => Chain;
  eq:     () => Chain;
  in:     () => Chain;
  is:     () => Chain;
  gte:    () => Chain;
  lte:    () => Chain;
  order:  () => Chain;
  limit:  () => Promise<QueryResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function build(table: string): Chain {
    const payload: QueryResult =
      table === 'production_records' ? { data: PROD_ROWS, error: null } :
      table === 'products'           ? { data: PRODUCT_ROWS, error: null } :
      { data: [], error: null };
    const chain: Chain = {
      select: () => chain,
      eq:     () => chain,
      in:     () => chain,
      is:     () => chain,
      gte:    () => chain,
      lte:    () => chain,
      order:  () => chain,
      limit:  () => Promise.resolve(payload),
    };
    // `in()` resolves directly because the second query (products) uses
    // .select().in() without .limit(). We need a fallback that resolves on
    // any terminal awaiter. Make every chain method `await`-able by giving
    // the chain itself a `.then` shim.
    Object.defineProperty(chain, 'then', {
      configurable: true,
      writable: true,
      value: (resolve: (v: QueryResult) => unknown) => resolve(payload),
    });
    return chain;
  }
  return { supabase: { from: (t: string) => build(t), rpc: () => Promise.resolve({ data: null, error: null }) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionYieldPage />
    </QueryClientProvider>,
  );
}

describe('ProductionYieldPage smoke', () => {
  beforeEach(() => { /* nothing */ });

  it('renders heading + both sections', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Production Yield/i, level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Top-10 variance outliers/i)).toBeInTheDocument();
    expect(screen.getByText(/Trend per recipe/i)).toBeInTheDocument();
  });

  it('places the worst-variance row first in the outliers table', async () => {
    renderPage();
    // Wait until the first outlier row is present.
    await waitFor(() => {
      expect(screen.getByText('PROD-001')).toBeInTheDocument();
    });
    const outliersHeading = screen.getByText(/Top-10 variance outliers/i);
    // Look up the table directly under the heading's section.
    const section = outliersHeading.closest('section')!;
    const rows = within(section).getAllByRole('row');
    // First row is <thead> ; second row is the worst outlier (PROD-001 / -50%).
    expect(rows[1]?.textContent ?? '').toMatch(/PROD-001/);
    expect(rows[1]?.textContent ?? '').toMatch(/-50\.00%/);
  });

  it('reveals the drill-down panel when an outlier row is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('PROD-001')).toBeInTheDocument();
    });
    // No drill-down section initially.
    expect(screen.queryByTestId('yield-drilldown-section')).toBeNull();
    // Click the first outlier (PROD-001, product p1).
    fireEvent.click(screen.getAllByTestId('yield-outlier-row')[0]!);
    expect(screen.getByTestId('yield-drilldown-section')).toBeInTheDocument();
    // Drill-down shows both p1 rows (PROD-001 and PROD-003).
    const drillRows = screen.getAllByTestId('yield-drilldown-row');
    expect(drillRows.length).toBe(2);
  });

  it('exposes an Export CSV trigger once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('yield-export-csv')).not.toBeDisabled();
    });
  });
});
