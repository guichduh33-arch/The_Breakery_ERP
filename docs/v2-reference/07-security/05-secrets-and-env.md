# 05 — Secrets & Environment Variables

> **Last verified**: 2026-05-03

## Overview

AppGrav V2 has three distinct secret surfaces:

1. **Vite-time env vars** — read from `.env` by the build, baked into the SPA bundle. Anything `VITE_*` is publicly visible to anyone who downloads the JavaScript. Treat as public.
2. **Supabase Edge Function secrets** — set via `supabase secrets set`, available as `Deno.env.get(...)` server-side. Never exposed to the client.
3. **Build-time secrets** — used by Vite plugins during `npm run build` (e.g. Sentry source-map upload), not bundled into the output.

This document inventories every variable, explains the rotation process, and points at the local protection hooks.

## Frontend (Vite) variables

Reference: [.env.example](../../../.env.example) at the repo root.

| Variable | Required | Public? | Purpose | Source |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | yes | **public** | Base URL of the Supabase project (`https://abjabuniwkqpfsenxljp.supabase.co`) | [src/lib/supabase.ts](../../../src/lib/supabase.ts) |
| `VITE_SUPABASE_ANON_KEY` | yes | **public** | Anon JWT key. Designed to be public; protected by RLS. | [src/lib/supabase.ts](../../../src/lib/supabase.ts) |
| `VITE_SENTRY_DSN` | no (prod) | **public** | Sentry project DSN. DSNs are designed to be public. | [src/lib/sentry.ts](../../../src/lib/sentry.ts) |
| `VITE_APP_VERSION` | no | public | Set by CI; tags Sentry releases as `appgrav-v2@<version>`. | [src/lib/sentry.ts](../../../src/lib/sentry.ts) |
| `VITE_APP_CONTEXT` | no | public | Override subdomain detection. One of `pos | backoffice | mobile | kds | display`. | App context resolver |
| `VITE_PLATFORM` | no | public | `android` for Capacitor builds; otherwise `web`. | [.env.android](../../../.env.example) |
| `SENTRY_AUTH_TOKEN` | no (prod build) | **secret** | Sentry CLI token for source-map upload. Build-time only, never bundled. | `vite.config.ts` Sentry plugin |

**About "public" Supabase keys:** the anon key is a JWT signed with Supabase's secret. It encodes `role: 'anon'` and lets anyone hit the REST/Realtime/Auth endpoints. Security comes entirely from RLS policies — the anon role can only read what RLS lets it read. See [02-rls-patterns.md](./02-rls-patterns.md) and the residual P1-01 finding in [docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md) about the still-too-broad anon SELECT surface.

## Supabase Edge Function secrets

These live in the Supabase project (Functions → Secrets) and are accessible as `Deno.env.get('NAME')` from any deployed function.

| Variable | Required | Used by | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | yes (auto-set) | all | Same value as `VITE_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | yes (auto-set) | functions doing JWT validation | Used to create a per-request client that calls `auth.getUser()`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (auto-set) | all | **Bypasses RLS.** Used by every Edge Function for admin operations. Never include in any client bundle. |
| `ANTHROPIC_API_KEY` | yes (claude-proxy) | `claude-proxy` | Anthropic API key. Capped + model-allowlisted server-side. |
| `EXTRA_ALLOWED_ORIGINS` | no | `_shared/cors.ts` | Comma-separated extra CORS origins. Use sparingly. |
| `ENVIRONMENT` | no | `_shared/cors.ts` | Set to `'development'` to enable localhost CORS. |

The three `SUPABASE_*` vars are auto-injected by the Supabase Functions runtime; you do not manually `supabase secrets set` them. The others are managed via:

```bash
# Set
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# List
supabase secrets list

# Unset
supabase secrets unset ANTHROPIC_API_KEY
```

## Notable absences

The following are **not** stored as Edge Function env vars (intentional):

- **SMTP credentials** — read from `settings` table at runtime by `send-test-email`. Lets the admin UI rotate them without redeploying. Protected by RLS (`settings.update`).
- **Print server URL** — read from `printer_configurations` table. Per-printer, validated SSRF-safe in `send-to-printer`.
- **PIN hashes** — only ever stored in `user_profiles.pin_hash` (bcrypt). Never an env var.

## Vercel production env vars

Set via Vercel dashboard (Settings → Environment Variables) for the `the-breakery-pos` project, applied at build time:

- `VITE_SUPABASE_URL` — production
- `VITE_SUPABASE_ANON_KEY` — production
- `VITE_SENTRY_DSN` — production
- `VITE_APP_VERSION` — set by CI from `package.json`
- `SENTRY_AUTH_TOKEN` — production (sensitive, encrypted at rest by Vercel)

The CI job that runs `npm run build` reads these and bakes the `VITE_*` ones into the bundle. `SENTRY_AUTH_TOKEN` is read by the `@sentry/vite-plugin` to upload sourcemaps and is **not** included in the bundle.

## Local hook: `protect-files.sh`

Source: [.claude/hooks/protect-files.sh](../../../.claude/hooks/protect-files.sh).

A pre-edit hook fires before any `Edit` or `Write` tool call. It blocks modifications to:

- `**/.env` and `**/.env.*` (any depth) — secrets file. Block message: *"BLOQUE: Fichier .env protege (contient des secrets)."*
- `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` — lock files must come from `npm install`, not manual edits.
- `database.generated.ts` — auto-generated by `/gen-types`; manual edits would be silently overwritten.
- `breakery-platform/packages/types/src/database.generated.ts` — V3 equivalent.
- `supabase/functions/_shared/types.ts` — auto-synced from V3 `types` package via `pnpm sync-shared`.

This runs only inside the Claude Code harness; humans editing in their IDE are not blocked. The hook is registered in [.claude/settings.json](../../../.claude/settings.json):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.sh\"", "timeout": 5 }
        ]
      }
    ]
  }
}
```

