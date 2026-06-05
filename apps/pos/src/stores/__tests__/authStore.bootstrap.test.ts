// apps/pos/src/stores/__tests__/authStore.bootstrap.test.ts
//
// Non-regression for the "401 on every request after reload" bug:
//   The PIN bearer lives in a module variable (setSupabaseAccessToken), lost on
//   reload. bootstrap() must restore it from the EF-reminted `auth` bundle AND
//   re-fetch permissions before any query fires — never leave the client on the
//   anon key (which 401s + triggers the retry storm).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, logoutSession, setSupabaseAccessToken } = vi.hoisted(() => ({
  getSession: vi.fn(),
  logoutSession: vi.fn().mockResolvedValue(undefined),
  setSupabaseAccessToken: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'http://test.local' }));

vi.mock('@breakery/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@breakery/supabase')>();
  return { ...actual, getSession, logoutSession, setSupabaseAccessToken };
});

import { useAuthStore } from '@/stores/authStore';

const RESET = {
  user: null,
  sessionToken: null,
  permissions: [],
  isAuthenticated: false,
  isLocked: false,
  isLoading: false,
  error: null,
  bootstrapStatus: 'pending',
  sessionTimeoutMinutes: null,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState(RESET as never);
});

describe('POS authStore.bootstrap', () => {
  it('flips to ready without a round-trip when no session is persisted', async () => {
    await useAuthStore.getState().bootstrap();
    expect(getSession).not.toHaveBeenCalled();
    expect(setSupabaseAccessToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
  });

  it('restores the PIN bearer AND rehydrates permissions for a valid session', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockResolvedValue({
      id: 'u-1',
      full_name: 'Mamat',
      role_code: 'SUPER_ADMIN',
      employee_code: 'E1',
      permissions: ['pos.sale.create'],
      session_timeout_minutes: 30,
      auth: { access_token: 'pin-jwt', refresh_token: 'r', expires_at: 1 },
    });

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(setSupabaseAccessToken).toHaveBeenCalledWith('pin-jwt');
    expect(s.permissions).toContain('pos.sale.create');
    expect(s.bootstrapStatus).toBe('ready');
    // SUPER_ADMIN bypass — fixes being blocked on /pos/reports.
    expect(s.hasPermission('reports.sales.read')).toBe(true);
  });

  it('logs out on a 401 (revoked/expired session)', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockRejectedValue(Object.assign(new Error('session_invalid'), { status: 401 }));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(logoutSession).toHaveBeenCalled();
    expect(setSupabaseAccessToken).toHaveBeenCalledWith(null); // dropped by logout()
    expect(s.isAuthenticated).toBe(false);
    expect(s.bootstrapStatus).toBe('ready');
  });

  it('enters error state and KEEPS the session when the backend is unreachable', async () => {
    useAuthStore.setState({ sessionToken: 'tok', isAuthenticated: true });
    getSession.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(s.bootstrapStatus).toBe('error');
    expect(s.sessionToken).toBe('tok');
    expect(s.isAuthenticated).toBe(true);
    expect(logoutSession).not.toHaveBeenCalled();
  });
});
