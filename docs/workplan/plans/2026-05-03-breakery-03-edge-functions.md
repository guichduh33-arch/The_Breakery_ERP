# Phase 3 — Edge Functions Deno

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Implémenter 4 Edge Functions auth + 1 wrapper paiement + 1 module `_shared` (middleware + helpers). Toutes en TypeScript Deno.

**Spec source:** `docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md` section 7.

**Dépend de :** Phase 2 (DB).

**À la fin :**
- 5 Edge Functions déployées en local : `auth-verify-pin`, `auth-get-session`, `auth-logout`, `auth-change-pin`, `process-payment`
- Module `_shared/` avec session-auth middleware, rate-limiter, CORS
- Tests integration via Vitest pour chaque fonction

---

## Task 3.1 — Module `_shared/` (CORS + session middleware + rate-limiter)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/session-auth.ts`
- Create: `supabase/functions/_shared/rate-limit.ts`
- Create: `supabase/functions/_shared/supabase-admin.ts`

- [ ] **Step 1: Créer `_shared/cors.ts`**

```ts
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Créer `_shared/supabase-admin.ts`**

```ts
// supabase/functions/_shared/supabase-admin.ts
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

let _admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}
```

- [ ] **Step 3: Créer `_shared/rate-limit.ts`**

```ts
// supabase/functions/_shared/rate-limit.ts
// Rate limiter in-memory simple (LRU). Suffit pour single-instance Edge Function.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 1000;

export function checkRateLimit(key: string, maxPerMinute = 20): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    if (buckets.size >= MAX_KEYS) {
      // Simple eviction : remove oldest
      const firstKey = buckets.keys().next().value;
      if (firstKey !== undefined) buckets.delete(firstKey);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= maxPerMinute) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true, retryAfterSec: 0 };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}
```

- [ ] **Step 4: Créer `_shared/session-auth.ts`**

```ts
// supabase/functions/_shared/session-auth.ts
import { getAdminClient } from './supabase-admin.ts';
import { jsonResponse } from './cors.ts';

const TIMEOUT_MS = 30 * 60 * 1000;          // 30 min inactivity
const MAX_AGE_MS = 24 * 60 * 60 * 1000;     // 24h hard cap

export interface SessionContext {
  userId: string;          // user_profiles.id
  authUserId: string;      // auth.users.id
  roleCode: string;
  sessionId: string;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function requireSession(req: Request): Promise<SessionContext | Response> {
  const token = req.headers.get('x-session-token');
  if (!token) {
    return jsonResponse({ error: 'session_token_required' }, 401);
  }

  const tokenHash = await sha256Hex(token);
  const admin = getAdminClient();

  const { data: session, error } = await admin
    .from('user_sessions')
    .select('id, user_id, created_at, last_activity_at, ended_at, user_profiles!inner(id, auth_user_id, role_code)')
    .eq('session_token_hash', tokenHash)
    .is('ended_at', null)
    .maybeSingle();

  if (error || !session) {
    return jsonResponse({ error: 'session_not_found' }, 401);
  }

  const now = Date.now();
  const lastActivity = new Date(session.last_activity_at).getTime();
  const created = new Date(session.created_at).getTime();

  if (now - lastActivity > TIMEOUT_MS) {
    await admin
      .from('user_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'timeout' })
      .eq('id', session.id);
    return jsonResponse({ error: 'session_timeout' }, 401);
  }

  if (now - created > MAX_AGE_MS) {
    await admin
      .from('user_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'expired' })
      .eq('id', session.id);
    return jsonResponse({ error: 'session_expired' }, 401);
  }

  // Refresh activity
  await admin
    .from('user_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);

  // Note: user_profiles vient via Supabase relational select. Type check.
  const profile = Array.isArray(session.user_profiles) ? session.user_profiles[0] : session.user_profiles;
  if (!profile) return jsonResponse({ error: 'profile_not_found' }, 401);

  return {
    userId: profile.id,
    authUserId: profile.auth_user_id,
    roleCode: profile.role_code,
    sessionId: session.id,
  };
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(token);
}
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat(edge): add _shared module (cors, supabase-admin, rate-limit, session-auth)"
```

---

## Task 3.2 — Edge Function `auth-verify-pin`

**Files:**
- Create: `supabase/functions/auth-verify-pin/index.ts`

- [ ] **Step 1: Créer `index.ts`**

```ts
// supabase/functions/auth-verify-pin/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit, getClientIp } from '../_shared/rate-limit.ts';

const PIN_REGEX = /^\d{4,6}$/;
const MAX_FAILED = 5;
const LOCKOUT_MIN = 15;

interface VerifyPinPayload {
  user_id: string;
  pin: string;
  device_type: 'pos' | 'backoffice';
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(`verify-pin:${ip}`, 20);
  if (!rl.allowed) {
    return jsonResponse({ error: 'rate_limited', retry_after_sec: rl.retryAfterSec }, 429);
  }

  let body: VerifyPinPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { user_id, pin, device_type } = body;
  if (!user_id || !pin || !device_type) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!PIN_REGEX.test(pin)) {
    return jsonResponse({ error: 'invalid_pin_format' }, 400);
  }
  if (!['pos', 'backoffice'].includes(device_type)) {
    return jsonResponse({ error: 'invalid_device_type' }, 400);
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
    return jsonResponse({ error: 'user_not_found' }, 401);
  }

  if (!profile.is_active) {
    return jsonResponse({ error: 'user_inactive' }, 403);
  }

  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60_000);
    return jsonResponse({ error: 'account_locked', minutes_left: minutesLeft }, 403);
  }

  // 2. Verify PIN via DB function
  const { data: pinValid, error: verifyErr } = await admin.rpc('verify_user_pin', {
    p_user_id: user_id,
    p_pin: pin,
  });

  if (verifyErr) {
    console.error('verify_user_pin error', verifyErr);
    return jsonResponse({ error: 'internal' }, 500);
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
    return jsonResponse({ error: 'invalid_pin', attempts_remaining: Math.max(0, MAX_FAILED - newAttempts) }, 401);
  }

  // 3. PIN OK : reset compteur, set last_login
  await admin
    .from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq('id', user_id);

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
    console.error('user_sessions insert error', sessionErr);
    return jsonResponse({ error: 'internal' }, 500);
  }

