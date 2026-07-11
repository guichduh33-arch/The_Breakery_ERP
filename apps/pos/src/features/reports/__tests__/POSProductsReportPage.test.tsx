// apps/pos/src/features/reports/__tests__/POSProductsReportPage.test.tsx
//
// Reports POS refonte — Lot F smoke for the Products tab. Validates the
// role-gate (ReportsForbidden splash), loading + error branches, the empty
// state, and the happy-path ranked product rows. Mocks usePOSReportsTopProducts
// + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSProductsReportPage from '../POSProductsReportPage';
import type { POSReportsTopProduct } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsTopProduct[] | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsTopProducts: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSProductsReportPage />
    </MemoryRouter>,
  );
}

function populated(): POSReportsTopProduct[] {
  return [
    { product_id: 'p1', product_name: 'Croissant', qty: 120, revenue: 1_800_000 },
    { product_id: 'p2', product_name: 'Pain au chocolat', qty: 80, revenue: 1_200_000 },
  ];
}

describe('POSProductsReportPage', () => {
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
    expect(screen.getByText(/loading top products/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load top products/i)).toBeInTheDocument();
  });

  it('renders the empty state when no products were sold', () => {
    state.current = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No products sold')).toBeInTheDocument();
  });

  it('renders ranked product rows on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    const first = screen.getByTestId('top-product-p1');
    expect(within(first).getByText('Croissant')).toBeInTheDocument();
    expect(within(first).getByText(/120 sold/)).toBeInTheDocument();
    expect(screen.getByTestId('top-product-p2')).toBeInTheDocument();
  });
});
