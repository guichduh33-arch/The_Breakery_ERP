// Reports POS refonte — dernier lot — smoke for the Margin tab. Validates the
// financial-permission gate (ReportsForbidden), loading/error branches, the
// empty state, and the happy path: KPI cards, WAC caveat, no-cost badge,
// product + category rows, CSV button. Mocks usePOSReportsMargin + authStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSMarginReportPage from '../POSMarginReportPage';
import type { POSReportsMargin } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsMargin | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsMargin: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSMarginReportPage />
    </MemoryRouter>,
  );
}

function empty(): POSReportsMargin {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      revenueTtc: 0, revenueHt: 0, cogs: 0, grossMargin: 0,
      marginPct: 0, orders: 0, productsWithoutCost: 0,
    },
    byProduct: [],
    byCategory: [],
  };
}

function populated(): POSReportsMargin {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      revenueTtc: 8_250_000, revenueHt: 7_500_000, cogs: 3_000_000,
      grossMargin: 4_500_000, marginPct: 60, orders: 84, productsWithoutCost: 2,
    },
    byProduct: [
      { productId: 'p1', productName: 'Croissant', categoryName: 'Pastry',
        qty: 120, revenueHt: 3_000_000, cogs: 1_200_000, margin: 1_800_000, marginPct: 60 },
      { productId: 'p2', productName: 'Latte', categoryName: 'Coffee',
        qty: 90, revenueHt: 4_500_000, cogs: 1_800_000, margin: 2_700_000, marginPct: 60 },
    ],
    byCategory: [
      { categoryId: 'c1', categoryName: 'Coffee',
        qty: 90, revenueHt: 4_500_000, cogs: 1_800_000, margin: 2_700_000, marginPct: 60 },
      { categoryId: null, categoryName: '(uncategorized)',
        qty: 4, revenueHt: 100_000, cogs: 40_000, margin: 60_000, marginPct: 60 },
    ],
  };
}

describe('POSMarginReportPage', () => {
  beforeEach(() => {
    state.current = { data: undefined, isLoading: false, isError: false };
    authState.current = { canRead: true };
  });

  it('renders the ReportsForbidden splash when the user lacks reports.financial.read', () => {
    authState.current = { canRead: false };
    renderPage();
    expect(screen.getByText(/reports are restricted/i)).toBeInTheDocument();
  });

  it('renders the loading state while data is fetching', () => {
    state.current = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.getByText(/loading margin/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load margin/i)).toBeInTheDocument();
  });

  it('renders the empty state and no badge when there are no lines', () => {
    state.current = { data: empty(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-margin-nocost-badge')).not.toBeInTheDocument();
  });

  it('renders KPIs, caveat, no-cost badge, rows and CSV button on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    // 4 KPI cards.
    expect(screen.getByTestId('pos-margin-kpi-revenue')).toBeInTheDocument();
    expect(screen.getByTestId('pos-margin-kpi-cogs')).toBeInTheDocument();
    expect(screen.getByTestId('pos-margin-kpi-margin')).toBeInTheDocument();
    const pct = screen.getByTestId('pos-margin-kpi-pct');
    expect(within(pct).getByText('60.0%')).toBeInTheDocument();
    // Permanent WAC caveat + no-cost badge (2 products). /current WAC/ also
    // appears in the COGS KPI label, so scope the query to the caveat box.
    const caveat = screen.getByTestId('pos-margin-caveat');
    expect(within(caveat).getByText(/current WAC/i)).toBeInTheDocument();
    const badge = screen.getByTestId('pos-margin-nocost-badge');
    expect(within(badge).getByText(/2 product/i)).toBeInTheDocument();
    // Product + category rows (incl. uncategorized bucket).
    expect(screen.getByTestId('margin-product-p1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-product-p2')).toBeInTheDocument();
    expect(screen.getByTestId('margin-category-c1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-category-uncat')).toBeInTheDocument();
    // CSV export present.
    expect(screen.getByTestId('pos-margin-export-csv')).toBeInTheDocument();
  });
});
