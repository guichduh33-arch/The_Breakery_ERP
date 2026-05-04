# 06 — Edge Functions Deploy

> **Last verified**: 2026-05-03

## Inventory

V2 ships **15 Edge Functions** plus a `_shared/` folder of helpers (CORS, rate-limiter, session-auth, supabase-client, types). Source: `supabase/functions/`.

| Function | Purpose | `verify_jwt` |
|----------|---------|--------------|
| `auth-get-session` | Validate session token + bump `last_activity_at` | false (the function IS the session validator) |
| `auth-verify-pin` | PIN login → returns session token | false (entry point — no JWT yet) |
| `auth-change-pin` | Change PIN with old + new | true |
| `auth-logout` | Revoke session | true |
| `auth-user-management` | CRUD on user profiles | true |
| `set-user-pin` | Admin: set a user's PIN | true |
| `create-admin-user` | Bootstrap an admin (one-shot) | true |
| `list-auth-users` | Admin: list auth users | true |
| `generate-invoice` | PDF invoice generation | true |
| `send-to-printer` | Forward print job to local print server | true |
| `calculate-daily-report` | EOD summary aggregator | true |
| `claude-proxy` | LLM API proxy (server-side `ANTHROPIC_API_KEY`) | true |
| `purchase_order_module` | PO-specific business logic | true |
| `intersection_stock_movements` | Stock calculation aggregations | true |
| `send-test-email` | Email test endpoint | true |

The `_shared/` folder contains:
- `cors.ts` — `corsHeaders`, `handleCors`, `jsonResponse`, `errorResponse`
- `rate-limiter.ts` — token-bucket rate limiting
- `session-auth.ts` — PIN session validation helpers
- `supabase-client.ts` — pre-configured Supabase client for edge runtime
- `types.ts` — shared Deno-typed contracts

CLAUDE.md groups these into nine product groupings (auth flow, user management, PDF, print, daily reports, LLM, PO, stock, email). The deploy mechanics are identical regardless of grouping.

## Runtime

| Property | Value |
|----------|-------|
| Runtime | Deno (Supabase-managed) |
| Module imports | Deno-style (`https://deno.land/std@.../...`, `https://esm.sh/@supabase/supabase-js@2`) |
| `verify_jwt` policy | Per-function, set in `supabase/config.toml` `[functions.<name>]` blocks (or function-level `config.json`) |
| Permission gate | Functions that perform privileged actions MUST call `user_has_permission(auth.uid(), 'module.action')` (see CLAUDE.md "RLS Pattern") |

## Authoring a function

```bash
supabase functions new <name>
# Creates supabase/functions/<name>/index.ts with a serve() boilerplate
```

Then edit `supabase/functions/<name>/index.ts`:

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

serve(async (req: Request) => {
  // 1. CORS preflight
  const cors = handleCors(req);
  if (cors) return cors;

  // 2. Permission check (when verify_jwt: true)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('Unauthorized', 401);

  const { data: hasPerm } = await supabase.rpc('user_has_permission', {
    user_id: user.id,
    permission_code: '<module>.action',
  });
  if (!hasPerm) return errorResponse('Forbidden', 403);

  // 3. Business logic
  const body = await req.json();
  // ... do work ...

  return jsonResponse({ ok: true });
});
```

## `verify_jwt` configuration

Set per-function in `supabase/config.toml`:

```toml
[functions.auth-verify-pin]
verify_jwt = false   # entry point — no JWT exists yet

[functions.auth-get-session]
verify_jwt = false   # function IS the session validator

[functions.generate-invoice]
verify_jwt = true    # default; explicit for clarity
```

Default is `verify_jwt = true` (Supabase rejects unauthenticated requests at the gateway). Set `false` only for true entry points; even then, validate the request body content rigorously and rate-limit aggressively.

## Local development

```bash
# Serve all functions locally on localhost:54321/functions/v1/<name>
supabase functions serve

# Serve only one (faster startup, hot reload on file change)
supabase functions serve <name> --env-file .env.local

# Test:
curl -X POST http://localhost:54321/functions/v1/auth-verify-pin \
  -H "Authorization: Bearer <local-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"pin": "1234"}'
