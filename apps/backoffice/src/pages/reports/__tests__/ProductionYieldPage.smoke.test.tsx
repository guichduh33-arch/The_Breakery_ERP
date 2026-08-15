// apps/backoffice/src/pages/reports/__tests__/ProductionYieldPage.smoke.test.tsx
// Session 15 — Phase 2.B — ProductionYieldPage render smoke. Mocks supabase to
// return a small set of production_records with varied variance, asserts the
// outliers table appears and the worst row is at the top.
//
// CRITICAL : `production_records.yield_variance_pct` is NUMERIC(7,4) ; the DB
// stores FRACTIONS (e.g. -0.5 = -50.00%). The page multiplies by 100 for
// display. The fixtures here mirror that contract.

//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : les `<section>` maison deviennent des PanelCard, et l'export passe par le
// menu unique. Les acquis tenus ici ne bougent pas — le pire lot en tête, le
// drill-down clavier du lot A2, et les DEUX exports (le gabarit PDF
// `production_yield` était inatteignable avant le correctif R-13).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductionYieldPage from '@/pages/reports/ProductionYieldPage.js';
import { useAuthStore } from '@/stores/authStore.js';

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
      <MemoryRouter><ProductionYieldPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

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
    await waitFor(() => {
      expect(screen.getByText('PROD-001')).toBeInTheDocument();
    });
    const rows = within(screen.getByTestId('yield-outliers')).getAllByRole('row');
    // First row is <thead> ; second row is the worst outlier (PROD-001 / -50%).
    expect(rows[1]?.textContent ?? '').toMatch(/PROD-001/);
    expect(rows[1]?.textContent ?? '').toMatch(/-50\.00%/);
  });

  // Les deux mesures dérivées de la bande, sur la fixture : trois lots suivis,
  // le plus gros écart à 50 %, un seul motif renseigné.
  it('summarises the window in the KPI band', async () => {
    renderPage();
    const swing = await screen.findByTestId('kpi-largest-swing');
    expect(swing.textContent).toMatch(/50\.00%/);
    expect(screen.getByTestId('kpi-beyond').textContent).toMatch(/^Beyond ±15%1/);
    expect(screen.getByTestId('kpi-explained').textContent).toMatch(/1 of 3 with a reason/);
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

  // Audit R-13 — la page exposait un <Button> maison ; elle passe par le menu
  // d'export du socle, qui offre les DEUX formats — le PDF étant précisément le
  // gabarit qui était inatteignable.
  it('exposes CSV and PDF exports once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });
});
