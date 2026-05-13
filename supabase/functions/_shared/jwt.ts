// supabase/functions/_shared/jwt.ts
// Shared HS256 JWT signer for Edge Functions.
//
// Both `auth-verify-pin` (PIN flow) and `kiosk-issue-jwt` (kiosk flow) mint
// HS256 JWTs signed with `SUPABASE_JWT_SECRET` (V3 dev: `JWT_SECRET` in
// supabase/functions/.env to avoid SUPABASE_-prefix filtering by the local
// serve runtime). Extracted from auth-verify-pin/index.ts (Session 8 D4 perf
// cache pattern) per design ref §3.1.
//
// Same secret + same HS256 algorithm = the custom-fetch wrapper in
// packages/supabase/src/client.ts injects the bearer token identically ; the
// PostgREST/Realtime stack honours the `role: 'authenticated'` claim regardless
// of provider (pin vs kiosk).

// Module-scope CryptoKey cache. Edge Function instances are reused across
// invocations ; importKey() is ~1-3ms per call, caching removes that cost
// from every invocation after the first.
let _hmacKey: CryptoKey | null = null;

export async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (_hmacKey) return _hmacKey;
  _hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return _hmacKey;
}

/**
 * Sign a JWT using HS256 via Web Crypto API (Deno native).
 *
 * @param payload - JWT payload (will be JSON-encoded then base64url'd).
 * @param secret  - SUPABASE_JWT_SECRET / JWT_SECRET env var contents.
 * @returns Signed JWT string in `header.payload.signature` format.
 */
export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${enc(header)}.${enc(payload)}`;
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sigB64}`;
}

/**
 * Resolve the JWT secret from Deno env. Tries `JWT_SECRET` first
 * (V3 dev convention — non SUPABASE_-prefixed for local serve), falls back
 * to `SUPABASE_JWT_SECRET` (Supabase-managed env in staging/prod).
 *
 * @returns The secret string, or null if neither env var is set.
 */
export function getJwtSecret(): string | null {
  return Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET') ?? null;
}
