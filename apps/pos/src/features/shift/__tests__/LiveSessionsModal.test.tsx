// apps/pos/src/features/shift/__tests__/LiveSessionsModal.test.tsx
//
// Session 14 — Phase 2.D smoke for the Live Sessions modal. Mocks
// useLiveSessions so each render is deterministic ; uses a real
// QueryClientProvider only because the refresh button calls
// queryClient.invalidateQueries.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

// S3-01 — le bouton de clôture d'une autre session dépend de l'utilisateur.
const authState = { current: { userId: 'me', canCloseOthers: false } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(sel: (s: { user: { id: string }; hasPermission: (c: string) => boolean }) => T) =>
    sel({ user: { id: authState.current.userId },
      hasPermission: (c) => c === 'pos.session.close_other' && authState.current.canCloseOthers }),
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
    authState.current = { userId: 'me', canCloseOthers: false };
  });

  it('lets a manager close another cashier\'s shift, never their own (S3-01)', () => {
    authState.current = { userId: 'me', canCloseOthers: true };
    sessionsState.current = { ...sessionsState.current,
      data: [session({ id: 'other', opened_by: 'u1' }), session({ id: 'mine', opened_by: 'me' })] };
    const onCloseOther = vi.fn();
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} onCloseOtherShift={onCloseOther} />));
    expect(within(screen.getByTestId('live-session-mine')).queryByTestId('live-session-close')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('live-session-other')).getByTestId('live-session-close'));
    expect(onCloseOther).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }));
  });

  it('hides the close button without pos.session.close_other (S3-01)', () => {
    sessionsState.current = { ...sessionsState.current, data: [session({ id: 'other', opened_by: 'u1' })] };
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} onCloseOtherShift={vi.fn()} />));
    expect(screen.queryByTestId('live-session-close')).not.toBeInTheDocument();
  });

  it('renders the Live Sessions header and active count when open', () => {
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} />));
    expect(screen.getByRole('heading', { name: 'Live Sessions' })).toBeInTheDocument();
    expect(screen.getByText(/0 active/i)).toBeInTheDocument();
    expect(screen.getByTestId('live-sessions-modal')).toBeInTheDocument();
  });

  it('renders the empty-state when no sessions are open', () => {
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} />));
    expect(screen.getByText(/no live sessions/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(withQuery(<LiveSessionsModal open={false} onClose={() => { /* fixture sans effet */ }} />));
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
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} />));
    expect(screen.getByText('TERM-ALPHA')).toBeInTheDocument();
    expect(screen.getByText('TERM-BRAVO')).toBeInTheDocument();
    expect(screen.getByText(/2 active/i)).toBeInTheDocument();
  });

  // S3-04 — alerte sur une session ouverte depuis plus de 24 h.
  it('shows the stale-session badge for a session open 25h', () => {
    sessionsState.current = {
      data: [session({ id: 'old', opened_at: new Date(Date.now() - 25 * 3_600_000).toISOString() })],
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} />));
    const row = screen.getByTestId('live-session-old');
    expect(within(row).getByTestId('stale-session-badge')).toHaveTextContent('Open over 24h');
  });

  it('does not show the stale-session badge for a session open 23h', () => {
    sessionsState.current = {
      data: [session({ id: 'recent', opened_at: new Date(Date.now() - 23 * 3_600_000).toISOString() })],
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    render(withQuery(<LiveSessionsModal open onClose={() => { /* fixture sans effet */ }} />));
    expect(screen.getByTestId('live-session-recent')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-session-badge')).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(withQuery(<LiveSessionsModal open onClose={onClose} />));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
