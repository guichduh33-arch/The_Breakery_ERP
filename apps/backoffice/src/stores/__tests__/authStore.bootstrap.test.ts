// apps/backoffice/src/stores/__tests__/authStore.bootstrap.test.ts
//
// Non-regression for the "permissions lost on reload" bug:
//   Login → F5 on a protected route must KEEP the session, re-fetch the role's
//   permissions, and restore the Supabase bearer — never degrade to an empty
//   permission list (which collapsed the sidebar + redirected every gated route).
//
// Covers authStore.bootstrap() across its four outcomes:
//   1. no persisted session            → ready, no round-trip
//   2. valid session                   → perms rehydrated + bearer restored, ready
//   3. 401 (revoked/expired)           → logged out, ready
//   4. backend unreachable (5xx/net)   → error state, session KEPT for retry

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the (hoisted) vi.mock factories below can reference them safely.
const { setSession, signOut, getSession, logoutSession } = vi.hoisted(() => ({
  setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  getSession: vi.fn(),
  logoutSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { auth: { setSession, signOut } },
  supabaseUrl: 'http://test.local',
}));

vi.mock('@breakery/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@breakery/supabase')>();
  return { ...actual, getSession, logoutSession };
});

import { useAuthStore } from '@/stores/authStore.js';

const RESET = {
  user: null,
  sessionToken: null,
  permissions: [],
  isAuthenticated: false,
  isLoading: false,
  error: null,
  bootstrapStatus: 'pending',
  sessionTimeoutMinutes: null,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState(RESET as never);
});

describe('authStore.bootstrap', () => {
  it('flips straight to ready without a round-trip when no session is persisted', async () => {
    await useAuthStore.getState().bootstrap();
    expect(getSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
  });

  it('rehydrates permissions AND restores the Supabase bearer for a valid session', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockResolvedValue({
      id: 'u-1',
      full_name: 'Mamat',
      role_code: 'SUPER_ADMIN',
      employee_code: 'E1',
      permissions: ['orders.read'],
      session_timeout_minutes: 60,
      auth: { access_token: 'access-x', refresh_token: 'refresh-x', expires_at: 123 },
    });

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(getSession).toHaveBeenCalledWith('http://test.local', 'tok');
    // Bearer restored (the fix for "permission denied for table products").
    expect(setSession).toHaveBeenCalledWith({ access_token: 'access-x', refresh_token: 'refresh-x' });
    expect(s.permissions).toContain('orders.read');
    expect(s.sessionTimeoutMinutes).toBe(60);
    expect(s.bootstrapStatus).toBe('ready');
    // SUPER_ADMIN bypass: every gate passes even beyond the returned list.
    expect(s.hasPermission('reports.financial.read')).toBe(true);
  });

  it('logs out and goes ready on a 401 (revoked/expired session)', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockRejectedValue(Object.assign(new Error('session_invalid'), { status: 401 }));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(logoutSession).toHaveBeenCalled();
    expect(s.isAuthenticated).toBe(false);
    expect(s.sessionToken).toBeNull();
    expect(s.bootstrapStatus).toBe('ready');
  });

  it('enters error state and KEEPS the session when the backend is unreachable', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(s.bootstrapStatus).toBe('error');
    expect(s.error).toBe('backend_unreachable');
    // Session preserved so the user can retry without re-entering their PIN.
    expect(s.sessionToken).toBe('tok');
    expect(s.isAuthenticated).toBe(true);
    expect(logoutSession).not.toHaveBeenCalled();
  });
});
