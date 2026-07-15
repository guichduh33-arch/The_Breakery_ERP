# Staging configuration — Session 13

> Reference document for team. **Contains no secret values** — only secret
> names, project refs, and operational procedures. Last reviewed: 2026-05-13.

---

## 1. Target project

The Breakery uses the existing V3 dev Supabase sandbox as the **staging** target
for Session 13 work. Production is a separate (V2) project; **do not deploy
Session 13 work to production until V3 acceptance is signed off**.

| Field                     | Value                                           |
|---------------------------|-------------------------------------------------|
| Staging project ref       | `ikcyvlovptebroadgtvd`                          |
| Staging API URL           | `https://ikcyvlovptebroadgtvd.supabase.co`      |
| Staging region            | (set by initial project create — confirm in dashboard) |
| Production project ref    | `abjabuniwkqpfsenxljp` (V2 — **do not touch**)  |
| Local dev (Docker)        | `http://127.0.0.1:54321` (anon/service keys from `supabase status`) |

Source of truth: `~/.claude/projects/.../memory/project_v3_dev_supabase.md`.

---

## 2. Required GitHub repository secrets

Configure under **Settings → Secrets and variables → Actions** at the
**repository** level, and (where noted) bind to the `staging` **environment**
so that the required-reviewer approval gate applies before exposure.

### 2.1 Always required (CI + staging deploy)

| Secret name                            | Used by                       | Scope        | Notes                                                                 |
|----------------------------------------|-------------------------------|--------------|-----------------------------------------------------------------------|
| `SUPABASE_ACCESS_TOKEN`                | `staging-deploy.yml`          | environment  | Personal access token from Supabase dashboard → Account → Access tokens. Allows `supabase` CLI to authenticate. |
| `SUPABASE_PROJECT_REF_STAGING`         | `staging-deploy.yml`          | environment  | Must equal `ikcyvlovptebroadgtvd`. Workflow logs a warning if mismatched. |
| `SUPABASE_DB_PASSWORD_STAGING`         | `staging-deploy.yml`          | environment  | DB password set when project was created (or rotated). Used by `supabase db push --linked --password`. |
| `SUPABASE_URL_STAGING`                 | `staging-deploy.yml` (build)  | environment  | Baked into Vite bundle as `VITE_SUPABASE_URL`.                        |
| `SUPABASE_ANON_KEY_STAGING`            | `staging-deploy.yml` (build)  | environment  | Public anon key, baked into Vite bundle as `VITE_SUPABASE_ANON_KEY`. Safe to expose to browsers (RLS-protected). |

### 2.2 Observability (recommended)

| Secret name                            | Used by                       | Scope        | Notes                                                                 |
|----------------------------------------|-------------------------------|--------------|-----------------------------------------------------------------------|
| `SENTRY_DSN_POS_STAGING`               | `staging-deploy.yml` (build)  | environment  | Sentry DSN for POS app. Leave unset to disable Sentry in staging.     |
| `SENTRY_DSN_BACKOFFICE_STAGING`        | `staging-deploy.yml` (build)  | environment  | Sentry DSN for Backoffice app.                                        |

### 2.3 Optional — Vercel preview deploy

Disabled by default in `staging-deploy.yml` (steps guarded by `if: false`).
Wire these and flip the guards to enable.

| Secret name                            | Used by                       | Scope        | Notes                                                                 |
|----------------------------------------|-------------------------------|--------------|-----------------------------------------------------------------------|
| `VERCEL_TOKEN`                         | `staging-deploy.yml`          | environment  | Vercel personal token with deploy permission.                         |
| `VERCEL_ORG_ID`                        | `staging-deploy.yml`          | environment  | From Vercel project settings.                                         |
| `VERCEL_PROJECT_ID_POS`                | `staging-deploy.yml`          | environment  | Vercel project for `apps/pos`.                                        |
| `VERCEL_PROJECT_ID_BACKOFFICE`         | `staging-deploy.yml`          | environment  | Vercel project for `apps/backoffice`.                                 |

