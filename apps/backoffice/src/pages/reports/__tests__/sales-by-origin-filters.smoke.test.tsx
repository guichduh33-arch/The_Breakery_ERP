// apps/backoffice/src/pages/reports/__tests__/sales-by-origin-filters.smoke.test.tsx
//
// S3-22 (2026-11-11) — les FILTRES DE COMMANDE de « Sales by Origin », câblés
// de bout en bout : le hook réel tourne, seul `supabase.rpc` est simulé. Ce
// que ce fichier tient, pour chacun des trois filtres (type, paiement, table) :
//
//  · il s'écrit dans l'URL ;
//  · il se relit depuis une URL initiale (rechargement, lien partagé) ;
//  · il part dans `p_filters` (le serveur l'applique aussi à la fenêtre
//    précédente : un seul appel porte les deux) ;
//  · sans filtre, l'argument est OMIS ;
//  · « Clear filters » les retire tous et garde la période.
//
// Le rendu de la page vit dans `SalesByOriginPage.smoke.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const RPC = 'get_sales_by_origin_v4';

const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  summary: {
    total_revenue: 150_000, total_orders: 2,
    total_revenue_prev: 100_000, total_orders_prev: 1,
  },
  by_origin: [
    { origin: 'P', orders: 2, revenue: 150_000, avg_ticket: 75_000,
      discount_total: 0, revenue_prev: 100_000, orders_prev: 1 },
  ],
  by_day: [{ date: '2027-01-17', origin: 'P', revenue: 150_000, orders: 2 }],
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

import SalesByOriginPage from '../SalesByOriginPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-origin${search}`]}>
        <SalesByOriginPage />
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

async function expectFiltered(expected: Record<string, string>): Promise<void> {
  await waitFor(() => {
    const hit = callsOf().some((a) => {
      const f = a.p_filters as Record<string, string> | undefined;
      return a.p_start_date === START && f !== undefined
        && Object.entries(expected).every(([k, v]) => f[k] === v);
    });
    expect(hit).toBe(true);
  });
}

const FILTERED = `?start=${START}&end=${END}`
  + '&order_type=dine_in&payment_method=cash&table_number=T-07';

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('SalesByOriginPage — S3-22 filters', () => {
  it('sends no p_filters when no filter is active', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    await waitFor(() => { expect(callsOf().length).toBeGreaterThanOrEqual(1); });
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('reads the three filters back from the initial URL and sends them', async () => {
    renderPage(FILTERED);
    const expected = { order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07' };
    await waitFor(() => {
      const calls = callsOf();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const a of calls) expect(a.p_filters).toEqual(expected);
    });
    expect(screen.getByTestId('filter-order_type')).toHaveValue('dine_in');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('cash');
    expect(screen.getByTestId('filter-table_number')).toHaveValue('T-07');
    expect(screen.getAllByText(/3 filters active/).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores a payment method that is not a Postgres enum value', async () => {
    renderPage(`?start=${START}&end=${END}&payment_method=bitcoin`);
    await screen.findByTestId('kpi-revenue');
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('');
  });

  it('picking an order type writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    fireEvent.change(screen.getByTestId('filter-order_type'), { target: { value: 'take_out' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('order_type=take_out');
    });
    await expectFiltered({ order_type: 'take_out' });
  });

  it('picking a payment method writes it to the URL, to p_filters, and states its caveat', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('payment_method=qris');
    });
    await expectFiltered({ payment_method: 'qris' });
    expect(await screen.findByTestId('payment-filter-note')).toHaveTextContent(/counts in full under each/i);
  });

  it('typing a table number writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const input = screen.getByTestId('filter-table_number');
    fireEvent.change(input, { target: { value: 'T-12' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('table_number=T-12');
    });
    await expectFiltered({ table_number: 'T-12' });
  });

  it('Clear filters removes every order filter from the URL at once and keeps the period', async () => {
    renderPage(FILTERED);
    await screen.findByTestId('kpi-revenue');
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
