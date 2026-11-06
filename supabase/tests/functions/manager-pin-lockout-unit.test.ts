import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  counts: new Map<string, { count: number; until: number }>(),
  read: vi.fn(), rpc: vi.fn(), audit: vi.fn(), candidates: [] as Record<string, unknown>[],
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      if (table === 'audit_logs') return { insert: state.audit };
      if (table === 'user_profiles') {
        const query = { select: () => query, in: () => query, eq: () => query,
          is: () => Promise.resolve({ data: state.candidates, error: null }) };
        return query;
      }
      let bucket = '';
      const query = {
        select: () => query, gt: () => query,
        eq: (key: string, value: string) => { if (key === 'bucket_key') bucket = value; return query; },
        maybeSingle: () => state.read(bucket),
      };
      return query;
    },
  }),
}));

import { isManagerPinBlocked, recordManagerPinFailure, verifyManagerPin } from '../../functions/_shared/manager-pin.ts';
import { PermissionsUnavailableError } from '../../functions/_shared/permissions.ts';

beforeEach(() => {
  vi.clearAllMocks();
  state.counts.clear(); state.candidates = [];
  state.audit.mockResolvedValue({ error: null });
  state.read.mockImplementation((key: string) => {
    const row = state.counts.get(key);
    return Promise.resolve({ data: row && row.until > Date.now()
      ? { request_count: row.count, window_end: new Date(row.until).toISOString() } : null, error: null });
  });
  state.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    const key = String(args.p_bucket_key);
    const old = state.counts.get(key);
    const count = old && old.until > Date.now() ? old.count : 0;
    const allowed = count < Number(args.p_max_per_window);
    const next = { count: allowed ? count + 1 : count, until: old?.until ?? Date.now() + 900000 };
    state.counts.set(key, next);
    return { data: [{ allowed, retry_after_sec: allowed ? 0 : 900, current_count: next.count }], error: null };
  });
});

describe('verrouillage durable du PIN manager', () => {
  it('lit les deux compteurs sans compter une vérification réussie', async () => {
    expect(await isManagerPinBlocked('192.0.2.1', 'cashier-a')).toBe(false);
    expect(state.read.mock.calls.map(([key]) => key)).toEqual(['ip:192.0.2.1', 'actor:cashier-a']);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('bloque le même caissier malgré les changements d’IP et un nouvel import du helper', async () => {
    for (let n = 1; n <= 5; n++) await recordManagerPinFailure(`192.0.2.${n}`, 'void-order', 'cashier-a');
    vi.resetModules();
    const fresh = await import('../../functions/_shared/manager-pin.ts');
    expect(await fresh.isManagerPinBlocked('192.0.2.99', 'cashier-a')).toBe(true);
    expect(await fresh.isManagerPinBlocked('192.0.2.99', 'cashier-b')).toBe(false);
    expect(state.rpc).toHaveBeenCalledTimes(10);
    expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      actor_id: null, metadata: { ip: '192.0.2.5', function: 'void-order', acting_auth_user_id: 'cashier-a' },
    }));
  });

  it('conserve la garde IP existante et libère les fenêtres expirées', async () => {
    state.counts.set('ip:192.0.2.1', { count: 5, until: Date.now() + 10000 });
    expect(await isManagerPinBlocked('192.0.2.1', 'cashier-b')).toBe(true);
    state.counts.set('ip:192.0.2.1', { count: 5, until: Date.now() - 1 });
    expect(await isManagerPinBlocked('192.0.2.1', 'cashier-b')).toBe(false);
  });

  it.each(['error', 'throw', 'malformed'])('refuse une lecture durable %s', async (kind) => {
    if (kind === 'throw') state.read.mockRejectedValue(new Error('offline'));
    else state.read.mockResolvedValue(kind === 'error'
      ? { data: null, error: { code: '08006' } } : { data: { request_count: '0' }, error: null });
    await expect(isManagerPinBlocked('192.0.2.1', 'cashier-a')).rejects.toMatchObject({ name: 'PermissionsUnavailableError' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([{ data: null }, { data: [] }, { data: [{}] },
    { data: [{ allowed: 'true', retry_after_sec: 0, current_count: 1 }] },
    { data: [{ allowed: true, retry_after_sec: -1, current_count: 1 }] },
  ])('refuse un résultat de compteur invalide %j', async ({ data }) => {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(recordManagerPinFailure('192.0.2.1', 'refund-order', 'cashier-a')).rejects.toMatchObject({ name: 'PermissionsUnavailableError' });
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('ne poursuit pas si le compteur durable ne peut pas être écrit', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(recordManagerPinFailure('192.0.2.1', 'refund-order', 'cashier-a'))
      .rejects.toMatchObject({ name: 'PermissionsUnavailableError' });
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('exige l’identité vérifiée de l’appelant', async () => {
    await expect(isManagerPinBlocked('192.0.2.1', '')).rejects.toBeInstanceOf(PermissionsUnavailableError);
    expect(state.read).not.toHaveBeenCalled();
  });

  it.each([null, { verified: true }])('refuse une réponse PIN non booléenne %j', async (data) => {
    state.candidates = [{ id: 'manager-1', role_code: 'MANAGER', full_name: 'Manager', locked_until: null }];
    state.rpc.mockResolvedValue({ data, error: null });
    expect(await verifyManagerPin('123456')).toEqual({ ok: false, reason: 'internal' });
  });

  it('ne transforme pas une panne du vérificateur PIN en mauvais PIN', async () => {
    state.candidates = [{ id: 'manager-1', role_code: 'MANAGER', locked_until: null }];
    state.rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    expect(await verifyManagerPin('123456')).toEqual({ ok: false, reason: 'internal' });
  });

  it('accepte un PIN vérifié et ignore les managers verrouillés', async () => {
    state.candidates = [
      { id: 'locked', role_code: 'MANAGER', locked_until: new Date(Date.now() + 10000).toISOString() },
      { id: 'manager-2', role_code: 'ADMIN', full_name: 'Manager', locked_until: null },
    ];
    state.rpc.mockResolvedValue({ data: true, error: null });
    expect(await verifyManagerPin('123456')).toEqual({ ok: true, manager_profile_id: 'manager-2', role_code: 'ADMIN', full_name: 'Manager' });
    expect(state.rpc).toHaveBeenCalledOnce();
  });
});
