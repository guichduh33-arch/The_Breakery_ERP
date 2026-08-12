// apps/backoffice/src/pages/btob/__tests__/B2BPaymentsPage.smoke.test.tsx
//
// Lot 1 B2B (fix/b2b-dead-classes-and-states) — premier smoke dédié de la
// page Payments : rendu nominal, tirets pendant le chargement (jamais des
// zéros, ADR-025), alertes visibles sur échec des lectures.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BPaymentsPage from '../B2BPaymentsPage.js';

type Mode = 'ok' | 'loading' | 'error';
const mockState = vi.hoisted((): { mode: Mode } => ({ mode: 'ok' }));

const DASH_DATA = {
  activeClients: 2,
  monthlyRevenue: 850_000,
  monthlyDeltaPct: 10,
  outstandingAr: 250_000,
  pendingOrders: 1,
  totalOrders: 3,
  topClients: [
    {
      id: 'b1', name: 'Hotel Kuta', b2b_company_name: 'PT Kuta',
      b2b_current_balance: 250_000, b2b_credit_limit: 1_000_000,
      total_spent: 5_000_000, total_visits: 12, last_visit_at: '2026-04-10T00:00:00Z',
    },
  ],
  recentOrders: [],
  aging: [
    { label: 'Current', range: '0-30 days', total: 250_000, count: 1 },
  ],
};

const PAYMENTS_DATA = [
  {
    id: 'p1', payment_number: 'PAY-0001', customer_id: 'b1',
    customer_name: 'Hotel Kuta', company_name: 'PT Kuta',
    amount: 150_000, method: 'transfer', reference: 'TRX-9',
    paid_at: '2026-08-01T08:00:00Z', notes: null,
  },
];

function queryResult(data: unknown) {
  if (mockState.mode === 'loading') {
    return { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
  }
  if (mockState.mode === 'error') {
    return { data: undefined, isLoading: false, error: new Error('query failed'), refetch: vi.fn() };
  }
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

vi.mock('@/features/btob/hooks/useB2bDashboard.js', () => ({
  useB2bDashboard: () => queryResult(DASH_DATA),
}));
vi.mock('@/features/btob/hooks/useB2bPaymentsReceived.js', () => ({
  useB2bPaymentsReceived: () => queryResult(PAYMENTS_DATA),
}));
// Sous-arbres à hooks propres — hors du périmètre de ce smoke.
vi.mock('@/features/btob/components/B2bInvoicesTab.js', () => ({
  B2bInvoicesTab: () => <div data-testid="invoices-tab-stub" />,
}));
vi.mock('@/features/btob/components/RecordB2bPaymentModal.js', () => ({
  RecordB2bPaymentModal: () => null,
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function renderPage(initialEntry = '/backoffice/b2b/payments') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <B2BPaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2BPaymentsPage', () => {
  beforeEach(() => { mockState.mode = 'ok'; });

  it('renders the archetype header and the four tabs, Outstanding first', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /b2b payments/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('B2B');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringMatching(/outstanding/i),
      expect.stringMatching(/aging report/i),
      expect.stringMatching(/received/i),
      expect.stringMatching(/invoices/i),
    ]);
    // L'onglet par défaut est le recouvrement (fiche B2B.md §9).
    expect(screen.getByRole('tab', { name: /outstanding/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('PT Kuta')).toBeInTheDocument();
  });

  it('?tab=invoices still lands on the Invoices tab (JE drill-down deep-link)', async () => {
    renderPage('/backoffice/b2b/payments?tab=invoices');
    expect(await screen.findByRole('tab', { name: /invoices/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('invoices-tab-stub')).toBeInTheDocument();
  });

  it('scopes the filters to the tabs they act on', async () => {
    renderPage('/backoffice/b2b/payments?tab=received');
    // Received : recherche + méthode + période.
    expect(await screen.findByLabelText(/payment method/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/period/i)).toBeInTheDocument();
    expect(screen.getByText('PAY-0001')).toBeInTheDocument();
  });

  it('renders no filter row on the Aging tab', async () => {
    renderPage('/backoffice/b2b/payments?tab=aging');
    expect(await screen.findByRole('tab', { name: /aging report/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText(/search payments/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/payment method/i)).not.toBeInTheDocument();
  });

  it('renders dashes, never zeros, in the KPI row while loading', async () => {
    mockState.mode = 'loading';
    renderPage();
    await screen.findByText(/total received/i);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Rp 0')).not.toBeInTheDocument();
  });

  it('renders visible alerts when the reads fail', async () => {
    mockState.mode = 'error';
    renderPage();
    expect(await screen.findByText(/receivables could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/outstanding balances could not be loaded/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });
});
