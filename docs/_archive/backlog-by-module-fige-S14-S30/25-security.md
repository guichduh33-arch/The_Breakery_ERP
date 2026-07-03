# Travail — Security

> Last updated: 2026-05-03
> Référence : [`../07-security/`](../07-security/) (`01-auth-flow-pin.md`, `02-rls-patterns.md`)
> Sources audit : `docs/audit/01-architecture-security-audit.md` (full), `docs/audit/08-operations-lan-audit.md` §2 (Edge Functions), `docs/audit/03-code-quality-schema-audit.md` §A1, `docs/audit/00-executive-summary.md` §Sécurité, `CURRENT_STATE.md` Backlog T3 / T5

## Objectifs du module

1. Refermer les findings P1 / P2 du `security-review` 2026-04-09 — cible : 0 P1 ouvert, P2 < 3.
2. Restreindre les RLS anon SELECT sur tables PII (orders, customers, user_roles) — cible : 0 table PII lisible avec clé anon.
3. Mettre en place le rate limiting Edge Functions — cible : aucune Edge Function sans limite IP-based, focus auth (T3 backlog).
4. Auditer les Edge Functions une par une (permission check, input validation, error leakage) — cible : matrice complète conforme.
5. Hardenir le SPA Vercel : CSP/HSTS, SRI, dependency audit régulier — cible : score Mozilla Observatory ≥ B+.

---

## Tâches

### TASK-25-001 — Restreindre RLS anon SELECT sur tables PII [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `supabase/migrations/20260517000033_rls_pii_anon_to_authenticated.sql` flips `orders/order_items/customers/customer_categories/pos_sessions` SELECT from `anon` to `is_authenticated() OR has_kiosk_jwt()`; pgTAP suite `supabase/tests/security.test.sql` (T_SEC_*) asserts anon SELECT denied. Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P1-01 — *"16+ tables (products, categories, orders, order_items, customers, customer_categories, promotions, settings, suppliers, etc.) have FOR SELECT TO anon USING (true). Anyone with the anon key can read all customers, all orders. Data exfiltration of customer PII and business data."*
**Critère d'acceptation** :
- [ ] Migration : tables PII (`orders`, `order_items`, `customers`, `customer_categories`, `user_roles`) passées de `anon USING(true)` → `authenticated USING(true)`
- [ ] Tests Edge Functions : `auth-verify-pin` crée bien session Supabase Auth — sinon les pages plantent
- [ ] Pour tables non-PII restant en anon (products, categories, promotions) : justifier dans commentaire migration
- [ ] Vérification : `psql` avec anon key → SELECT customers retourne 0 rows
**Fichiers concernés** : nouvelle migration `supabase/migrations/<date>_restrict_anon_pii_tables.sql`
**Dépend de** : confirmation que magic link Auth dans `auth-verify-pin` (lines 220-241) crée bien session valide
**Estimation** : `M`
**Risques** : casse KDS / display si ces devices n'ont pas de session Supabase Auth — vérifier en staging d'abord (TASK-24-008)
**Notes** : audit P2-03 (anon read sur roles / user_roles) inclus dans cette tâche

**S20 update:** GRANT-level defense-in-depth complement. S13 closed the RLS layer; S20 closes the table/view GRANT layer (Wave 2, migration `20260524000020`) and the function EXECUTE layer (Wave 2.5, migrations `20260524000030` + corrective `_31`). `pg_default_acl` re-targeted to prevent future auto-grants on new postgres-owned objects. Critical pattern recorded in CLAUDE.md, including the PUBLIC-inheritance gotcha discovered during execution.