  // 6. Mint Supabase JWT (magic link approach)
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: `cashier-${profile.employee_code}@thebreakery.local`,
  });

  if (linkErr || !linkData) {
    console.error('generateLink error', linkErr);
    return jsonResponse({ error: 'jwt_mint_failed' }, 500);
  }

  // Extract token_hash from action_link or properties
  // For local dev, linkData.properties contains hashed_token. We exchange it.
  const hashedToken = linkData.properties?.hashed_token;
  if (!hashedToken) {
    console.error('no hashed_token in linkData', linkData);
    return jsonResponse({ error: 'jwt_extract_failed' }, 500);
  }

  // Exchange hashed_token for actual session
  const { data: verifyData, error: verifyOtpErr } = await admin.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink',
  });

  if (verifyOtpErr || !verifyData.session) {
    console.error('verifyOtp error', verifyOtpErr);
    return jsonResponse({ error: 'jwt_verify_failed' }, 500);
  }

  // 7. Audit log success
  await admin.from('audit_logs').insert({
    actor_id: profile.id,
    action: 'login.success',
    entity_type: 'user_profiles',
    entity_id: profile.id,
    metadata: { device_type, ip, session_id: session.id },
  });

  // 8. Build permissions list (v1 hardcoded by role)
  const permissions = computePermissionsForRole(profile.role_code);

  // 9. Response
  return jsonResponse({
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

function computePermissionsForRole(role: string): string[] {
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
```

- [ ] **Step 2: Test manuel**

```bash
supabase functions serve auth-verify-pin --no-verify-jwt
```

Dans un autre terminal :

```bash
# Récupérer l'admin id
ADMIN_ID=$(curl -s "http://127.0.0.1:54321/rest/v1/user_profiles?employee_code=eq.EMP000&select=id" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" | jq -r '.[0].id')

curl -X POST http://127.0.0.1:54321/functions/v1/auth-verify-pin \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$ADMIN_ID\",\"pin\":\"1234\",\"device_type\":\"pos\"}"
```

Expected: réponse JSON avec `user`, `session.token`, `auth.access_token`, `permissions[]` (12 items pour SUPER_ADMIN).

Test cas erreur PIN invalide :

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/auth-verify-pin \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$ADMIN_ID\",\"pin\":\"9999\",\"device_type\":\"pos\"}"
```

Expected: `{"error":"invalid_pin","attempts_remaining":4}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/auth-verify-pin/
git commit -m "feat(edge): add auth-verify-pin Edge Function (PIN bcrypt + lockout + JWT mint)"
```

---

## Task 3.3 — Edge Function `auth-get-session`

**Files:**
- Create: `supabase/functions/auth-get-session/index.ts`

- [ ] **Step 1: Créer `index.ts`**

```ts
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
```

- [ ] **Step 2: Test manuel**

```bash
supabase functions serve auth-get-session --no-verify-jwt

# Dans autre terminal — récupère un sessionToken via auth-verify-pin d'abord, puis :
TOKEN=<sessionToken_from_previous_step>
curl http://127.0.0.1:54321/functions/v1/auth-get-session \
  -H "x-session-token: $TOKEN"
```

Expected: `{"user": {...}, "permissions": [...], "session_id": "..."}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/auth-get-session/
git commit -m "feat(edge): add auth-get-session Edge Function (probe + refresh activity)"
```

---

## Task 3.4 — Edge Function `auth-logout`

**Files:**
- Create: `supabase/functions/auth-logout/index.ts`

- [ ] **Step 1: Créer `index.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/auth-logout/
git commit -m "feat(edge): add auth-logout Edge Function"
```

---

## Task 3.5 — Edge Function `auth-change-pin`

**Files:**
- Create: `supabase/functions/auth-change-pin/index.ts`

- [ ] **Step 1: Créer `index.ts`**

```ts
// supabase/functions/auth-change-pin/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

const PIN_REGEX = /^\d{4,6}$/;

interface ChangePinPayload {
  user_id: string;
  current_pin?: string;
  new_pin: string;
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

  const { user_id, current_pin, new_pin } = body;
  if (!user_id || !new_pin) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!PIN_REGEX.test(new_pin)) {
    return jsonResponse({ error: 'invalid_new_pin_format' }, 400);
  }

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

  return jsonResponse({ ok: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/auth-change-pin/
git commit -m "feat(edge): add auth-change-pin Edge Function (self + admin override)"
```

---

## Task 3.6 — Edge Function `process-payment` (wrapper RPC)

**Files:**
- Create: `supabase/functions/process-payment/index.ts`

- [ ] **Step 1: Créer `index.ts`**

```ts
// supabase/functions/process-payment/index.ts
// Wrapper sur RPC complete_order_with_payment.
// Capture les exceptions Postgres et les remappe en réponses HTTP propres.
// Logs Sentry server-side optionnel.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

interface ProcessPaymentPayload {
  session_id: string;
  order_type: 'dine_in' | 'take_out' | 'delivery';
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  payment: {
    method: 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';
    amount: number;
    cash_received?: number;
    change_given?: number;
  };
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  let body: ProcessPaymentPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.session_id || !body.order_type || !Array.isArray(body.items) || body.items.length === 0 || !body.payment) {
    return jsonResponse({ error: 'missing_or_invalid_fields' }, 400);
  }

  if (body.payment.method === 'cash') {
    if (typeof body.payment.cash_received !== 'number' || body.payment.cash_received < body.payment.amount) {
      return jsonResponse({ error: 'cash_received_insufficient' }, 400);
    }
  }

  // Use a per-request client carrying the user JWT so the RPC sees auth.uid()
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await userClient.rpc('complete_order_with_payment', {
    p_session_id: body.session_id,
    p_order_type: body.order_type,
    p_items: body.items,
    p_payment: body.payment,
  });

  if (error) {
    console.error('complete_order_with_payment error', error);
    // Map Postgres error codes
    if (error.code === 'P0001') return jsonResponse({ error: 'no_open_session', message: error.message }, 409);
    if (error.code === 'P0002') return jsonResponse({ error: 'insufficient_stock', message: error.message }, 409);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse(data);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/process-payment/
git commit -m "feat(edge): add process-payment Edge Function (wrapper for complete_order_with_payment RPC)"
```

---

## Task 3.7 — Tests intégration Edge Functions

**Files:**
- Create: `supabase/tests/functions/auth-verify-pin.test.ts`
- Create: `supabase/tests/functions/process-payment.test.ts`
- Create: `supabase/tests/package.json`
- Create: `supabase/tests/vitest.config.ts`

- [ ] **Step 1: Créer `supabase/tests/package.json`**

```json
{
  "name": "@breakery/supabase-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@supabase/supabase-js": "^2.47.10",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Créer `supabase/tests/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

- [ ] **Step 3: Créer `auth-verify-pin.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

describe('auth-verify-pin', () => {
  let adminUserId: string;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP000').single();
    if (!data) throw new Error('Seed not loaded — run supabase db reset');
    adminUserId = data.id;
  });

  it('returns 400 if pin format invalid', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: 'abc', device_type: 'pos' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_pin_format');
  });

  it('returns 401 if pin wrong', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: '9999', device_type: 'pos' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_pin');
    expect(body.attempts_remaining).toBeGreaterThanOrEqual(0);
  });

  it('returns 200 + session/auth tokens on valid pin', async () => {
    // First reset failed attempts
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('user_profiles').update({ failed_login_attempts: 0, locked_until: null }).eq('id', adminUserId);

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: '1234', device_type: 'pos' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.full_name).toBe('Mamat (Owner)');
    expect(body.session.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.auth.access_token).toBeTruthy();
    expect(body.permissions).toContain('pos.sale.create');
  });
});
```

- [ ] **Step 4: Créer `process-payment.test.ts`** (smoke test)

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/process-payment`;

describe('process-payment', () => {
  let accessToken: string;
  let sessionId: string;
  let productIds: string[] = [];

  beforeAll(async () => {
    // Login admin via auth-verify-pin
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('user_profiles').update({ failed_login_attempts: 0, locked_until: null }).eq('employee_code', 'EMP000');
    const { data: profile } = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP000').single();

    const loginRes = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile!.id, pin: '1234', device_type: 'pos' }),
    });
    const loginBody = await loginRes.json();
    accessToken = loginBody.auth.access_token;

    // Create open session via direct insert (admin)
    const { data: session } = await admin
      .from('pos_sessions')
      .upsert({ opened_by: profile!.id, opening_cash: 100000 }, { onConflict: 'opened_by' })
      .select('id')
      .single();
    sessionId = session!.id;

    const { data: products } = await admin.from('products').select('id').limit(2);
    productIds = (products ?? []).map((p) => p.id);
  });

  it('creates an order on valid payload', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [
          { product_id: productIds[0], quantity: 1, unit_price: 35000 },
          { product_id: productIds[1], quantity: 1, unit_price: 45000 },
        ],
        payment: { method: 'cash', amount: 80000, cash_received: 100000, change_given: 20000 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_number).toMatch(/^#\d{4}$/);
    expect(body.subtotal).toBe(80000);
    expect(body.change_given).toBe(20000);
  });

  it('rejects on insufficient stock', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 99999, unit_price: 35000 }],
        payment: { method: 'cash', amount: 35000 * 99999, cash_received: 35000 * 99999 },
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('insufficient_stock');
  });
});
```

- [ ] **Step 5: Run tests**

Démarre les Edge Functions :

```bash
supabase functions serve --no-verify-jwt
```

Puis :

```bash
cd supabase/tests
pnpm install
pnpm test
```

Expected: tous les tests passent.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/
git commit -m "test(edge): add integration tests for auth-verify-pin + process-payment"
```

---

## Phase 3 — Done criteria

- [ ] 5 Edge Functions créées : `auth-verify-pin`, `auth-get-session`, `auth-logout`, `auth-change-pin`, `process-payment`
- [ ] Module `_shared/` avec `cors`, `supabase-admin`, `rate-limit`, `session-auth`
- [ ] `supabase functions serve --no-verify-jwt` démarre les 5 fonctions sans erreur
- [ ] Tests intégration passent contre stack locale
- [ ] PIN admin `1234` → response 200 avec sessionToken + JWT + permissions
- [ ] PIN cashier `5678` → response 200 avec permissions limitées
- [ ] PIN invalide → response 401 + decrement attempts_remaining
- [ ] 5 PINs invalides consécutifs → response 403 account_locked + 15min lockout
- [ ] `process-payment` valide → crée order via RPC, retourne order_number
- [ ] `process-payment` stock insuffisant → 409 insufficient_stock

**Next:** Phase 4 — Shared packages (`2026-05-03-breakery-04-shared-packages.md`).
