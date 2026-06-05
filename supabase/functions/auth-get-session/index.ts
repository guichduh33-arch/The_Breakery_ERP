// supabase/functions/auth-get-session/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { computePermissionsForRole } from '../_shared/permissions.ts';
import { signJwt, getJwtSecret } from '../_shared/jwt.ts';

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const sessionResult = await requireSession(req);
  if (sessionResult instanceof Response) return sessionResult;

  const admin = getAdminClient();
  // Session 19 / Phase 3.A — join roles to surface session_timeout_minutes
  // for the idle-logout hook (useIdleTimeout). The role row is keyed by
  // user_profiles.role_code → roles.code (a TEXT FK).
  const { data: profile, error } = await admin
    .from('user_profiles')
    .select('id, auth_user_id, full_name, role_code, employee_code, is_active, role:roles!user_profiles_role_code_fkey(session_timeout_minutes)')
    .eq('id', sessionResult.userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !profile) {
    return jsonResponse({ error: 'profile_not_found' }, 404);
  }

  const permissions = await computePermissionsForRole(profile.role_code, profile.id);

  // PostgREST returns the embedded role as `role: { ... } | null`. We flatten
  // the timeout out (the original `user` shape stays unchanged so existing
  // callers keep working).
  const role = (profile as { role?: { session_timeout_minutes?: number } | null }).role ?? null;
  const sessionTimeoutMinutes = role?.session_timeout_minutes ?? null;
  const { role: _drop, ...userOnly } = profile as Record<string, unknown> & { role?: unknown };

  // Re-mint a fresh Supabase-compatible HS256 JWT so the client can restore its
  // bearer token after a hard reload. Without this, `auth-get-session` only
  // proves the opaque session is still valid — the PostgREST bearer minted at
  // login is lost when the tab is reloaded (the BO client runs with
  // `persistSession: false`), so every RLS-protected query would 401 with
  // "permission denied for table ..." until the next PIN login.
  //
  // Payload mirrors `auth-verify-pin` exactly (same secret, same HS256 alg) so
  // the custom-fetch wrapper in packages/supabase injects it identically.
  const jwtSecret = getJwtSecret();
  let auth: { access_token: string; refresh_token: string; expires_at: number } | null = null;
  if (jwtSecret) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + 3600; // 1 hour
    const accessToken = await signJwt(
      {
        iss: 'supabase',
        ref: 'local',
        role: 'authenticated',
        aud: 'authenticated',
        sub: profile.auth_user_id, // auth.users.id
        email: `cashier-${profile.employee_code}@thebreakery.local`,
        iat: nowSec,
        exp: expiresAt,
        app_metadata: { provider: 'pin' },
        user_metadata: { employee_code: profile.employee_code, role: profile.role_code },
      },
      jwtSecret,
    );
    // The opaque session token (used to re-probe later) doubles as the refresh
    // marker, matching the `pin-session:<token>` convention from auth-verify-pin.
    const sessionToken = req.headers.get('x-session-token') ?? '';
    auth = { access_token: accessToken, refresh_token: `pin-session:${sessionToken}`, expires_at: expiresAt };
  }

  return jsonResponse({
    user: userOnly,
    permissions,
    session_id: sessionResult.sessionId,
    session_timeout_minutes: sessionTimeoutMinutes,
    auth,
  });
});

