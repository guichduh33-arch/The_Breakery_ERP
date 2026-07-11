// apps/pos/src/features/reports/__tests__/POSVoidsReportPage.test.tsx
//
// Reports POS refonte — Lot C smoke for the Voids tab. Validates the role-gate
// (ReportsForbidden splash), loading + error branches, the two empty states
// (no reversals / no discounts), and the happy-path tiles + breakdown rows +
// CSV button. Mocks usePOSReportsVoidsRefunds + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSVoidsReportPage from '../POSVoidsReportPage';
import type { POSReportsVoidsRefunds } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsVoidsRefunds | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsVoidsRefunds: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSVoidsReportPage />
    </MemoryRouter>,
  );
}

function empty(): POSReportsVoidsRefunds {
  return {
    timezone: 'Asia/Makassar',
    reversals: {
      voids: { count: 0, amount: 0, taxRefunded: 0, afterKitchenCount: 0, beforeKitchenCount: 0 },
      refunds: { count: 0, amount: 0, taxRefunded: 0 },
      itemCancellations: { count: 0, afterKitchenCount: 0, beforeKitchenCount: 0 },
      byReason: [],
      byOperator: [],
      byAuthorizer: [],
    },
    discounts: { totalAmount: 0, orderCount: 0, compCount: 0, byType: [], byOperator: [] },
  };
}

function populated(): POSReportsVoidsRefunds {
  return {
    timezone: 'Asia/Makassar',
    reversals: {
      voids: { count: 2, amount: 50_000, taxRefunded: 5_000, afterKitchenCount: 1, beforeKitchenCount: 1 },
      refunds: { count: 1, amount: 12_000, taxRefunded: 1_200 },
      itemCancellations: { count: 3, afterKitchenCount: 2, beforeKitchenCount: 1 },
      byReason: [{ reason: 'wrong order', count: 2, amount: 40_000 }],
      byOperator: [{ operator_id: 'u1', operator_name: 'Cashier A', count: 3, amount: 62_000 }],
      byAuthorizer: [{ operator_id: 'm1', operator_name: 'Manager B', count: 3, amount: 62_000 }],
    },
    discounts: {
      totalAmount: 77_000,
      orderCount: 22,
      compCount: 0,
      byType: [{ type: 'percentage', count: 22, amount: 77_000 }],
      byOperator: [{ operator_id: 'm1', operator_name: 'Manager B', count: 22, amount: 77_000 }],
    },
  };
}

describe('POSVoidsReportPage', () => {
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
    expect(screen.getByText(/loading voids/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load voids/i)).toBeInTheDocument();
  });

  it('renders both empty states when there are no reversals nor discounts', () => {
    state.current = { data: empty(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No voids or refunds')).toBeInTheDocument();
    expect(screen.getByText('No discounts')).toBeInTheDocument();
  });

  it('renders tiles, breakdowns and the CSV button on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Full voids')).toBeInTheDocument();
    expect(screen.getByText('Partial refunds')).toBeInTheDocument();
    expect(screen.getByText('Item cancellations')).toBeInTheDocument();
    expect(screen.getByText(/wrong order/i)).toBeInTheDocument();
    expect(screen.getByTestId('discount-type-percentage')).toBeInTheDocument();
    expect(screen.getByTestId('pos-voids-export-csv')).toBeInTheDocument();
  });
});
