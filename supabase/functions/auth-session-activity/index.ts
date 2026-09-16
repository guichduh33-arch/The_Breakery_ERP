import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';

export async function handleSessionActivity(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const session = await requireSession(req);
  if (session instanceof Response) return session;
  const limit = await checkRateLimitDurable({
    functionName: 'auth-session-activity', bucketKey: `session:${session.sessionId}`,
    ipAddress: getClientIp(req), maxPerWindow: 2, windowSec: 60,
  });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSec);
  const { data, error } = await getAdminClient().rpc('touch_user_session_v1', { p_session_id: session.sessionId });
  if (error) return jsonResponse({ error: 'session_unavailable' }, 503);
  if (data !== true) return jsonResponse({ error: 'session_expired' }, 401);
  return jsonResponse({ ok: true });
}

serve(handleSessionActivity);
