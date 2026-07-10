// apps/pos/src/features/reports/__tests__/POSPaymentsReportPage.test.tsx
//
// Reports POS refonte — Lot B smoke for the Payments tab. Validates the
// role-gate (ReportsForbidden splash), loading + error branches, the empty
// state, and the happy-path method rows + total tile. Mocks
// usePOSReportsPayments + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSPaymentsReportPage from '../POSPaymentsReportPage';
import type { POSReportsPayments } from '../hooks/usePOSReports';

const paymentsState = {
  current: {
    data: undefined as POSReportsPayments | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsPayments: () => paymentsState.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSPaymentsReportPage />
    </MemoryRouter>,
  );
}

function makePayments(): POSReportsPayments {
  return {
    totalAmount: 6_416_000,
    totalOrders: 84,
    totalTenders: 84,
    timezone: 'Asia/Makassar',
    byMethod: [
      { method: 'cash', amount: 4_458_000, tenders: 61, share_pct: 69.48 },
      { method: 'qris', amount: 1_073_000, tenders: 16, share_pct: 16.72 },
      { method: 'card', amount: 485_000, tenders: 4, share_pct: 7.56 },
    ],
  };
}

describe('POSPaymentsReportPage', () => {
  beforeEach(() => {
    paymentsState.current = { data: undefined, isLoading: false, isError: false };
    authState.current = { canRead: true };
  });

  it('renders the ReportsForbidden splash when the user lacks permission', () => {
    authState.current = { canRead: false };
    renderPage();
    expect(screen.getByText(/reports are restricted/i)).toBeInTheDocument();
  });

  it('renders the loading state while data is fetching', () => {
    paymentsState.current = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.getByText(/loading payments/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    paymentsState.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load payments/i)).toBeInTheDocument();
  });

  it('renders the empty state when no tenders exist', () => {
    paymentsState.current = {
      data: { totalAmount: 0, totalOrders: 0, totalTenders: 0, timezone: 'Asia/Makassar', byMethod: [] },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText(/no payments recorded/i)).toBeInTheDocument();
  });

  it('renders the total tile + per-method rows on happy path', () => {
    paymentsState.current = { data: makePayments(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Tendered')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-cash')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-qris')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-card')).toBeInTheDocument();
    // human-readable label for the tender code
    expect(screen.getByText('QRIS')).toBeInTheDocument();
    expect(screen.getByTestId('pos-payments-export-csv')).toBeInTheDocument();
  });
});