## .gitignore protection

Reference: [.gitignore](../../../.gitignore) lines 78-86.

```gitignore
# dotenv environment variables file
# Bare `.env` matches at any depth (e.g., breakery-platform/apps/caissapp/.env).
# `.env.*` catches all dotenv variants (production, preview, staging, <branch>-scoped).
# `!.env.example` preserves the committed documentation files.
.env
.env.*
!.env.example
print-server/.env

# Sentry Config File
.env.sentry-build-plugin
```

This is the second line of defence (after the Claude hook). Any `.env` file at any depth is excluded; only `.env.example` and `.env.android.example` (no actual secrets) are tracked.

## Rotation process

### Anon key (Supabase)

Rotate via Supabase dashboard → Settings → API → "Reset anon key". Immediately after:

1. Update `VITE_SUPABASE_ANON_KEY` in Vercel production env.
2. Trigger a new Vercel deploy.
3. Restart any KDS / display devices (their cached SPA bundle still has the old key).
4. **No DB action needed** — Supabase invalidates the old key globally.

### Service role key (Supabase)

Rotate via dashboard → Settings → API → "Reset service_role key". Immediately:

1. Update `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` for any function that doesn't auto-receive it (defensive — usually auto).
2. Redeploy all 16 Edge Functions: `supabase functions deploy`.
3. **Critical** — any leaked old key is now dead, but you should review `audit_logs` for the prior 24h to look for anomalous activity.

### Anthropic API key

Rotate at console.anthropic.com → API Keys → Revoke. Immediately:

1. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
2. No redeploy needed (functions read on each invocation).

### Sentry auth token

Rotate at sentry.io → Settings → Auth Tokens → Revoke. Immediately:

1. Update `SENTRY_AUTH_TOKEN` in Vercel build env.
2. Trigger a new build (next push to main, or manual redeploy).

### PIN reset (per user)

A user-level operation, not a global secret rotation, but mentioned for completeness: see `set-user-pin` Edge Function in [01-auth-flow-pin.md](./01-auth-flow-pin.md). Admin UI can call it without knowing the current PIN.

## What is NOT a secret

The following look secret-y but are not:

- `VITE_SUPABASE_URL` — the project endpoint URL is public DNS.
- `VITE_SUPABASE_ANON_KEY` — public by design (see above).
- `VITE_SENTRY_DSN` — DSN is public by design; it identifies the project, not authenticates writes (Sentry rate-limits + ip-bans).
- The Supabase project ID `abjabuniwkqpfsenxljp` — public.
- The Vercel deployment URL — public.

## What IS a secret

Treat as P0 if leaked:

- `SUPABASE_SERVICE_ROLE_KEY` — full DB access, bypasses RLS. P0 incident, revoke immediately.
- `ANTHROPIC_API_KEY` — billing impact, revoke immediately.
- `SENTRY_AUTH_TOKEN` — could let attacker upload spoofed sourcemaps, revoke immediately.
- SMTP credentials in `settings` table — revoke at the SMTP provider, then update `settings`.
- Any user `pin_hash` (in DB) — bcrypt-hashed, but rotate the user's PIN if hash leaks.

## Verification commands

```bash
# Verify .env is not tracked
git ls-files | grep -E "\.env$|\.env\." | grep -v "\.example$"
#  -> should print nothing

# Verify Vercel env vars
vercel env ls --environment=production

# Verify Supabase secrets
supabase secrets list

# Verify the Claude hook is wired
jq '.hooks.PreToolUse[0].hooks[0].command' /home/user/appGrav-v2/.claude/settings.json
```

## Cross-references

- [04-edge-function-security.md](./04-edge-function-security.md) — Edge Function deployment + secret consumption.
- [06-pii-and-compliance.md](./06-pii-and-compliance.md) — PII handling, Sentry scrubbing.
- [10-deployment-ops/](../10-deployment-ops/) — Vercel build pipeline, sourcemap upload.
- [.env.example](../../../.env.example) — canonical list of frontend variables.
- [.claude/hooks/protect-files.sh](../../../.claude/hooks/protect-files.sh) — pre-edit guard.
