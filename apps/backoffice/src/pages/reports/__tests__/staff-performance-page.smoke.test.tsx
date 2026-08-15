// apps/backoffice/src/pages/reports/__tests__/staff-performance-page.smoke.test.tsx
// S40 Wave B1 — StaffPerformancePage : titre, lignes, export, état d'erreur.
//
// Lot D (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce que ce fichier tient en plus :
//
//  · la COMPARAISON, ajoutée (le hook accepte n'importe quelle fenêtre) : la
//    période précédente est requêtée, et chaque chiffre porte sa variation ;
//  · les tuiles de CONTRÔLE sont marquées `invert` — des voids qui montent sont
//    une MAUVAISE nouvelle, la couleur suit le sens métier, pas le signe ;
//  · l'export vit sous un menu, et sans `reports.export` il se désactive en
//    disant pourquoi au lieu de disparaître.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseStaffPerformance = vi.fn();

vi.mock('@/features/reports/hooks/useStaffPerformance.js', () => ({
  useStaffPerformance: (...args: unknown[]): unknown => mockUseStaffPerformance(...args),
}));

// Supabase is imported transitively. Provide minimal stub.
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}));

import StaffPerformancePage from '@/pages/reports/StaffPerformancePage.js';
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

const BY_STAFF = [
  {
    staff_id: 'u-1', staff_name: 'Sari',
    orders_served: 45, revenue: 2_700_000, aov: 60_000, items_per_order: 3.2,
    voids_count: 2, voids_value: 120_000,
    refunds_count: 1, refunds_value: 60_000,
    discount_orders_count: 5, discount_value: 75_000,
    items_cancelled: 3,
  },
  {
    staff_id: 'u-2', staff_name: 'Budi',
    orders_served: 38, revenue: 2_200_000, aov: 57_894, items_per_order: 2.9,
    voids_count: 0, voids_value: 0,
    refunds_count: 0, refunds_value: 0,
    discount_orders_count: 3, discount_value: 45_000,
    items_cancelled: 1,
  },
];

// Période précédente : moins de CA, MOINS de voids — la tuile voids doit donc
// annoncer une hausse peinte comme une mauvaise nouvelle.
const PREV_BY_STAFF = [
  {
    ...BY_STAFF[0]!, revenue: 2_000_000, orders_served: 40,
    voids_value: 60_000, voids_count: 1,
    refunds_value: 30_000, discount_value: 50_000,
  },
];

function ok(by_staff: unknown[], period: { start: string; end: string }) {
  return { data: { period, by_staff }, isLoading: false, error: null };
}

function seed(current: unknown = ok(BY_STAFF, { start: START, end: END })) {
  mockUseStaffPerformance.mockImplementation((p: { start: string }) => (
    p.start === START ? current : ok(PREV_BY_STAFF, { start: '2026-05-25', end: '2026-05-31' })
  ));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/staff-performance?start=${START}&end=${END}`]}>
        <StaffPerformancePage />
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

describe('StaffPerformancePage (smoke)', () => {
  it('rend le h1, le fil d’Ariane Operations et les lignes de la table', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Staff Performance/i, level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('Operations');

    const table = screen.getByTestId('staff-performance-table');
    expect(within(table).getByRole('link', { name: 'Sari' }))
      .toHaveAttribute('href', '/backoffice/users/u-1');
    expect(within(table).getByRole('link', { name: 'Budi' })).toBeInTheDocument();
    expect(within(table).getAllByText(/Rp/).length).toBeGreaterThan(0);
  });

  it('interroge la période précédente en plus de la fenêtre courante', () => {
    renderPage();
    const windows = mockUseStaffPerformance.mock.calls.map(([p]) => p as { start: string; end: string });
    expect(windows).toContainEqual({ start: START, end: END });
    expect(windows).toContainEqual({ start: '2026-05-25', end: '2026-05-31' });
  });

  it('bande KPI : six tuiles, et les tuiles de contrôle inversent le sens', () => {
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-orders', 'kpi-aov', 'kpi-voids', 'kpi-refunds', 'kpi-discounts']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getAllByText(/versus prev/)).toHaveLength(6);
    // 120.000 de voids contre 60.000 : une HAUSSE, donc du rouge, pas du vert.
    const voids = screen.getByTestId('kpi-voids');
    expect(within(voids).getByText(/^up /)).toBeInTheDocument();
    expect(voids.querySelector('.text-danger')).not.toBeNull();
    expect(within(voids).getByText('2 voids')).toBeInTheDocument();
    // Le CA monte aussi, mais lui se peint en vert.
    expect(screen.getByTestId('kpi-revenue').querySelector('.text-ink-success')).not.toBeNull();
  });

  it('un seul graphe — les commandes servies — et deux ventilations', () => {
    renderPage();
    expect(screen.getByTestId('chart-orders-by-staff')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Orders served per staff member/ })).toHaveLength(1);
    // Aucun second graphe : les montants restent chiffrés.
    expect(screen.getAllByRole('img')).toHaveLength(1);

    const revenue = screen.getByTestId('breakdown-staff-revenue');
    expect(within(revenue).getByText('55%')).toBeInTheDocument();
    const discounts = screen.getByTestId('breakdown-staff-discounts');
    expect(within(discounts).getByText('5 orders')).toBeInTheDocument();
  });

  it('export CSV sous menu, pas de PDF (aucun gabarit côté EF)', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('sans la permission reports.export : bouton désactivé et motif nommé', () => {
    useAuthStore.setState({ permissions: [] });
    renderPage();
    const btn = screen.getByTestId('export-menu');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the reports.export permission.');
  });

  it('surfaces a role="alert" error element when RPC fails', () => {
    seed({ isLoading: false, error: new Error('RPC error: get_staff_performance_v1 denied'), data: undefined });
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/RPC error/i);
    expect(screen.queryByTestId('staff-performance-table')).toBeNull();
    expect(screen.queryByTestId('export-menu')).toBeInTheDocument();
  });

  it('période sans donnée : EmptyState à la place du corps', () => {
    seed(ok([], { start: START, end: END }));
    renderPage();
    expect(screen.getByText('No performance data')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-performance-table')).toBeNull();
  });
});
