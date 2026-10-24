// Authentification des tests connectés via le même contrat PIN que les applications.
// Aucun jeton GoTrue seul, aucun changement de PIN ou remise à zéro du lockout.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_bJehhsPF6Hbg5nJKFCQWWw_Npz7gt1Z';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
interface Identity { token: string; profileId: string; authUserId: string }
interface CachedSession extends Identity { sessionToken: string }
const sessions = new Map<string, CachedSession>();
const MAX_ATTEMPTS = 3;

async function postAuth(slug: string, headers: Record<string,string>, body?: unknown): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: 'POST', headers: { apikey: ANON_KEY, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export async function loginAsFull(employeeCode: string, pin?: string): Promise<Identity> {
  const key = `${employeeCode}@${SUPABASE_URL}`;
  const cached = sessions.get(key);
  if (cached) {
    const response = await postAuth('auth-get-session', { 'x-session-token': cached.sessionToken });
    if (response.ok) {
      const restored = await response.json() as { auth?: { access_token?: string } };
      if (restored.auth?.access_token) {
        cached.token = restored.auth.access_token;
        return { token: cached.token, profileId: cached.profileId, authUserId: cached.authUserId };
      }
    }
    sessions.delete(key);
  }
  const loginPin = process.env[`TEST_PIN_${employeeCode}`] || pin;
  if (!loginPin) throw new Error(`loginAs(${employeeCode}): supply a real PIN or TEST_PIN_${employeeCode}; GoTrue alone is not an application session.`);
  if (!/^\d{6}$/.test(loginPin)) throw new Error(`loginAs(${employeeCode}): configure a valid six-digit test PIN.`);
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for test profile lookup.');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error } = await admin.from('user_profiles')
    .select('id, auth_user_id').eq('employee_code', employeeCode).is('deleted_at', null).single();
  if (error || !profile?.auth_user_id) throw new Error(`loginAs(${employeeCode}): active linked test profile required.`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await postAuth('auth-verify-pin', {
      'Content-Type': 'application/json', 'x-login-pin': loginPin,
    }, { user_id: profile.id, device_type: 'pos' });
    const body = await response.json() as {
      auth?: { access_token?: string }; session?: { token?: string; session_id?: string };
      error?: string; retry_after_sec?: number;
    };
    if (response.ok && body.auth?.access_token && body.session?.token && body.session.session_id) {
      const entry = { token: body.auth.access_token, profileId: profile.id as string,
        authUserId: profile.auth_user_id as string, sessionToken: body.session.token };
      sessions.set(key, entry);
      return { token: entry.token, profileId: entry.profileId, authUserId: entry.authUserId };
    }
    if (body.error === 'rate_limited' && attempt < MAX_ATTEMPTS) {
      const waitMs = Math.min(Math.max((body.retry_after_sec ?? 62) * 1000, 1000), 62_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    // Ne jamais afficher le payload d'authentification ni relancer un PIN incorrect.
    throw new Error(`loginAs(${employeeCode}): PIN login refused (HTTP ${response.status}).`);
  }
  throw new Error(`loginAs(${employeeCode}): rate limit remained active.`);
}
export async function loginAs(employeeCode: string, pin?: string): Promise<string> {
  return (await loginAsFull(employeeCode, pin)).token;
}
export async function loginAsViaPinEF(employeeCode: string, pin: string): Promise<string> {
  return loginAs(employeeCode, pin);
}
