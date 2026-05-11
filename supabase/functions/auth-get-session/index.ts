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
  const { data: profile, error } = await admin
    .from('user_profiles')
    .select('id, auth_user_id, full_name, role_code, employee_code, is_active')
    .eq('id', sessionResult.userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !profile) {
    return jsonResponse({ error: 'profile_not_found' }, 404);
  }

  const permissions = computePermissionsForRole(profile.role_code);

  return jsonResponse({
    user: profile,
    permissions,
    session_id: sessionResult.sessionId,
  });
});

