// apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
//
// S63 — Dashboard smoke tests (enveloppe get_dashboard_overview_v1).
// La prop `data` désactive le hook (enabled=false) : aucun réseau en test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '@/pages/Dashboard.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { DashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview.js';

beforeEach(() => {
  cleanup();
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: [],
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function overviewFixture(): DashboardOverview {
  return {
    kpis: {
      revenue_today: 1_500_000,
      orders_today: 12,
      items_sold: 30,
      avg_basket: 125_000,
      customers_today: 8,
    },
    revenue_30d: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      net: i * 10_000,
      order_count: i,
    })),
    revenue_by_type: [
      { order_type: 'take_out', gross: 900_000, order_count: 8 },
      { order_type: 'dine_in', gross: 600_000, order_count: 4 },
    ],
    top_products: [
      { product_id: 'p-1', name: 'Croissant', qty: 10, revenue: 350_000 },
    ],
    hourly_sales: [{ hour: 8, gross: 500_000, order_count: 5 }],
    payment_methods: [
      { method: 'cash', amount: 1_000_000, count: 8 },
      { method: 'qris', amount: 500_000, count: 4 },
    ],
    generated_at: '2026-07-06T12:00:00Z',
  };
}

describe('DashboardPage', () => {
  it('renders the title and all 5 KPI tile labels with data', () => {
    wrap(
      <DashboardPage
        data={{ data: overviewFixture(), isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/Today's revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/^Orders$/i)).toBeInTheDocument();
    expect(screen.getByText(/Items sold/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg basket/i)).toBeInTheDocument();
    expect(screen.getByText(/^Customers$/i)).toBeInTheDocument();
  });

  it('renders the greeting with the user full name', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Mamat/i)).toBeInTheDocument();
  });

  it('renders 5 skeleton tiles when the data hook is loading', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: true, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(5);
  });

  it('renders the error banner on a generic error', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: new Error('rpc_failed'), refetch: vi.fn() }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/rpc_failed/);
  });

  it('renders the restricted state (no KPI row, no alert) on permission denied', () => {
    const err = Object.assign(new Error('permission denied: reports.read required'), {
      code: '42501',
    });
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: err, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('dashboard-restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-kpi-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls refetch when the refresh icon is clicked', () => {
    const refetch = vi.fn();
    wrap(
      <DashboardPage
        data={{ data: overviewFixture(), isLoading: false, error: null, refetch }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh dashboard/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
