# Travail — Deployment & Operations

> Last updated: 2026-05-03
> Référence : [`../10-deployment-ops/`](../10-deployment-ops/) (à créer/compléter — actuellement vide)
> Sources audit : `docs/audit/08-operations-lan-audit.md` §5 (Operational Readiness, full), §2 (Edge Functions), `docs/audit/01-architecture-security-audit.md` §Recommendations, `docs/audit/06-documentation-audit.md` §Critical Missing, `CURRENT_STATE.md` Backlog T2, `CLAUDE.md` Pitfalls

## Objectifs du module

1. Mettre en place une CI/CD complète : lint + tests sur PR, deploy preview Vercel automatique, deploy prod sur tag — cible : 0 deploy manuel sauf rollback.
2. Documenter et tester les procédures de récupération en cas d'incident (DR runbook complet) — cible : 1 runbook par scénario d'échec, 1 restore test trimestriel.
3. Tunings monitoring : Sentry alertes utiles (pas de bruit), bench cold start Edge Functions, performance budgets bundle — cible : MTTR < 30 min sur incidents P0.
4. Créer une env staging réelle (Supabase + Vercel) pour tester les changements impactants avant prod — cible : alignement T2 backlog.
5. Préparer la résilience : backups validés, multi-env config docs, release notes auto.

---

## Tâches

### TASK-24-001 — CI/CD pipeline complète (PR check + deploy preview) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 0.2. V3 evidence: `.github/workflows/ci.yml` (PR lint+typecheck+test+build + pgTAP job) and `.github/workflows/staging-deploy.yml` (manual approval → migrations push + EF deploy to `ikcyvlovptebroadgtvd`). NOTE: `staging-deploy.yml` ran for the first time on 2026-05-14 (D-W6-CICD-01 follow-up — secrets gap). Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.2 — *"Vercel preview deploys exist per-PR, but there's no persistent staging."* Vérifier qu'il y a aussi lint+test sur PR (TASK-23-008).
**Critère d'acceptation** :
- [ ] `.github/workflows/ci.yml` (cf. TASK-23-008) couvre lint + tests
- [ ] `.github/workflows/deploy-preview.yml` : à chaque PR, deploy preview Vercel commenté en PR avec lien
- [ ] `.github/workflows/deploy-production.yml` : trigger sur push tag `v*`, deploy prod après tests verts
- [ ] Vérification migrations : Supabase migration check via `supabase db lint` dans CI
- [ ] Documentation `docs/reference/10-deployment-ops/01-cicd-pipeline.md`
**Fichiers concernés** : `.github/workflows/*.yml`, doc
**Dépend de** : TASK-23-001 (tests propres)
**Estimation** : `L`
**Risques** : déploiement auto prod = risque si tag mal posé — confirmer step manuel ou approval
**Notes** : Vercel git integration peut suffire pour deploy preview ; séparer si déjà actif

### TASK-24-002 — DR runbook complet (5 scénarios) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.C. V3 evidence: `docs/runbooks/disaster-recovery.md` documents 6 scenarios (Supabase down, hub crash, print server crash, Vercel down, data corruption + a sixth) with RTO/RPO, mitigation, recovery, post-mortem template — owned by Platform/on-call. Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.3 P2 FINDING — *"No documented disaster recovery runbook. For a production system handling ~200 tx/day, there should be Supabase backup verification schedule, RTO/RPO definitions, step-by-step recovery procedures, contact info for Supabase support escalation."*
**Critère d'acceptation** :
- [ ] `docs/reference/10-deployment-ops/02-disaster-recovery.md` créé
- [ ] 5 scénarios documentés : Supabase down, Hub crash, Print server crash, Vercel down, Data corruption
- [ ] RTO/RPO définis : RTO 1h pour Supabase down, RPO 5 min (PITR Supabase Pro)
- [ ] Procédure restore PITR testée 1× et chronométrée
- [ ] Contact Supabase support escalation (email + plan account ID)
- [ ] Liste numéros support Vercel + payment provider local
**Fichiers concernés** : doc DR
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : doc obsolète si pas maintenue — review trimestrielle obligatoire
**Notes** : aligner avec TASK-24-005 (backup verification)

### TASK-24-003 — Monitoring Sentry alertes tuning [P2] [TODO]
**Status note (2026-05-14)** : Sentry client SDKs were initialized in Session 13 Phase 6.C (`apps/pos/sentry.client.config.ts`, `apps/backoffice/sentry.client.config.ts`) — but alert-rules/Slack-notification configuration is a dashboard-side step that was not documented. `docs/reference/10-deployment-ops/03-monitoring-alerts.md` not created. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.1 — *"Comprehensive Sentry setup with appropriate privacy controls."* Mais pas d'alerte rules documentées. Sentry peut spammer Slack/email si non tuné.
**Critère d'acceptation** :
- [ ] Alert rules Sentry : nouveau type d'erreur en prod → notification Slack #ops dans 5 min
- [ ] Spike detection : > 10 errors/min même type → alert P1
- [ ] Issue assignment auto par module (path-based)
- [ ] Documentation : `docs/reference/10-deployment-ops/03-monitoring-alerts.md` avec liste alerts actives
- [ ] Suppression bruit : ResizeObserver, JWT expiry déjà filtrés (vérifier)
**Fichiers concernés** : Sentry dashboard config (manuel), doc
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : —
**Notes** : —

