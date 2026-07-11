// apps/pos/src/features/reports/__tests__/POSMixReportPage.test.tsx
//
// Reports POS refonte — Lot E smoke for the Mix tab. Validates the role-gate
// (ReportsForbidden splash), loading + error branches, both empty states, and
// the happy-path order-type rows + category rows + CSV button. Mocks
// usePOSReportsMix + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSMixReportPage from '../POSMixReportPage';
import type { POSReportsMix } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsMix | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsMix: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSMixReportPage />
    </MemoryRouter>,
  );
}

function empty(): POSReportsMix {
  return {
    timezone: 'Asia/Makassar',
    totals: { revenue: 0, orders: 0 },
    byOrderType: [],
    byCategory: [],
  };
}

function populated(): POSReportsMix {
  return {
    timezone: 'Asia/Makassar',
    totals: { revenue: 6_416_000, orders: 84 },
    byOrderType: [
      { orderType: 'take_out', revenue: 3_298_000, orderCount: 60, avgBasket: 54_966, sharePct: 51.4 },
      { orderType: 'dine_in', revenue: 2_518_000, orderCount: 19, avgBasket: 132_526, sharePct: 39.25 },
      { orderType: 'delivery', revenue: 600_000, orderCount: 5, avgBasket: 120_000, sharePct: 9.35 },
    ],
    byCategory: [
      { categoryId: 'c1', categoryName: 'Coffee', revenue: 2_155_000, qty: 61, sharePct: 32.86 },
      { categoryId: null, categoryName: '(uncategorized)', revenue: 100_000, qty: 4, sharePct: 1.5 },
    ],
  };
}

describe('POSMixReportPage', () => {
  beforeEach(() => {
    state.current = { data: undefined, isLoading: false, isError: false };
    authState.current = { canRead: true };
  });

  it('renders the ReportsForbidden splash when the user lacks permission', () => {
    authState.current = { canRead: false };
    renderPage();
    expect(screen.getByText(/reports are restricted/i)).toBeInTheDocument();
  });

  it('renders the loading state while data is fetching', () => {
    state.current = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.getByText(/loading mix/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load mix/i)).toBeInTheDocument();
  });

  it('renders both empty states when there are no order types nor categories', () => {
    state.current = { data: empty(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.getByText('No category sales')).toBeInTheDocument();
  });

  it('renders order-type rows, category rows and the CSV button on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    // Order-type rows with human labels.
    const takeout = screen.getByTestId('order-type-take_out');
    expect(within(takeout).getByText('Take-out')).toBeInTheDocument();
    expect(screen.getByTestId('order-type-dine_in')).toBeInTheDocument();
    expect(screen.getByTestId('order-type-delivery')).toBeInTheDocument();
    // Category rows, including the uncategorized bucket.
    expect(screen.getByTestId('category-c1')).toBeInTheDocument();
    const uncat = screen.getByTestId('category-uncat');
    expect(within(uncat).getByText(/uncategorized/i)).toBeInTheDocument();
    // CSV export present.
    expect(screen.getByTestId('pos-mix-export-csv')).toBeInTheDocument();
  });
});