```

`--env-file .env.local` injects local secrets (e.g. `ANTHROPIC_API_KEY` for `claude-proxy`) so the function behaves like production.

## Deploy

```bash
# Deploy ONE function
supabase functions deploy <name> --project-ref abjabuniwkqpfsenxljp

# Deploy ALL functions (rebuilds and uploads each one)
supabase functions deploy --project-ref abjabuniwkqpfsenxljp

# Deploy with a specific import map
supabase functions deploy <name> --import-map supabase/functions/import_map.json
```

The `--project-ref` flag can be omitted if the repo is linked (`supabase link --project-ref abjabuniwkqpfsenxljp`).

Deploy ETA: ~10-30 seconds per function. The function is hot-swapped at the edge — in-flight requests complete on the old version, new requests hit the new version.

## Secrets

Edge Functions read secrets from `Deno.env.get(...)`. Set them via the CLI:

```bash
# Set one
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref abjabuniwkqpfsenxljp

# Set many from a file
supabase secrets set --env-file ./supabase/.env.production --project-ref abjabuniwkqpfsenxljp

# List currently-set secret names (values not exposed)
supabase secrets list --project-ref abjabuniwkqpfsenxljp

# Remove
supabase secrets unset ANTHROPIC_API_KEY --project-ref abjabuniwkqpfsenxljp
```

Built-in secrets (auto-injected, do not set):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

Project-specific secrets currently in use (verify via `supabase secrets list`):
- `ANTHROPIC_API_KEY` (consumed by `claude-proxy`)
- Any SMTP credentials (consumed by `send-test-email`)

## Logs

```bash
# Tail logs for one function
supabase functions logs <name> --project-ref abjabuniwkqpfsenxljp

# Last 100 entries
supabase functions logs <name> --project-ref abjabuniwkqpfsenxljp --limit 100

# Filter by level
supabase functions logs <name> --project-ref abjabuniwkqpfsenxljp | grep ERROR
```

In the dashboard: Project → Edge Functions → click the function → Logs tab. The dashboard view supports time-range filtering and is the easier UX for triage.

Sentry **does not** auto-instrument Deno Edge Functions. To get errors in Sentry, manually call the Sentry Deno SDK from inside the function. Today, no Edge Function sends to Sentry — you triage from Supabase logs.

## Rollback

Edge Functions deploy is single-revision (no built-in versioning). To roll back:

```bash
# Check out the previous commit of the function source
git checkout <previous-commit> -- supabase/functions/<name>/

# Redeploy
supabase functions deploy <name> --project-ref abjabuniwkqpfsenxljp

# Restore HEAD afterwards
git checkout HEAD -- supabase/functions/<name>/
```

Always pair with a `git revert` for the broken commit so the source repo reflects the rollback.

## Testing in production

```bash
# Health check (anonymous)
curl -X OPTIONS https://abjabuniwkqpfsenxljp.supabase.co/functions/v1/<name>

# Authenticated call
curl -X POST https://abjabuniwkqpfsenxljp.supabase.co/functions/v1/<name> \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

Get a `<user-jwt>` by logging into the app (browser DevTools → Application → Local Storage → `sb-abjabuniwkqpfsenxljp-auth-token`).

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| 401 from a function expected to be public | `verify_jwt` left at default (true) | Set `verify_jwt = false` in `supabase/config.toml`, redeploy |
| `Authorization` header rejected | Function uses service-role client without forwarding the user JWT | Forward via `global.headers.Authorization` (see authoring snippet above) |
| Cold-start slow | Function is large or imports heavy modules | Trim imports; pre-init `createClient` outside `serve()` |
| `Module not found: ../_shared/cors.ts` | Deploy missed the shared folder | `supabase functions deploy --no-verify-jwt-strict` and ensure `_shared/` is co-deployed |
| `Deno.env.get('X')` returns undefined in prod | Secret not set | `supabase secrets list` to confirm |
| CORS error in browser | Function doesn't handle `OPTIONS` preflight | Use `handleCors(req)` from `_shared/cors.ts` at top of `serve` |

## Cross-references

- Per-function `verify_jwt` policy lives in `supabase/config.toml`
- Permission codes accepted by `user_has_permission`: CLAUDE.md "Permission Codes"
- Migrations workflow (often deployed together with functions): `05-database-migrations-deploy.md`
- Supabase environments: `02-supabase-environments.md`
