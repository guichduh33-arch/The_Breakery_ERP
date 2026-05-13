# 03 — Environment variables

> **Last verified**: 2026-05-03

Toutes les variables d'environnement utilisées par AppGrav V2 (frontend Vite + Edge Functions Deno + tooling CI). Source de vérité local : `.env.example`.

---

## 1. Conventions Vite

| Préfixe | Visibilité |
|---|---|
| `VITE_*` | **Exposée au bundle client** — accessible via `import.meta.env.VITE_FOO`. **Ne jamais y mettre de secret serveur.** |
| (autre) | Build-time uniquement, non exposée au client (ex. `SENTRY_AUTH_TOKEN` consommé par le plugin Vite Sentry à la compilation) |

---

## 2. REQUIRED — Supabase connection

| Nom | Type | Required | Exemple / Source | Description |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | public client | ✅ | `https://abjabuniwkqpfsenxljp.supabase.co` | URL projet Supabase. Région `ap-southeast-1` (Singapore). |
| `VITE_SUPABASE_ANON_KEY` | public client | ✅ | Get from Supabase dashboard → Settings → API | Clé anon publique. RLS protège les données. |

Récupérer les valeurs : `https://supabase.com/dashboard/project/abjabuniwkqpfsenxljp/settings/api`.

---

## 3. OPTIONAL (production) — Sentry monitoring

| Nom | Type | Required | Exemple / Source | Description |
|---|---|---|---|---|
| `VITE_SENTRY_DSN` | public client | ⚙️ recommandé prod | `https://...@o.../...` (depuis Sentry → Settings → Client Keys) | DSN frontend pour `@sentry/react`. Désactive Sentry si vide. |
| `SENTRY_AUTH_TOKEN` | build-time secret | ⚙️ recommandé prod | Sentry → Account → API → Auth Tokens (scope `project:releases`) | Permet l'upload sourcemaps lors du `vite build` via `@sentry/vite-plugin`. |

> **Comportement** : si `VITE_SENTRY_DSN` absent ou en dev (`import.meta.env.DEV`), Sentry est désactivé. Voir [`05-integrations/03-sentry-monitoring.md`](../05-integrations/03-sentry-monitoring.md).

---

## 4. OPTIONAL — App context & version

| Nom | Type | Required | Exemple | Description |
|---|---|---|---|---|
| `VITE_APP_VERSION` | public client | ❌ | `2.4.1` (auto-set par CI) | Version affichée en bas de page + tag Sentry. Auto-set par le pipeline CI Vercel via la commande de build. |
| `VITE_APP_CONTEXT` | public client | ❌ | `pos`, `backoffice`, `mobile`, `kds`, `display` | Override la détection par sous-domaine. Utile en dev local pour simuler un contexte. |

---

## 5. OPTIONAL — Capacitor / Android / iOS

| Nom | Type | Required | Exemple | Description |
|---|---|---|---|---|
| `VITE_PLATFORM` | public client | ✅ pour build natif | `android` ou `ios` | Active branches code spécifiques natif (Capacitor APIs). Mis dans `.env.android` (cf. `npm run android:build`). |

---

## 6. Edge Functions secrets — Supabase Vault

Les secrets ci-dessous sont stockés via `supabase secrets set NAME=value` et accessibles côté Edge Function via `Deno.env.get('NAME')`. **Ne pas mettre dans `.env` local.**

| Nom | Edge Function consommatrice | Description |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | toutes les Edge Fn admin | Clé service role (bypass RLS). **Jamais** côté client. Auto-injectée par Supabase. |
| `SUPABASE_URL` | toutes | URL projet (auto-injectée). |
| `SUPABASE_ANON_KEY` | toutes | Clé anon (auto-injectée). |
| `ANTHROPIC_API_KEY` | `claude-proxy` | Clé API Claude (Anthropic) pour le proxy LLM. |
| `SMTP_HOST` | `send-test-email`, futures emails | Hôte SMTP (ex. Gmail, SES). |
| `SMTP_PORT` | idem | Port SMTP (587 TLS, 465 SSL). |
| `SMTP_USER` | idem | Username SMTP. |
| `SMTP_PASSWORD` | idem | Password / app-password SMTP. |
| `SMTP_FROM` | idem | Adresse expéditeur (`The Breakery <noreply@...>`). |
| `INVOICE_LOGO_URL` | `generate-invoice` | URL absolue du logo affiché en haut des factures PDF. |
| `PRINT_SERVER_URL` | `send-to-printer` (si invoké en mode SaaS) | URL print server distant pour mode sans LAN. |