### TASK-25-002 — Rate limiting Edge Functions [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `supabase/functions/_shared/rate-limit.ts` (with durable Postgres-backed `checkRateLimitDurable`) + migration `20260517000031_init_edge_function_rate_limits.sql` (table `edge_function_rate_limits`); applied to `auth-verify-pin` (3/min/IP) and `kiosk-issue-jwt` (10/min/IP + 1/min/kiosk_id); covered by `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts`. Commit `bdf21aa`.
**Status note (2026-05-18)** : S22 update — DEV-S19-2.A-02 (HTTP `Retry-After` missing on 429 across 5 rate-limited EFs) **closed**. Helper `rateLimitedResponse(retryAfterSec)` added in `supabase/functions/_shared/responses.ts` + wired in 5 EFs (`auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item`). Header value clamped to `Math.max(1, Math.ceil(retryAfterSec))` and sourced from `record_rate_limit_v1` return. `Access-Control-Expose-Headers: Retry-After` added so browser fetch callers can read the header. Live curl smoke from `203.0.113.250` confirmed `Retry-After: 57` on 4th `auth-verify-pin` attempt. Vitest live `rate-limit-retry-after.test.ts` 5/5 green. ALSO : DEV-S17-1.B-01 (cost_price WAC bypass) **closed** via column-level REVOKE + new SECURITY DEFINER RPC `update_cost_price_v1` — see `07-purchasing-suppliers.md` TASK-07-012 S22 Status note for details. Defense-in-depth GRANT pattern from S20 applied (REVOKE FROM PUBLIC + REVOKE FROM anon + GRANT TO authenticated on the new RPC).
**Contexte** : `docs/audit/00-executive-summary.md` §P1 + `docs/audit/01-architecture-security-audit.md` §P1-01 + `08-operations-lan-audit.md` §2.3 P2 — *"No rate limiting on Edge Functions. auth-verify-pin exposed to brute-force PIN. Lockout is per-user, not per-IP. Attacker could enumerate PINs across multiple users without triggering per-user lockout."* + `CURRENT_STATE.md` T3.
**Critère d'acceptation** :
- [ ] Helper `_shared/rate-limit.ts` utilisant Supabase table `edge_function_rate_limits` (window-based, IP + endpoint)
- [ ] Limites : `auth-verify-pin` 10 req/IP/min, autres endpoints 60 req/IP/min
- [ ] Réponse 429 + `Retry-After` header si dépassé
- [ ] Audit log les rate limit hits avec severity warning
- [ ] Tests : 11 calls successifs `auth-verify-pin` même IP → 11e retourne 429
**Fichiers concernés** : `supabase/functions/_shared/rate-limit.ts`, migration `<date>_create_edge_function_rate_limits.sql`, intégration dans 16 Edge Functions
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : table rate_limits grossit vite — TTL cleanup automatique (delete > 10 min)
**Notes** : alternative : utiliser Upstash Redis ou Cloudflare WAF (mais coût supplémentaire)

### TASK-25-003 — Supprimer fallback PIN client-side [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `apps/pos/src/stores/authStore.ts` dropped `supabase.auth.setSession()` fallback path; `apps/pos/src/features/auth/hooks/useAuthPin.ts` documents "EF is the sole arbiter ; if the EF is unreachable the user cannot log in"; commit `ed6e32a` body explicitly cites task 25-003. Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P1-02 — *"Client-side PIN fallback bypasses Edge Function security controls. _loginWithPinFallback uses anon key + RPC. Bypasses rate limiting, IP logging, and audit trail. If verify_user_pin is callable by anon, attacker can brute-force PINs at a rate limited only by Supabase's global rate limits — no per-user lockout, no audit logging."*
**Critère d'acceptation** :
- [ ] `authService._loginWithPinFallback` supprimé du code
- [ ] Si `auth-verify-pin` Edge Function indispo → message UI clair "Login service unavailable, contact admin"
- [ ] RPC `verify_user_pin` restreint à `service_role` (pas `anon`)
- [ ] Tests : couper Edge Function → login échoue gracieusement, pas de fallback silencieux
**Fichiers concernés** : `src/services/authService.ts` (lines 184-312), migration RPC permissions
**Dépend de** : aucune (mais vérifier en staging)
**Estimation** : `M`
**Risques** : si Edge Function down = POS down → améliorer monitoring uptime Edge Function avant suppression
**Notes** : aligner avec TASK-24-006 cold start optimization pour fiabilité

