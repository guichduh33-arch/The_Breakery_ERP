import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Supabase from '@breakery/supabase';
const mocks = vi.hoisted(() => ({ get: vi.fn(), login: vi.fn(), cloud: vi.fn(), rpc: vi.fn() }));
vi.mock('@breakery/supabase', async (original) => ({ ...await original<typeof Supabase>(),
  getSession: mocks.get, loginWithPin: mocks.login, setSupabaseCloudEnabled: mocks.cloud, setSupabaseAccessToken: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://example.invalid', supabase: { rpc: mocks.rpc } }));
import { useAuthStore } from '../authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { localSessionFromServer } from '@/features/auth/localSession';
import { replayOfflineOutbox } from '@/features/lan/offlineReplay';
import { enqueueIntent, getPendingIntents } from '@/features/lan/offlineOutbox';
const now = Date.now();
const clock = { created_at: new Date(now - 60_000).toISOString(), last_activity_at: new Date(now - 20_000).toISOString(), server_now: new Date(now).toISOString() };
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'reload' }] });
  mocks.get.mockRejectedValue(new TypeError('network'));
  useCloudStatusStore.setState({ cloudOnline: true });
  useAuthStore.setState({ user: { id: 'u', full_name: 'Test', employee_code: 'E', role_code: 'cashier' }, sessionToken: 't',
    isAuthenticated: true, isLocked: false, lockReason: null, permissions: [], bootstrapStatus: 'pending', cloudValidated: false,
    localSession: localSessionFromServer(clock, 30, 't', 'u', ['sales.create'], now) });
});
afterEach(() => vi.unstubAllGlobals());
describe('reprise reload POS', () => {
  it('reprend localement sans ouvrir le cloud ni repousser le délai', async () => {
    const previous = useAuthStore.getState().localSession;
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState()).toMatchObject({ bootstrapStatus: 'ready', permissions: ['sales.create'], cloudValidated: false, localSession: previous });
    expect(mocks.cloud).not.toHaveBeenCalledWith(true);
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it('nouvelle navigation interdit le fallback et détruit l’éligibilité copiée', async () => {
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'navigate' }] });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState()).toMatchObject({ bootstrapStatus: 'error', localSession: null });
  });
  it('le verrou manuel reste fermé hors ligne', async () => {
    useAuthStore.setState({ isLocked: true, lockReason: 'manual' });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState()).toMatchObject({ isLocked: true, permissions: [], cloudValidated: false });
    const saved = JSON.parse(sessionStorage.getItem('breakery-pos-auth') ?? '{}') as { state?: { isLocked: boolean; localSession?: { version: number } } };
    expect(saved.state?.isLocked).toBe(true);
    expect(saved.state?.localSession?.version).toBe(1);
  });
  it.each([401, 403, 404])('refus serveur %s interdit la reprise locale', async (status) => {
    mocks.get.mockRejectedValue({ status });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().permissions).toEqual([]);
    expect(useAuthStore.getState().cloudValidated).toBe(false);
  });
  it('revalidation restaure les permissions serveur sans déverrouiller', async () => {
    useAuthStore.setState({ isLocked: true, lockReason: 'manual' });
    mocks.get.mockResolvedValue({ id: 'u', full_name: 'Test', employee_code: 'E', role_code: 'cashier', permissions: ['new'],
      session_timeout_minutes: 30, session_clock: clock, auth: { access_token: 'fresh', expires_at: 9999999999 } });
    await useAuthStore.getState().validateSession();
    expect(useAuthStore.getState()).toMatchObject({ isLocked: true, cloudValidated: true, permissions: ['new'] });
  });
  it('coalesce les revalidations et ignore un refus tardif pour une autre session', async () => {
    let reject!: (error: unknown) => void;
    mocks.get.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = useAuthStore.getState().validateSession();
    const second = useAuthStore.getState().validateSession();
    expect(mocks.get).toHaveBeenCalledOnce();
    useAuthStore.setState({ sessionToken: 'new-session' });
    reject({ status: 401 });
    await first;
    await second;
    expect(useAuthStore.getState().isLocked).toBe(false);
  });
  it('ne rouvre pas le cloud après une nouvelle coupure pendant le probe', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const probe = useAuthStore.getState().validateSession();
    useCloudStatusStore.setState({ cloudOnline: false });
    resolve({ id: 'u', permissions: [], session_timeout_minutes: 30, session_clock: clock, auth: null });
    await probe;
    expect(useAuthStore.getState().cloudValidated).toBe(false);
    expect(mocks.cloud).not.toHaveBeenCalledWith(true);
  });
  it.each(['bootstrap', 'validateSession'] as const)('ancien 200 après verrou : %s ne réactive ni cloud ni drain', async (method) => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await enqueueIntent({ kind: 'fire', id: 'root', root_client_uuid: 'root', seq: 1,
      created_at: new Date().toISOString(), local_number: 'L-1', session_id: 's', order_type: 'take_out', table_number: null,
      items: [{ product_id: 'p', quantity: 1, unit_price: 100, modifiers: [] }] });
    const pending = useAuthStore.getState()[method]();
    useAuthStore.getState().lock('session_expired');
    resolve({ id: 'u', full_name: 'Test', employee_code: 'E', role_code: 'cashier', permissions: ['new'],
      session_timeout_minutes: 30, session_clock: clock, auth: { access_token: 'stale', expires_at: 9999999999 } });
    await pending;
    expect(useAuthStore.getState()).toMatchObject({ isLocked: true, lockReason: 'session_expired', cloudValidated: false, bootstrapStatus: 'ready' });
    expect(mocks.cloud).not.toHaveBeenCalledWith(true);
    expect(await replayOfflineOutbox()).toEqual({ replayed: 0, failed: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await getPendingIntents()).toHaveLength(1);
  });
  it.each([['bootstrap', 'bootstrap'], ['bootstrap', 'validateSession'], ['validateSession', 'bootstrap']] as const)(
    '%s et %s partagent une seule réponse et attendent sa résolution', async (first, second) => {
      let resolve!: (value: unknown) => void;
      mocks.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockRejectedValueOnce({ status: 401 });
      const one = useAuthStore.getState()[first]();
      const two = useAuthStore.getState()[second]();
      let finished = false;
      void two.then(() => { finished = true; });
      await Promise.resolve();
      expect(finished).toBe(false);
      expect(mocks.get).toHaveBeenCalledOnce();
      resolve({ id: 'u', permissions: ['same'], session_timeout_minutes: 30, session_clock: clock, auth: null });
      await Promise.all([one, two]);
      expect(useAuthStore.getState()).toMatchObject({ cloudValidated: true, permissions: ['same'], isLocked: false });
      await useAuthStore.getState().validateSession();
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState()).toMatchObject({ isLocked: true, cloudValidated: false });
    });
  it.each([403, 404])('refus définitif %s verrouille aussi lors de revalidation', async (status) => {
    mocks.get.mockRejectedValue({ status });
    await useAuthStore.getState().validateSession();
    expect(useAuthStore.getState()).toMatchObject({ isLocked: true, lockReason: 'session_expired', cloudValidated: false });
    expect(mocks.cloud).not.toHaveBeenCalledWith(true);
  });
  it('la fin de l’ancien vol ne supprime pas le vol du nouveau contexte', async () => {
    const resolve: ((value: unknown) => void)[] = [];
    mocks.get.mockImplementation(() => new Promise((done) => { resolve.push(done); }));
    const old = useAuthStore.getState().validateSession();
    useAuthStore.getState().lock('session_expired');
    // Une connexion nouvelle a remplacé le contexte invalidé.
    useAuthStore.setState({ sessionToken: 'new-token', lockReason: null, isLocked: false });
    const current = useAuthStore.getState().validateSession();
    const response = { id: 'u', permissions: ['new'], session_timeout_minutes: 30, session_clock: clock, auth: null };
    resolve[0]!(response);
    await old;
    expect(useAuthStore.getState().cloudValidated).toBe(false);
    const joined = useAuthStore.getState().bootstrap();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    resolve[1]!(response);
    await Promise.all([current, joined]);
    expect(useAuthStore.getState()).toMatchObject({ sessionToken: 'new-token', cloudValidated: true, permissions: ['new'] });
  });
});
