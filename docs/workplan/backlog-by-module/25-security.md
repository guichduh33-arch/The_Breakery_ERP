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

### TASK-25-001 — Restreindre RLS anon SELECT sur tables PII [P1] [TODO]
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

### TASK-25-002 — Rate limiting Edge Functions [P1] [TODO]
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

### TASK-25-003 — Supprimer fallback PIN client-side [P1] [TODO]
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

### TASK-25-004 — Error message leakage `auth-verify-pin` [P1] [TODO]
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

### TASK-25-005 — CSP + HSTS headers SPA Vercel [P1] [TODO]
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

### TASK-25-006 — Audit Edge Functions permission checks [P1] [TODO]
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

### TASK-25-007 — Edge Functions `verify_jwt` config explicite [P2] [TODO]
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

### TASK-25-010 — `select('*')` audit final + cleanup [P2] [TODO]
**Contexte** : `docs/audit/01-architecture-security-audit.md` §P2-01 + `03-code-quality-schema-audit.md` §A8 — *"3 remaining violations: useSupplierDetail.ts:69, UnitsTab.tsx:91, debug_pearl_sugar.ts:26 (debug file in root)."* + `08-operations-lan-audit.md` §P3 *"purchase_order_module Edge Function uses select('*')."*
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

### TASK-25-011 — Audit log table consultation UI [P2] [TODO]
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

### TASK-25-016 — `auth-logout` derive user_id from session [P2] [TODO]
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
