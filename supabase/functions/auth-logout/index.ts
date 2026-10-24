// supabase/functions/auth-logout/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { hashSessionToken } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const token = req.headers.get('x-session-token');
  if (!token || token.length > 1024) return jsonResponse({ error: 'session_token_required' }, 401);
  try {
    const admin = getAdminClient();
    // Le secret opaque autorise seulement sa propre révocation, même après expiration.
    // Il ne restaure jamais l'identité, les permissions ou l'activité de la session.
    const { data: session, error: lookupError } = await admin.from('user_sessions')
      .select('id, user_id, ended_at').eq('session_token_hash', await hashSessionToken(token)).maybeSingle();
    if (lookupError) return jsonResponse({ error: 'logout_unavailable' }, 503);
    // Absence/fin confirmée en base : un ACK perdu est rejouable sans nouvel audit.
    if (!session || session.ended_at !== null) return jsonResponse({ ok: true });
    const { data, error } = await admin.rpc('logout_user_session_v1', {
      p_session_id: session.id, p_user_id: session.user_id,
    });
    if (error || data !== true) return jsonResponse({ error: 'logout_unavailable' }, 503);
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: 'logout_unavailable' }, 503);
  }
});
