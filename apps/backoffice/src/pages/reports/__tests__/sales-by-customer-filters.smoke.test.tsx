// apps/backoffice/src/pages/reports/__tests__/sales-by-customer-filters.smoke.test.tsx
//
// S3-22 (2026-11-11) — les FILTRES DE COMMANDE de « Sales by Customer »,
// câblés de bout en bout : le hook réel tourne, seul `supabase.rpc` est
// simulé. Ce que ce fichier tient :
//
//  · chaque filtre (type, paiement, table) s'écrit dans l'URL, se relit
//    depuis une URL initiale et part dans `p_filters` ;
//  · sans filtre, l'argument est OMIS ;
//  · le filtre de type de CLIENT, distinct, part toujours dans
//    `p_customer_type` et se combine aux filtres de commande ;
//  · « Clear filters » retire les filtres de commande et garde la période.
//
// Le rendu de la page vit dans `SalesByCustomerPage.smoke.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const RPC = 'get_sales_by_customer_v4';

const REPORT_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    identified_revenue: 150_000, identified_revenue_prev: 0, identified_orders: 2,
    anonymous_revenue: 40_000, anonymous_revenue_prev: 0, anonymous_orders: 1,
    customer_count: 1, new_customer_count: 1,
  },
  by_customer: [
    { customer_id: 'ca', name: 'Ibu Ratna', customer_type: 'retail', loyalty_points: 10,
      order_count: 2, revenue: 150_000, last_order_date: '2026-06-18', is_new: true,
      revenue_prev: null, order_count_prev: null },
  ],
  churned: [],
  by_day: [{ date: '2026-06-18', identified: 150_000, anonymous: 40_000 }],
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

import SalesByCustomerPage from '../SalesByCustomerPage.js';
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
const END   = '2026-06-30';

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-customer${search}`]}>
        <SalesByCustomerPage />
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
      return f !== undefined && Object.entries(expected).every(([k, v]) => f[k] === v);
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

describe('SalesByCustomerPage — S3-22 filters', () => {
  it('sends no p_filters when no filter is active', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
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
    expect(screen.getByTestId('new-customer-filter-note')).toHaveTextContent(/filters do not change it/i);
  });

  it('says nothing about "new" while no filter is active', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    expect(screen.queryByTestId('new-customer-filter-note')).toBeNull();
  });

  it('combines the customer type with the order filters in one call', async () => {
    renderPage(`${FILTERED}&customer_type=b2b`);
    await waitFor(() => {
      const hit = callsOf().some((a) =>
        a.p_customer_type === 'b2b'
        && (a.p_filters as Record<string, string> | undefined)?.order_type === 'dine_in');
      expect(hit).toBe(true);
    });
  });

  it('picking an order type writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    fireEvent.change(screen.getByTestId('filter-order_type'), { target: { value: 'take_out' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('order_type=take_out');
    });
    await expectFiltered({ order_type: 'take_out' });
  });

  it('picking a payment method writes it to the URL, to p_filters, and states its caveat', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('payment_method=qris');
    });
    await expectFiltered({ payment_method: 'qris' });
    expect(await screen.findByTestId('payment-filter-note')).toHaveTextContent(/counts in full under each/i);
  });

  it('typing a table number writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Ibu Ratna');
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
    await screen.findAllByText('Ibu Ratna');
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
