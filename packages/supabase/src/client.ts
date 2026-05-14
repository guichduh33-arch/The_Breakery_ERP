import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated.js';

let _client: SupabaseClient<Database> | null = null;
let _accessToken: string | null = null;

/**
 * Configuration injected on first {@link getSupabaseClient} call.
 *
 * @property url     - Supabase project URL (e.g. `http://localhost:54321` for local CLI).
 * @property anonKey - Supabase anon API key. Used as the `apikey` header alongside
 *                     the Authorization bearer token from {@link setSupabaseAccessToken}.
 */
export interface BreakerySupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Set the PIN-issued access token used by the PostgREST/Realtime/Functions
 * clients. We do NOT call `supabase.auth.setSession()` because the PIN EF mints
 * HS256 JWTs while modern supabase CLI ships ES256-only GoTrue, which 403s on
 * `/auth/v1/user`. Instead, we inject the token directly into the Authorization
 * header on every request via a custom fetch.
 *
 * @param token - PIN-issued JWT (HS256) from {@link loginWithPin}, or `null` to clear.
 *
 * @example
 * ```ts
 * const res = await loginWithPin(url, { user_id, pin, device_type: 'pos' });
 * setSupabaseAccessToken(res.auth.access_token);
 * // subsequent supabase queries now carry Authorization: Bearer <token>
 * ```
 */
export function setSupabaseAccessToken(token: string | null): void {
  _accessToken = token;
}

/**
 * Read the currently injected PIN access token.
 *
 * @returns The active token, or `null` if no user is signed in.
 */
export function getSupabaseAccessToken(): string | null {
  return _accessToken;
}

/**
 * Inject a kiosk JWT (from `kiosk-issue-jwt` EF) into the bearer header.
 *
 * Mechanically identical to {@link setSupabaseAccessToken} — both PIN and
 * kiosk tokens are HS256 signed with `SUPABASE_JWT_SECRET` and ride the same
 * custom-fetch wrapper. The wrapper exists to make intent explicit at call
 * sites (KDS/Display/Tablet boot vs. PIN login).
 *
 * @param token - Kiosk JWT (HS256), or `null` to clear.
 */
export function setSupabaseKioskAccessToken(token: string | null): void {
  _accessToken = token;
}

/**
 * Lazily create (or reuse) the singleton Supabase client.
 *
 * The client is configured with `autoRefreshToken: false` and
 * `persistSession: false` because session lifecycle is owned by the PIN
 * Edge Functions (see {@link loginWithPin}/{@link logoutSession}), not by
 * GoTrue. Authorization is injected by {@link setSupabaseAccessToken} via
 * a custom `global.fetch` wrapper.
 *
 * @param config - Required on first call; ignored on subsequent calls.
 * @returns The shared `SupabaseClient<Database>` instance.
 * @throws {Error} `Supabase client not initialized` if called without `config`
 *                  before the first initialization.
 */
export function getSupabaseClient(config?: BreakerySupabaseConfig): SupabaseClient<Database> {
  if (_client) return _client;
  if (!config) throw new Error('Supabase client not initialized — pass config on first call');
  _client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-app': 'breakery' },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (_accessToken) {
          headers.set('Authorization', `Bearer ${_accessToken}`);
          headers.set('apikey', config.anonKey);
        }
        return fetch(input, { ...init, headers });
      },
    },
  });
  return _client;
}

/**
 * Reset the singleton client and clear the access token. Intended for tests
 * (forces a fresh `createClient` on next {@link getSupabaseClient} call).
 */
export function resetSupabaseClient(): void {
  _client = null;
  _accessToken = null;
}
