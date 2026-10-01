// P0-2 (audit POS live 2026-06-12) : le JWT PIN/kiosk doit atteindre le
// WebSocket realtime via realtime.setAuth — sans ça, toutes les subscriptions
// postgres_changes tournent en anon (révoqué S20) et ne reçoivent rien.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  setSupabaseKioskAccessToken,
  setSupabaseCloudEnabled,
  isSupabaseCloudEnabled,
} from '../client.js';

const CONFIG = { url: 'http://localhost:54321', anonKey: 'test-anon-key' };

describe('realtime auth propagation (P0-2)', () => {
  beforeEach(() => resetSupabaseClient());
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('BO/kiosk : défaut ouvert ; barrière POS refuse fetch et websocket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(isSupabaseCloudEnabled()).toBe(true);
    const client = getSupabaseClient(CONFIG);
    await client.from('products').select('id');
    expect(fetchMock).toHaveBeenCalledOnce();
    setSupabaseCloudEnabled(false);
    await client.from('products').select('id');
    expect(fetchMock).toHaveBeenCalledOnce();
    client.realtime.connect();
    expect(client.realtime.connectionState()).toBe('closed');
    setSupabaseCloudEnabled(true);
    fetchMock.mockResolvedValue(new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
    await client.from('products').select('id');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('setSupabaseAccessToken forwards the token to realtime.setAuth', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    // Promise.resolve() pour matcher la vraie signature realtime-js
    // (Promise<void>) — les call sites chaînent .catch() sur la valeur de retour.
    client.realtime.setAuth = (t?: string | null) => {
      calls.push(t);
      return Promise.resolve();
    };

    setSupabaseAccessToken('pin-jwt-123');
    expect(calls).toEqual(['pin-jwt-123']);

    setSupabaseAccessToken(null); // logout → revert to anon
    expect(calls).toEqual(['pin-jwt-123', null]);
  });

  it('setSupabaseKioskAccessToken forwards the kiosk token too', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    client.realtime.setAuth = (t?: string | null) => {
      calls.push(t);
      return Promise.resolve();
    };

    setSupabaseKioskAccessToken('kiosk-jwt-456');
    expect(calls).toEqual(['kiosk-jwt-456']);
  });

  it('a token set BEFORE client creation is applied at creation', () => {
    setSupabaseAccessToken('early-token'); // _client is null — must not throw
    const client = getSupabaseClient(CONFIG);
    // supabase-js ≥ 2.39 expose le token courant du RealtimeClient.
    const rt = client.realtime as unknown as { accessTokenValue: string | null };
    expect(rt.accessTokenValue).toBe('early-token');
  });

  it.each([
    ['PIN', setSupabaseAccessToken],
    ['kiosk', setSupabaseKioskAccessToken],
  ] as const)('keeps the current %s token through implicit SDK refreshes', async (_kind, setToken) => {
    const client = getSupabaseClient(CONFIG);
    setToken('first-token');
    // Le SDK appelle setAuth() sans argument après un join et à la reconnexion.
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe('first-token');
    setToken('renewed-token');
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe('renewed-token');
  });

  it('keeps a token injected before initialization through SDK refresh', async () => {
    setSupabaseAccessToken('early-token');
    const client = getSupabaseClient(CONFIG);
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe('early-token');
  });

  it.each([setSupabaseAccessToken, setSupabaseKioskAccessToken])('clears the realtime token on logout', async (setToken) => {
    const client = getSupabaseClient(CONFIG);
    setToken('signed-in-token');
    await client.realtime.setAuth();
    setToken(null);
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe(CONFIG.anonKey);
  });

  it('preserves GoTrue auth and its fallback when no PIN or kiosk token exists', async () => {
    const client = getSupabaseClient(CONFIG);
    const getSession = vi.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'gotrue-token' } as Session }, error: null,
    });
    await client.realtime.setAuth();
    expect(getSession).toHaveBeenCalled();
    expect(client.realtime.accessTokenValue).toBe('gotrue-token');
    setSupabaseAccessToken('pin-token');
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe('pin-token');
    setSupabaseAccessToken(null);
    await client.realtime.setAuth();
    expect(client.realtime.accessTokenValue).toBe('gotrue-token');
  });

  it('uses the current PIN when it arrives during the GoTrue fallback', async () => {
    const client = getSupabaseClient(CONFIG);
    let release!: (value: { data: { session: null }; error: null }) => void;
    vi.spyOn(client.auth, 'getSession').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = client.realtime.accessToken!();
    setSupabaseAccessToken('new-pin-token');
    release({ data: { session: null }, error: null });
    expect(await pending).toBe('new-pin-token');
  });
});
