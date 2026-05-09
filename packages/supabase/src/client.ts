import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated.js';

let _client: SupabaseClient<Database> | null = null;
let _accessToken: string | null = null;

export interface BreakerySupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Set the PIN-issued access token used by the PostgREST/Realtime/Functions
 * clients. We do NOT call supabase.auth.setSession() because the PIN EF mints
 * HS256 JWTs while modern supabase CLI ships ES256-only GoTrue, which 403s on
 * /auth/v1/user. Instead, we inject the token directly into the Authorization
 * header on every request via a custom fetch.
 */
export function setSupabaseAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getSupabaseAccessToken(): string | null {
  return _accessToken;
}

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

export function resetSupabaseClient(): void {
  _client = null;
  _accessToken = null;
}
