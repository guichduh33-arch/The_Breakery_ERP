// supabase/functions/_shared/session-auth.ts
import { getAdminClient } from './supabase-admin.ts';
import { jsonResponse } from './cors.ts';

const TIMEOUT_MS = 30 * 60 * 1000;          // 30 min inactivity
const MAX_AGE_MS = 24 * 60 * 60 * 1000;     // 24h hard cap

export interface SessionContext {
  userId: string;          // user_profiles.id
  authUserId: string;      // auth.users.id
  roleCode: string;
  sessionId: string;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function requireSession(req: Request): Promise<SessionContext | Response> {
  const token = req.headers.get('x-session-token');
  if (!token) {
    return jsonResponse({ error: 'session_token_required' }, 401);
  }

  const tokenHash = await sha256Hex(token);
  const admin = getAdminClient();

  const { data: session, error } = await admin
    .from('user_sessions')
    .select('id, user_id, created_at, last_activity_at, ended_at, user_profiles!inner(id, auth_user_id, role_code)')
    .eq('session_token_hash', tokenHash)
    .is('ended_at', null)
    .maybeSingle();

  if (error || !session) {
    return jsonResponse({ error: 'session_not_found' }, 401);
  }

  const now = Date.now();
  const lastActivity = new Date(session.last_activity_at).getTime();
  const created = new Date(session.created_at).getTime();

  if (now - lastActivity > TIMEOUT_MS) {
    await admin
      .from('user_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'timeout' })
      .eq('id', session.id);
    return jsonResponse({ error: 'session_timeout' }, 401);
  }

  if (now - created > MAX_AGE_MS) {
    await admin
      .from('user_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'expired' })
      .eq('id', session.id);
    return jsonResponse({ error: 'session_expired' }, 401);
  }

  // Refresh activity
  await admin
    .from('user_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);

  // Note: user_profiles vient via Supabase relational select. Type check.
  const profile = Array.isArray(session.user_profiles) ? session.user_profiles[0] : session.user_profiles;
  if (!profile) return jsonResponse({ error: 'profile_not_found' }, 401);

  return {
    userId: profile.id,
    authUserId: profile.auth_user_id,
    roleCode: profile.role_code,
    sessionId: session.id,
  };
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(token);
}
