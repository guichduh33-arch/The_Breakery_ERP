// apps/backoffice/src/pages/reports/__tests__/sales-by-staff-page.smoke.test.tsx
//
// S3-22 (2026-11-11) — les FILTRES DE COMMANDE de « Sales by Staff », câblés de
// bout en bout : le hook réel tourne, seul `supabase.rpc` est simulé. Ce que ce
// fichier tient, pour chacun des trois filtres (type, paiement, table) :
//
//  · il s'écrit dans l'URL ;
//  · il se relit depuis une URL initiale (rechargement, lien partagé) ;
//  · il part dans `p_filters` du classement ET de sa comparaison ;
//  · sans filtre, l'argument est OMIS ;
//  · la descente vers les commandes servies porte les mêmes clés ;
//  · la recherche sur le nom reste côté client, et « Clear filters » l'efface.
//
// Le drill-down d'origine et l'archétype vivent dans
// `sales-by-staff-drilldown.smoke.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockRpc = vi.fn();

const ROWS = [
  { staff_id: 'u-1', staff_name: 'Alice Cashier', total: 1_500_000, order_count: 25, avg_basket: 60_000 },
  { staff_id: 'u-2', staff_name: 'Bob Cashier',   total:   500_000, order_count: 10, avg_basket: 50_000 },
];

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_staff_v6') return Promise.resolve({ data: ROWS, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

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
/** `previousPeriod('2026-06-01','2026-06-07')` → la semaine d'avant. */
const PREV_START = '2026-05-25';

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-staff${search}`]}>
        <SalesByStaffPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function callsOf(): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_sales_by_staff_v6')
    .map(([, args]) => args as Record<string, unknown>);
}

/** Un appel filtré existe pour la période courante ET pour la comparaison. */
async function expectBothPeriodsFiltered(expected: Record<string, string>): Promise<void> {
  await waitFor(() => {
    const filtered = callsOf().filter((a) => {
      const f = a.p_filters as Record<string, string> | undefined;
      return f !== undefined && Object.entries(expected).every(([k, v]) => f[k] === v);
    });
    expect(filtered.some((a) => a.p_date_start === START)).toBe(true);
    expect(filtered.some((a) => a.p_date_start === PREV_START)).toBe(true);
  });
}

const FILTERED = `?start=${START}&end=${END}`
  + '&order_type=dine_in&payment_method=cash&table_number=T-07';

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('SalesByStaffPage — S3-22 filters', () => {
  it('sends no p_filters when no filter is active', async () => {
    renderPage();
    await screen.findAllByText('Alice Cashier');
    await waitFor(() => { expect(callsOf().length).toBeGreaterThanOrEqual(2); });
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('reads the three filters back from the initial URL and sends them to both periods', async () => {
    renderPage(FILTERED);
    const expected = { order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07' };
    await waitFor(() => {
      const calls = callsOf();
      expect(calls.some((a) => a.p_date_start === START)).toBe(true);
      expect(calls.some((a) => a.p_date_start === PREV_START)).toBe(true);
      for (const a of calls) expect(a.p_filters).toEqual(expected);
    });
    expect(screen.getByTestId('filter-order_type')).toHaveValue('dine_in');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('cash');
    expect(screen.getByTestId('filter-table_number')).toHaveValue('T-07');
    // Ligne méta ET annonce live de ReportShell : au moins une occurrence.
    expect(screen.getAllByText(/3 filters active/).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores a payment method that is not a Postgres enum value', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=bitcoin`);
    await screen.findAllByText('Alice Cashier');
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('');
  });

  it('picking an order type writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Alice Cashier');
    fireEvent.change(screen.getByTestId('filter-order_type'), { target: { value: 'take_out' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('order_type=take_out');
    });
    await expectBothPeriodsFiltered({ order_type: 'take_out' });
  });

  it('picking a payment method writes it to the URL, to p_filters, and states its caveat', async () => {
    renderPage();
    await screen.findAllByText('Alice Cashier');
    expect(screen.queryByTestId('payment-filter-note')).toBeNull();
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('payment_method=qris');
    });
    await expectBothPeriodsFiltered({ payment_method: 'qris' });
    expect(await screen.findByTestId('payment-filter-note')).toHaveTextContent(/counts in full under each/i);
  });

  it('typing a table number writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Alice Cashier');
    const input = screen.getByTestId('filter-table_number');
    fireEvent.change(input, { target: { value: 'T-12' } });
    // Le champ commet au blur sans attendre le délai de frappe.
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('table_number=T-12');
    });
    await expectBothPeriodsFiltered({ table_number: 'T-12' });
  });

  it('the served-orders drill-down carries the same order filters; the profile link does not', async () => {
    renderPage(FILTERED);
    await screen.findAllByText('Alice Cashier');
    const card = screen.getByTestId('breakdown-staff');
    const href = within(card).getByRole('link', { name: /Alice Cashier/ }).getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/backoffice/orders');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      served_by: 'u-1', start: START, end: END,
      order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07',
    });
    const table = screen.getByTestId('sbs-staff-detail');
    expect(within(table).getByRole('link', { name: 'Alice Cashier' }))
      .toHaveAttribute('href', '/backoffice/users/u-1');
  });

  it('staff search narrows the table without calling the server, and Clear filters removes it', async () => {
    renderPage();
    await screen.findAllByText('Alice Cashier');
    await waitFor(() => { expect(callsOf().length).toBeGreaterThanOrEqual(2); });
    const before = mockRpc.mock.calls.length;

    fireEvent.change(screen.getByTestId('sbs-table-search'), { target: { value: 'bob' } });
    const table = within(screen.getByTestId('sbs-staff-detail')).getByRole('table');
    // En-tête + une seule ligne ; le pied du jeu complet se tait.
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent ?? '').toMatch(/Bob Cashier/);
    expect(screen.getByTestId('sbs-table-count')).toHaveTextContent('1 of 2 staff members');
    expect(screen.getByTestId('location')).toHaveTextContent('q=bob');
    expect(mockRpc.mock.calls.length).toBe(before);

    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      expect(screen.getByTestId('location')).not.toHaveTextContent('q=');
    });
    // En-tête + deux vendeurs + pied du total.
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByTestId('sbs-table-footer')).toHaveTextContent('Rp 2.000.000');
  });

  it('Clear filters removes every order filter from the URL at once and keeps the period', async () => {
    renderPage(FILTERED);
    await screen.findAllByText('Alice Cashier');
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      const search = screen.getByTestId('location').textContent ?? '';
      for (const k of ['order_type', 'payment_method', 'table_number']) {
        expect(search).not.toContain(`${k}=`);
      }
      expect(search).toContain(`start=${START}`);
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });
});
