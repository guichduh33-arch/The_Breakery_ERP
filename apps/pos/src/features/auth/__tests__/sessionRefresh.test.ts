// apps/pos/src/features/auth/__tests__/sessionRefresh.test.ts
//
// Backlog 401 — proactive PIN-JWT refresh. Four contracts:
//  T1  a live session schedules ONE probe ~10 min before authExpiresAt; a
//      successful probe re-mints (new expiry) and reschedules the next tick.
//  T2  kiosk surfaces / logged-out state (no PIN session) never probe.
//  T3  a transient failure (network) retries on the 60 s floor instead of
//      giving up — the JWT still has its 10-minute runway.
//  T4  a session locked for session_expired stops the timer (the overlay's
//      re-PIN is the only way back).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionMock = vi.fn();

vi.mock('@breakery/supabase', () => ({
  // lib/supabase.ts builds the client at module load — a stub suffices here.
  getSupabaseClient: vi.fn(() => ({})),
  setSupabaseAuthErrorHandler: vi.fn(),
  setSupabaseAccessToken: vi.fn(),
  getSession: (...args: unknown[]): unknown => getSessionMock(...args),
  loginWithPin: vi.fn(),
  logoutSession: vi.fn(),
  hasPermission: () => true,
}));

import { initSessionRefresh, disposeSessionRefresh } from '../sessionRefresh';
import { useAuthStore } from '@/stores/authStore';

const MIN = 60_000;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function freshSession(expiresInSec: number) {
  return {
    id: 'u1',
    full_name: 'E2E Cashier',
    role_code: 'cashier',
    employee_code: 'C1',
    permissions: [],
    session_timeout_minutes: 30,
    auth: { access_token: 'fresh-jwt', refresh_token: '', expires_at: nowSec() + expiresInSec },
  };
}

describe('sessionRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSessionMock.mockReset();
    useAuthStore.setState({
      isAuthenticated: true,
      sessionToken: 'tok-1',
      user: { id: 'u1', full_name: 'E2E Cashier', role_code: 'cashier', employee_code: 'C1' },
      isLocked: false,
      lockReason: null,
      authExpiresAt: nowSec() + 3600, // JWT lives 60 min
    });
  });

  afterEach(() => {
    disposeSessionRefresh();
    vi.useRealTimers();
  });

  it('T1 — probes once ~10 min before expiry, then reschedules on the re-minted expiry', async () => {
    getSessionMock.mockImplementation(() => Promise.resolve(freshSession(3600)));
    initSessionRefresh();

    // 49 min: still inside the scheduled delay — no probe yet.
    await vi.advanceTimersByTimeAsync(49 * 60 * 1000);
    expect(getSessionMock).not.toHaveBeenCalled();

    // 50 min: the tick fires, the EF re-mints (new expiry 60 min out).
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000 + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    // Next tick lands ~50 min after the re-mint, not on the 60 s floor.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(41 * 60 * 1000);
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it('T2 — no PIN session (kiosk / logged out): the timer never arms', async () => {
    useAuthStore.setState({ isAuthenticated: false, sessionToken: null, authExpiresAt: null });
    initSessionRefresh();
    await vi.advanceTimersByTimeAsync(2 * 3600 * 1000);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('T3 — a transient failure retries on the 60 s floor', async () => {
    getSessionMock.mockRejectedValue(new Error('network'));
    initSessionRefresh();

    await vi.advanceTimersByTimeAsync(50 * 60 * 1000 + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    // authExpiresAt did not move — the clamp turns the reschedule into 60 s.
    await vi.advanceTimersByTimeAsync(MIN + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MIN + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(3);
  });

  it('T4 — session_expired lock stops the timer; a fresh login re-arms it', async () => {
    getSessionMock.mockRejectedValue({ status: 401 });
    initSessionRefresh();

    // The probe hits a server 401 → validateSession locks the terminal.
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000 + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().lockReason).toBe('session_expired');

    // Locked: no more probes, ever — no silent retry loop on a dead session.
    await vi.advanceTimersByTimeAsync(3 * 3600 * 1000);
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    // Re-PIN (login) mints a fresh bearer → the subscription re-arms the timer.
    getSessionMock.mockImplementation(() => Promise.resolve(freshSession(3600)));
    useAuthStore.setState({
      isLocked: false,
      lockReason: null,
      authExpiresAt: nowSec() + 3600,
    });
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000 + 50);
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });
});