> Voir [`05-integrations/02-edge-functions.md`](../05-integrations/02-edge-functions.md) et [`07-security/05-secrets-and-env.md`](../07-security/05-secrets-and-env.md).

---

## 7. CI / Vercel deployment env

À configurer dans Vercel → Project → Settings → Environment Variables (scope `Production`, `Preview`, `Development`).

| Nom | Scope Vercel | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | All | Identique à `.env` local |
| `VITE_SUPABASE_ANON_KEY` | All | Identique à `.env` local |
| `VITE_SENTRY_DSN` | Production + Preview | Séparer les DSN par env si possible |
| `SENTRY_AUTH_TOKEN` | Production | Upload sourcemaps |
| `VITE_APP_VERSION` | All | Auto-set par script CI : `npm version --no-git-tag-version` ou `git describe` |

---

## 8. Hooks de protection

Le hook `protect-files.sh` (`.claude/hooks/`) bloque toute modification via Edit/Write sur :

- `.env` (root)
- `.env.android`
- `.env.local`
- `package-lock.json`, `pnpm-lock.yaml`
- `database.generated.ts`

**Workflow correct** :

| Cas | Action |
|---|---|
| Modifier une env var locale | Éditer `.env` **manuellement** dans l'IDE (pas via Claude) |
| Ajouter une nouvelle env var | (1) ajouter dans `.env.example` (lui n'est pas protégé), (2) demander à l'utilisateur de mettre la valeur dans `.env`, (3) propager dans Vercel |
| Régénérer types | Lancer `/gen-types` |

---

## 9. Validation au démarrage

`src/lib/supabase.ts` valide la présence des deux env vars critiques :

```ts
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check your .env file'
  )
}
```

Sentry et app version sont optionnelles — pas de fail.

---

## 10. Synthèse — tableau condensé

| Variable | Côté | Required | Stockée où |
|---|---|:--:|---|
| `VITE_SUPABASE_URL` | client | ✅ | `.env` + Vercel |
| `VITE_SUPABASE_ANON_KEY` | client | ✅ | `.env` + Vercel |
| `VITE_SENTRY_DSN` | client | ⚙️ prod | `.env` + Vercel |
| `SENTRY_AUTH_TOKEN` | build | ⚙️ prod | Vercel uniquement |
| `VITE_APP_VERSION` | client | ❌ | Auto CI |
| `VITE_APP_CONTEXT` | client | ❌ | `.env` (dev only) |
| `VITE_PLATFORM` | client | ✅ natif | `.env.android` / `.env.ios` |
| `ANTHROPIC_API_KEY` | Edge Fn | ✅ pour claude-proxy | Supabase Vault |
| `SMTP_*` | Edge Fn | ✅ pour emails | Supabase Vault |
| `INVOICE_LOGO_URL` | Edge Fn | ⚙️ | Supabase Vault |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Fn | auto-injecté | Supabase managed |

---

## 11. Liens

- `.env.example` (root) — template à copier en `.env`
- [`05-integrations/01-supabase.md`](../05-integrations/01-supabase.md) — client singleton
- [`05-integrations/02-edge-functions.md`](../05-integrations/02-edge-functions.md) — 16 Edge Functions
- [`05-integrations/03-sentry-monitoring.md`](../05-integrations/03-sentry-monitoring.md) — config Sentry
- [`07-security/05-secrets-and-env.md`](../07-security/05-secrets-and-env.md) — sécurité secrets
- [`10-deployment-ops/01-vercel-deployment.md`](../10-deployment-ops/01-vercel-deployment.md) — déploiement Vercel
- [`10-deployment-ops/03-android-build.md`](../10-deployment-ops/03-android-build.md) — Android specifics
