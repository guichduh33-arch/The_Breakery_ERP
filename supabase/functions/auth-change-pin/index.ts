// supabase/functions/auth-change-pin/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { evaluatePinStrength } from '../_shared/pin-strength.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';

const PIN_REGEX = /^\d{6}$/;

interface ChangePinPayload {
  user_id: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const sessionResult = await requireSession(req);
  if (sessionResult instanceof Response) return sessionResult;

  let body: ChangePinPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  // S25 hard cutover (session 59) — PINs travel via dedicated headers, never
  // in the JSON body (request bodies get logged by PostgREST/pgaudit/proxies).
  const current_pin = req.headers.get('x-current-pin') ?? undefined;
  const new_pin = req.headers.get('x-new-pin') ?? undefined;

  const { user_id } = body;
  if (!user_id || !new_pin) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!PIN_REGEX.test(new_pin)) {
    return jsonResponse({ error: 'invalid_new_pin_format' }, 400);
  }

  // Durable rate-limit (SEC-S30-MED-03) — the self-rotate path verifies current_pin
  // via verify_user_pin, which has NO lockout (unlike auth-verify-pin). Without this,
  // a holder of a valid session can brute-force the current PIN to rotate it. Bucket on
  // the TARGET user_id (caps attempts per account regardless of how many sessions the
  // attacker mints — stronger than a per-session bucket).
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
  const isSelf = user_id === sessionResult.userId;

  if (isSelf) {
    if (!current_pin) {
      return jsonResponse({ error: 'current_pin_required' }, 400);
    }
    const { data: pinValid } = await admin.rpc('verify_user_pin', {
      p_user_id: user_id,
      p_pin: current_pin,
    });
    if (!pinValid) {
      return jsonResponse({ error: 'invalid_current_pin' }, 401);
    }
  } else {
    // Admin override : caller must have users.update
    if (!['SUPER_ADMIN', 'ADMIN'].includes(sessionResult.roleCode)) {
      return jsonResponse({ error: 'permission_denied' }, 403);
    }
  }

  const { data: newHash, error: hashErr } = await admin.rpc('hash_pin', { p_pin: new_pin });
  if (hashErr || !newHash) {
    return jsonResponse({ error: 'hash_failed' }, 500);
  }

  const { error: updateErr } = await admin
    .from('user_profiles')
    .update({
      pin_hash: newHash,
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', user_id);

  if (updateErr) {
    return jsonResponse({ error: 'update_failed' }, 500);
  }

  await admin.from('audit_logs').insert({
    actor_id: sessionResult.userId,
    action: isSelf ? 'pin.change_self' : 'pin.change_admin',
    entity_type: 'user_profiles',
    entity_id: user_id,
  });

  const strength = evaluatePinStrength(new_pin);
  const responseBody: Record<string, unknown> = { ok: true, weak: strength.weak };
  if (strength.weak && strength.reason) {
    responseBody.weak_reason = strength.reason;
  }
  return jsonResponse(responseBody);
});