### TASK-25-004 — Error message leakage `auth-verify-pin` [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `supabase/functions/_shared/error-redact.ts` (with `redactError` + `logAndRedact` collapsing identity-mode failures to `invalid_credentials` and hiding stacks/PII); `auth-verify-pin/index.ts` consumes it; client `useAuthPin.ts` surfaces only the generic `invalid_credentials` string. Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P1-03 — *"errorResponse(\`Failed to create session: ${sessionError.message} (${sessionError.code})\`, 500, req). The Supabase error message and code are returned to the client. Could reveal database schema details, constraint names, or internal error codes."*
**Critère d'acceptation** :
- [ ] `auth-verify-pin/index.ts` line 193 → message générique "Failed to create session" client-side
- [ ] Détails (`sessionError.message`, `sessionError.code`) loggués server-side via `console.error` (puis Sentry serveur post TASK-24-010)
- [ ] Audit autres Edge Functions pour leak similaire (grep `errorResponse.*\${.*\.message}`)
**Fichiers concernés** : `supabase/functions/auth-verify-pin/index.ts`, audit 15 autres Edge Functions
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : déjà mentionné dans `CURRENT_STATE.md` Global Audit comme partiellement traité — re-vérifier

### TASK-25-005 — CSP + HSTS headers SPA Vercel [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: root `vercel.json` defines `Content-Security-Policy` (`default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; frame-ancestors 'none'; ...`), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options DENY`, `Permissions-Policy`, `Referrer-Policy`. Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-07 — *"Edge Functions have CSP, but the SPA served by Vercel may not have equivalent CSP headers."* `CURRENT_STATE.md` Global Audit mentionne *"Security: CSP + HSTS headers on Vercel"* comme done ; à vérifier.
**Critère d'acceptation** :
- [ ] `vercel.json` contient `Content-Security-Policy` header strict :
  ```
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://abjabuniwkqpfsenxljp.supabase.co https://*.sentry.io;
  frame-ancestors 'none';
  ```
- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` ajouté
- [ ] Test Mozilla Observatory : score B+ minimum
- [ ] Smoke test : appli charge bien, Sentry call fonctionne, Supabase Realtime fonctionne
**Fichiers concernés** : `vercel.json`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : CSP trop strict casse une lib third-party — démarrer en `Content-Security-Policy-Report-Only` et observer 1 semaine
**Notes** : —

### TASK-25-006 — Audit Edge Functions permission checks [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B + D-W6-PERMS-01. V3 evidence: `supabase/functions/_shared/permissions.ts` exists; `notification-dispatch/index.ts` calls `has_permission()`; commit `d97e057` ("fix(edge): D-W6-PERMS-01 — EF permissions read from DB") closes the audit sweep. V3 has only 11 EFs (vs 16 audited in V2) so matrix is narrower. Commit `bdf21aa`.
**Contexte** : `CLAUDE.md` Pitfalls — *"Edge Functions: Must use verify_jwt: true + call user_has_permission(auth.uid(), 'module.action')"* + `docs/audit/08-operations-lan-audit.md` §2.3 — matrice par fonction. Toutes ne loggent pas les permission denials proprement.
**Critère d'acceptation** :
- [ ] Matrice par Edge Function : permission requise documentée dans `docs/reference/07-security/03-edge-functions-permissions.md`
- [ ] Pour chaque fonction : vérifier que `user_has_permission(uid, code)` est appelé avant action sensitive
- [ ] Permission denials → audit log + 403 response (pas 500)
- [ ] Tests par fonction avec user sans permission → 403
**Fichiers concernés** : 16 Edge Functions audit, doc
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : audit révèle gaps additionnels → backlog s'étend
**Notes** : —

### TASK-25-007 — Edge Functions `verify_jwt` config explicite [P2] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `supabase/config.toml` lines 369-383 declare `[functions.auth-verify-pin/auth-get-session/auth-logout/auth-change-pin] verify_jwt = false` and `[functions.process-payment] verify_jwt = true`. Public-auth endpoints and JWT-required endpoints are now explicit per design.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §2.3 P1 FINDING — *"No per-function verify_jwt configuration. CLAUDE.md states it but there is NO config.toml per-function or [functions.*] blocks. Defense-in-depth dictates verify_jwt should be explicit."*
**Critère d'acceptation** :
- [ ] `supabase/config.toml` contient `[functions.<name>]` avec `verify_jwt = true|false` selon Appendix A audit
- [ ] Login endpoints (`auth-verify-pin`, `auth-get-session`, etc.) : `verify_jwt = false`
- [ ] Autres : `verify_jwt = true`
- [ ] Tests : appel sans JWT → 401 sur fonctions verify_jwt=true
**Fichiers concernés** : `supabase/config.toml`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : casse fonctions actuellement appelées sans JWT en oubli — audit avant déploiement
**Notes** : —

### TASK-25-008 — Secrets rotation policy [P2] [TODO]
**Status note (2026-05-14)** : Partial / still applicable. V3 evidence: kiosk JWT signing keys table exists (`supabase/migrations/20260517000032_kiosk_jwt_signing_keys.sql`) and commit `2d3be8d` mentions "K8 rotation runbook", but `docs/reference/07-security/04-secrets-rotation.md` covering the full secrets list (service role, ANTHROPIC, SENTRY) is not yet authored. Keep TODO until full doc lands.
**Contexte** : Pas mentionné explicitement audit mais best practice. `SUPABASE_SERVICE_ROLE`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN` sont long-lived sans rotation.
**Critère d'acceptation** :
- [ ] Doc `docs/reference/07-security/04-secrets-rotation.md` :
  - Service role : rotation tous les 6 mois (ou sur départ employé admin)
  - API keys third-party : rotation sur compromise alert
  - Procédure step-by-step par secret
