// supabase/tests/functions/_helpers/auth.ts
// Shared login helper for the live-RPC vitest suite (S77 / Lot C).
//
// WHY THIS EXISTS
//   ~44 test files each POSTed the `auth-verify-pin` edge function to mint a
//   JWT. That EF is rate-limited (~3 req/min/IP) and the suite runs serial
//   (`fileParallelism: false`), so ~90 sequential logins produced a storm of
//   `{"error":"rate_limited"}` every nightly run. On top of that the seed PIN
//   for EMP000 drifted (changed via the app) so even un-throttled logins hit
//   `invalid_credentials`.
//
//   This helper sidesteps the EF entirely: it mints a session through the
//   GoTrue admin API (service key) — `generateLink` (magiclink) → `verifyOtp`
//   → session access_token. The project validates both ES256 (GoTrue) and the
//   HS256 legacy PIN JWTs against PostgREST, so an ES256 GoTrue token works for
//   every RPC these tests call. No rate limit, no PIN dependency.
//
//   The `pin` argument is kept on every export for signature compatibility with
//   the call-sites (mechanical migration) but is IGNORED.

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

// V3 dev publishable key (project `ikcyvlovptebroadgtvd`). Public by design,
// committable. The old `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` fallback
// scattered across the suite was the LOCAL Docker stack key — invalid against
// cloud, which is what produced the anon-path 401s.
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_bJehhsPF6Hbg5nJKFCQWWw_Npz7gt1Z';

export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Anon client carrying a user access token as Bearer — the RLS-scoped client. */
export function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

interface CachedToken {
  token: string;
  profileId: string;
  authUserId: string;
  at: number;
}

const TTL_MS = 40 * 60 * 1000;
const memCache = new Map<string, CachedToken>();
const CACHE_FILE = join(tmpdir(), 'breakery-vitest-tokens.json');

function cacheKey(employeeCode: string): string {
  return `${employeeCode}@${SUPABASE_URL}`;
}

function isFresh(entry: CachedToken | undefined): entry is CachedToken {
  return !!entry && Date.now() - entry.at < TTL_MS;
}

function readFileCache(): Record<string, CachedToken> {
  try {
    if (!existsSync(CACHE_FILE)) return {};
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, CachedToken>;
  } catch {
    // Corrupt / concurrently-written cache file must never fail a login.
    return {};
  }
}

function writeFileCache(entry: CachedToken, key: string): void {
  try {
    const all = readFileCache();
    all[key] = entry;
    writeFileSync(CACHE_FILE, JSON.stringify(all), 'utf8');
  } catch {
    // Best-effort; the module-level cache still serves within a run.
  }
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// `EmailOtpType` (auth-js 2.105.1) = 'signup' | 'invite' | 'magiclink' |
// 'recovery' | 'email_change' | 'email' — so both 'email' and 'magiclink'
// typecheck for `verifyOtp({ token_hash, type })`. GoTrue's accepted runtime
// value can vary by version, so we try 'email' first then 'magiclink', minting
// a FRESH single-use magiclink for each attempt (a wrong-type verify can burn
// the token).
const VERIFY_TYPES = ['email', 'magiclink'] as const;

async function mintAccessToken(employeeCode: string, email: string): Promise<string> {
  const errors: string[] = [];
  for (const type of VERIFY_TYPES) {
    const admin = adminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      errors.push(`generateLink(${type}): ${linkErr?.message ?? 'no hashed_token'}`);
      continue;
    }
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    const accessToken = verifyData?.session?.access_token;
    if (!verifyErr && accessToken) return accessToken;
    errors.push(`verifyOtp(${type}): ${verifyErr?.message ?? 'no session'}`);
  }
  throw new Error(`loginAs(${employeeCode}): could not mint session — ${errors.join(' | ')}`);
}

/**
 * Mint a session for an employee and return the token plus identity fields.
 * The `_pin` argument is accepted for call-site compatibility and IGNORED.
 */
export async function loginAsFull(
  employeeCode: string,
  _pin?: string,
): Promise<{ token: string; profileId: string; authUserId: string }> {
  const key = cacheKey(employeeCode);

  const mem = memCache.get(key);
  if (isFresh(mem)) {
    return { token: mem.token, profileId: mem.profileId, authUserId: mem.authUserId };
  }

  const onDisk = readFileCache()[key];
  if (isFresh(onDisk)) {
    memCache.set(key, onDisk);
    return { token: onDisk.token, profileId: onDisk.profileId, authUserId: onDisk.authUserId };
  }

  if (!SERVICE_KEY) {
    throw new Error(
      `loginAs(${employeeCode}): SUPABASE_SERVICE_ROLE_KEY is not set — cannot mint an admin session.`,
    );
  }

  const admin = adminClient();

  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('id, auth_user_id')
    .eq('employee_code', employeeCode)
    .is('deleted_at', null)
    .single();
  if (profileErr || !profile) {
    throw new Error(
      `loginAs(${employeeCode}): user_profiles lookup failed — ${profileErr?.message ?? 'no row'}`,
    );
  }
  const profileId = profile.id as string;
  const authUserId = profile.auth_user_id as string | null;
  if (!authUserId) {
    throw new Error(`loginAs(${employeeCode}): user_profiles.auth_user_id is null`);
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(authUserId);
  const email = userData?.user?.email;
  if (userErr || !email) {
    throw new Error(
      `loginAs(${employeeCode}): getUserById(${authUserId}) failed — ${userErr?.message ?? 'no email'}`,
    );
  }

  const token = await mintAccessToken(employeeCode, email);

  const entry: CachedToken = { token, profileId, authUserId, at: Date.now() };
  memCache.set(key, entry);
  writeFileCache(entry, key);
  return { token, profileId, authUserId };
}

/**
 * Mint a session for an employee and return just the access token.
 * The `_pin` argument is accepted for call-site compatibility and IGNORED.
 */
export async function loginAs(employeeCode: string, _pin?: string): Promise<string> {
  const { token } = await loginAsFull(employeeCode, _pin);
  return token;
}