### 2.4 Server-side only — never in client bundles

| Secret name                            | Used by                       | Scope        | Notes                                                                 |
|----------------------------------------|-------------------------------|--------------|-----------------------------------------------------------------------|
| `SUPABASE_SERVICE_ROLE_STAGING`        | Edge Functions runtime        | environment  | Configured on the Supabase project itself (`supabase secrets set --project-ref ikcyvlovptebroadgtvd SERVICE_ROLE_KEY=...`) — **not** in workflow env. **Never** prefix with `VITE_`. |

---

## 3. Environment variable contracts

### 3.1 Vite apps (browser bundle, baked at build time)

Both `apps/pos` and `apps/backoffice` read these at build time. Anything
prefixed with `VITE_` ends up in the browser bundle — only put **public**
values there.

| Variable                       | Local (Docker)                     | Staging                                              |
|--------------------------------|------------------------------------|------------------------------------------------------|
| `VITE_SUPABASE_URL`            | `http://127.0.0.1:54321`           | `https://ikcyvlovptebroadgtvd.supabase.co`           |
| `VITE_SUPABASE_ANON_KEY`       | from `supabase status` (anon key)  | from `SUPABASE_ANON_KEY_STAGING` secret              |
| `VITE_SENTRY_DSN_POS`          | empty (disabled)                   | from `SENTRY_DSN_POS_STAGING` secret (optional)      |
| `VITE_SENTRY_DSN_BACKOFFICE`   | empty (disabled)                   | from `SENTRY_DSN_BACKOFFICE_STAGING` secret (optional) |
| `TZ`                           | host TZ                            | `Asia/Jakarta` (Vercel runtime envs, if applicable)  |

> **Reminder from MEMORY.md** — Vite `envDir` is unset for both apps, so the
> `.env.local` files must live **inside `apps/pos/` and `apps/backoffice/`**,
> NOT at the repo root. The repo-root `.env.example` is misleading.

### 3.2 Edge Functions runtime (Deno, server-side)

Set via `supabase secrets set --project-ref ikcyvlovptebroadgtvd KEY=value`.
Never `VITE_`-prefixed.

| Variable                       | Notes                                                                 |
|--------------------------------|-----------------------------------------------------------------------|
| `SUPABASE_URL`                 | auto-injected by Supabase runtime                                     |
| `SUPABASE_ANON_KEY`            | auto-injected                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`    | auto-injected                                                         |
| `PIN_JWT_SECRET`               | HS256 secret used by `auth-verify-pin` to sign PIN JWTs               |
| `PIN_JWT_ISSUER`               | issuer claim — e.g. `the-breakery-staging`                            |
| (other EF-specific env)        | document additions here as they are introduced                        |

### 3.3 CI workflow (`.github/workflows/ci.yml`)

The CI workflow boots a local Supabase Docker stack and reads keys back from
`supabase status -o json`, exporting them as `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
to `$GITHUB_ENV`. **No GitHub secrets are needed for CI.**

---

## 4. Verify staging connectivity locally

Use these steps to sanity-check staging from your laptop **without deploying**.

```bash
# 1. Authenticate the supabase CLI (one-time).
supabase login

# 2. Link the current checkout to staging. You'll be prompted for the DB password.
supabase link --project-ref ikcyvlovptebroadgtvd

# 3. Compare local migrations vs staging migrations (read-only).
supabase db diff --linked

# 4. Quick connectivity probe (anon access via REST).
curl -sS -H "apikey: $VITE_SUPABASE_ANON_KEY_STAGING" \
  "https://ikcyvlovptebroadgtvd.supabase.co/rest/v1/?select=*" | head

# 5. Vitest live RPC suite against staging (optional, manual).
#    Run from repo root with staging anon key exported.
VITE_SUPABASE_URL="https://ikcyvlovptebroadgtvd.supabase.co" \
VITE_SUPABASE_ANON_KEY="<paste staging anon key>" \
SUPABASE_SERVICE_ROLE_KEY="<paste staging service role>" \
  pnpm --filter @breakery/supabase-tests test inventory

# 6. Unlink when done (recommended — avoids accidental writes).
supabase unlink
```

