import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { read, update, query } = vi.hoisted(() => {
  const read = vi.fn();
  const update = vi.fn();
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: read, update };
  return { read, update, query };
});
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({ from: () => query }),
}));
import { requireSession } from '../../functions/_shared/session-auth';

describe('requireSession — profil actif avant activité', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
  });
  it.each([
    null, [], { id: 'profile', is_active: false, deleted_at: null },
    { id: 'profile', is_active: true, deleted_at: '2026-01-01' },
  ])('refuse %j sans renouveler la session', async (profile) => {
    read.mockResolvedValue({ data: {
      id: 'session', last_activity_at: new Date(Date.now()-120000).toISOString(),
      created_at: new Date().toISOString(), user_profiles: profile,
    }, error: null });
    const result = await requireSession(new Request('https://example.test', { headers: { 'x-session-token': 'token' } }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('rend les identités distinctes du profil actif', async () => {
    const now = new Date().toISOString();
    read.mockResolvedValue({ data: {
      id: 'session', last_activity_at: now, created_at: now,
      ended_at: null, permissions_snapshot: ['orders.read'], session_timeout_minutes: 30,
      user_profiles: { id: 'profile', auth_user_id: 'auth', role_code: 'CUSTOM', is_active: true, deleted_at: null },
    }, error: null });
    expect(await requireSession(new Request('https://example.test', { headers: { 'x-session-token': 'token' } })))
      .toEqual({ userId: 'profile', authUserId: 'auth', roleCode: 'CUSTOM', sessionId: 'session',
        permissions: ['orders.read'], sessionTimeoutMinutes: 30 });
  });
});
