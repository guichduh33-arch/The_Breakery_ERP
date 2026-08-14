// apps/pos/src/features/auth/__tests__/sessionDeathWatch.test.ts
//
// Critique 2026-08-14 P1 — the 401-storm watchdog. Three contracts:
//  T1  a storm (3×401 in the window) probes auth-get-session ONCE (cooldown);
//      a successful probe re-mints the bearer and never locks the terminal.
//  T2  a probe refused with 401 locks the terminal with the session-expired
//      copy — it does NOT logout (cart + shift survive).
//  T3  kiosk surfaces (no PIN session) never trigger the probe.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionMock = vi.fn();
let capturedHandler: ((status: number) => void) | null = null;

vi.mock('@breakery/supabase', () => ({
  // lib/supabase.ts builds the client at module load — a stub suffices here.
  getSupabaseClient: vi.fn(() => ({})),
  setSupabaseAuthErrorHandler: (h: ((status: number) => void) | null) => {
    capturedHandler = h;
  },
  setSupabaseAccessToken: vi.fn(),
  getSession: (...args: unknown[]): unknown => getSessionMock(...args),
  loginWithPin: vi.fn(),
  logoutSession: vi.fn(),
  hasPermission: () => true,
}));

import { initSessionDeathWatch, disposeSessionDeathWatch } from '../sessionDeathWatch';
import { useAuthStore } from '@/stores/authStore';

function stormOnce(): void {
  capturedHandler?.(401);
  capturedHandler?.(401);
  capturedHandler?.(401);
}

async function flush(): Promise<void> {
  // Let the probe promise chain settle.
  await new Promise((r) => setTimeout(r, 0));
}

describe('sessionDeathWatch', () => {
  beforeEach(() => {
    initSessionDeathWatch();
    useAuthStore.setState({
      isAuthenticated: true,
      sessionToken: 'tok-1',
      user: { id: 'u1', full_name: 'E2E Cashier', role_code: 'cashier', employee_code: 'C1' },
      isLocked: false,
      lockReason: null,
    });
    getSessionMock.mockReset();
  });

  afterEach(() => {
    disposeSessionDeathWatch();
  });

  it('T1 — a 401 storm probes the session once; a healthy probe recovers silently', async () => {
    getSessionMock.mockResolvedValue({
      id: 'u1',
      full_name: 'E2E Cashier',
      role_code: 'cashier',
      employee_code: 'C1',
      permissions: [],
      session_timeout_minutes: 30,
      auth: { access_token: 'fresh-jwt' },
    });

    stormOnce();
    stormOnce(); // second storm inside the cooldown — must not re-probe
    await flush();

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isLocked).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('T2 — a probe refused with 401 locks with session_expired and keeps the session context', async () => {
    getSessionMock.mockRejectedValue({ status: 401 });

    stormOnce();
    await flush();

    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(true);
    expect(s.lockReason).toBe('session_expired');
    // NOT a logout — the overlay's re-PIN needs the user, and cart/shift live on.
    expect(s.user?.id).toBe('u1');
  });

  it('T3 — below the storm threshold, or without a PIN session, no probe fires', async () => {
    capturedHandler?.(401);
    capturedHandler?.(401);
    await flush();
    expect(getSessionMock).not.toHaveBeenCalled();

    // Kiosk surface: authenticated=false — even a storm must not probe.
    useAuthStore.setState({ isAuthenticated: false, sessionToken: null });
    stormOnce();
    await flush();
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
