// apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
//
// Session 14 / Phase 4.A — Dashboard smoke tests.
//
// Verifies:
//   - All 5 KPI tile labels render with the safe empty state (no hook)
//   - Loading state renders 5 skeleton placeholders
//   - Error state surfaces the error message
//   - Refetch button calls the hook's refetch handler

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '@/pages/Dashboard.js';
import { useAuthStore } from '@/stores/authStore.js';

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

describe('DashboardPage', () => {
  it('renders the title and all 5 KPI tile labels in the empty (zero) state', () => {
    wrap(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/Today's revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/^Orders$/i)).toBeInTheDocument();
    expect(screen.getByText(/Items sold/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg basket/i)).toBeInTheDocument();
    expect(screen.getByText(/^Customers$/i)).toBeInTheDocument();
  });

  it('renders the greeting with the user full name', () => {
    wrap(<DashboardPage />);
    expect(screen.getByText(/Mamat/i)).toBeInTheDocument();
  });

  it('renders 5 skeleton tiles when the data hook is loading', () => {
    wrap(
      <DashboardPage
        data={{
          data: null,
          isLoading: true,
          error: null,
          refetch: vi.fn(),
        }}
      />,
    );
    const skeletons = screen.getAllByTestId('kpi-skeleton');
    expect(skeletons).toHaveLength(5);
  });

  it('renders the error banner when the data hook returned an error', () => {
    wrap(
      <DashboardPage
        data={{
          data: null,
          isLoading: false,
          error: new Error('rpc_failed'),
          refetch: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/rpc_failed/);
  });

  it('calls refetch when the refresh icon is clicked', () => {
    const refetch = vi.fn();
    wrap(
      <DashboardPage
        data={{
          data: {
            revenue_today: 1500000,
            orders_today: 12,
            items_sold: 30,
            avg_basket: 125000,
            customers_today: 8,
            last_updated: '2026-05-14T12:00:00Z',
          },
          isLoading: false,
          error: null,
          refetch,
        }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Refresh dashboard/i });
    fireEvent.click(btn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
