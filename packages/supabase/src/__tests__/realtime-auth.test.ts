// P0-2 (audit POS live 2026-06-12) : le JWT PIN/kiosk doit atteindre le
// WebSocket realtime via realtime.setAuth — sans ça, toutes les subscriptions
// postgres_changes tournent en anon (révoqué S20) et ne reçoivent rien.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  setSupabaseKioskAccessToken,
} from '../client.js';

const CONFIG = { url: 'http://localhost:54321', anonKey: 'test-anon-key' };

describe('realtime auth propagation (P0-2)', () => {
  beforeEach(() => resetSupabaseClient());

  it('setSupabaseAccessToken forwards the token to realtime.setAuth', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    // async pour matcher la vraie signature realtime-js (Promise<void>) —
    // les call sites chaînent .catch() sur la valeur de retour.
    client.realtime.setAuth = (async (t?: string | null) => {
      calls.push(t);
    }) as typeof client.realtime.setAuth;

    setSupabaseAccessToken('pin-jwt-123');
    expect(calls).toEqual(['pin-jwt-123']);

    setSupabaseAccessToken(null); // logout → revert to anon
    expect(calls).toEqual(['pin-jwt-123', null]);
  });

  it('setSupabaseKioskAccessToken forwards the kiosk token too', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    client.realtime.setAuth = (async (t?: string | null) => {
      calls.push(t);
    }) as typeof client.realtime.setAuth;

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
});
