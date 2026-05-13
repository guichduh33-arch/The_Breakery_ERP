// supabase/functions/kiosk-issue-jwt/index.ts
// Session 13 / Phase 1.B — D18 kiosk auth.
//
// Mints a short-lived (24h) HS256 JWT for kiosk surfaces (KDS, customer
// display, tablet) that have no staff PIN. The JWT carries
// `app_metadata.provider='kiosk'` + `app_metadata.scope` and is honoured
// by the same custom-fetch wrapper that injects PIN JWTs (HS256 shared
// secret = SUPABASE_JWT_SECRET, see _shared/jwt.ts).
//
// IP-allowlist is gated by env var `KIOSK_ALLOWED_IPS` (comma-separated
// CIDR/IP list). Empty / unset = no allowlist (dev convenience).
//
// Rate-limit : 10/min/IP for general flood protection ; 1/min/kiosk_id
// for brute-force resistance.
//
// Spec  : docs/workplan/specs/2026-05-13-session-13-spec.md D18
// Design: docs/workplan/refs/2026-05-13-kiosk-auth-design.md
// Plan  : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit, getClientIp } from '../_shared/rate-limit.ts';
import { signJwt, getJwtSecret } from '../_shared/jwt.ts';
import { logAndRedact } from '../_shared/error-redact.ts';

const VALID_SCOPES = ['kds', 'display', 'tablet'] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface IssueRequest {
  kiosk_id?: string;
  scope?: string;
  device_label?: string;
}

// Tablet-friendly: 24h kiosk session matches the design §3.2 `exp`.
const KIOSK_JWT_TTL_SEC = 24 * 3600;

// ============================================================
// IP allowlist helpers
// ============================================================

/** Parse the KIOSK_ALLOWED_IPS env var into a list of acceptable IPs/prefixes. */
function getAllowedIps(): string[] {
  const raw = Deno.env.get('KIOSK_ALLOWED_IPS') ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Lightweight allowlist check : exact IP match or "starts with" CIDR-ish prefix. */
function isIpAllowed(ip: string): boolean {
  const allowed = getAllowedIps();
  if (allowed.length === 0) return true; // dev / unconfigured = no gate
  if (ip === 'unknown') return false;
  return allowed.some((entry) => {
    if (entry === ip) return true;
    // Treat trailing "." as a prefix match (e.g. "10.0.0." matches "10.0.0.42").
    if (entry.endsWith('.') && ip.startsWith(entry)) return true;
    // Naive CIDR : "10.0.0.0/24" → match first 3 octets.
    const slashIdx = entry.indexOf('/');
    if (slashIdx > 0) {
      const prefix = entry.slice(0, slashIdx);
      // Only support /8, /16, /24 for the minimal check ; production should use
      // a proper CIDR matcher (e.g. via PG `<<=` on INET ; deferred).
      const bits = Number.parseInt(entry.slice(slashIdx + 1), 10);
      if (bits === 24) return ip.startsWith(prefix.split('.').slice(0, 3).join('.') + '.');
      if (bits === 16) return ip.startsWith(prefix.split('.').slice(0, 2).join('.') + '.');
      if (bits === 8)  return ip.startsWith(prefix.split('.').slice(0, 1).join('.') + '.');
    }
    return false;
  });
}

// ============================================================
// Main handler
// ============================================================

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const ip = getClientIp(req);

  // (a) Per-IP rate-limit : 10/min
  const ipRL = checkRateLimit(`kiosk-jwt:ip:${ip}`, 10);
  if (!ipRL.allowed) {
    return jsonResponse({ error: 'rate_limited', retry_after_sec: ipRL.retryAfterSec }, 429);
  }

  // (b) IP allowlist (env-gated)
  if (!isIpAllowed(ip)) {
    return jsonResponse({ error: 'ip_not_allowed' }, 403);
  }

  // (c) Parse body
  let body: IssueRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { kiosk_id, scope, device_label } = body;
  if (!kiosk_id || !scope) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!(VALID_SCOPES as readonly string[]).includes(scope)) {
    return jsonResponse({ error: 'invalid_scope' }, 400);
  }

  // (d) Per-kiosk rate-limit : 1/min (catches brute-force)
  const kRL = checkRateLimit(`kiosk-jwt:id:${kiosk_id}`, 1);
  if (!kRL.allowed) {
    return jsonResponse({ error: 'rate_limited', retry_after_sec: kRL.retryAfterSec }, 429);
  }

  // (e) JWT secret check (env)
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return jsonResponse({ error: 'server_misconfigured_no_jwt_secret' }, 500);
  }

  // (f) Mint JWT — synthetic UUID `sub` (deterministic per kiosk_id) so
  // auth.uid() returns a stable value (no auth.users row exists for kiosks).
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + KIOSK_JWT_TTL_SEC;

  // Deterministic UUIDv5-ish from kiosk_id : SHA-1 hash + RFC4122 v5 nibbles.
  const encoder = new TextEncoder();
  const hashBytes = new Uint8Array(
    await crypto.subtle.digest('SHA-1', encoder.encode(`kiosk:${kiosk_id}`)),
  );
  const hex = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  // Force version 5 + variant bits.
  const sub =
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-` +
    `${hex.slice(20, 32)}`;

  let accessToken: string;
  try {
    accessToken = await signJwt(
      {
        iss: 'supabase',
        ref: Deno.env.get('SUPABASE_PROJECT_REF') ?? 'local',
        role: 'authenticated',
        aud: 'authenticated',
        sub,
        email: `kiosk-${kiosk_id}@thebreakery.local`,
        iat: nowSec,
        exp,
        app_metadata: { provider: 'kiosk', kiosk_id, scope },
        user_metadata: { device_label: device_label ?? null },
      },
      jwtSecret,
    );
  } catch (err) {
    return jsonResponse(logAndRedact('kiosk-jwt:sign', err), 500);
  }

  // (g) Audit log
  const admin = getAdminClient();
  try {
    await admin.from('audit_logs').insert({
      actor_id: null,
      action: 'kiosk.token.issued',
      entity_type: 'kiosk_jwt_signing_keys',
      entity_id: null,
      metadata: { kiosk_id, scope: scope as Scope, ip, device_label: device_label ?? null },
    });
  } catch (err) {
    // Audit failure must not break issuance (degrades cleanly to "no audit
    // row" — preferable to a 500 on every kiosk reboot).
    console.warn('[kiosk-issue-jwt] audit_logs insert failed', err);
  }

  return jsonResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_at: exp,
    kiosk: {
      kiosk_id,
      scope: scope as Scope,
      device_label: device_label ?? null,
    },
  });
});
