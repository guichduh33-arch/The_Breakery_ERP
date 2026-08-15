// apps/backoffice/src/pages/reports/__tests__/PaymentByMethodPage.smoke.test.tsx
//
// S30 Wave 4.3 — smoke de PaymentByMethodPage.
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce fichier tient, en plus du rendu :
//
//  · LE SPLIT-TENDER EST VISIBLE — `total_count` et `total_orders` étaient
//    câblés côté hook (lot A1, F-06) et affichés nulle part ; 85 paiements pour
//    80 commandes, ce n'est pas la même chose ;
//  · les frais informatifs (ADR-006 déc. 9) restent en colonnes ;
//  · la tendance est en barres empilées, pas en aire.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_payments_by_method_v3') {
        // Real RPC shape: { period, summary, by_method, by_day }.
        return Promise.resolve({
          data: {
            period:  { start: args.p_date_start, end: args.p_date_end },
            summary: {
              total_amount: 3_500_000, total_count: 85, total_orders: 80,
              total_fees_est: 17_000, total_net_est: 3_483_000,
            },
            by_method: [
              { method: 'cash',   amount: 2_000_000, count: 45, share_pct: 57.14, fee_pct: 0,   fee_est: 0,      net_est: 2_000_000 },
              { method: 'qris',   amount: 1_000_000, count: 28, share_pct: 28.57, fee_pct: 0.7, fee_est: 7_000,  net_est: 993_000 },
              { method: 'gopay',  amount:   500_000, count: 12, share_pct: 14.29, fee_pct: 2,   fee_est: 10_000, net_est: 490_000 },
            ],
            by_day: [
              { day: '2026-06-01', cash: 1_000_000, qris: 500_000, gopay: 250_000, total: 1_750_000 },
              { day: '2026-06-02', cash: 1_000_000, qris: 500_000, gopay: 250_000, total: 1_750_000 },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import PaymentByMethodPage from '@/pages/reports/PaymentByMethodPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-06-01&end=2026-06-07') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/payment-by-method${search}`]}>
        <PaymentByMethodPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('PaymentByMethodPage (smoke)', () => {
  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Payment by Method/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_payments_by_method_v3 with p_date_start and p_date_end', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_payments_by_method_v3');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toBe('2026-06-01');
      expect(args.p_date_end).toBe('2026-06-07');
    });
  });

  it('renders all payment method rows once data loads', async () => {
    renderPage();
    await screen.findByText('cash');
    const table = screen.getByTestId('pbm-method-detail');
    expect(within(table).getByText('cash')).toBeInTheDocument();
    expect(within(table).getByText('qris')).toBeInTheDocument();
    expect(within(table).getByText('gopay')).toBeInTheDocument();
  });

  // Lot C (ADR-006 déc. 9) — frais informatifs : colonnes Fee / Fee est. / Net est.
  it('renders fee and net-estimate columns from the v3 payload', async () => {
    renderPage();
    expect(await screen.findByText('0.7%')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fee est.' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Net est.' })).toBeInTheDocument();
    // Ligne gopay : 2 % de 500 000 = 10 000 de frais, net 490 000.
    expect(screen.getByText(/490\.000/)).toBeInTheDocument();
  });

  it('LE SPLIT-TENDER EST VISIBLE : 85 paiements pour 80 commandes', async () => {
    renderPage();
    await screen.findByTestId('kpi-payments');
    const band = screen.getByTestId('report-kpi-band');
    expect(within(band).getByTestId('kpi-payments')).toHaveTextContent('85');
    expect(within(band).getByTestId('kpi-orders')).toHaveTextContent('80');
    expect(within(band).getByTestId('kpi-per-order')).toHaveTextContent('1,06');
    const card = screen.getByTestId('breakdown-methods');
    expect(within(card).getByText(/85 payments across 80 orders/)).toBeInTheDocument();
  });

  it('un seul graphe, en barres empilees', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Daily collections stacked by payment method/ });
    expect(screen.getByTestId('chart-payments-by-day')).toBeInTheDocument();
    expect(
      screen.getAllByRole('img', { name: /Daily collections stacked by payment method/ }),
    ).toHaveLength(1);
  });

  it('shows export CSV and PDF under the menu once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });
});
