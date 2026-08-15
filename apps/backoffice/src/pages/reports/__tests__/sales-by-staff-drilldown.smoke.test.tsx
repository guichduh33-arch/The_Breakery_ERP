// apps/backoffice/src/pages/reports/__tests__/sales-by-staff-drilldown.smoke.test.tsx
//
// S31 — le drill-down de la cellule « Staff » vers la fiche utilisateur.
//
// Lot D (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 et gagne la COMPARAISON qu'elle n'avait pas. Ce fichier tient les deux :
// le drill-down d'origine, et les propriétés de l'archétype — appariement par
// `staff_id` (jamais par rang), part de chaque vendeur, export sous menu.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSalesByStaff = vi.fn();

vi.mock('@/features/reports/hooks/useSalesByStaff.js', () => ({
  useSalesByStaff: (...a: unknown[]): unknown => mockUseSalesByStaff(...a),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: vi.fn() } }));

import SalesByStaffPage from '../SalesByStaffPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const START = '2026-06-01';
const END   = '2026-06-07';

const ROWS = [
  { staff_id: 'u-1', staff_name: 'Alice Cashier', total: 1_500_000, order_count: 25, avg_basket: 60_000 },
  { staff_id: 'u-2', staff_name: 'Bob Cashier',   total:   500_000, order_count: 10, avg_basket: 50_000 },
];
// La période précédente rend les MÊMES personnes dans l'ordre INVERSE : si
// l'appariement se faisait par rang, Alice se comparerait à Bob.
const PREV_ROWS = [
  { staff_id: 'u-2', staff_name: 'Bob Cashier',   total: 900_000, order_count: 18, avg_basket: 50_000 },
  { staff_id: 'u-1', staff_name: 'Alice Cashier', total: 100_000, order_count:  5, avg_basket: 20_000 },
];

function ok<T>(data: T) {
  return { data, isLoading: false, error: null };
}

function seed(current: unknown = ok(ROWS)) {
  mockUseSalesByStaff.mockImplementation((s: string) => (s === START ? current : ok(PREV_ROWS)));
}

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-staff${search}`]}>
        <SalesByStaffPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  seed();
});

describe('SalesByStaffPage — archétype Report + drill-down (S31)', () => {
  it('staff cell renders a link with the /backoffice/users/:id href', () => {
    renderPage();
    const table = screen.getByTestId('sbs-staff-detail');
    const link = within(table).getByRole('link', { name: /Alice Cashier/ });
    expect(link.getAttribute('href')).toBe('/backoffice/users/u-1');
  });

  it('la carte de part ouvre les COMMANDES servies, pas la fiche', () => {
    renderPage();
    const card = screen.getByTestId('breakdown-staff');
    const link = within(card).getByRole('link', { name: /Alice Cashier/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/backoffice/orders');
    expect(href).toContain('served_by=u-1');
    expect(href).toContain(`start=${START}`);
    expect(within(card).getByText('75%')).toBeInTheDocument();
  });

  it('bande KPI : revenu en héro avec comparaison, tête de classement sans delta', () => {
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-orders', 'kpi-avg-basket', 'kpi-staff-count', 'kpi-top-staff']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 2 jt contre 1 jt la période d'avant → hausse, dite en toutes lettres.
    expect(within(screen.getByTestId('kpi-revenue')).getByText(/^up /)).toBeInTheDocument();
    const top = within(band).getByTestId('kpi-top-staff');
    expect(within(top).getByText('Alice Cashier')).toBeInTheDocument();
    expect(within(top).getByText('75,0% of revenue')).toBeInTheDocument();
    expect(within(top).queryByText(/versus prev/)).toBeNull();
    expect(within(band).getAllByText(/versus prev/)).toHaveLength(4);
  });

  it('un seul graphe, et la seconde série n’apparaît qu’avec le bouton Compare', () => {
    renderPage();
    expect(screen.getByTestId('chart-revenue-by-staff')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Revenue per staff member/ })).toHaveLength(1);
    // Compare éteint : l'étiquette du graphe ne promet aucune comparaison.
    expect(screen.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('img', { name: /compared with the previous period/ })).toBeNull();

    fireEvent.click(screen.getByTestId('compare-toggle'));
    expect(screen.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /compared with the previous period/ })).toBeInTheDocument();
  });

  it('toolbar : période, compare, export sous menu (CSV + PDF), pas de Print', () => {
    renderPage();
    expect(screen.getByTestId('period-control')).toBeInTheDocument();
    expect(screen.queryByTestId('print-report')).toBeNull();
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('période sans vente : EmptyState, pas de table', () => {
    seed(ok([]));
    renderPage();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.queryByTestId('sbs-staff-detail')).toBeNull();
  });

  it('erreur RPC : bannière role=alert unifiée', () => {
    seed({ data: undefined, isLoading: false, error: new Error('boom') });
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent('boom');
    expect(screen.queryByTestId('sbs-staff-detail')).toBeNull();
  });
});