> **Never run `pnpm db:reset` while linked to staging.** It resets the linked
> DB. Always run it against the local Docker stack only.

---

## 5. Rollback procedures

### 5.1 Rollback a bad migration

```bash
# 1. Identify the offending migration version (timestamp prefix).
supabase migration list --linked

# 2. Author a corrective migration (forward-only — no in-place edits).
#    Pick the next monotonic 20260516xxxxxx_*.sql number.
#    The corrective migration should DROP the offending objects and
#    recreate any prior version we need to restore.

# 3. Push the correction.
supabase db push --linked --password "$STAGING_DB_PASSWORD"
```

**Do not** delete migration files from `supabase/migrations/` after they have
been applied to staging. Forward-only is the contract; `db:reset` on local
must still replay history identically.

### 5.2 Rollback an Edge Function

```bash
# Deploy the previous source revision of the function.
git checkout <previous-good-sha> -- supabase/functions/<fn-name>
supabase functions deploy <fn-name> --project-ref ikcyvlovptebroadgtvd
git checkout HEAD -- supabase/functions/<fn-name>
```

### 5.3 Rollback an app bundle (Vercel)

If Vercel preview deploy is enabled, use the Vercel dashboard's
"Promote to Production" / rollback UI on the previous deployment. Otherwise,
re-run `staging-deploy.yml` with a `workflow_dispatch` `ref` input pointing at
the last good commit SHA.

### 5.4 Emergency: revoke compromised keys

If anon/service role keys leak:

```bash
# 1. Rotate keys via the Supabase dashboard (Project Settings → API).
# 2. Update GitHub secrets: SUPABASE_ANON_KEY_STAGING,
#    SUPABASE_SERVICE_ROLE_STAGING (and re-set via `supabase secrets set`).
# 3. Re-run `staging-deploy.yml` to rebuild apps with the new anon key.
# 4. Revoke any compromised SUPABASE_ACCESS_TOKEN in dashboard → Account.
```

---

## 6. CI workflow contract

`.github/workflows/ci.yml` runs on PRs to `master`, `main`, and any
`swarm/session-13*` branch. It is the merge gate.

**Steps (fail-fast):**

1. Checkout (full history, needed for `git diff --exit-code`).
2. Setup pnpm 9.15 + Node 22.
3. Cache pnpm store + turbo cache.
4. `pnpm install --frozen-lockfile`.
5. Setup Supabase CLI + `supabase start` (local Docker stack).
6. Export local Supabase keys to `$GITHUB_ENV`.
7. `pnpm db:reset` — re-apply all migrations + seed.
8. `pnpm db:types` — regenerate `packages/supabase/src/types.generated.ts`.
9. `git diff --exit-code packages/supabase/src/types.generated.ts` — **drift
   guard**. Fails the build if the regenerated file differs from the committed
   copy. This is the #1 broken-CI cause per `CLAUDE.md`.
10. `pnpm typecheck`.
11. `pnpm lint`.
12. `pnpm test --concurrency=1` — Vitest live RPC + domain unit + BO/POS smoke.
13. `bash supabase/tests/run_pgtap.sh` — full pgTAP suite.
14. `pnpm build` — all apps + packages.
15. Upload coverage + `apps/*/dist/**` artifacts.
16. `supabase stop` (always).

Approximate runtime: **12–18 minutes** on `ubuntu-latest` with warm caches,
**20–25 minutes** cold.

---

## 7. Staging deploy contract

`.github/workflows/staging-deploy.yml` runs on push to `swarm/session-13*` or
manual `workflow_dispatch`.

**Approval gate:** the job binds to `environment: staging`. Configure required
reviewers under **Settings → Environments → staging → Required reviewers**.
The job pauses until a reviewer approves.

**Concurrency:** only one staging deploy runs at a time
(`concurrency.group: staging-deploy`, no cancel — pending runs queue).