### TASK-24-004 — Performance budgets + Lighthouse CI [P2] [TODO]
**Status note (2026-05-14)** : No `.lighthouserc.json` or `.github/workflows/lighthouse.yml` in V3. Session 13 did not include Lighthouse CI. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.4 — *"Build chunked output with ~650KB warning limit. Vendor-react ~620KB (within limit)."* Pas de garde-fou si on ajoute une lib lourde.
**Critère d'acceptation** :
- [ ] `lhci` (Lighthouse CI) configuré, run sur preview Vercel après deploy
- [ ] Budgets : LCP < 3 s, CLS < 0.1, JS bundle main < 700 KB gzip
- [ ] CI fail si budget cassé (mode warn d'abord, enforce après)
- [ ] Report en commentaire PR
**Fichiers concernés** : `.lighthouserc.json`, `.github/workflows/lighthouse.yml`
**Dépend de** : TASK-24-001
**Estimation** : `M`
**Risques** : —
**Notes** : Lombok = 4G, performance critique

### TASK-24-005 — Backup verification (Supabase PITR test) [P1] [TODO]
**Status note (2026-05-14)** : DR runbook (`docs/runbooks/disaster-recovery.md`) references Supabase PITR (TASK-24-002 DONE) but no executed test-restore on the V3 dev project, no chronometered RTO measurement, no quarterly-schedule artifact. Procedure documented, drill not performed. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.3 — *"Supabase point-in-time recovery (PITR) available on Pro plan. No documented recovery procedure."*
**Critère d'acceptation** :
- [ ] Test restore PITR sur projet Supabase de staging (ou branch) à T-24h
- [ ] Procédure documentée step-by-step dans DR runbook (lien TASK-24-002)
- [ ] Chronométrage RTO mesuré
- [ ] Schedule : restore test trimestriel (calendrier ops)
- [ ] Validation post-restore : checksum sur tables critiques (orders, journal_entries, accounts)
**Fichiers concernés** : doc DR, scripts de validation
**Dépend de** : TASK-24-002
**Estimation** : `M`
**Risques** : test sur prod jamais — toujours staging/branch
**Notes** : Supabase Pro requis pour PITR (vérifier plan)

### TASK-24-006 — Edge Function cold start optimization [P2] [TODO]
**Status note (2026-05-14)** : V3 ships 10 Edge Functions (`supabase/functions/`) including `auth-verify-pin`, `notification-dispatch`, `kiosk-issue-jwt`. No `scripts/bench-edge-functions.sh` exists ; no `docs/reference/10-deployment-ops/04-edge-functions-perf.md`. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.4 mentionne build chunking client mais pas Edge Function perf. `auth-verify-pin` cold start peut atteindre 500-800 ms (Deno + connect Supabase).
**Critère d'acceptation** :
- [ ] Bench : mesurer cold start des 16 Edge Functions (script `scripts/bench-edge-functions.sh`)
- [ ] Top 5 plus lentes optimisées : import minimal, lazy supabase client init, réduire taille bundle
- [ ] Rapport baseline + après dans `docs/reference/10-deployment-ops/04-edge-functions-perf.md`
- [ ] Cible : cold start < 300 ms pour `auth-verify-pin`, `auth-get-session`
**Fichiers concernés** : `supabase/functions/*/index.ts` (refacto imports), bench script
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : refacto imports peut casser bundling Deno → tests Edge à chaque modif
**Notes** : —

### TASK-24-007 — Vercel config rewrites SPA edge cases [P3] [TODO]
**Status note (2026-05-14)** : Session 13 Phase 1.B shipped `vercel.json` with CSP + HSTS + security headers (TASK-cascade for 25-005) but no SPA `rewrites` block (file shows headers only). The audit-original edge-case rewrites (`/api/*`, `/.well-known/*`) are not addressed. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.2 — *"SPA rewrites: /((?!assets/).*) -> /index.html"*. Edge case : URL `/api/*` ou `/.well-known/*` (PWA, securitytxt) doivent NE PAS être rewrités.
**Critère d'acceptation** :
- [ ] Audit `vercel.json` rewrites : exclure `/api/*`, `/.well-known/*`, `/sw.js`, `/manifest.json`
- [ ] Tests : `curl https://the-breakery-pos.vercel.app/.well-known/security.txt` retourne 200 ou 404, pas le bundle index.html
- [ ] Documentation des routes Vercel dans `10-deployment-ops/05-vercel-config.md`
**Fichiers concernés** : `vercel.json`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : —
**Notes** : —

### TASK-24-008 — Multi-env staging Supabase + Vercel [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 0.2. V3 evidence: dedicated Supabase project `ikcyvlovptebroadgtvd` (the-breakery-v3-dev, Pro plan) provisioned as staging (per CLAUDE.md `## Critical patterns` block) and wired into `.github/workflows/staging-deploy.yml` with environment approval gates. Prod (`abjabuniwkqpfsenxljp`, V2) explicitly out-of-lineage. Commit `bdf21aa`.
**Contexte** : `docs/audit/07-product-backlog-audit.md` §7 + `CURRENT_STATE.md` T2 — *"Staging environment. Every production system needs a staging environment. Bugs at 200 tx/day are expensive. Quick win on Vercel (branch previews already available)."* Côté Supabase : utiliser branches Supabase ou projet dédié.
**Critère d'acceptation** :
- [ ] Projet Supabase staging créé (ou branch `staging` activée)
- [ ] Variable Vercel `VITE_SUPABASE_URL_STAGING` + branche Vercel `staging` qui pointe dessus
- [ ] Workflow : merge `develop` → `staging` → tests manuels → promotion `main`
- [ ] Documentation `docs/reference/10-deployment-ops/06-environments.md`
- [ ] Migrations testées en staging avant prod
**Fichiers concernés** : config Vercel, Supabase project, doc
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : data leakage staging→prod si tooling mal configuré ; coût Supabase second projet (~$25/mois)
**Notes** : alternative branches Supabase = plus simple mais ne couvre pas Edge Functions séparément

### TASK-24-009 — Release notes automation [P3] [TODO]
**Status note (2026-05-14)** : No `release-please` / `changesets` / `.github/workflows/release.yml` in V3. CLAUDE.md mandates conventional commits but no auto-CHANGELOG flow ships. Genuinely undone.
**Contexte** : `docs/audit/06-documentation-audit.md` §Nice-to-have — *"Changelog / Release notes. No versioned history of changes."*
**Critère d'acceptation** :
- [ ] `release-please` ou `changesets` configuré
- [ ] Sur tag `v*`, génération auto `CHANGELOG.md` depuis commits Conventional Commits
- [ ] GitHub Release créée auto avec notes
- [ ] Migration vers Conventional Commits (lint via `commitlint`) — optionnel cette tâche
**Fichiers concernés** : `.github/workflows/release.yml`, config release-please
**Dépend de** : TASK-24-001
**Estimation** : `M`
**Risques** : —
**Notes** : —

### TASK-24-010 — Sentry serveur (Edge Functions) [P3] [TODO]
**Status note (2026-05-14)** : Phase 6.C shipped Sentry on client only (`apps/{pos,backoffice}/sentry.client.config.ts`). No `supabase/functions/_shared/sentry.ts` ; `@sentry/deno` not added to EFs. Genuinely undone.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.1 P3 FINDING — *"No server-side monitoring for Edge Functions. Sentry is client-side only. Edge Function errors go to console.error which is only visible in Supabase Edge Function logs (limited retention). Consider @sentry/deno for Edge Functions."*
**Critère d'acceptation** :
- [ ] `@sentry/deno` ajouté dans `_shared/sentry.ts`
- [ ] Init Sentry dans chaque Edge Function (DSN dédié serveur ou même DSN avec tag environment=server)
- [ ] Catch wrapper `withSentry(handler)` pour capturer erreurs non handled
- [ ] Tests : provoquer une erreur dans Edge Function → visible dans Sentry < 1 min
**Fichiers concernés** : `supabase/functions/_shared/sentry.ts`, 16 Edge Functions
**Dépend de** : TASK-24-006 (perf bench avant ajout overhead)
**Estimation** : `M`
**Risques** : overhead Sentry SDK sur cold start — bench avant/après
**Notes** : —

### TASK-24-011 — Disaster recovery plan complet (formalisation) [P2] [TODO]
**Status note (2026-05-14)** : TASK-24-002 DONE delivers the technical runbook ; the broader incident-response artifacts (admin-accounts list, downtime banner component, annual drill, postmortem template) are not in `docs/runbooks/disaster-recovery.md`. Genuinely undone — incremental on top of 24-002.
**Contexte** : Liée à TASK-24-002 mais étendue à plan d'urgence multi-volet : qui contacter, comment communiquer aux clients (downtime banner), quels comptes ont accès admin Supabase/Vercel.
**Critère d'acceptation** :
- [ ] Doc `docs/reference/10-deployment-ops/07-incident-response.md`
- [ ] Liste comptes admins (sans mot de passe) avec backup
- [ ] Communication template : downtime banner → afficher sur splash mobile / login
- [ ] Test annuel : simuler incident (ex : Supabase coupé) et chronométrer reprise complète
- [ ] Postmortem template
**Fichiers concernés** : doc, banner component, template fichier markdown
**Dépend de** : TASK-24-002
**Estimation** : `M`
**Risques** : —
**Notes** : —

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 24-001, 24-002, 24-005, 24-008 |
| P2 | 24-003, 24-004, 24-006, 24-011 |
| P3 | 24-007, 24-009, 24-010 |


**S21 update (2026-05-18):** `staging-deploy.yml` already secretized in S14 — minor S21 updates : add `master` push trigger + dispatch default ref to `swarm/session-21`. New `STAGING_SETUP.md` documents the 10 required secrets (`gh secret list` shows only `V3_DEV_PG_POOLER_URL` provisioned ; others need creation). Closes D-W6-CICD-01.
