import type * as DomainModule from '@breakery/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PermissionCode } from '@breakery/supabase';
import DashboardPage from '../Dashboard.js';
import { useAuthStore } from '@/stores/authStore.js';
import { financialFixture } from '@/features/dashboard/__tests__/financialFixture.js';
import type { DashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview.js';

const download = vi.hoisted(() => vi.fn());
vi.mock('@breakery/domain', async (original) => ({
  ...await original<typeof DomainModule>(),
  downloadCsv: download,
}));
vi.mock('@/features/settings/hooks/useHolidays.js', () => ({
  useHolidaysList: () => ({ data: [] }), holidayNameFor: () => null,
}));

beforeEach(() => {
  cleanup();
  download.mockClear();
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Reader', role_code: 'CASHIER', employee_code: 'E1' },
    sessionToken: 'test', isAuthenticated: true, isLoading: false, error: null,
    permissions: [],
  });
});

function show(permissions: PermissionCode[], overview = financialFixture()) {
  useAuthStore.setState({ permissions });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter>
    <DashboardPage data={{ data: overview, isLoading: false, error: null, refetch: vi.fn() }} />
  </MemoryRouter></QueryClientProvider>);
}

function expectPrivateHidden() {
  const margin = screen.getByTestId('kpi-gross-margin');
  expect(margin).toHaveTextContent(/restricted/i);
  expect(margin).not.toHaveTextContent('61,8');
  expect(margin).not.toHaveTextContent('1,4pt');
  expect(margin).not.toHaveTextContent('2,7pt');
  expect(screen.getByTestId('card-cost-mtd')).toHaveTextContent(/restricted/i);
  expect(screen.queryByText('Private flour account')).not.toBeInTheDocument();
  expect(screen.getByTestId('kpi-orders')).toHaveTextContent('10');
  fireEvent.click(screen.getByTestId('dashboard-export'));
  const csv = String(download.mock.calls[0]?.[0]);
  expect(csv).toContain('Net revenue');
  expect(csv).not.toContain('Gross margin');
  expect(csv).not.toContain('cost_mtd');
  expect(csv).not.toContain('Private flour account');
}

describe('Dashboard financial confidentiality from page to CSV', () => {
  it('masks cached financial numbers when the client has no financial permission', () => {
    show(['reports.read', 'reports.export']);
    expectPrivateHidden();
  });

  it('shows and exports financial values for an authorized reader', () => {
    show(['reports.read', 'reports.export', 'reports.financial.read']);
    expect(screen.getByTestId('kpi-gross-margin')).toHaveTextContent('61,8%');
    expect(screen.getByTestId('card-cost-mtd')).toHaveTextContent('Private flour account');
    fireEvent.click(screen.getByTestId('dashboard-export'));
    const csv = String(download.mock.calls[0]?.[0]);
    expect(csv).toContain('Gross margin');
    expect(csv).toContain('Private flour account');
  });

  it('honors server restrictions even when the client permission is stale', () => {
    const overview: DashboardOverview = financialFixture();
    overview.kpis.gross_margin.restricted = true;
    overview.cost_mtd.restricted = true;
    show(['reports.read', 'reports.export', 'reports.financial.read'], overview);
    expectPrivateHidden();
  });
});
