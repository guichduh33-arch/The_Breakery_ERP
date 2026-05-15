// apps/pos/src/features/shift/__tests__/LiveSessionsModal.test.tsx
//
// Session 14 — Phase 2.D smoke for the Live Sessions modal. Mocks
// useLiveSessions so each render is deterministic ; uses a real
// QueryClientProvider only because the refresh button calls
// queryClient.invalidateQueries.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveSessionsModal } from '../LiveSessionsModal';
import type { LiveSession } from '../hooks/useLiveSessions';

const sessionsState = {
  current: {
    data: [] as LiveSession[],
    isLoading: false,
    isError: false,
    isFetching: false,
  },
};

vi.mock('../hooks/useLiveSessions', () => ({
  useLiveSessions: () => sessionsState.current,
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'sess-abcdef12',
    opening_cash: 200_000,
    opened_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    opened_by: 'u1',
    cashier_name: 'Mamat',
    terminal_label: 'TERM-ABCDEF12',
    cash_movements_total: 0,
    order_count: 0,
    ...overrides,
  };
}

describe('LiveSessionsModal', () => {
  beforeEach(() => {
    sessionsState.current = { data: [], isLoading: false, isError: false, isFetching: false };
  });

  it('renders the Live Sessions header and active count when open', () => {
    render(withQuery(<LiveSessionsModal open onClose={() => {}} />));
    expect(screen.getByRole('heading', { name: 'Live Sessions' })).toBeInTheDocument();
    expect(screen.getByText(/0 active/i)).toBeInTheDocument();
    expect(screen.getByTestId('live-sessions-modal')).toBeInTheDocument();
  });

  it('renders the empty-state when no sessions are open', () => {
    render(withQuery(<LiveSessionsModal open onClose={() => {}} />));
    expect(screen.getByText(/no live sessions/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(withQuery(<LiveSessionsModal open={false} onClose={() => {}} />));
    expect(screen.queryByTestId('live-sessions-modal')).toBeNull();
  });

  it('renders one row per session with its terminal label', () => {
    sessionsState.current = {
      data: [
        session({ id: 'a', terminal_label: 'TERM-ALPHA' }),
        session({ id: 'b', terminal_label: 'TERM-BRAVO' }),
      ],
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    render(withQuery(<LiveSessionsModal open onClose={() => {}} />));
    expect(screen.getByText('TERM-ALPHA')).toBeInTheDocument();
    expect(screen.getByText('TERM-BRAVO')).toBeInTheDocument();
    expect(screen.getByText(/2 active/i)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(withQuery(<LiveSessionsModal open onClose={onClose} />));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
