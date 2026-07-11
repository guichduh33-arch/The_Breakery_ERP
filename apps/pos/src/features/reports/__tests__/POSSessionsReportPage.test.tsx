// apps/pos/src/features/reports/__tests__/POSSessionsReportPage.test.tsx
//
// Reports POS refonte — Lot D smoke for the Sessions (Z-report) tab. Validates
// the role-gate (ReportsForbidden splash), loading + error branches, the empty
// state, and the happy-path summary tiles + table rows (open vs closed, signed
// variance cells, CSV button). Mocks usePOSReportsSessions + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSSessionsReportPage from '../POSSessionsReportPage';
import type { POSReportsSessions } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsSessions | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsSessions: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSSessionsReportPage />
    </MemoryRouter>,
  );
}

function empty(): POSReportsSessions {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      totalSessions: 0,
      openCount: 0,
      closedCount: 0,
      salesTotal: 0,
      voidsTotal: 0,
      cashVarianceTotal: 0,
      cashShortCount: 0,
      cashOverCount: 0,
    },
    sessions: [],
  };
}

function populated(): POSReportsSessions {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      totalSessions: 2,
      openCount: 1,
      closedCount: 1,
      salesTotal: 500_000,
      voidsTotal: 0,
      cashVarianceTotal: -12_000,
      cashShortCount: 1,
      cashOverCount: 0,
    },
    sessions: [
      {
        sessionId: 'open-1',
        status: 'open',
        cashierId: 'c1',
        cashierName: 'Cashier A',
        closedById: null,
        closedByName: null,
        openedAt: '2026-07-10T09:00:00+08:00',
        closedAt: null,
        openingCash: 100_000,
        salesTotal: 200_000,
        orderCount: 5,
        refundsTotal: 0,
        voidsTotal: 0,
        cash: { expected: null, counted: null, variance: null },
        qris: { expected: null, counted: null, variance: null },
        card: { expected: null, counted: null, variance: null },
        openingNotes: null,
        closingNotes: null,
        varianceApproved: false,
      },
      {
        sessionId: 'closed-1',
        status: 'closed',
        cashierId: 'c2',
        cashierName: 'Cashier B',
        closedById: 'm1',
        closedByName: 'Manager M',
        openedAt: '2026-07-09T09:00:00+08:00',
        closedAt: '2026-07-09T18:00:00+08:00',
        openingCash: 100_000,
        salesTotal: 300_000,
        orderCount: 8,
        refundsTotal: 0,
        voidsTotal: 0,
        cash: { expected: 300_000, counted: 288_000, variance: -12_000 },
        qris: { expected: 50_000, counted: 50_000, variance: 0 },
        card: { expected: null, counted: null, variance: null },
        openingNotes: null,
        closingNotes: 'end of day',
        varianceApproved: true,
      },
    ],
  };
}

describe('POSSessionsReportPage', () => {
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
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load sessions/i)).toBeInTheDocument();
  });

  it('renders the empty state when there are no sessions', () => {
    state.current = { data: empty(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No sessions')).toBeInTheDocument();
  });

  it('renders summary tiles, both session rows and the CSV button on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    // Summary strip — unambiguous footer strings (the "Sessions" label collides
    // with the nav tab, so assert on the unique footers instead).
    expect(screen.getByText('1 open · 1 closed')).toBeInTheDocument();
    expect(screen.getByText('1 short · 0 over')).toBeInTheDocument();
    expect(screen.getByTestId('pos-sessions-table')).toBeInTheDocument();
    // Rows: one open, one closed (assert on the status badge — the word also
    // appears in the timeline cell, so scope to the badge testid).
    const openRow = screen.getByTestId('session-open-1');
    expect(within(openRow).getByTestId('session-status-badge')).toHaveTextContent('open');
    const closedRow = screen.getByTestId('session-closed-1');
    expect(within(closedRow).getByTestId('session-status-badge')).toHaveTextContent('closed');
    // Manager-approved variance chip on the closed row.
    expect(within(closedRow).getByText('PIN')).toBeInTheDocument();
    // CSV export present.
    expect(screen.getByTestId('pos-sessions-export-csv')).toBeInTheDocument();
  });
});
