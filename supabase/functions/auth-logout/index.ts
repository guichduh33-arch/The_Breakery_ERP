// supabase/functions/auth-logout/index.ts
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
  await admin
    .from('user_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'logout' })
    .eq('id', sessionResult.sessionId);

  await admin.from('audit_logs').insert({
    actor_id: sessionResult.userId,
    action: 'logout',
    entity_type: 'user_sessions',
    entity_id: sessionResult.sessionId,
  });

  return jsonResponse({ ok: true });
});
