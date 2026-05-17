// supabase/functions/auth-verify-pin/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { computePermissionsForRole, checkPermissionForRole } from '../_shared/permissions.ts';
import { signJwt, getJwtSecret } from '../_shared/jwt.ts';
import { logAndRedact, redactError } from '../_shared/error-redact.ts';

const PIN_REGEX = /^\d{6}$/;
const MAX_FAILED = 5;
const LOCKOUT_MIN = 15;
// Session 13 (25-002) — tightened from 20/min to 3/min (≈ 12/hour) on the
// invalid-pin path. After the 4th attempt within 60s from one IP we 429.
const RATE_LIMIT_PER_MIN = 3;

interface VerifyPinPayload {
  user_id: string;
  pin: string;
  device_type: 'pos' | 'backoffice';
  required_permission?: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(redactError('method_not_allowed'), 405);
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName:  'auth-verify-pin',
    bucketKey:     `ip:${ip}`,
    ipAddress:     ip,
    maxPerWindow:  RATE_LIMIT_PER_MIN,
    windowSec:     60,
  });
  if (!rl.allowed) {
    return jsonResponse({ error: 'rate_limited', retry_after_sec: rl.retryAfterSec }, 429);
  }

  let body: VerifyPinPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(redactError('invalid_json'), 400);
  }

  const { user_id, pin, device_type, required_permission } = body;
  if (!user_id || !pin || !device_type) {
    return jsonResponse(redactError('missing_fields'), 400);
  }
  if (!PIN_REGEX.test(pin)) {
    return jsonResponse(redactError('invalid_pin_format'), 400);
  }
  if (!['pos', 'backoffice'].includes(device_type)) {
    return jsonResponse(redactError('invalid_device_type'), 400);
  }

  const admin = getAdminClient();

  // 1. Fetch profile
  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('id, auth_user_id, full_name, role_code, employee_code, is_active, locked_until, failed_login_attempts')
    .eq('id', user_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (profileErr || !profile) {
    // Redact : do not leak "user not found" vs "wrong pin" to the client.
    return jsonResponse(redactError('user_not_found'), 401);
  }

  if (!profile.is_active) {
    return jsonResponse(redactError('user_inactive'), 403);
  }

  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60_000);
    return jsonResponse(redactError('account_locked', { minutes_left: minutesLeft }), 403);
  }

  // 2. Verify PIN via DB function
  const { data: pinValid, error: verifyErr } = await admin.rpc('verify_user_pin', {
    p_user_id: user_id,
    p_pin: pin,
  });

  if (verifyErr) {
    return jsonResponse(logAndRedact('verify-pin:rpc', verifyErr), 500);
  }

  if (!pinValid) {
    const newAttempts = (profile.failed_login_attempts ?? 0) + 1;
    const updates: Record<string, unknown> = { failed_login_attempts: newAttempts };
    if (newAttempts >= MAX_FAILED) {
      updates.locked_until = new Date(Date.now() + LOCKOUT_MIN * 60_000).toISOString();
    }
    await admin.from('user_profiles').update(updates).eq('id', user_id);
    await admin.from('audit_logs').insert({
      actor_id: profile.id,
      action: 'login.failed',
      entity_type: 'user_profiles',
      entity_id: profile.id,
      metadata: { attempts: newAttempts, ip },
    });
    return jsonResponse(
      redactError('invalid_pin', { attempts_remaining: Math.max(0, MAX_FAILED - newAttempts) }),
      401,
    );
  }

  // 3. PIN OK : reset compteur, set last_login
  await admin
    .from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq('id', user_id);

  // 3b. Optional permission gate — check before issuing session
  if (required_permission) {
    const hasPermission = await checkPermissionForRole(profile.role_code, required_permission, profile.id);
    if (!hasPermission) {
      return jsonResponse(redactError('permission_denied', { code: 'PERMISSION_MISSING' }), 403);
    }
  }

  // 4. Generate session token (UUID v4) — sera hashé par trigger DB
  const sessionToken = crypto.randomUUID();

  // 5. Insert session
  const { data: session, error: sessionErr } = await admin
    .from('user_sessions')
    .insert({
      user_id: profile.id,
      session_token_hash: sessionToken,    // trigger hash en SHA-256
      device_type,
      ip_address: ip,
      user_agent: req.headers.get('user-agent') ?? null,
    })
    .select('id, created_at')
    .single();

  if (sessionErr) {
    return jsonResponse(logAndRedact('verify-pin:session', sessionErr), 500);
  }

  // 6. Mint a Supabase-compatible JWT directly via SUPABASE_JWT_SECRET (HS256)
  // via the shared signer (_shared/jwt.ts — extracted Session 13 Phase 1.B).
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return jsonResponse(redactError('server_misconfigured_no_jwt_secret'), 500);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + 3600; // 1 hour
  const jwtPayload = {
    iss: 'supabase',
    ref: 'local',
    role: 'authenticated',
    aud: 'authenticated',
    sub: profile.auth_user_id,   // auth.users.id
    email: `cashier-${profile.employee_code}@thebreakery.local`,
    iat: nowSec,
    exp: expiresAt,
    app_metadata: { provider: 'pin' },
    user_metadata: { employee_code: profile.employee_code, role: profile.role_code },
  };

  const accessToken = await signJwt(jwtPayload, jwtSecret);
  const refreshToken = `pin-session:${sessionToken}`;
  const verifyData = {
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    },
  };

  // 7. Audit log success
  await admin.from('audit_logs').insert({
    actor_id: profile.id,
    action: 'login.success',
    entity_type: 'user_profiles',
    entity_id: profile.id,
    metadata: { device_type, ip, session_id: session.id },
  });

  // 8. Build permissions list (DB-driven — role_permissions + user_permission_overrides)
  const permissions = await computePermissionsForRole(profile.role_code, profile.id);

  // 9. Response
  return jsonResponse({
    verified_user_id: profile.id,
    user: {
      id: profile.id,
      full_name: profile.full_name,
      role_code: profile.role_code,
      employee_code: profile.employee_code,
    },
    session: {
      token: sessionToken,
      session_id: session.id,
      created_at: session.created_at,
    },
    auth: {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_at: verifyData.session.expires_at,
    },
    permissions,
  });
});
