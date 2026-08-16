// apps/backoffice/src/pages/reports/__tests__/RefundsVoidsPage.smoke.test.tsx
//
// « Refunds & Voids » — ce que la page promet et qui ne doit pas se perdre :
//
//  · TROIS FLUX JAMAIS CONFONDUS — void + partiel = remboursé, et les lignes
//    annulées avant paiement vivent dans leur panneau, jamais dans le remboursé ;
//  · LA DOUBLE SIGNATURE est affichée (saisi par / autorisé par), et le cash
//    remboursé porte son badge — il se recompte au tiroir ;
//  · LES VENTILATIONS SE RECALCULENT depuis les événements — la carte motifs
//    recoupe la table ;
//  · LES FILTRES NE TOUCHENT QUE LA TABLE — la bande de KPI dit toujours la
//    période entière, et le pied de table se requalifie en « Filtered total ».

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 145k = 1 void (45k) + 1 partiel (100k) ;
// méthodes cash 60k + QRIS 40k + QRIS 45k ; motifs input_error 100k / duplicate 45k.
const REPORT_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    refunded: 145_000, refunded_prev: 100_000,
    refund_count: 2, void_count: 1, void_amount: 45_000,
    partial_count: 1, partial_amount: 100_000, tax_refunded: 13_182,
    gross_sales: 10_000_000, gross_sales_prev: 9_000_000,
    cancelled: { lines: 3, value: 45_000 },
  },
  events: [
    { id: 'r1', refund_number: 'RF-0001', order_id: 'o1', order_number: '#0101',
      created_at: '2026-06-10T10:00:00+08:00', business_date: '2026-06-10',
      is_full_void: false, reason: 'Erreur de saisie caissier', reason_family: 'input_error',
      tax_refunded: 9_091, total: 100_000,
      refunded_by: { id: 'u1', name: 'Ayu' }, authorized_by: { id: 'u9', name: 'Mamat' },
      payments: [{ method: 'cash', amount: 60_000 }, { method: 'qris', amount: 40_000 }] },
    { id: 'r2', refund_number: 'RF-0002', order_id: 'o2', order_number: '#0102',
      created_at: '2026-06-14T15:00:00+08:00', business_date: '2026-06-14',
      is_full_void: true, reason: 'double payment detected', reason_family: 'duplicate',
      tax_refunded: 4_091, total: 45_000,
      refunded_by: { id: 'u2', name: 'Dewi' }, authorized_by: { id: 'u9', name: 'Mamat' },
      payments: [{ method: 'qris', amount: 45_000 }] },
  ],
  cancelled_by_product: [
    { product_id: 'p1', name: 'Croissant', line_count: 3, value: 45_000,
      top_reason: 'erreur de saisie', top_cashier: { id: 'u1', name: 'Ayu', count: 2 } },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    refunded: 0, refunded_prev: 0, refund_count: 0, void_count: 0, void_amount: 0,
    partial_count: 0, partial_amount: 0, tax_refunded: 0,
    gross_sales: 10_000_000, gross_sales_prev: 9_000_000,
    cancelled: { lines: 0, value: 0 },
  },
  events: [],
  cancelled_by_product: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_refunds_report_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import RefundsVoidsPage from '@/pages/reports/RefundsVoidsPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-06-01&end=2026-06-30') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/refunds-voids${search}`]}>
        <RefundsVoidsPage />
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

describe('RefundsVoidsPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Refunds & Voids/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_refunds_report_v1 with the business-day bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_refunds_report_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
    });
  });

  it('renders the KPI band — rate, voids, cancelled lines beside the money', async () => {
    renderPage();
    await screen.findByTestId('kpi-refunded');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-refunded', 'kpi-rate', 'kpi-voids', 'kpi-cancelled', 'kpi-top-reason',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // 145 000 / 10 000 000 = 1,45 % — et la précédente à 1,11 %.
    expect(within(band).getByTestId('kpi-rate')).toHaveTextContent('1,45%');
    expect(within(band).getByTestId('kpi-rate')).toHaveTextContent(/1,11%/);
    // Les lignes annulées disent « no money out », jamais un remboursé.
    expect(within(band).getByTestId('kpi-cancelled')).toHaveTextContent(/no money out/i);
    expect(within(band).getByTestId('kpi-top-reason')).toHaveTextContent('Input error');
  });

  it('states the three-flow reserve', async () => {
    renderPage();
    await screen.findAllByText('RF-0001');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/Three distinct flows/i);
    expect(caveat).toHaveTextContent(/no money out/i);
    expect(caveat).toHaveTextContent(/signed twice/i);
  });

  it('shows the double signature and the cash badge on the events table', async () => {
    renderPage();
    await screen.findAllByText('RF-0001');
    const table = within(screen.getByTestId('rv-events-table')).getByRole('table');
    const row = within(table).getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('RF-0001'));
    expect(row).toBeDefined();
    expect(row!).toHaveTextContent('Ayu');
    expect(row!).toHaveTextContent('Mamat');
    expect(row!).toHaveTextContent('Cash');
    // Le n° de commande est un lien vers la commande.
    expect(within(row!).getByRole('link', { name: '#0101' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/orders'));
  });

  it('reconciles the reason breakdown with the table (client-side derivation)', async () => {
    renderPage();
    await screen.findAllByText('RF-0001');
    const card = screen.getByTestId('breakdown-reasons');
    expect(card).toHaveTextContent('Input error');
    expect(card).toHaveTextContent('Duplicate payment');
    // 100k + 45k = le total remboursé de la bande (rendu IDR compact).
    expect(card).toHaveTextContent(/145 rb/);
  });

  it('filters the TABLE only — the KPI band keeps the full period', async () => {
    renderPage();
    await screen.findAllByText('RF-0001');
    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'void' } });
    const table = within(screen.getByTestId('rv-events-table')).getByRole('table');
    expect(within(table).queryByText('RF-0001')).toBeNull();
    expect(within(table).getByText('RF-0002')).toBeInTheDocument();
    expect(table).toHaveTextContent('Filtered total');
    // La bande dit toujours la période entière.
    expect(within(screen.getByTestId('report-kpi-band')).getByTestId('kpi-refunded'))
      .toHaveTextContent(/145/);
  });

  it('keeps cancelled lines in their own panel, never inside refunded', async () => {
    renderPage();
    await screen.findAllByText('RF-0001');
    const panel = screen.getByTestId('rv-cancelled-table');
    expect(panel).toHaveTextContent('Croissant');
    expect(panel).toHaveTextContent('Ayu (2)');
    expect(panel).toHaveTextContent(/no money out/i);
  });

  it('offers the CSV export, and no PDF (no template registered)', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing was refunded nor cancelled', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No refund, void or pre-payment cancellation/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('rv-events-table')).toBeNull();
  });
});
