# 04 — Edge Function Security

> **Last verified**: 2026-05-03

## Overview

AppGrav V2 ships 16 Supabase Edge Functions (Deno runtime). They live in [supabase/functions/](../../../supabase/functions/) and fall into two security categories:

1. **`verify_jwt = true`** (10 of 16) — Supabase platform validates the JWT in `Authorization: Bearer <jwt>` before the function body runs. Everything inside can assume an authenticated user.
2. **`verify_jwt = false`** (6 of 16) — the platform JWT check is skipped because the function uses an alternative auth mechanism (PIN session token, or it IS the auth bootstrap itself). Each of these manually validates the caller via `validateSessionToken(req)` from [_shared/session-auth.ts](../../../supabase/functions/_shared/session-auth.ts).

Source for the per-function `verify_jwt` setting: each function has a `config.toml` in its directory.

## verify_jwt configuration map

| Edge Function | verify_jwt | Auth strategy | Notes |
|---|---|---|---|
| `auth-verify-pin` | **false** | Bootstrap (no JWT yet) | MINTS the session; rate-limited 20 req/min/IP |
| `auth-get-session` | **false** | Custom session token (validates the token it receives) | Probe; cannot require a JWT to validate |
| `auth-change-pin` | **false** | `x-session-token` validated via `validateSessionToken` | PIN flow has no JWT |
| `auth-logout` | **false** | `x-session-token` OR JWT (dual path) | End-of-session; either bootstrap is acceptable |
| `set-user-pin` | **false** | Manual JWT check via `supabaseAuth.auth.getUser()` | Documented exception — JWT validated in code |
| `auth-user-management` | **true** | JWT (preferred) OR `x-session-token` (fallback) | Permission check `users.{create|update|delete}` |
| `list-auth-users` | **true** | JWT | Permission `users.view` |
| `create-admin-user` | **true** | JWT | Permission `users.create` |
| `claude-proxy` | **true** | JWT | LLM proxy; allowlists model + caps `max_tokens` |
| `generate-invoice` | **true** | JWT | Permission `b2b.view`; HTML escaped |
| `calculate-daily-report` | **true** | JWT | Permission `reports.financial` |
| `send-test-email` | **true** | JWT + `requireSession()` | SMTP diagnostic; admin-only via UI gating (see ACCEPTED RISK in source) |
| `send-to-printer` | **true** | JWT + SSRF allowlist | URL must be RFC 1918 private + HTTP only |
| `intersection_stock_movements` | **true** | JWT | Permission `inventory.view` |
| `purchase_order_module` | **true** | JWT | Permission `purchases.*` |

## Canonical Edge Function template

```ts
// breakery-lint-disable comment explaining auth strategy if verify_jwt=false
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { validateSessionToken } from '../_shared/session-auth.ts';

serve(async (req: Request) => {
  // 1. CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // 2. Method gate
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  try {
    // 3. Resolve caller identity (PIN session OR JWT)
    let requestingUserId: string | null = null;

    // 3a. PIN flow
    const sessionToken = req.headers.get('x-session-token');
    if (sessionToken) {
      const session = await validateSessionToken(req);
      if (session?.userId) requestingUserId = session.userId;
    }

    // 3b. JWT flow
    if (!requestingUserId) {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const supabaseAuth = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user } } = await supabaseAuth.auth.getUser();
        if (user) {
          // Map auth.uid() -> user_profiles.id
          const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          );
          const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('id')
            .eq('auth_user_id', user.id)
            .single();
          if (profile?.id) requestingUserId = profile.id;
        }
      }
    }

    if (!requestingUserId) return errorResponse('Authentication required', 401, req);

    // 4. Permission check (defence-in-depth)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: hasPermission } = await supabase.rpc('user_has_permission', {
      p_user_id: requestingUserId,
      p_permission_code: '<module>.<action>',
    });
    if (!hasPermission) {
      return errorResponse('Permission denied: <module>.<action> required', 403, req);
    }

    // 5. Validate input
    const body = await req.json();
    if (!body.target_id) return errorResponse('target_id is required', 400, req);

    // 6. Perform the mutation (service_role bypasses RLS, permission check above guards intent)
    const result = await supabase.from('<table>').update(body.payload).eq('id', body.target_id);

    // 7. Audit log
    await supabase.from('audit_logs').insert({
      user_id: requestingUserId,
      action: 'UPDATE',
      module: '<module>',
      entity_type: '<table>',
      entity_id: body.target_id,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent') || null,
      severity: 'info',
    });

    return jsonResponse({ success: true, result }, 200, req);
  } catch (error) {
    console.error('handler error:', error);
    return errorResponse('Internal server error', 500, req); // Generic — never leak internals
  }
});
```

## Service-role usage

Almost every Edge Function ends up creating a `supabaseAdmin` client with `SUPABASE_SERVICE_ROLE_KEY` for writes. Service-role bypasses RLS entirely, which is intentional for two reasons:

1. **Performance** — RLS policies double-check `user_has_permission()` per row; the Edge Function already validated authorisation once at the top, so re-running it on every UPDATE/INSERT row is wasted work.
2. **Cross-table operations** — many actions touch tables the user wouldn't be allowed to write directly (e.g., logging into `audit_logs`, creating `user_sessions`). Service-role lets the function do the orchestration without compromising end-user privileges.

The trade-off: a bug in the Edge Function permission gate becomes a privilege-escalation vector. Mitigations:

- The pattern above (resolve identity → check permission → mutate → audit) is mandatory.
- `user_has_permission()` is called via RPC, which goes through `verify_user_pin` style validation in the function body — not by reading some client-supplied flag.
- Audit logs let us catch mismatches: if a CASHIER somehow triggers a `users.delete` action, it shows up immediately in the audit dashboard.

## CORS

All Edge Functions use the shared CORS helper at [_shared/cors.ts](../../../supabase/functions/_shared/cors.ts). Origin allowlist:

- **Production (cible, non active — V3 pas encore déployée)**: `https://thebreakery.app`, `https://admin.thebreakery.app`, `https://pos.thebreakery.app`, `https://the-breakery-pos.vercel.app`.
- **Development**: `http://localhost:{3000,3001,5173}` and `http://127.0.0.1:{3000,3001,5173}`.
- **Optional extras**: `EXTRA_ALLOWED_ORIGINS` env var, comma-separated.

The helper resolves `Access-Control-Allow-Origin` per request based on the incoming `Origin` header, falling back to empty string (which fails the browser CORS check) for unknown origins. Allowed headers include `x-session-token` so the PIN flow works.

Security headers added on every response:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

The CSP on Edge Function responses is strict (`default-src 'none'`) because they only return JSON — no HTML, no scripts.

## Rate limiting

Source: [_shared/rate-limiter.ts](../../../supabase/functions/_shared/rate-limiter.ts).

In-memory sliding-window rate limiter (per-IP, per-Edge-Function instance). Used in:

- `auth-verify-pin`: 20 req/min per IP. Returns `429 Too Many Requests` with `Retry-After` header.

Limitation: state is per-instance — Supabase's Deno Edge runtime can spin up multiple isolates, so the limit is approximate. Sufficient for human-typed PINs (5 attempts triggers DB-level lockout for 15min anyway), insufficient for true API rate limiting. For higher-volume endpoints we would need an external store (Upstash/Redis); not currently needed.

## SSRF protection (send-to-printer)

[send-to-printer/index.ts](../../../supabase/functions/send-to-printer/index.ts) accepts a target printer URL. Without controls this is a textbook SSRF vector — the Edge Function runs on Supabase infrastructure with potential access to internal endpoints. Mitigations:

- URL must start with `http://` (HTTPS rejected — local printers don't have TLS).
- IP must be in RFC 1918 private space: `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`.
- `localhost` / `127.0.0.1` allowed (for the local print server pattern).
- Hostnames are rejected; IP must be literal.

This means the print-server proxy can only reach LAN devices, not Supabase internals or arbitrary internet hosts.

## Error handling — never leak internals

Bad pattern (rejected at code review):

```ts
return errorResponse(`Failed to create session: ${error.message} (${error.code})`, 500, req);
```

Good pattern:

```ts
console.error('Session creation error:', JSON.stringify(error));   // Server-side log
return errorResponse('Failed to create session', 500, req);        // Generic to client
```

Finding P1-03 in [docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md) flagged one residual instance in `auth-verify-pin`; current source already returns the generic message.

## Sentry / observability

Edge Functions log to Deno `console.error` by default. Supabase aggregates these in the Functions Logs dashboard. There is no Sentry SDK in the Edge Function runtime today (Deno-compatible Sentry exists but is not integrated).

The client-side Sentry config ([src/lib/sentry.ts](../../../src/lib/sentry.ts)) **does** propagate distributed tracing headers (`sentry-trace`, `baggage`) to Edge Function calls. The Edge Function CORS allowlist exposes these headers (`Access-Control-Allow-Headers` includes `baggage, sentry-trace`), so a failed function call shows up in the client trace with the correct parent span.

## Secrets exposed to Edge Functions

Configured via `supabase secrets set` (or the dashboard). Available as `Deno.env.get(...)`:

- `SUPABASE_URL` — same as `VITE_SUPABASE_URL`.
- `SUPABASE_ANON_KEY` — same as `VITE_SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-side only**, never exposed to the client.
- `ANTHROPIC_API_KEY` — used by `claude-proxy` only; cap on `max_tokens` and model allowlist.
- `EXTRA_ALLOWED_ORIGINS` — optional comma-separated CORS allowlist additions.
- `ENVIRONMENT` — `'development'` to enable dev origins; otherwise treated as production.

SMTP credentials are stored in the `settings` table (key prefix `notifications.smtp_*`) and read at runtime by `send-test-email`, not via env vars. This is intentional so the admin UI can rotate them without redeploying functions. Trade-off: a database breach exposes them; counter-mitigation is RLS on `settings` (gated by `settings.update`).

## Deployment

```bash
# Deploy a single function
supabase functions deploy auth-verify-pin

# Deploy all
supabase functions deploy

# Set a secret
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

The `--no-verify-jwt` flag is **not** used at deploy time; the per-function `config.toml` determines the JWT setting. CI verifies the `config.toml` has not been silently flipped via the `breakery-lint:public-edge-fn` rule (any function setting `verify_jwt = false` must include a `breakery-lint-disable:public-edge-fn` comment in the source explaining why).

## Cross-references

- [01-auth-flow-pin.md](./01-auth-flow-pin.md) — full PIN auth flow that all `verify_jwt=false` functions implement.
- [02-rls-patterns.md](./02-rls-patterns.md) — why permission checks are still needed even with service_role mutations.
- [03-rbac-permissions.md](./03-rbac-permissions.md) — list of permission codes consumed by Edge Functions.
- [05-secrets-and-env.md](./05-secrets-and-env.md) — full env var inventory.
- [_shared/](../../../supabase/functions/_shared/) — `cors.ts`, `session-auth.ts`, `supabase-client.ts`, `rate-limiter.ts`, `types.ts`.
