// apps/pos/src/lib/__tests__/accessToken.test.ts
//
// POS audit 2026-06-12 — locks the `no_auth_session` regression: under PIN
// auth the JWT lives in the module holder (setSupabaseAccessToken) and
// GoTrue's getSession() returns null in a real browser. The token resolver
// MUST prefer the holder, falling back to GoTrue only for email-login/tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAccessToken: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@breakery/supabase', () => ({
  getSupabaseAccessToken: mocks.getSupabaseAccessToken,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import { getAccessToken } from '@/lib/accessToken';

describe('getAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the PIN-holder token even when GoTrue has no session (real-browser PIN auth)', async () => {
    mocks.getSupabaseAccessToken.mockReturnValue('pin-jwt');
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await expect(getAccessToken()).resolves.toBe('pin-jwt');
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('falls back to the GoTrue session token when no PIN token is set', async () => {
    mocks.getSupabaseAccessToken.mockReturnValue(null);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'gotrue-jwt' } } });

    await expect(getAccessToken()).resolves.toBe('gotrue-jwt');
  });

  it('throws no_auth_session when neither source has a token', async () => {
    mocks.getSupabaseAccessToken.mockReturnValue(null);
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await expect(getAccessToken()).rejects.toThrow('no_auth_session');
  });
});
