// apps/backoffice/src/pages/reports/__tests__/SalesByTablePage.smoke.test.tsx
//
// « Sales by Table » — ce que la page promet et qui ne doit pas se perdre :
//
//  · LA MATRICE EST EN COMMANDES (arbitrage) — le CA vit dans le tooltip et
//    le Pareto ;
//  · LE PÉRIMÈTRE EST HONNÊTE — la réserve dit l'exclusion des dine-in sans
//    table (cas non autorisé) ;
//  · LES COUVERTS SE JOIGNENT PAR NOM — une table hors plan de salle montre
//    des seats vides, jamais des ventes perdues ;
//  · ROTATION ET CA/SIÈGE se recalculent des chiffres servis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 350k / 4 commandes / 2 tables ; A tourne dimanche.
const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    revenue: 350_000, revenue_prev: 50_000, orders: 4, orders_prev: 1,
    tables_used: 2, active_tables: 11, active_seats: 42,
  },
  by_table: [
    { table_number: 'T-01', seats: 4, orders: 3, revenue: 260_000,
      avg_ticket: 86_667, revenue_prev: 50_000 },
    { table_number: 'Patio-9', seats: null, orders: 1, revenue: 90_000,
      avg_ticket: 90_000, revenue_prev: 0 },
  ],
  by_table_dow: [
    { table_number: 'T-01', dow: 7, orders: 2, revenue: 200_000 },
    { table_number: 'T-01', dow: 1, orders: 1, revenue: 60_000 },
    { table_number: 'Patio-9', dow: 1, orders: 1, revenue: 90_000 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    revenue: 0, revenue_prev: 0, orders: 0, orders_prev: 0,
    tables_used: 0, active_tables: 11, active_seats: 42,
  },
  by_table: [],
  by_table_dow: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_table_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SalesByTablePage from '@/pages/reports/SalesByTablePage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2027-01-01&end=2027-01-31') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-table${search}`]}>
        <SalesByTablePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // On seede la permission d'export : ce fichier teste le CÂBLAGE, pas le RBAC.
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  reportPayload = REPORT_DATA;
});

describe('SalesByTablePage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Sales by Table/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_sales_by_table_v1 with the period bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_table_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2027-01-01');
      expect(args.p_end_date).toBe('2027-01-31');
    });
  });

  it('derives rotation and revenue per seat from the served figures', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-rotation', 'kpi-tables', 'kpi-ticket', 'kpi-per-seat']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-revenue')).toHaveTextContent(/350 rb/);
    // 4 commandes / 2 tables / 31 jours = 0,06… → 0,1.
    expect(within(band).getByTestId('kpi-rotation')).toHaveTextContent('0,1');
    expect(within(band).getByTestId('kpi-tables')).toHaveTextContent('2 / 11');
    // 350k / 42 sièges = 8 333 → Rp 8,33 rb.
    expect(within(band).getByTestId('kpi-per-seat')).toHaveTextContent(/8,33 rb/);
  });

  it('states the floor-only reserve — table-less dine-ins are excluded', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/table-less dine-in.*disallowed/i);
    expect(caveat).toHaveTextContent(/order counts/i);
  });

  it('renders the weekday matrix in ORDER COUNTS with revenue in the tooltip', async () => {
    renderPage();
    await screen.findAllByText('T-01');
    const panel = screen.getByTestId('table-dow-matrix');
    expect(panel).toHaveTextContent('Mon');
    expect(panel).toHaveTextContent('Sun');
    // La cellule du dimanche de T-01 porte 2 commandes et le CA en tooltip.
    const cell = within(panel).getByTitle(/T-01 · Sun: 2 orders/);
    expect(cell).toHaveTextContent('2');
    expect(cell.getAttribute('title')).toMatch(/200\.000/);
  });

  it('joins seats by name and never drops an off-plan table', async () => {
    renderPage();
    await screen.findAllByText('Patio-9');
    const panel = screen.getByTestId('table-table');
    const rows = within(panel).getAllByRole('row');
    const patio = rows.find((r) => r.textContent?.includes('Patio-9'));
    expect(patio).toBeDefined();
    // Table hors plan de salle : ventes visibles, seats et CA/siège à blanc.
    expect(patio).toHaveTextContent('—');
    expect(patio).toHaveTextContent(/90\.000/);
  });

  it('offers the CSV export per table, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when no table order exists', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No dine-in order carrying a table number/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('table-table')).toBeNull();
  });
});
