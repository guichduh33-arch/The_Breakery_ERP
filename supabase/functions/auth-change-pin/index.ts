// supabase/functions/auth-change-pin/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { evaluatePinStrength } from '../_shared/pin-strength.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';

const PIN_REGEX = /^\d{6}$/;

export async function handleChangePin(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const sessionResult = await requireSession(req);
  if (sessionResult instanceof Response) return sessionResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  // S25 hard cutover (session 59) — PINs travel via dedicated headers, never
  // in the JSON body (request bodies get logged by PostgREST/pgaudit/proxies).
  const current_pin = req.headers.get('x-current-pin') ?? undefined;
  const new_pin = req.headers.get('x-new-pin') ?? undefined;

  const user_id = body && typeof body === 'object' && 'user_id' in body ? body.user_id : null;
  if (typeof user_id !== 'string' || !user_id || !new_pin) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!PIN_REGEX.test(new_pin)) {
    return jsonResponse({ error: 'invalid_new_pin_format' }, 400);
  }

  // Limite durable complémentaire au verrouillage de compte dans la RPC.
  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'auth-change-pin',
    bucketKey:    `user:${user_id}`,
    ipAddress:    ip,
    maxPerWindow: 5,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  const admin = getAdminClient();
  // La RPC revalide le profil actif, les permissions effectives et la cible.
  // Vérification, mutation et audit partagent la même transaction.
  const { data, error } = await admin.rpc('change_user_pin_v1', {
    p_actor_id: sessionResult.userId,
    p_user_id: user_id,
    p_new_pin: new_pin,
    p_current_pin: current_pin ?? null,
  });
  if (error || !data || typeof data !== 'object') {
    return jsonResponse({ error: 'change_pin_failed' }, 500);
  }
  if (data.ok !== true) {
    const code = typeof data.error === 'string' ? data.error : 'change_pin_failed';
    if (code === 'account_locked') return rateLimitedResponse(900, code);
    const status = code === 'invalid_current_pin' || code === 'active_profile_required' ? 401
      : code === 'current_pin_required' || code === 'invalid_new_pin_format' ? 400
      : code === 'user_not_found' ? 404
      : code === 'permission_denied' || code === 'super_admin_only' ? 403 : 500;
    return jsonResponse({ error: code }, status);
  }

  const strength = evaluatePinStrength(new_pin);
  const responseBody: Record<string, unknown> = { ok: true, weak: strength.weak };
  if (strength.weak && strength.reason) {
    responseBody.weak_reason = strength.reason;
  }
  return jsonResponse(responseBody);
}

serve(handleChangePin);
