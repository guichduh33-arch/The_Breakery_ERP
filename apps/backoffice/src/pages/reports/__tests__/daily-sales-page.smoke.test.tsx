// apps/backoffice/src/pages/reports/__tests__/daily-sales-page.smoke.test.tsx
//
// Lot C (campagne Reports 2026-08-15) — la page flagship réécrite sur le socle
// du lot B. Ce que ce test tient, au-delà du « ça rend » :
//
//  · la bande de SIX tuiles de la maquette 4c, avec la tuile héro Net revenue ;
//  · CHAQUE tuile porte sa comparaison — donc la période de comparaison est
//    bien requêtée, et une comparaison impossible sort en tiret, pas en 0 % ;
//  · `variance_total` NULL se lit « not closed yet » et JAMAIS « Rp 0 » ;
//  · les deux acquis que la maquette n'a pas : annotation des jours fériés et
//    drill-down par jour, conservés dans le bloc de détail.
//
// 2026-08-21 — la ligne de RAPPROCHEMENT de la carte Payments (bump v3). Deux
// comportements, et le second compte autant que le premier : elle se rend quand
// `on_account_total > 0`, elle DISPARAÎT quand il vaut 0. Une ligne toujours
// rendue afficherait « + Rp 0 settled on account » sur une période sans compte
// client, et affirmerait une cause le jour où l'écart en aurait une autre.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseDailySales      = vi.fn();
const mockUseSalesByCategory = vi.fn();
const mockUsePaymentsByMethod = vi.fn();
const mockUseSalesByStaff    = vi.fn();
const mockUseGrossMargin     = vi.fn();
const mockUseHolidaysList    = vi.fn();

vi.mock('@/features/reports/hooks/useDailySales.js', () => ({
  useDailySales: (...a: unknown[]): unknown => mockUseDailySales(...a),
}));
vi.mock('@/features/reports/hooks/useSalesByCategory.js', () => ({
  useSalesByCategory: (...a: unknown[]): unknown => mockUseSalesByCategory(...a),
}));
vi.mock('@/features/reports/hooks/usePaymentsByMethod.js', () => ({
  usePaymentsByMethod: (...a: unknown[]): unknown => mockUsePaymentsByMethod(...a),
}));
vi.mock('@/features/reports/hooks/useSalesByStaff.js', () => ({
  useSalesByStaff: (...a: unknown[]): unknown => mockUseSalesByStaff(...a),
}));
vi.mock('@/features/reports/hooks/useGrossMargin.js', () => ({
  useGrossMargin: (...a: unknown[]): unknown => mockUseGrossMargin(...a),
}));
// `holidayNameFor` est un helper PUR du même module : il traverse le mock tel
// quel, sinon le test de l'annotation des jours fériés ne vérifierait plus que
// son propre doublon.
type HolidayNameFor = (h: unknown, iso: string) => string | null;
vi.mock('@/features/settings/hooks/useHolidays.js', async (orig) => {
  const actual = await orig<{ holidayNameFor: HolidayNameFor }>();
  return {
    holidayNameFor:  actual.holidayNameFor,
    useHolidaysList: (): unknown => mockUseHolidaysList(),
  };
});

// Le graphe est importé transitivement ; supabase ne doit jamais être appelé.
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: vi.fn() } }));

import DailySalesPage from '@/pages/reports/DailySalesPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// Période FIGÉE par l'URL : `useReportPeriod` la lit telle quelle, et
// `previousPeriod` en dérive 2026-05-25 → 2026-05-31 (7 jours décalés).
const START = '2026-06-01';
const END   = '2026-06-07';
const CMP_START = '2026-05-25';

const CURRENT = {
  period:  { start: START, end: END },
  summary: {
    total: 8_610_000, order_count: 247, aov: 34_100,
    refund_total: 150_000, net: 8_420_000,
    discount_total: 412_000, discount_orders_count: 31,
    voids_count: 4, voids_value: 36_000,
    // Bump v3 — invariant serveur : total = tendered_total + on_account_total,
    // order_count = tendered_order_count + on_account_order_count.
    tendered_total: 7_610_000, tendered_order_count: 233,
    on_account_total: 1_000_000, on_account_order_count: 14,
  },
  by_day: [
    { date: '2026-06-01', order_count: 120, gross: 4_300_000, refunds: 100_000, net: 4_200_000, aov: 35_000 },
    { date: '2026-06-02', order_count: 127, gross: 4_310_000, refunds:  50_000, net: 4_220_000, aov: 33_228 },
  ],
  sessions: [
    {
      id: 's-1', cashier: 'Dewi', opened_at: '2026-06-01T06:30:00Z',
      opening_cash: 500_000, status: 'open', closed_at: null, variance_total: null,
    },
    {
      id: 's-2', cashier: 'Adi', opened_at: '2026-05-31T06:30:00Z',
      opening_cash: 300_000, status: 'closed', closed_at: '2026-05-31T18:00:00Z',
      variance_total: -12_000,
    },
  ],
};

