import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ from }) }));
import { computePermissionsForRole, checkPermissionForRole, PermissionsUnavailableError, withPermissionErrors } from '../../functions/_shared/permissions';

function respond(roleError: unknown = null, overrideError: unknown = null) {
  from.mockImplementation((table: string) => {
    const response = table === 'role_permissions'
      ? { data: [{ permission_code: 'users.update' }, { permission_code: 'orders.read' }], error: roleError }
      : { data: [
        { permission_code: 'users.update', is_granted: true, expires_at: null },
        { permission_code: 'users.update', is_granted: false, expires_at: null },
        { permission_code: 'extra', is_granted: true, expires_at: null },
        { permission_code: 'orders.read', is_granted: false, expires_at: '2000-01-01' },
        { permission_code: 'expired', is_granted: true, expires_at: '2000-01-01' },
      ], error: overrideError };
    const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve) };
    return query;
  });
}

describe('permissions — refus sur lecture incomplète', () => {
  beforeEach(() => { vi.clearAllMocks(); respond(); });
  it('conserve DENY prioritaire et ignore les overrides expirés', async () => {
    expect(await computePermissionsForRole('CUSTOM','profile')).toEqual(['extra','orders.read']);
    expect(await checkPermissionForRole('CUSTOM','users.update','profile')).toBe(false);
  });
  it.each(['role','overrides'])('refuse une erreur de lecture %s', async (source) => {
    respond(source === 'role' ? { message: 'offline' } : null, source === 'overrides' ? { message: 'offline' } : null);
    await expect(computePermissionsForRole('ADMIN','profile')).rejects.toBeInstanceOf(PermissionsUnavailableError);
  });
  it('ne rend pas les grants du rôle lorsque les DENY ne sont pas lisibles', async () => {
    respond(null, { message: 'timeout' });
    await expect(checkPermissionForRole('ADMIN','users.update','profile')).rejects.toThrow('authorization_unavailable');
  });
  it('rend un 503 contrôlé avant tout nonce ou mutation', async () => {
    respond(null, { message: 'timeout' });
    const mutate = vi.fn();
    const handler = withPermissionErrors(async () => {
      await checkPermissionForRole('ADMIN','users.update','profile');
      mutate();
      return new Response(null, { status: 200 });
    });
    const response = await handler(new Request('https://example.test'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'authorization_unavailable' });
    expect(mutate).not.toHaveBeenCalled();
  });
  it('ne masque pas une erreur sans rapport avec les permissions', async () => {
    const handler = withPermissionErrors(async () => { throw new Error('other failure'); });
    await expect(handler(new Request('https://example.test'))).rejects.toThrow('other failure');
  });
});
