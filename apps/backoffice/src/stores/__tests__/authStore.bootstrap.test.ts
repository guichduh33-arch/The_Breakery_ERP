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
import type * as BreakerySupabase from '@breakery/supabase';

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
  const actual = await importOriginal<typeof BreakerySupabase>();
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
  authSnapshot: null,
} as const;

/** A persisted JWT snapshot still comfortably within its 1 h validity. */
function freshSnapshot() {
  return {
    access_token: 'cached-access',
    refresh_token: 'cached-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3000,
  };
}

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

  // ————— Fast path (2026-08-28) : cache local + revalidation en arrière-plan.
  // Le F5 payait ~0,8-1 s d'auth-get-session bloquant à chaque rechargement dur.
  // Avec un snapshot JWT persisté encore valide ET une liste de permissions non
  // vide, le boot restaure le bearer depuis le cache, ouvre immédiatement, et
  // revalide en arrière-plan (une session révoquée → logout via le 401).

  it('boots instantly from a valid persisted snapshot, without awaiting the round-trip', async () => {
    useAuthStore.setState({
      sessionToken: 'tok',
      isAuthenticated: true,
      permissions: ['orders.read'],
      sessionTimeoutMinutes: 60,
      authSnapshot: freshSnapshot(),
    });
    // Round-trip artificially pending: ready must NOT wait for it.
    let resolveSession!: (v: unknown) => void;
    getSession.mockReturnValue(new Promise((r) => { resolveSession = r; }));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(s.bootstrapStatus).toBe('ready');
    // Bearer restored from the CACHED snapshot, not from the network.
    expect(setSession).toHaveBeenCalledWith({ access_token: 'cached-access', refresh_token: 'cached-refresh' });
    expect(s.permissions).toContain('orders.read');
    // Background revalidation was fired.
    expect(getSession).toHaveBeenCalledWith('http://test.local', 'tok');

    // When it lands, fresh perms/timeout replace the cached ones.
    resolveSession({
      id: 'u-1', full_name: 'Mamat', role_code: 'SUPER_ADMIN', employee_code: 'E1',
      permissions: ['orders.read', 'reports.read'],
      session_timeout_minutes: 120,
      auth: { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().permissions).toContain('reports.read');
    });
    expect(useAuthStore.getState().sessionTimeoutMinutes).toBe(120);
  });

  it('logs out when the background revalidation reports a revoked session (401)', async () => {
    useAuthStore.setState({
      sessionToken: 'tok',
      isAuthenticated: true,
      permissions: ['orders.read'],
      authSnapshot: freshSnapshot(),
    });
    getSession.mockRejectedValue(Object.assign(new Error('session_invalid'), { status: 401 }));

    await useAuthStore.getState().bootstrap();
    // Instant open first…
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
    // …then the background 401 tears the session down.
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
    expect(logoutSession).toHaveBeenCalled();
  });

  it('falls back to the blocking path when the snapshot is expired', async () => {
    useAuthStore.setState({
      sessionToken: 'tok',
      isAuthenticated: true,
      permissions: ['orders.read'],
      authSnapshot: { access_token: 'stale', refresh_token: 'stale-r', expires_at: Math.floor(Date.now() / 1000) - 10 },
    });
    getSession.mockResolvedValue({
      id: 'u-1', full_name: 'Mamat', role_code: 'ADMIN', employee_code: 'E1',
      permissions: ['orders.read'],
      session_timeout_minutes: 60,
      auth: { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });

    await useAuthStore.getState().bootstrap();

    // The bearer came from the round-trip, never from the stale snapshot.
    expect(setSession).toHaveBeenCalledWith({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' });
    expect(setSession).not.toHaveBeenCalledWith({ access_token: 'stale', refresh_token: 'stale-r' });
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
  });

  it('falls back to the blocking path when no permissions were persisted alongside the snapshot', async () => {
    useAuthStore.setState({
      sessionToken: 'tok',
      isAuthenticated: true,
      permissions: [],
      authSnapshot: freshSnapshot(),
    });
    getSession.mockResolvedValue({
      id: 'u-1', full_name: 'Mamat', role_code: 'ADMIN', employee_code: 'E1',
      permissions: ['orders.read'],
      session_timeout_minutes: 60,
      auth: { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });

    await useAuthStore.getState().bootstrap();

    expect(setSession).toHaveBeenCalledWith({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' });
    expect(useAuthStore.getState().permissions).toContain('orders.read');
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
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
