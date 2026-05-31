// supabase/functions/_shared/acting-user.ts
// S34 security (security-fraud-guard Pattern #4) — resolve the acting cashier's
// auth.uid from the incoming Bearer PIN-JWT, server-side.
//
// Context: the reversal RPCs (void/cancel/refund) are now service_role-only
// (REVOKE'd from authenticated) and called via the admin client, so auth.uid()
// is NULL inside them. The cashier identity must therefore be resolved in the
// Edge Function and passed explicitly as p_acting_auth_user_id.
//
// The PIN-JWT is HS256-signed with SUPABASE_JWT_SECRET (see auth-verify-pin).
// We VERIFY the signature (not just decode) so a forged token cannot misattribute
// the operation to another cashier. `sub` carries the auth_user_id.

import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

let _key: CryptoKey | null = null;

async function getVerifyKey(): Promise<CryptoKey> {
  if (_key) return _key;
  const secret = Deno.env.get('SUPABASE_JWT_SECRET');
  if (!secret) throw new Error('Missing SUPABASE_JWT_SECRET');
  _key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return _key;
}

/**
 * Verify the Bearer PIN-JWT and return the acting user's auth.uid (`sub` claim),
 * or null if the header is missing / malformed / signature-invalid.
 */
export async function getActingAuthUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const key = await getVerifyKey();
    const payload = await verify(token, key);
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