**Steps:**

1. Checkout the requested ref.
2. Setup pnpm + Node + Supabase CLI.
3. `pnpm install --frozen-lockfile`.
4. Sanity-check `SUPABASE_PROJECT_REF_STAGING` matches `ikcyvlovptebroadgtvd`.
5. `supabase link --project-ref ikcyvlovptebroadgtvd --password "$STAGING_DB_PASSWORD"`.
6. `supabase db push --linked --include-all` — apply migrations to staging.
7. `supabase functions deploy --project-ref ikcyvlovptebroadgtvd` — deploy all EFs.
8. `pnpm build --filter @breakery/app-pos --filter @breakery/app-backoffice` — build apps with staging envs baked in.
9. Upload build artifacts (`pos-staging-dist`, `backoffice-staging-dist`, 14-day retention).
10. (Optional, off by default) Vercel preview deploy for each app.
11. Write a summary to the job's `$GITHUB_STEP_SUMMARY`.

Approximate runtime: **8–12 minutes** (no DB reset, no test suite).

---

## 8. Proposed `package.json` additions

These are **suggestions** for the lead to review and apply (this phase does
not modify `package.json` directly).

```json
{
  "scripts": {
    "db:diff-types": "pnpm db:types && git diff --exit-code packages/supabase/src/types.generated.ts",
    "ci:local": "pnpm install --frozen-lockfile && pnpm db:reset && pnpm db:diff-types && pnpm typecheck && pnpm lint && pnpm test --concurrency=1 && bash supabase/tests/run_pgtap.sh && pnpm build",
    "staging:link": "supabase link --project-ref ikcyvlovptebroadgtvd",
    "staging:diff": "supabase db diff --linked",
    "staging:unlink": "supabase unlink"
  }
}
```

Rationale:

- `db:diff-types` mirrors the CI drift guard so agents can self-check before
  pushing. The CI failure message points to this script.
- `ci:local` reproduces the full CI pipeline on a developer machine — useful
  when debugging a CI failure that doesn't repro from a single sub-step.
- `staging:link` / `staging:diff` / `staging:unlink` give a guarded interface
  to the staging CLI flows so we don't keep retyping the project ref.

---

## 9. Open items / blockers

Track these before flipping CI on the `master` branch protection rule.

- [ ] `SUPABASE_ACCESS_TOKEN` — generate + add to `staging` env secrets.
- [ ] `SUPABASE_PROJECT_REF_STAGING` — set to `ikcyvlovptebroadgtvd`.
- [ ] `SUPABASE_DB_PASSWORD_STAGING` — retrieve from Supabase dashboard (or
  rotate if unknown).
- [ ] `SUPABASE_URL_STAGING` — set to `https://ikcyvlovptebroadgtvd.supabase.co`.
- [ ] `SUPABASE_ANON_KEY_STAGING` — retrieve from dashboard → API.
- [ ] `SUPABASE_SERVICE_ROLE_STAGING` — set on Supabase project via
  `supabase secrets set`, NOT as a GitHub Actions secret (it must never flow
  into a Vite build env).
- [ ] **GitHub `staging` environment created** with at least 1 required reviewer.
- [ ] **Branch protection rule** on `master` set to require the `CI` workflow
  to pass before merge.
- [ ] (Optional) `SENTRY_DSN_*_STAGING` secrets added — leave unset to disable.
- [ ] (Optional) Vercel project IDs + token if we wire preview deploys.

---

## 10. References

- `docs/workplan/plans/2026-05-13-session-13-INDEX.md` (Phase 0.2 spec).
- `~/.claude/projects/.../memory/project_v3_dev_supabase.md` (staging project source of truth).
- `~/.claude/projects/.../memory/project_edge_runtime_windows.md` (Edge runtime
  Windows bug — informs why CI runs on `ubuntu-latest`, not Windows).
- `CLAUDE.md` § "Build & Test" (canonical commands).
- `.github/workflows/ci.yml`, `.github/workflows/staging-deploy.yml`.
