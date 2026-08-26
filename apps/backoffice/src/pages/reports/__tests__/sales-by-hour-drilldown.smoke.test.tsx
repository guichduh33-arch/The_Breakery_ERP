// apps/backoffice/src/pages/reports/__tests__/sales-by-hour-drilldown.smoke.test.tsx
//
// Session 32 / Wave 3.J — le drill-down par heure : chaque créneau non vide
// ouvre `/backoffice/orders?hour=N&start=<jour>&end=<jour>`.
//
// Lot D (campagne Reports 2026-08-15) — le fichier tient désormais l'archétype
// Report de la page : bande KPI (le pic ne porte pas de variation, il porte une
// note), graphe unique, carte des heures les plus fortes, et l'export sous
// menu. Le drill-down d'origine est conservé tel quel — c'est l'acquis que la
// migration ne devait pas perdre.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSalesByHour = vi.fn();

vi.mock('@/features/reports/hooks/useSalesByHour.js', () => ({
  useSalesByHour: (...a: unknown[]): unknown => mockUseSalesByHour(...a),
}));
// Le graphe est importé transitivement ; supabase ne doit jamais être appelé.
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: vi.fn() } }));

import SalesByHourPage from '../SalesByHourPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const DAY = '2026-06-07';

const ROWS = [
  { hour: 9,  total: 100_000, order_count: 2 },
  { hour: 12, total: 500_000, order_count: 5 },
  { hour: 14, total: 0,       order_count: 0 },
];
const PREV_ROWS = [
  { hour: 9,  total: 80_000,  order_count: 2 },
  { hour: 12, total: 320_000, order_count: 4 },
];

function ok<T>(data: T) {
  return { data, isLoading: false, error: null };
}

function seed(current: unknown = ok(ROWS)) {
  mockUseSalesByHour.mockImplementation((d: string) => (d === DAY ? current : ok(PREV_ROWS)));
}

function renderPage(search = `?start=${DAY}&end=${DAY}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-hour${search}`]}>
        <SalesByHourPage />
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

describe('SalesByHourPage — archétype Report + drill-down horaire', () => {
  it('T1 per-hour table renders DrilldownLink for each non-empty hour', () => {
    renderPage();
    const table = screen.getByTestId('sbh-hour-detail');
    const link9  = within(table).getByRole('link', { name: '09:00' });
    const link12 = within(table).getByRole('link', { name: '12:00' });
    const href9 = link9.getAttribute('href') ?? '';
    expect(href9).toContain('/backoffice/orders');
    expect(href9).toContain('hour=9');
    expect(href9).toContain(`start=${DAY}`);
    expect(href9).toContain(`end=${DAY}`);
    expect(link12.getAttribute('href') ?? '').toContain('hour=12');
    // L'heure vide n'a pas de ligne : elle n'a rien à ouvrir.
    expect(within(table).queryByText('14:00')).toBeNull();
  });

  it('fil d’Ariane, h1 et ligne méta qui nomme la journée lue', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('Sales');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sales by Hour');
    // `selector: 'p'` — la ligne méta est le `<p>` du bandeau. Le même texte
    // vit désormais AUSSI dans la région live `sr-only` de `ReportShell` (un
    // `<span>`), qui est ce qui annonce l'arrivée des nouveaux chiffres après
    // un changement de période : on désigne la ligne VISIBLE, pas l'annonce.
    expect(screen.getByText(/Sunday, 7 June 2026/, { selector: 'p' })).toBeInTheDocument();
  });

  it('fenêtre multi-jours : la ligne méta dit que seul le dernier jour est lu', () => {
    renderPage('?start=2026-06-01&end=2026-06-07');
    expect(
      screen.getByText(/last day of the selected period/, { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('bande KPI : revenu en héro avec sa variation, pic sans variation mais avec sa note', () => {
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-orders', 'kpi-avg-basket', 'kpi-peak-hour', 'kpi-trading-hours']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 600.000 contre 400.000 la veille → hausse annoncée en toutes lettres.
    expect(within(screen.getByTestId('kpi-revenue')).getByText(/^up /)).toBeInTheDocument();
    // Le pic est une HEURE : aucune variation ne s'y applique, une note la
    // remplace. Trois tuiles comparées, pas cinq.
    const peak = screen.getByTestId('kpi-peak-hour');
    expect(within(peak).getByText('12:00')).toBeInTheDocument();
    expect(within(peak).queryByText(/versus prev day/)).toBeNull();
    expect(within(band).getAllByText(/versus prev day/)).toHaveLength(3);
    // Deux créneaux ont vendu sur les 24.
    expect(within(screen.getByTestId('kpi-trading-hours')).getByText('2')).toBeInTheDocument();
  });

  it('graphe unique + carte des heures les plus fortes, avec leur part', () => {
    renderPage();
    expect(screen.getByTestId('chart-revenue-by-hour')).toBeInTheDocument();
    const card = screen.getByTestId('breakdown-busiest-hours');
    expect(within(card).getByRole('link', { name: '12:00' })).toBeInTheDocument();
    expect(within(card).getByText('83%')).toBeInTheDocument();
    // Un seul graphe sur la page.
    expect(screen.getAllByRole('img', { name: /Revenue per hour/ })).toHaveLength(1);
  });

  it('toolbar : période + compare + export sous menu, pas de bouton Print', () => {
    renderPage();
    expect(screen.getByTestId('period-control')).toBeInTheDocument();
    expect(screen.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('print-report')).toBeNull();

    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('sans la permission reports.export, le bouton est DÉSACTIVÉ et dit pourquoi', () => {
    useAuthStore.setState({ permissions: [] });
    renderPage();
    const btn = screen.getByTestId('export-menu');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the reports.export permission.');
  });

  it('journée sans vente : EmptyState, aucune table de détail', () => {
    seed(ok([{ hour: 0, total: 0, order_count: 0 }]));
    renderPage();
    expect(screen.getByText('No orders')).toBeInTheDocument();
    expect(screen.queryByTestId('sbh-hour-detail')).toBeNull();
  });

  it('erreur RPC : bannière role=alert unifiée, corps non rendu', () => {
    seed({ data: undefined, isLoading: false, error: new Error('permission_denied') });
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent(
      'You do not have permission to view this report.',
    );
    expect(screen.queryByTestId('sbh-hour-detail')).toBeNull();
  });

  it('chargement : squelettes de la bande, aucun « Rp 0 » affirmé', () => {
    seed({ data: undefined, isLoading: true, error: null });
    renderPage();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(5);
    expect(screen.queryByTestId('kpi-revenue')).toBeNull();
  });
});