- [ ] Calendrier rotation dans `docs/reference/10-deployment-ops/` (rappel ops)
- [ ] Edge Functions : test après rotation
**Fichiers concernés** : doc
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : rotation mal planifiée = downtime — runbook obligatoire
**Notes** : —

### TASK-25-009 — Dependency audit (`npm audit`) régulier [P2] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: `.github/workflows/` contains only `ci.yml` + `staging-deploy.yml`; no `security-scan.yml`, no `.github/dependabot.yml`. Project uses `pnpm` so command would be `pnpm audit`. Session 13 did not scope CI security workflows.
**Contexte** : Pas vu dans audit. CVEs dans dependencies (Supabase JS, jsPDF, etc.) ne sont pas surveillées en CI.
**Critère d'acceptation** :
- [ ] `.github/workflows/security-scan.yml` : run `npm audit --audit-level=high` hebdo
- [ ] Échec si vuln High ou Critical
- [ ] Ouvre auto issue GitHub avec liste CVEs
- [ ] Dependabot ou Renovate configuré pour PRs auto majors/minors
- [ ] Snyk ou GitHub Code Scanning activé
**Fichiers concernés** : `.github/workflows/security-scan.yml`, `.github/dependabot.yml`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : faux positifs (CVEs dans deps de build) → utiliser `--omit=dev`
**Notes** : —

### TASK-25-010 — `select('*')` audit final + cleanup [P2] [OBSOLETE]
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-01 + `03-code-quality-schema-audit.md` §A8 —
**Status note (2026-05-14)** : V2 monolith task. V3 file paths `useSupplierDetail.ts`, `UnitsTab.tsx`, `debug_pearl_sugar.ts`, `purchase_order_module/index.ts` do not exist (V3 has no `purchase_order_module` EF, debug files were not migrated). V3 supplier/units code lives in `apps/backoffice/src/features/{purchasing,catalog}/` with targeted selects already in place. No V3 equivalent — rebuilt differently. *"3 remaining violations: useSupplierDetail.ts:69, UnitsTab.tsx:91, debug_pearl_sugar.ts:26 (debug file in root)."* + `08-operations-lan-audit.md` §P3 *"purchase_order_module Edge Function uses select('*')."*
**Critère d'acceptation** :
- [ ] `useSupplierDetail.ts:69` → select colonnes explicites
- [ ] `UnitsTab.tsx:91` → idem
- [ ] `debug_pearl_sugar.ts` supprimé du repo (P3-03 audit)
- [ ] `purchase_order_module/index.ts` → targeted selects sur suppliers + purchase_orders
- [ ] Eslint rule custom (déjà en place selon audit ?) bloque toute nouvelle occurrence
**Fichiers concernés** : 3 fichiers app + 1 Edge Function + 1 fichier debug
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

