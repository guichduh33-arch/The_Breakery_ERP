// apps/pos/src/features/reports/__tests__/POSReportsOverviewPage.test.tsx
//
// Session 14 — Phase 2.D smoke for the POS Reports Overview page. Validates
// the role-gate (ReportsForbidden splash), loading + error branches, and the
// happy-path KPI tiles. Mocks usePOSReportsOverview + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSReportsOverviewPage from '../POSReportsOverviewPage';
import type { POSReportsOverview } from '../hooks/usePOSReports';

const overviewState = {
  current: {
    data: undefined as POSReportsOverview | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsOverview: () => overviewState.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSReportsOverviewPage />
    </MemoryRouter>,
  );
}

function makeOverview(): POSReportsOverview {
  return {
    revenue: 1_500_000,
    orders: 25,
    tax: 150_000,
    avgBasket: 60_000,
    timezone: 'Asia/Makassar',
    salesByHour: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      revenue: h % 3 === 0 ? 100_000 : 0,
      tickets: h % 3 === 0 ? 2 : 0,
    })),
  };
}

describe('POSReportsOverviewPage', () => {
  beforeEach(() => {
    overviewState.current = { data: undefined, isLoading: false, isError: false };
    authState.current = { canRead: true };
  });

  it('renders the ReportsForbidden splash when the user lacks permission', () => {
    authState.current = { canRead: false };
    renderPage();
    expect(screen.getByText(/reports are restricted/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /pos reports/i })).toBeNull();
  });

  it('renders the loading state while data is fetching', () => {
    overviewState.current = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.getByText(/loading overview/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    overviewState.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load overview/i)).toBeInTheDocument();
  });

  it('renders the KPI tiles + sales-by-hour chart on happy path', () => {
    overviewState.current = { data: makeOverview(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText(/revenue \(incl\. tax\)/i)).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Avg Basket')).toBeInTheDocument();
    expect(screen.getByText(/sales by hour/i)).toBeInTheDocument();
    expect(screen.getByTestId('sales-by-hour-bar-6')).toBeInTheDocument();
    // full 0..23 axis now surfaces late-night sales the old 6→23 seed dropped
    expect(screen.getByTestId('sales-by-hour-bar-0')).toBeInTheDocument();
    expect(screen.getByTestId('sales-by-hour-bar-23')).toBeInTheDocument();
  });

  it('renders the report layout chrome (period chips + tab nav)', () => {
    overviewState.current = { data: makeOverview(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByRole('heading', { name: /pos reports/i })).toBeInTheDocument();
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    expect(screen.getByTestId('pos-reports-close')).toBeInTheDocument();
  });
});
