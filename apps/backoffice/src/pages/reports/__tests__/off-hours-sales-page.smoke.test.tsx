// ADR-006 déc. 9 (business hours) — Off-Hours Sales : titre, appel RPC, lignes
// (créneau + jour fermé), total, export CSV.
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : les trois compteurs de synthèse que la RPC sert déjà montent en tuiles
// sobres, l'export passe par le menu unique du bandeau, et les colonnes se
// trient. La SÉMANTIQUE MÉTIER est inchangée — c'est ce que ce test verrouille
// en premier : un jour fermé (open/close à NULL) marque tout et s'affiche
// « Closed », et l'état vide reste une BONNE nouvelle assortie de sa réserve.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OffHoursSalesPage from '@/pages/reports/OffHoursSalesPage.js';
import { useAuthStore } from '@/stores/authStore.js';

const mockRpc = vi.fn();
let emptyPeriod = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_off_hours_sales_v1') {
        if (emptyPeriod) {
          return Promise.resolve({
            data: { summary: { payment_count: 0, order_count: 0, total_amount: 0 }, rows: [] },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            summary: { payment_count: 2, order_count: 1, total_amount: 300_000 },
            rows: [
              {
                order_id: 'o1', order_number: 'ORD-001', method: 'cash', amount: 100_000,
                paid_at: '2026-06-01T15:30:00Z', local_time: '2026-06-01 23:30',
                day_key: 'mon', window_open: '07:00', window_close: '22:00', cashier: 'Ayu',
              },
              {
                order_id: 'o1', order_number: 'ORD-001', method: 'qris', amount: 200_000,
                paid_at: '2026-06-02T02:00:00Z', local_time: '2026-06-02 10:00',
                day_key: 'tue', window_open: null, window_close: null, cashier: null,
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><OffHoursSalesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// L'export est gouverné par `reports.export`. Ce test vérifie le CÂBLAGE de
// l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  emptyPeriod = false;
  mockRpc.mockReset();
});

describe('OffHoursSalesPage (smoke)', () => {
  it('renders the page heading and calls the RPC with a date range', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Off-Hours Sales/i, level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_off_hours_sales_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders one row per flagged payment, window or Closed for a closed day', async () => {
    renderPage();
    const table = await screen.findByTestId('off-hours-table');
    expect(await within(table).findByText('2026-06-01 23:30')).toBeInTheDocument();
    expect(within(table).getByText('07:00–22:00')).toBeInTheDocument();
    // Jour fermé (tue : window à null) → « Closed ».
    expect(within(table).getByText('Closed')).toBeInTheDocument();
    expect(within(table).getByText('Tuesday')).toBeInTheDocument();
    expect(within(table).getByText('Ayu')).toBeInTheDocument();
  });

  it('renders the summary total in the footer and the CSV export once data is available', async () => {
    renderPage();
    expect(await screen.findByText(/2 payments on 1 order/i)).toBeInTheDocument();
    const table = screen.getByTestId('off-hours-table');
    expect(within(table).getByText(/300\.000/)).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('monte les trois compteurs de la RPC en tuiles, sans en inventer un quatrième', async () => {
    renderPage();
    const band = await screen.findByTestId('report-kpi-band');
    await waitFor(() => { expect(screen.getByTestId('kpi-payments')).toBeInTheDocument(); });
    expect(within(band).getByText('Flagged payments')).toBeInTheDocument();
    expect(within(band).getByText('Orders concerned')).toBeInTheDocument();
    expect(within(band).getByText('Flagged amount')).toBeInTheDocument();
  });

  it('trie une colonne : asc → desc → retour à l\'ordre serveur', async () => {
    renderPage();
    const table = await screen.findByTestId('off-hours-table');
    await within(table).findByText('2026-06-01 23:30');

    const methods = (): string[] =>
      within(table).getAllByRole('row').slice(1)      // hors en-tête
        .map((r) => r.querySelectorAll('td')[4]?.textContent ?? '')
        .filter((t) => t !== '');

    expect(methods()).toEqual(['cash', 'qris']);

    const header = screen.getByRole('columnheader', { name: 'Method' });
    fireEvent.click(within(header).getByRole('button', { name: 'Method' }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(methods()).toEqual(['cash', 'qris']);

    fireEvent.click(within(header).getByRole('button', { name: 'Method' }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(methods()).toEqual(['qris', 'cash']);

    fireEvent.click(within(header).getByRole('button', { name: 'Method' }));
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(methods()).toEqual(['cash', 'qris']);
  });

  it('le créneau n\'est pas triable — « Closed » n\'a pas de rang parmi des heures', async () => {
    renderPage();
    const table = await screen.findByTestId('off-hours-table');
    await within(table).findByText('2026-06-01 23:30');
    const header = screen.getByRole('columnheader', { name: 'Window' });
    expect(header).not.toHaveAttribute('aria-sort');
    expect(within(header).queryByRole('button')).toBeNull();
  });

  it('l\'état vide est une BONNE nouvelle, et il énonce sa réserve', async () => {
    emptyPeriod = true;
    renderPage();
    expect(await screen.findByText(/Nothing was taken off-hours/i)).toBeInTheDocument();
    expect(screen.getByText(/business hours are not configured/i)).toBeInTheDocument();
  });
});
