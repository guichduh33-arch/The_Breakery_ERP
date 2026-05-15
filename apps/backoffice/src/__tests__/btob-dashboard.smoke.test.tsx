// apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for B2BDashboardPage.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BDashboardPage from '@/pages/btob/B2BDashboardPage.js';

vi.mock('@/lib/supabase.js', () => {
  const clients = [
    { id: 'b1', name: 'Hotel Kuta',  b2b_company_name: 'PT Kuta',  b2b_current_balance: 250000,
      b2b_credit_limit: 1000000, total_spent: 5000000, total_visits: 12, last_visit_at: '2026-04-10T00:00:00Z' },
    { id: 'b2', name: 'Bali Organic', b2b_company_name: 'CV Bali', b2b_current_balance: 0,
      b2b_credit_limit: null,    total_spent: 1200000, total_visits: 4,  last_visit_at: '2026-05-01T00:00:00Z' },
  ];
  const orders = [
    { id: 'o1', order_number: 'B2B-0001', total: 350000, status: 'paid',
      created_at: '2026-05-10T08:00:00Z', customer_id: 'b1', paid_at: '2026-05-10T09:00:00Z' },
    { id: 'o2', order_number: 'B2B-0002', total: 500000, status: 'pending',
      created_at: '2026-05-12T08:00:00Z', customer_id: 'b1', paid_at: null },
  ];
  type Resolver = (v: unknown) => void;
  const make = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {
      select:  () => builder,
      is:      () => builder,
      eq:      () => builder,
      in:      () => builder,
      order:   () => builder,
      limit:   () => builder,
      then:    (resolve: Resolver) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'orders') return make(orders);
        return make(clients);
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => p === 'customers.read' }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <B2BDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2BDashboardPage', () => {
  it('renders title, KPI tiles and quick links', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /b2b dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/active clients/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly b2b revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/outstanding ar/i)).toBeInTheDocument();
    expect(screen.getByText(/pending orders/i)).toBeInTheDocument();
    expect(screen.getByText(/total orders/i)).toBeInTheDocument();
    // Quick links
    expect(screen.getByRole('link', { name: /b2b clients/i })).toHaveAttribute('href', '/backoffice/customers');
    expect(screen.getAllByRole('link', { name: /payments/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: /b2b settings/i })).toHaveAttribute('href', '/backoffice/b2b/settings');
  });

  it('lists top B2B clients from the joined data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('PT Kuta')).toBeInTheDocument());
    expect(screen.getByText('CV Bali')).toBeInTheDocument();
  });

  it('disables + New B2B Order with the deviation explanation', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /new b2b order/i });
    expect(btn).toBeDisabled();
  });
});
