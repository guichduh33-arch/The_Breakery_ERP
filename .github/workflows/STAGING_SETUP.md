# Staging Deployment Setup

This document covers provisioning the GitHub Actions secrets required by
`staging-deploy.yml` (D-W6-CICD-01) and `playwright-e2e.yml` (D-W6-6C-05).

## V3 Dev Project

| Field | Value |
|-------|-------|
| Project ID | `ikcyvlovptebroadgtvd` |
| Name | `the-breakery-v3-dev` |
| Region | `ap-southeast-1` |
| Dashboard | <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd> |
| Plan | Pro ($10/mo) |

## Secrets required by `staging-deploy.yml`

```bash
# Supabase personal access token — create at https://supabase.com/dashboard/account/tokens
gh secret set SUPABASE_ACCESS_TOKEN --body "<token>"

# The V3 dev project ref (must equal ikcyvlovptebroadgtvd)
gh secret set SUPABASE_PROJECT_REF_STAGING --body "ikcyvlovptebroadgtvd"

# Database password — found at: Dashboard → Settings → Database → Database password
gh secret set SUPABASE_DB_PASSWORD_STAGING --body "<db-password>"

# Project URL — https://ikcyvlovptebroadgtvd.supabase.co
gh secret set SUPABASE_URL_STAGING --body "https://ikcyvlovptebroadgtvd.supabase.co"

# Anon (publishable) key — Dashboard → Settings → API → Project API keys → anon (public)
gh secret set SUPABASE_ANON_KEY_STAGING --body "<anon-key>"

# Service role key — Dashboard → Settings → API → Project API keys → service_role (secret)
# NEVER expose in client-side bundles — used only by Edge Function runtime.
gh secret set SUPABASE_SERVICE_ROLE_STAGING --body "<service-role-key>"
```

## Secrets required by `playwright-e2e.yml` (S71 build-in-CI model)

Le nightly build + sert POS/BO en localhost dans le job (pas d'URL hébergée).
Il ne reste que 3 secrets à poser (le 4e est déjà là) :

```bash
# Dev V3 anon (publishable) key — Dashboard → Settings → API → anon (public)
gh secret set VITE_SUPABASE_ANON_KEY --body "<anon-key>"

# 6-digit PIN de l'utilisateur E2E owner  (user_profiles 0e2e0000-…-001)
gh secret set E2E_PIN_ADMIN --body "<6-digit-pin>"

# 6-digit PIN de l'utilisateur E2E cashier (user_profiles 0e2e0000-…-002)
gh secret set E2E_PIN_CASHIER --body "<6-digit-pin>"

# Déjà posé (2026-05-16) — connexion pooler pour le provisioning des PINs :
#   V3_DEV_PG_POOLER_URL
```

`VITE_SUPABASE_URL` est public (`https://ikcyvlovptebroadgtvd.supabase.co`) et
codé en clair dans le workflow — pas un secret. Les anciens secrets
`STAGING_POS_URL` / `STAGING_BO_URL` / `E2E_KIOSK_JWT` ne sont plus requis.

## Secrets status (as of Session 21)

| Secret | Status |
|--------|--------|
| `V3_DEV_PG_POOLER_URL` | Set (2026-05-16) |
| `SUPABASE_ACCESS_TOKEN` | Not set — needs provisioning |
| `SUPABASE_PROJECT_REF_STAGING` | Not set — needs provisioning |
| `SUPABASE_DB_PASSWORD_STAGING` | Not set — needs provisioning |
| `SUPABASE_URL_STAGING` | Not set — needs provisioning |
| `SUPABASE_ANON_KEY_STAGING` | Not set — needs provisioning |
| `SUPABASE_SERVICE_ROLE_STAGING` | Not set — needs provisioning |
| `VITE_SUPABASE_ANON_KEY` | Not set — needs provisioning |
| `E2E_PIN_CASHIER` | Not set — needs provisioning |
| `E2E_PIN_ADMIN` | Not set — needs provisioning |

## GitHub Environment: `staging`

The `staging-deploy.yml` workflow uses `environment: staging` which triggers
GitHub's required-reviewer approval gate. Configure reviewers at:

**Repository → Settings → Environments → staging → Required reviewers**

## Where to find each secret value

| Secret | Where to find |
|--------|--------------|
| `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) — create a new PAT |
| `SUPABASE_PROJECT_REF_STAGING` | Dashboard → Project Settings → General → Reference ID |
| `SUPABASE_DB_PASSWORD_STAGING` | Dashboard → Project Settings → Database → Database password |
| `SUPABASE_URL_STAGING` | Dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY_STAGING` | Dashboard → Project Settings → API → `anon` key |
| `SUPABASE_SERVICE_ROLE_STAGING` | Dashboard → Project Settings → API → `service_role` key |
| `STAGING_POS_URL` | Your Vercel / hosting dashboard for the POS app preview URL |
| `STAGING_BO_URL` | Your Vercel / hosting dashboard for the Backoffice app preview URL |
| `E2E_PIN_CASHIER` | Your seed data — PIN for user `00000000-0000-0000-0000-000000000002` |
| `E2E_PIN_ADMIN` | Your seed data — PIN for user `00000000-0000-0000-0000-000000000001` |
| `E2E_KIOSK_JWT` | Call `kiosk-issue-jwt` EF with your kiosk pairing code |

## Pre-deployment checklist

Before a `staging-deploy.yml` run succeeds:

- [ ] All secrets above are set in the repository.
- [ ] `staging` environment exists with at least one required reviewer.
- [ ] V3 dev Supabase project `ikcyvlovptebroadgtvd` is active (not paused).
- [ ] Supabase CLI has access via `SUPABASE_ACCESS_TOKEN`.
- [ ] All migrations in `supabase/migrations/` are monotonically numbered.
- [ ] `packages/supabase/src/types.generated.ts` is up to date (run types regen after schema changes).

## Vercel deploy (optional, disabled by default)

The `staging-deploy.yml` has Vercel deploy steps under `if: false`. To enable:

1. Set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_POS`, `VERCEL_PROJECT_ID_BACKOFFICE` secrets.
2. Remove `if: false` from the Vercel steps in `staging-deploy.yml`.