### TASK-25-011 — Audit log table consultation UI [P2] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 6.A/6.B. V3 evidence: `apps/backoffice/src/pages/reports/AuditPage.tsx` exists; `apps/backoffice/src/features/reports/hooks/useAuditLogs.ts` paginates via `supabase/migrations/20260517000076_paginate_audit_log_rpc.sql`; permission `reports.audit.read` seeded into ADMIN+MANAGER role grants. Route placement under `/reports` rather than `/security/audit-logs` is acceptable per Session 13 IA. Commit `bdf21aa`.
**Contexte** : `audit_logs` table existe et reçoit événements (login, PIN change). UI `/reports/audit` existe mais permission unique `reports.sales` (cf. audit reports P1-2). Sécuriser la lecture audit_logs.
**Critère d'acceptation** :
- [ ] Page `/security/audit-logs` ou `/admin/audit` (vs reports : meilleure séparation)
- [ ] Permission dédiée `audit.view` (ajout migration permissions)
- [ ] Filtres : action, severity, user, IP, date range
- [ ] Export CSV avec audit log de l'export lui-même (meta-audit)
- [ ] Réservé aux rôles `admin`, `super_admin`
**Fichiers concernés** : `src/pages/security/AuditLogsPage.tsx`, route à enregistrer, migration permissions
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : —
**Notes** : aligner avec TASK-19-005 (audit settings) qui pousse plus de rows dans audit_logs

### TASK-25-012 — Session hijacking protection (cookies SameSite, etc.) [P2] [TODO]
**Status note (2026-05-14)** : Uncertain — manual review needed. V3 auth uses custom-fetch wrapper + PIN JWT injection (`packages/supabase/src/auth/`), not Supabase Auth cookies, so `SameSite` is less load-bearing. Vercel headers (HSTS + X-Frame DENY) cover transport; doc `docs/reference/07-security/05-session-security.md` not yet authored. Keep TODO for the doc deliverable.
**Contexte** : Pas couvert audit (PIN auth ne stocke pas de cookies sensibles). Mais Supabase Auth (post magic link) peut. Vérifier.
**Critère d'acceptation** :
- [ ] Audit : Supabase client config → cookies `SameSite=Strict` ou `Lax` ; `Secure` flag
- [ ] localStorage tokens : envisager déplacer vers `sessionStorage` pour sessions courtes (déjà fait selon audit §1)
- [ ] Doc `docs/reference/07-security/05-session-security.md`
**Fichiers concernés** : `src/lib/supabase.ts`, doc
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

### TASK-25-013 — Subresource Integrity (SRI) sur scripts externes [P3] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: no `vite-plugin-sri*` in `pnpm-lock.yaml`, no `integrity=` attributes in `apps/{pos,backoffice}/index.html`. Session 14 Phase 1.A loaded 4 canonical fonts (commit `950640a`) — confirm whether they are bundled or CDN; if CDN, SRI is relevant.
**Contexte** : Si l'app charge des scripts externes (analytics, fonts CDN), absence SRI = compromis CDN injecte code.
**Critère d'acceptation** :
- [ ] Audit `index.html` + bundle final : tout `<script src=>` ou `<link rel=stylesheet>` externe a `integrity=` + `crossorigin=anonymous`
- [ ] Vite plugin SRI (ex `vite-plugin-sri3`) ajouté pour build prod
- [ ] Tests : modifier intentionnellement un asset externe → browser bloque
**Fichiers concernés** : `vite.config.ts`, `index.html`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : peut casser si script externe change (ex Sentry CDN)
**Notes** : Sentry est bundlé, fonts via Google = à vérifier

