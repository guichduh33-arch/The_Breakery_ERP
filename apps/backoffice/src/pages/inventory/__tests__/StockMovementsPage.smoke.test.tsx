// apps/backoffice/src/pages/inventory/__tests__/StockMovementsPage.smoke.test.tsx
// 2026-06-18 — stock-card ledger rewrite. Covers: header + KPI tiles, ledger rows
// (running balance layout), filter bar, CSV export. Mocks useStockLedger +
// useMovementAggregates.
//
// ADR-027 — le filtre de section a disparu de la barre : le stock est global.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import type { StockLedgerLine } from '@/features/inventory-movements/hooks/useStockLedger.js';
import { useAuthStore } from '@/stores/authStore.js';
import type * as StockLedgerModule from '@/features/inventory-movements/hooks/useStockLedger.js';

const MOCK_LINES: StockLedgerLine[] = [
  {
    id: 'mv-1', movement_date: '2026-05-12', created_time: '2026-05-12T08:00:00Z',
    movement_type: 'sale', product_id: 'p-1', product_name: 'Americano', product_group: 'Beverage',
    unit: 'pcs', incoming_qty: 0, outgoing_qty: 2, beginning_qty: 10, balance_qty: 8,
    price: 9000, movement_amount: -18000, reference_type: 'orders', reference_id: 'so-1',
    reason: null, reference_label: 'ORD-0042', created_by_name: 'Jane',
  },
  {
    id: 'mv-2', movement_date: '2026-05-12', created_time: '2026-05-12T07:00:00Z',
    movement_type: 'purchase', product_id: 'p-2', product_name: 'Croissant', product_group: 'Pastry',
    unit: 'pcs', incoming_qty: 24, outgoing_qty: 0, beginning_qty: 0, balance_qty: 24,
    price: 5000, movement_amount: 120000, reference_type: 'admin_action', reference_id: null,
    reason: null, reference_label: null, created_by_name: 'John',
  },
];

vi.mock('@/features/inventory-movements/hooks/useStockLedger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StockLedgerModule>();
  return {
    ...actual,
    useStockLedger: () => ({
      data: { lines: MOCK_LINES, truncated: false, row_count: MOCK_LINES.length },
      isLoading: false,
      error: null,
    }),
  };
});

const aggregateState = vi.hoisted(() => ({ error: null as Error | null, refetch: vi.fn(), filters: vi.fn() }));
vi.mock('@/features/inventory-movements/hooks/useMovementAggregates.js', () => ({
  useMovementAggregates: (filters: unknown) => { aggregateState.filters(filters); return ({
    data: [
      { movement_type: 'sale', unit: 'pcs', direction: -1, count: 10, qty_total: 20, value_total: -100000 },
      { movement_type: 'purchase', unit: 'pcs', direction: 1, count: 3, qty_total: 72, value_total: 360000 },
      { movement_type: 'adjustment', unit: 'kg', direction: 1, count: 1, qty_total: 1.375, value_total: 5000 },
    ],
    isLoading: false, error: aggregateState.error, refetch: aggregateState.refetch,
  }); },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><StockMovementsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`. Ce test verifie le cablage de l'export, pas le RBAC.
beforeEach(() => {
  aggregateState.error = null;
  vi.clearAllMocks();
  useAuthStore.setState({ permissions: ['reports.export'] });
});

describe('StockMovementsPage (stock-card rewrite)', () => {
  it('keeps units separate and classifies positive adjustments as incoming', () => {
    renderPage();
    const incoming = within(screen.getByTestId('kpi-stock-in'));
    expect(incoming.getByText('72 pcs')).toBeInTheDocument();
    expect(incoming.getByText('1,375 kg')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-stock-out')).getByText('20 pcs')).toBeInTheDocument();
  });
  it('withholds stale totals and offers retry when aggregates fail', () => {
    aggregateState.error = new Error('offline');
    renderPage();
    expect(screen.getByTestId('kpi-movements-value')).toHaveTextContent('—');
    expect(screen.queryByText('72 pcs')).not.toBeInTheDocument();
    expect(screen.getByText('Movement totals could not be loaded.')).toBeInTheDocument();
  });
  it('passes the selected movement type to the aggregate query', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: 'sale' } });
    expect(aggregateState.filters).toHaveBeenLastCalledWith(expect.objectContaining({ movementType: 'sale' }));
  });
  it('renders the page header and KPI tiles', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock movements/i })).toBeInTheDocument();
    expect(screen.getByText(/Stock in/i)).toBeInTheDocument();
    expect(screen.getByText(/Stock out/i)).toBeInTheDocument();
    expect(screen.getByText(/Value moved/i)).toBeInTheDocument();
  });

  it('renders slim ledger rows (product + type label) without detail until expanded', () => {
    renderPage();
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('POS_SALE')).toBeInTheDocument();   // type label, main row
    expect(screen.getByText('PURCHASE')).toBeInTheDocument();
    // Detail-only fields are collapsed by default.
    expect(screen.queryByText('SL26051200000001')).toBeNull();
    expect(screen.queryByText('Beverage')).toBeNull();
  });

  it('sorts rows by product when the product header is toggled', () => {
    renderPage();
    const productOrder = () =>
      screen.getAllByText(/^(Americano|Croissant)$/).map((el) => el.textContent);
    // default = server order (Americano, then Croissant)
    expect(productOrder()).toEqual(['Americano', 'Croissant']);
    const header = screen.getByRole('button', { name: /product/i });
    fireEvent.click(header); // asc
    expect(productOrder()).toEqual(['Americano', 'Croissant']);
    fireEvent.click(header); // desc
    expect(productOrder()).toEqual(['Croissant', 'Americano']);
  });

  it('reveals movement detail (origin, user, ref_no, group) when a row is expanded', () => {
    renderPage();
    const expandButtons = screen.getAllByRole('button', { name: /Expand movement detail/i });
    fireEvent.click(expandButtons[0]!);
    // The first row (Americano sale) detail surfaces.
    expect(screen.getByText('Sale · order ORD-0042')).toBeInTheDocument(); // origin
    expect(screen.getByText('SL26051200000001')).toBeInTheDocument();      // ref_no
    expect(screen.getByText('Jane')).toBeInTheDocument();                  // user
    expect(screen.getByText('Beverage')).toBeInTheDocument();             // product group
  });

  it('renders the filter bar and CSV export', () => {
    renderPage();
    expect(screen.queryByLabelText(/Section/i)).toBeNull();
    expect(screen.getByLabelText(/Item/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/From/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^To$/i)).toBeInTheDocument();
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
  });
});
