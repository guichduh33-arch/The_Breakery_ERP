// apps/backoffice/src/pages/reports/__tests__/SupplierPaymentsPage.smoke.test.tsx
//
// « Supplier Payments » — ce que la page promet et qui ne doit pas se perdre :
//
//  · DEUX NATURES DE CHIFFRE — le décaissé porte un delta de période, l'encours
//    porte une date de snapshot, jamais l'inverse ;
//  · LA DETTE, PAS L'ENGAGEMENT — la réserve dit PO reçus uniquement, imports
//    historiques exclus ;
//  · LE SOLDE AU GRAIN PO — total, réglé, restant, avec drill-down fournisseur
//    et bon de commande ;
//  · LA LISTE COMPLÈTE DES PO OUVERTS part au CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : décaissé 500k (2 paiements) ; encours 900k
// (500k Moulin + 400k Butter).
const REPORT_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  as_of: '2027-01-31',
  summary: {
    paid_total: 500_000, paid_total_prev: 250_000, payments_count: 2,
    outstanding_total: 900_000, open_po_count: 2, supplier_count: 2,
    oldest_open_days: 36, avg_settlement_days: 22,
  },
  by_day: [
    { date: '2027-01-15', amount: 300_000, count: 1 },
    { date: '2027-01-20', amount: 200_000, count: 1 },
  ],
  by_supplier_outstanding: [
    { supplier_id: 's1', supplier_name: 'Moulin Lombok', outstanding: 500_000,
      po_count: 1, oldest_days: 36 },
    { supplier_id: 's2', supplier_name: 'Bali Butter', outstanding: 400_000,
      po_count: 1, oldest_days: 31 },
  ],
  open_pos: [
    { po_id: 'po1', po_number: 'PO-0412', supplier_id: 's1', supplier_name: 'Moulin Lombok',
      received_on: '2026-12-26', total: 1_000_000, settled: 500_000, outstanding: 500_000,
      age_days: 36 },
    { po_id: 'po2', po_number: 'PO-0418', supplier_id: 's2', supplier_name: 'Bali Butter',
      received_on: '2026-12-31', total: 400_000, settled: 0, outstanding: 400_000,
      age_days: 31 },
  ],
  payments: [
    { payment_id: 'p1', po_id: 'po1', po_number: 'PO-0412', supplier_name: 'Moulin Lombok',
      amount: 300_000, method: 'transfer', reference: null, paid_on: '2027-01-15' },
    { payment_id: 'p2', po_id: 'po1', po_number: 'PO-0412', supplier_name: 'Moulin Lombok',
      amount: 200_000, method: 'cash', reference: null, paid_on: '2027-01-20' },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2027-01-01', end: '2027-01-31' },
  period_prev: { start: '2026-12-01', end: '2026-12-31' },
  as_of: '2027-01-31',
  summary: {
    paid_total: 0, paid_total_prev: 0, payments_count: 0,
    outstanding_total: 0, open_po_count: 0, supplier_count: 0,
    oldest_open_days: 0, avg_settlement_days: null,
  },
  by_day: [],
  by_supplier_outstanding: [],
  open_pos: [],
  payments: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_supplier_payments_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SupplierPaymentsPage from '@/pages/reports/SupplierPaymentsPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2027-01-01&end=2027-01-31') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/supplier-payments${search}`]}>
        <SupplierPaymentsPage />
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

describe('SupplierPaymentsPage smoke', () => {
  it('renders the heading and the Reports › Purchases breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Supplier Payments/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Purchases');
  });

  it('calls get_supplier_payments_v1 with the period bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_supplier_payments_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2027-01-01');
      expect(args.p_end_date).toBe('2027-01-31');
    });
  });

  it('shows the band: paid with delta, outstanding as dated snapshot', async () => {
    renderPage();
    await screen.findByTestId('kpi-paid');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-paid', 'kpi-outstanding', 'kpi-open-pos', 'kpi-settlement', 'kpi-suppliers',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-paid')).toHaveTextContent(/500 rb/);
    expect(within(band).getByTestId('kpi-outstanding')).toHaveTextContent(/900 rb/);
    expect(within(band).getByTestId('kpi-outstanding')).toHaveTextContent(/snapshot as of/i);
    expect(within(band).getByTestId('kpi-settlement')).toHaveTextContent('22 d');
    expect(within(band).getByTestId('kpi-open-pos')).toHaveTextContent(/oldest 36 d/i);
  });

  it('states the debt-not-commitment reserve', async () => {
    renderPage();
    await screen.findByTestId('kpi-paid');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/received.*POs\s*only/i);
    expect(caveat).toHaveTextContent(/historical imports/i);
  });

  it('lists open POs with settled amounts and supplier + PO drill-downs', async () => {
    renderPage();
    await screen.findAllByText('PO-0412');
    const panel = screen.getByTestId('open-pos-table');
    expect(panel).toHaveTextContent(/500\.000/);   // settled et outstanding
    expect(panel).toHaveTextContent('36 d');
    expect(within(panel).getByRole('link', { name: 'Moulin Lombok' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/suppliers'));
    expect(within(panel).getByRole('link', { name: 'PO-0412' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/purchasing/purchase-orders'));
  });

  it('lists the period payments with method', async () => {
    renderPage();
    await screen.findAllByText('PO-0412');
    const panel = screen.getByTestId('payments-table');
    expect(panel).toHaveTextContent('transfer');
    expect(panel).toHaveTextContent('cash');
    expect(panel).toHaveTextContent(/300\.000/);
  });

  it('offers the CSV export of open POs, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing is paid nor owed', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No supplier payment in this period and no received PO/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('open-pos-table')).toBeNull();
  });
});
