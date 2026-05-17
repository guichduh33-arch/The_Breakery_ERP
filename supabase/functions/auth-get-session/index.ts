// supabase/functions/auth-get-session/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { computePermissionsForRole } from '../_shared/permissions.ts';

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

  return jsonResponse({
    user: userOnly,
    permissions,
    session_id: sessionResult.sessionId,
    session_timeout_minutes: sessionTimeoutMinutes,
  });
});