### TASK-25-014 — Penetration test annuel (P3 budget) [P3] [TODO]
**Status note (2026-05-14)** : Still applicable, deferred (budget/business decision). Not in scope for any Session 13 phase. Wait until V3 reaches production parity with V2 before scoping external pentest.
**Contexte** : Pas mentionné mais pratique standard pour ERP touchant données fiscales. Budget externe.
**Critère d'acceptation** :
- [ ] Recherche prestataire (Synacktiv, NCC Group, Cure53, ou local Indonesia)
- [ ] Périmètre défini : SPA Vercel + Edge Functions + Supabase RLS
- [ ] Test annuel ; rapport remédiation suivi
- [ ] Premier test scopé < $10K
**Fichiers concernés** : —
**Dépend de** : direction (budget)
**Estimation** : XL (depuis side prestataire) ; côté projet `M` pour préparation + remediation
**Risques** : —
**Notes** : reporter tant que pas requis par client/régulation

### TASK-25-015 — Validation UUID format `auth-verify-pin` [P2] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: grep for `UUID_REGEX|validateUuid|isUUID` in `supabase/functions/_shared/` returns 0 matches; `auth-verify-pin/index.ts` has no UUID pre-check. Defence-in-depth — DB still rejects malformed UUIDs at query level.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-02 — *"auth-verify-pin checks if (!user_id || !pin) but doesn't validate that user_id is a valid UUID format. A malformed user_id would fail at the DB query level, but validating input format early is defense-in-depth."*
**Critère d'acceptation** :
- [ ] Regex UUID v4 ajouté dans `auth-verify-pin/index.ts` : si non valide → 400 immédiat
- [ ] Pattern réutilisable dans `_shared/validation.ts`
- [ ] Audit autres Edge Functions acceptant user_id en payload
**Fichiers concernés** : `supabase/functions/auth-verify-pin/index.ts`, `_shared/validation.ts`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

### TASK-25-016 — `auth-logout` derive user_id from session [P2] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.B. V3 evidence: `supabase/functions/auth-logout/index.ts` is 29 lines, reads `userId` exclusively from `requireSession(req)` (`sessionResult.userId`), never from request body; audit log uses derived id only. Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-06 — *"auth-logout extracts session_id and user_id from request body, then verifies the caller matches. If validation accidentally removed → bug class. Recommendation: derive user_id entirely from authenticated session rather than accepting it in the request body."*
**Critère d'acceptation** :
- [ ] `auth-logout/index.ts` ne lit plus `user_id` depuis request body
- [ ] `user_id` dérivé exclusivement de `validateSessionToken(token)` retour
- [ ] Tests : ancien comportement bloqué (user_id différent dans body → ignoré)
**Fichiers concernés** : `supabase/functions/auth-logout/index.ts`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

### TASK-25-017 — `console.error` → logger.error en prod [P3] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: grep `console.error|console.warn` across `apps/` returns 3 occurrences in 2 files (`useEvaluatePromotions.ts`, `lanHubMessageHandler.ts`) — much smaller scope than V2's 18; no central `logger` util exists yet in `packages/utils` or `apps/*/src/lib/`. V2 `resetAllStores.ts` does not exist in V3.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-04 + §P3-05 — *"console.error in production code paths bypasses logger's level filtering. 18 console.log/warn/debug/info calls in src/ (9 files)."*
**Critère d'acceptation** :
- [ ] Audit + remplacement : tous `console.error/warn/log` dans `src/` → `logger.error/warn/info`
- [ ] Vite déjà strip console.log/info/debug en prod (audit §5.2) — vérifier que ça ne masque pas erreurs critiques
- [ ] Eslint rule `no-console` (warn level) pour empêcher régression
**Fichiers concernés** : `src/stores/resetAllStores.ts`, etc.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 25-001, 25-002, 25-003, 25-004, 25-005, 25-006 |
| P2 | 25-007, 25-008, 25-009, 25-010, 25-011, 25-012, 25-015, 25-016 |
| P3 | 25-013, 25-014, 25-017 |
