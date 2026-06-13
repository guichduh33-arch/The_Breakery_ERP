// supabase/functions/verify-manager-pin/index.ts
// Session 43 (P0-1c / DEV-S43-B1-01) — PIN-only manager verification for the
// POS discount-authorization flow.
//
// Why a dedicated EF: `auth-verify-pin` is the LOGIN edge function — it requires
// `user_id` + `device_type` in the body (400 missing_fields otherwise). The
// discount flow is PIN-only: the cashier types the manager's PIN and nobody
// knows WHICH manager, so the login contract can never be satisfied here.
// Instead we reuse the canonical PIN-only helper (`_shared/manager-pin.ts`,
// same path as void-order / cancel-item / refund-order):
//   - S25: the manager PIN travels in the `x-manager-pin` HTTP header, NEVER
//     in the JSON body (bodies are logged; headers are not).
//   - SEC-07: failures consume the SHARED per-IP `manager-pin-fail` bucket
//     (5 fails / 15 min) — a brute-force attempt against this EF locks the IP
//     out of the reversal EFs too, and vice versa.
// The acting cashier's Bearer PIN-JWT is HS256-verified in-function via
// `getActingAuthUserId` (same as void-order) — the EF stays self-defending even
// if verify_jwt were ever disabled at deploy. A successful verification writes
// an audit_logs row (`manager_pin.verified`, non-fatal on error) — unlike
// void-order whose success necessarily writes a void, this EF would otherwise
// confirm a guessed PIN silently (new oracle).
//
// Headers:
//   x-manager-pin: string (6 digits) — REQUIRED
//   Authorization: Bearer <cashier JWT> — REQUIRED
// Body: { required_permission?: string } (e.g. 'sales.discount'; empty body OK)
// 200 → { verified_user_id }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin, isManagerPinBlocked, recordManagerPinFailure, MANAGER_PIN_FAIL_WINDOW_SEC } from '../_shared/manager-pin.ts';
import { getActingAuthUserId } from '../_shared/acting-user.ts';
import { checkPermissionForRole } from '../_shared/permissions.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

interface VerifyManagerPinPayload {
  required_permission?: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'verify-manager-pin',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  // S25 — manager PIN from header, never the body.
  const managerPin = req.headers.get('x-manager-pin');
  if (!managerPin || managerPin.trim().length === 0) {
    return jsonResponse({ error: 'missing_manager_pin' }, 400);
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  // HS256-verify the cashier's PIN-JWT in-function (parity with void-order) —
  // self-defending even if verify_jwt were ever disabled at deploy.
  const actingAuthUserId = await getActingAuthUserId(req);
  if (!actingAuthUserId) {
    return jsonResponse({ error: 'not_authenticated' }, 401);
  }

  // Body is optional — tolerate an empty/absent body.
  const body = await req.json().catch(() => ({})) as VerifyManagerPinPayload;
  const requiredPermission = typeof body.required_permission === 'string' && body.required_permission.length > 0
    ? body.required_permission
    : null;

  // SEC-07 — check fail bucket before attempting PIN verification.
  if (await isManagerPinBlocked(ip)) {
    return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
  }

  const mgr = await verifyManagerPin(managerPin);
  if (!mgr.ok) {
    if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (mgr.reason === 'no_match') {
      const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'verify-manager-pin');
      if (blocked) return rateLimitedResponse(retryAfterSec);
      return jsonResponse({ error: 'wrong_pin' }, 401);
    }
    return jsonResponse({ error: 'internal' }, 500);
  }

  if (requiredPermission) {
    const allowed = await checkPermissionForRole(mgr.role_code, requiredPermission, mgr.manager_profile_id);
    if (!allowed) return jsonResponse({ error: 'permission_missing' }, 403);
  }

  // Audit the successful verification (non-fatal on error) — without this row a
  // guessed PIN would be confirmed silently, unlike void-order whose success
  // necessarily writes a void. supabase-js does not throw on DB errors — check
  // the returned error explicitly.
  try {
    const admin = getAdminClient();
    const { error: auditErr } = await admin.from('audit_logs').insert({
      actor_id:    mgr.manager_profile_id,
      action:      'manager_pin.verified',
      entity_type: 'edge_function',
      entity_id:   null,
      metadata:    { ip, function: 'verify-manager-pin', required_permission: requiredPermission },
    });
    if (auditErr) console.warn('[verify-manager-pin] audit_logs insert failed', auditErr);
  } catch (auditErr) {
    console.warn('[verify-manager-pin] audit_logs insert failed', auditErr);
  }

  // Tightened response — full_name/role_code would be gratuitous PIN→identity
  // disclosure; the client only needs the verified profile id.
  return jsonResponse({ verified_user_id: mgr.manager_profile_id });
});
