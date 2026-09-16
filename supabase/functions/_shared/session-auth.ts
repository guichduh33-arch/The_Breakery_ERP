// supabase/functions/_shared/session-auth.ts
import { getAdminClient } from './supabase-admin.ts';
import { jsonResponse } from './cors.ts';
import { sessionRejection } from './session-policy.ts';

export interface SessionContext {
  userId: string;          // user_profiles.id
  authUserId: string;      // auth.users.id
  roleCode: string;
  sessionId: string;
  permissions: string[];
  sessionTimeoutMinutes: number;
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
    .select('id, user_id, created_at, last_activity_at, ended_at, permissions_snapshot, session_timeout_minutes, user_profiles!inner(id, auth_user_id, role_code, is_active, deleted_at)')
    .eq('session_token_hash', tokenHash)
    .is('ended_at', null)
    .maybeSingle();

  if (error) return jsonResponse({ error: 'session_unavailable' }, 503);
  if (!session) {
    return jsonResponse({ error: 'session_not_found' }, 401);
  }

  const profile = Array.isArray(session.user_profiles) ? session.user_profiles[0] : session.user_profiles;
  if (!profile || profile.is_active !== true || profile.deleted_at !== null || !profile.auth_user_id) {
    return jsonResponse({ error: 'active_profile_required' }, 401);
  }

  const rejection = sessionRejection(session, Date.now());
  if (rejection) return jsonResponse({ error: rejection }, 401);

  return {
    userId: profile.id,
    authUserId: profile.auth_user_id,
    roleCode: profile.role_code,
    sessionId: session.id,
    permissions: session.permissions_snapshot,
    sessionTimeoutMinutes: session.session_timeout_minutes,
  };
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(token);
}
