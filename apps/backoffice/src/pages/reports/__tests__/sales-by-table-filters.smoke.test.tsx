// apps/backoffice/src/pages/reports/__tests__/sales-by-table-filters.smoke.test.tsx
//
// S3-22 (2026-11-11) — le filtre de MOYEN DE PAIEMENT de « Sales by Table »,
// câblé de bout en bout : le hook réel tourne, seul `supabase.rpc` est simulé.
// Ce rapport ne porte QUE ce filtre (le type et la table y sont fixés). Ce que
// ce fichier tient :
//
//  · le filtre s'écrit dans l'URL, se relit au rechargement, part dans
//    `p_filters` ; sans filtre, l'argument est OMIS ;
//  · une clé `order_type` ou `table_number` dans l'URL (lien venu d'un autre
//    rapport) n'affiche rien et ne part pas au serveur ;
//  · le lien d'une table vers ses commandes transporte le filtre ;
//  · « Clear filters » le retire et garde la période.
//
// Le rendu de la page vit dans `SalesByTablePage.smoke.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const RPC = 'get_sales_by_table_v4';

const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    revenue: 90_000, revenue_prev: 20_000, orders: 2, orders_prev: 1,
    tables_used: 1, active_tables: 11, active_seats: 42,
  },
  by_table: [
    { table_number: 'T-07', seats: 4, orders: 2, revenue: 90_000, avg_ticket: 45_000, revenue_prev: 20_000 },
  ],
  by_table_dow: [{ table_number: 'T-07', dow: 3, orders: 2, revenue: 90_000 }],
};

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === RPC) return Promise.resolve({ data: REPORT_DATA, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SalesByTablePage from '../SalesByTablePage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const START = '2027-01-01';
const END   = '2027-01-31';

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-table${search}`]}>
        <SalesByTablePage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function callsOf(): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === RPC)
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('SalesByTablePage — S3-22 payment filter', () => {
  it('sends no p_filters when no filter is active, and shows only the payment filter', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    await waitFor(() => { expect(callsOf().length).toBeGreaterThanOrEqual(1); });
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.getByTestId('filter-payment_method')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-order_type')).toBeNull();
    expect(screen.queryByTestId('filter-table_number')).toBeNull();
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('reads the payment method back from the URL and ignores order_type and table_number', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=cash&order_type=take_out&table_number=T-99`);
    await waitFor(() => {
      const calls = callsOf();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const a of calls) expect(a.p_filters).toEqual({ payment_method: 'cash' });
    });
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('cash');
    expect(screen.getAllByText(/1 filter active/).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores a payment method that is not a Postgres enum value', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=bitcoin`);
    await screen.findByTestId('kpi-revenue');
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('');
  });

  it('picking a payment method writes it to the URL, to p_filters, and states its caveat', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('payment_method=qris');
    });
    await waitFor(() => {
      expect(callsOf().some((a) => JSON.stringify(a.p_filters) === '{"payment_method":"qris"}')).toBe(true);
    });
    expect(await screen.findByTestId('payment-filter-note')).toHaveTextContent(/counts in full under each/i);
  });

  it('the table link to its orders carries the active payment method', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=cash`);
    const link = await screen.findByRole('link', { name: 'T-07' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('table_number=T-07');
    expect(href).toContain('payment_method=cash');
    expect(href).toContain(`start=${START}`);
  });

  it('the table link carries no payment method when the filter is off', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'T-07' });
    expect(link.getAttribute('href') ?? '').not.toContain('payment_method=');
  });

  it('Clear filters removes the payment method and keeps the period', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=cash`);
    await screen.findByTestId('kpi-revenue');
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      const search = screen.getByTestId('location').textContent ?? '';
      expect(search).not.toContain('payment_method=');
      expect(search).toContain(`start=${START}`);
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });
});
