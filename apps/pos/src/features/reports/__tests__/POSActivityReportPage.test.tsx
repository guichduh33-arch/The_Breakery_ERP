// apps/pos/src/features/reports/__tests__/POSActivityReportPage.test.tsx
//
// Reports POS refonte — Lot G smoke for the Activity tab. Validates the
// role-gate (ReportsForbidden splash), loading + error branches, the empty
// state, and the happy-path sale-event timeline. Mocks usePOSReportsActivity
// + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSActivityReportPage from '../POSActivityReportPage';
import type { POSReportsEvent } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsEvent[] | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsActivity: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSActivityReportPage />
    </MemoryRouter>,
  );
}

function populated(): POSReportsEvent[] {
  return [
    {
      id: 'order-a1',
      kind: 'sale',
      reference: 'A-1024',
      amount: 85_000,
      at: '2026-07-10T03:00:00Z',
      label: 'Sale completed',
    },
    {
      id: 'order-a2',
      kind: 'sale',
      reference: 'A-1023',
      amount: 42_000,
      at: '2026-07-10T02:00:00Z',
      label: 'Sale completed',
    },
  ];
}

describe('POSActivityReportPage', () => {
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
    expect(screen.getByText(/loading activity/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load activity/i)).toBeInTheDocument();
  });

  it('renders the empty state when there is no activity', () => {
    state.current = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No activity')).toBeInTheDocument();
  });

  it('renders the sale-event timeline on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    const first = screen.getByTestId('activity-order-a1');
    expect(within(first).getByText(/A-1024/)).toBeInTheDocument();
    expect(screen.getByTestId('activity-order-a2')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });
});