const PREVIOUS = {
  ...CURRENT,
  period: { start: CMP_START, end: '2026-05-31' },
  summary: {
    total: 7_500_000, order_count: 220, aov: 32_000,
    refund_total: 100_000, net: 7_400_000,
    discount_total: 300_000, discount_orders_count: 20,
    voids_count: 2, voids_value: 20_000,
    tendered_total: 7_500_000, tendered_order_count: 220,
    on_account_total: 0, on_account_order_count: 0,
  },
  by_day: [
    { date: CMP_START, order_count: 100, gross: 3_700_000, refunds: 0, net: 3_700_000, aov: 37_000 },
  ],
  sessions: [],
};

function ok<T>(data: T) {
  return { data, isLoading: false, error: null };
}

function seedHooks(current: unknown = ok(CURRENT)) {
  mockUseDailySales.mockImplementation((p: { start: string }) =>
    (p.start === START ? current : ok(PREVIOUS)));
  mockUseSalesByCategory.mockReturnValue(ok([
    { category_id: 'c1', category_name: 'Viennoiserie', total: 2_610_000, qty: 180 },
    { category_id: 'c2', category_name: 'Bread',        total: 2_020_000, qty: 140 },
  ]));
  mockUsePaymentsByMethod.mockReturnValue(ok({
    lines: [
      { method: 'qris', amount: 3_450_000, count: 110, share_pct: 41, fee_pct: 0, fee_est: 0, net_est: 3_450_000 },
      { method: 'cash', amount: 3_200_000, count: 100, share_pct: 38, fee_pct: 0, fee_est: 0, net_est: 3_200_000 },
    ],
    byDay: [], total: 8_420_000, totalFees: 0, totalNet: 8_420_000,
    totalCount: 260, totalOrders: 247,
    period: { start: START, end: END },
  }));
  mockUseSalesByStaff.mockReturnValue(ok([
    { staff_id: 'u1', staff_name: 'Dewi', total: 3_960_000, order_count: 118, avg_basket: 33_559 },
  ]));
  mockUseGrossMargin.mockReturnValue(ok({
    period: { start: START, end: END },
    summary: { revenue: 8_610_000, cogs: 3_000_000, margin: 5_610_000, margin_pct: 65 },
    by_product: [
      { product_id: 'p1', name: 'Croissant beurre', category_name: null, qty: 86, revenue: 1_290_000, cogs: 0, margin: 0, margin_pct: 0 },
      { product_id: 'p2', name: 'Flat white',       category_name: null, qty: 112, revenue: 900_000, cogs: 0, margin: 0, margin_pct: 0 },
    ],
    by_category: [],
  }));
  mockUseHolidaysList.mockReturnValue(ok([
    { id: 'h1', name: 'Idul Adha', date: '2026-06-02', is_recurring: false, deleted_at: null },
  ]));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/daily-sales?start=${START}&end=${END}`]}>
        <DailySalesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  seedHooks();
});

describe('DailySalesPage — archétype Report (maquette 4c)', () => {
  it('rend le fil d’Ariane Reports › Sales, le h1 et la ligne méta', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('Sales');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Daily sales');
    expect(screen.getByText(/2 register sessions/)).toBeInTheDocument();
    expect(screen.getByText(/figures net of refunds/)).toBeInTheDocument();
  });

  it('bande de six tuiles : héro Net revenue + une comparaison sur chacune', () => {
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-net-revenue', 'kpi-gross-revenue', 'kpi-refunds-voids',
      'kpi-orders', 'kpi-avg-basket', 'kpi-discounts',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // « Every figure carries a comparison » : six variations, une par tuile.
    expect(within(band).getAllByText(/versus prev/)).toHaveLength(6);
    // Net 8,42 jt vs 7,4 jt → hausse. Le libellé lu par le lecteur d'écran
    // porte le sens ; le glyphe seul n'est pas une information.
    expect(within(screen.getByTestId('kpi-net-revenue')).getByText(/^up /)).toBeInTheDocument();
    // Sous-notes de la maquette : voids et part des remises.
    expect(within(band).getByText('4 voids')).toBeInTheDocument();
    expect(within(band).getByText(/of gross/)).toHaveTextContent('31 tickets');
  });

  it('comparaison impossible (base nulle) : tiret, jamais « 0,0% »', () => {
    mockUseDailySales.mockImplementation((p: { start: string }) => (
      p.start === START
        ? ok(CURRENT)
        : ok({ ...PREVIOUS, summary: { ...PREVIOUS.summary, net: 0, total: 0, order_count: 0, aov: 0, refund_total: 0, voids_value: 0, discount_total: 0 } })
    ));
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    expect(within(band).getAllByText(/no comparison available/)).toHaveLength(6);
    expect(within(band).queryByText('0,0%')).toBeNull();
  });

  it('les quatre ventilations et le graphe unique sont posés', () => {
    renderPage();
    expect(screen.getByTestId('chart-net-by-day')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-categories')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-products')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-payments')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-cashiers')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-registers')).toBeInTheDocument();
    // La barre de partage vient APRÈS le total dérivé (extension lot C).
    const cat = screen.getByTestId('breakdown-categories');
    expect(within(cat).getByRole('img', { name: 'Share of revenue by category' })).toBeInTheDocument();
    expect(within(cat).getByText('Total')).toBeInTheDocument();
    // Payments : total NOMMÉ venu du serveur, pas une somme des lignes.
    expect(within(screen.getByTestId('breakdown-payments')).getByText('Total collected')).toBeInTheDocument();
  });

  it('Payments : la ligne de rapprochement nomme l’écart entre les deux « Total »', () => {
    renderPage();
    const card  = screen.getByTestId('breakdown-payments');
    const split = within(card).getByTestId('payments-settlement-split');
    // Les trois montants sont RENDUS, pas recalculés : brut, encaissé, en compte.
    expect(split).toHaveTextContent(/8\.610\.000/);
    expect(split).toHaveTextContent(/7\.610\.000/);
    expect(split).toHaveTextContent(/1\.000\.000/);
    expect(split).toHaveTextContent(/14 orders with no payment line/);
    // Elle s'AJOUTE à la note existante, elle ne la remplace pas.
    expect(card).toHaveTextContent(/260 payments across 247 orders/);
  });

  it('Payments : aucun règlement en compte → aucune ligne, et surtout aucun « Rp 0 »', () => {
    seedHooks(ok({
      ...CURRENT,
      summary: {
        ...CURRENT.summary,
        tendered_total:       CURRENT.summary.total,
        tendered_order_count: CURRENT.summary.order_count,
        on_account_total: 0, on_account_order_count: 0,
      },
    }));
    renderPage();
    const card = screen.getByTestId('breakdown-payments');
    expect(within(card).queryByTestId('payments-settlement-split')).toBeNull();
    expect(card).not.toHaveTextContent(/settled on account/);
    // Le pied garde sa note : c'est la ligne de rapprochement qui disparaît,
    // pas le pied entier.
    expect(card).toHaveTextContent(/260 payments across 247 orders/);
  });

  it('Register close : session ouverte → « not closed yet », jamais un écart nul', () => {
    renderPage();
    const card = screen.getByTestId('breakdown-registers');
    expect(within(card).getByText(/not closed yet/)).toBeInTheDocument();
    // Le compteur rend en `font-data` dans son propre <span> (The Mono-Carries-Data
    // Rule) : la phrase est donc découpée en plusieurs nœuds texte. `getByText` ne
    // lit que les nœuds DIRECTS, `toHaveTextContent` traverse les enfants.
    expect(card).toHaveTextContent(/1 register not reconciled/);
    expect(within(card).getByRole('link', { name: 'Open Z-report' }))
      .toHaveAttribute('href', '/backoffice/cash-register/zreports');
    // La session close, elle, montre son écart réel.
    expect(within(card).getByText(/var /)).toBeInTheDocument();
  });

  it('carte top-5 : le total porte le jeu COMPLET et la barre referme ses 100 %', () => {
    // Huit catégories à 1 jt : le total de la carte vaut 8 jt, pas les 5 jt des
    // cinq lignes visibles — un total calculé sur la troncature ment.
    mockUseSalesByCategory.mockReturnValue(ok(
      Array.from({ length: 8 }, (_, i) => ({
        category_id: `c${i}`, category_name: `Cat ${i}`, total: 1_000_000, qty: 10,
      })),
    ));
    renderPage();
    const card = screen.getByTestId('breakdown-categories');
    expect(within(card).getByTitle(/8\.000\.000/)).toBeInTheDocument();
    expect(within(card).queryByTitle(/^Rp 5\.000\.000$/)).toBeNull();
    // Le sous-titre COMPOSE deux énoncés qui ne se remplacent pas : la note de
    // troncature (« on ne montre que 5 des 8 ») et le périmètre de la carte
    // (« ces totaux se somment ligne à ligne »). Un `getByText` exact sur la
    // seule note casserait au premier ajout et, pire, laisserait croire que
    // l'un chasse l'autre. On assert la présence des DEUX.
    const subtitle = within(card).getByText(/Top 5 of 8 by revenue\./);
    expect(subtitle).toHaveTextContent('Top 5 of 8 by revenue.');
    expect(subtitle).toHaveTextContent('does not reconcile with gross revenue');
    // Reliquat agrégé : 5 × 12,5 % montrés, 37,5 % en « Others ».
    const others = within(card).getByText('Others');
    expect(others.closest('li')).toHaveTextContent('38%');
  });

  it('Register close : session FERMÉE sans comptage → « var — », pas « not closed yet »', () => {
    seedHooks(ok({
      ...CURRENT,
      sessions: [{
        id: 's-legacy', cashier: 'Rina', opened_at: '2026-06-01T06:30:00Z',
        opening_cash: 400_000, status: 'closed',
        closed_at: '2026-06-01T18:00:00Z', variance_total: null,
      }],
    }));
    renderPage();
    const card = screen.getByTestId('breakdown-registers');
    expect(within(card).getByText(/var —/)).toBeInTheDocument();
    expect(within(card).queryByText(/not closed yet/)).toBeNull();
    expect(within(card).queryByText(/var Rp 0/)).toBeNull();
    // Toutes fermées : le pied redevient un constat, pas une alerte.
    expect(within(card).getByText(/All sessions of this period are closed/)).toBeInTheDocument();
  });

  it('Register close : au-delà de huit sessions, seules les plus récentes', () => {
    seedHooks(ok({
      ...CURRENT,
      sessions: Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`, cashier: `REG-${i}`, opened_at: `2026-06-0${(i % 7) + 1}T06:30:00Z`,
        opening_cash: 100_000, status: 'closed',
        closed_at: `2026-06-0${(i % 7) + 1}T18:00:00Z`, variance_total: 0,
      })),
    }));
    renderPage();
    const card = screen.getByTestId('breakdown-registers');
    expect(within(card).getAllByRole('listitem')).toHaveLength(8);
    expect(within(card).getByText('Last 8 of 10 sessions.')).toBeInTheDocument();
    expect(within(card).queryByText('REG-0')).toBeNull();
    expect(within(card).queryByText('REG-1')).toBeNull();
    expect(within(card).getByText('REG-9')).toBeInTheDocument();
    // Le flotteur total reste celui des DIX sessions.
    expect(within(card).getByTitle(/1\.000\.000/)).toBeInTheDocument();
  });

  it('bloc de détail : badge de jour férié + drill-down par jour + totaux', () => {
    renderPage();
    const table = screen.getByTestId('daily-sales-table');
    expect(within(table).getByTestId('holiday-badge-2026-06-02')).toHaveTextContent('Idul Adha');
    const link = within(table).getByRole('link', { name: '2026-06-01' });
    expect(link).toHaveAttribute('href', '/backoffice/orders?start=2026-06-01&end=2026-06-01');
    expect(within(table).getByText('Total')).toBeInTheDocument();
  });

  it('toolbar : période, compare, print, export CSV seul (pas de PDF au lot C)', () => {
    renderPage();
    expect(screen.getByTestId('period-control')).toBeInTheDocument();
    expect(screen.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('print-report')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('Print déclenche window.print()', () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    renderPage();
    fireEvent.click(screen.getByTestId('print-report'));
    expect(printSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('erreur de la RPC principale : bannière role=alert, corps non rendu', () => {
    seedHooks({ data: undefined, isLoading: false, error: new Error('permission_denied') });
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent(
      'You do not have permission to view this report.',
    );
    expect(screen.queryByTestId('daily-sales-table')).toBeNull();
    expect(screen.queryByTestId('breakdown-registers')).toBeNull();
  });

  it('période sans vente : EmptyState à la place du corps', () => {
    seedHooks(ok({ ...CURRENT, by_day: [], sessions: [] }));
    renderPage();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-sales-table')).toBeNull();
  });

  it('périmètre ligne-à-ligne : rendu SEUL quand il n’y a pas de troncature', () => {
    // Le cas jumeau du test « Top 5 of 8 » : sans coupe, `topSlice` ne rend
    // aucune note, et le périmètre doit tout de même s'afficher. Sans cette
    // assertion, un `withLineLevelScope` qui ne renverrait la phrase QUE
    // lorsqu'une note existe passerait le reste de la suite au vert — la carte
    // la plus courante du produit perdrait son périmètre en silence.
    seedHooks(ok(CURRENT));
    renderPage();
    for (const testId of ['breakdown-categories', 'breakdown-products']) {
      const card = screen.getByTestId(testId);
      expect(card).toHaveTextContent('does not reconcile with gross revenue');
      expect(card).not.toHaveTextContent('Top 5 of');
    }
  });

  it('chargement : squelettes de la bande, aucun « Rp 0 » affirmé', () => {
    seedHooks({ data: undefined, isLoading: true, error: null });
    renderPage();
    expect(screen.getAllByTestId('kpi-skeleton').length).toBe(6);
    expect(screen.queryByTestId('kpi-net-revenue')).toBeNull();
  });
});
