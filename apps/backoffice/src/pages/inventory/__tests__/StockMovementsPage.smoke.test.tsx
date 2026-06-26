// apps/backoffice/src/pages/inventory/__tests__/StockMovementsPage.smoke.test.tsx
// 2026-06-18 — stock-card ledger rewrite. Covers: header + KPI tiles, ledger rows
// (running balance layout), filter bar, CSV export. Mocks useStockLedger +
// useMovementAggregates + useSections.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import type { StockLedgerLine } from '@/features/inventory-movements/hooks/useStockLedger.js';

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
  const actual = await importOriginal<typeof import('@/features/inventory-movements/hooks/useStockLedger.js')>();
  return {
    ...actual,
    useStockLedger: () => ({
      data: { lines: MOCK_LINES, truncated: false, row_count: MOCK_LINES.length },
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@/features/inventory-movements/hooks/useMovementAggregates.js', () => ({
  useMovementAggregates: () => ({
    data: [
      { movement_type: 'sale',     count: 10, qty_total: -20, value_total: 0 },
      { movement_type: 'purchase', count: 3,  qty_total:  72, value_total: 360000 },
    ],
    isLoading: false, error: null,
  }),
}));

vi.mock('@/features/inventory-transfers/hooks/useSections.js', () => ({
  useSections: () => ({
    data: [{ id: 's-1', code: 'KIT', name: 'Kitchen', kind: 'production', display_order: 1 }],
    isLoading: false, error: null,
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><StockMovementsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockMovementsPage (stock-card rewrite)', () => {
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
    expect(screen.getByLabelText(/Section/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/From/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^To$/i)).toBeInTheDocument();
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
  });
});
