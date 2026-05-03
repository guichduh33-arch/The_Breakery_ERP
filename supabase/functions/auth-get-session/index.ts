// supabase/functions/auth-get-session/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

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

function computePermissionsForRole(role: string): string[] {
  // Identique à auth-verify-pin. Dans une vraie codebase on extrait dans _shared,
  // mais Deno Edge Functions imports cross-folder marchent moyennement,
  // on accepte la duplication temporaire.
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return [
        'pos.session.open', 'pos.session.close_own', 'pos.session.close_other',
        'pos.session.view_all', 'pos.sale.create', 'pos.sale.void', 'pos.sale.update',
        'products.read', 'products.create', 'products.update',
        'users.create', 'users.update', 'users.view_audit',
      ];
    case 'MANAGER':
      return [
        'pos.session.open', 'pos.session.close_own', 'pos.session.close_other',
        'pos.session.view_all', 'pos.sale.create', 'pos.sale.void', 'pos.sale.update',
        'products.read', 'products.create', 'products.update',
      ];
    case 'CASHIER':
      return ['pos.session.open', 'pos.session.close_own', 'pos.sale.create', 'products.read'];
    default:
      return [];
  }
}
