# Session 21 — INDEX (Polish hardening reliquat)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 3 streams parallèles + closeout serial.

**Goal :** clore 8 items hardening + UX polish reliquat S13–S19 en 1 session via 3 streams subagents parallèles.

**Architecture :** Wave 0 (spec/INDEX/branch) serial → **Wave 1** parallel 3 streams via subagent fan-out → Wave 2 closeout serial. Stream A = DB+EF (items 3+4), Stream B = Infra+CI (items 2+5), Stream C = UI+LAN (items 1+6+7+8). Cloud-only via Supabase MCP — no Docker.

**Tech Stack :** Postgres `pg_net` ou fallback `pg_cron+supabase_functions.http_request`, ENUM column migration, Edge Functions, Playwright + Vitest + RTL, React + Tailwind, packages/lan-bus TTL Map.

**Date :** 2026-05-18
**Branch :** `swarm/session-21` (off `bd1374e` master post-S20 squash-merge)
**Spec :** [`../specs/2026-05-18-session-21-spec.md`](../../specs/archive/2026-05-18-session-21-spec.md) (commit `9ba6872`)
**Migration block réservé :** `20260525000010..099`

---

## 1. Goal global

Ramasser 8 items reliquat :

| # | Item | Stream | Estim |
|---|------|--------|-------|
| 1 | LAN message dedup TTL 5s (hub+client) | C | M ~3h |
| 2 | Playwright E2E CI (3 flows smoke) | B | M ~6h |
| 3 | pg_net birthday cron | A | S ~1.5h |
| 4 | Cash Flow Investing/Financing sections | A | M ~3h |
| 5 | staging-deploy.yml secrets wiring | B | S ~1h |
| 6 | useIdleTimeout "About to sign out" warning toast | C | S ~1h |
| 7 | BO UserDetailPage 4-vs-6 PIN regex | C | XS ~0.5h |
| 8 | POS ChangePinModal UX polish (3 sub-fixes) | C | S-M ~2h |

**Total :** ~18h serial ; ~7h wall-time avec 3 streams parallèles (max stream).

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ committed 9ba6872 + INDEX (this doc) + branch ✓
        │
        ▼
Wave 1 (3 streams parallèles via subagent fan-out)
  ├── Stream A : Phase 1.A — DB+EF (items 3+4)
  │     · pg_net (ou fallback) + birthday cron + EF
  │     · Cash Flow ENUM + RPC v2 + BO UI
  │
  ├── Stream B : Phase 1.B — Infra+CI (items 2+5)
  │     · Playwright config + 3 specs + GHA workflow
  │     · staging-deploy.yml secrets + STAGING_SETUP.md
  │
  └── Stream C : Phase 1.C — UI+LAN (items 1+6+7+8)
        · packages/lan-bus dedup TTL Map
        · packages/ui IdleWarningToast + hook
        · BO UserDetailPage regex
        · POS ChangePinModal UX (3 sub-fixes)
        │
        ▼ Sync gate (tous streams DONE → reviewers spec+quality)
Wave 2 — Phase 2.A : closeout
  · Types regen
  · Roadmap refresh + 7 Status notes
  · INDEX §10 deviations
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-18, 8 items + 8 risks + 4 streams.
- [x] Branche `swarm/session-21` créée off `bd1374e` master.
- [x] INDEX dated, 3 streams + closeout.
- [x] Commit INDEX.

**Complexity :** S (~30min, mostly done).
**Suggested executor :** lead.

---

## 4. Wave 1 — Stream A : DB+EF (Phase 1.A)

**Module(s) :** 08 (Customers/Loyalty), 11 (Accounting).
**Migration sub-block :** `20260525000010..029`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-a`.

### Sub-phase 1.A.1 — `pg_net`-based birthday cron (item 3)

**Files :**
- `supabase/migrations/20260525000010_enable_pg_net_extension.sql` OU `20260525000010_alt_pg_cron_supabase_functions_http.sql` (fallback)
- `supabase/migrations/20260525000011_schedule_birthday_cron.sql`
- `supabase/functions/customer-birthday-notify/index.ts`
- `supabase/functions/customer-birthday-notify/__tests__/birthday.test.ts`

**Steps :**

- [ ] **Step 1 — pg_net availability check** via MCP `execute_sql` (project_id `ikcyvlovptebroadgtvd`):
```sql
SELECT extname, extversion FROM pg_extension WHERE extname='pg_net';
SELECT name, default_version, installed_version
  FROM pg_available_extensions
 WHERE name IN ('pg_net','pg_cron','supabase_functions');
```
Décider : si `pg_net` disponible, branche `_010_enable_pg_net_extension`. Sinon, branche fallback `_010_alt_*` qui dépend de `supabase_functions.http_request` (déjà fourni par Supabase).

- [ ] **Step 2 — Apply migration `_010`** :
  - Variante pg_net :
    ```sql
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
    ```
  - Variante fallback : no-op DDL + COMMENT documentant le chemin `supabase_functions.http_request`.

- [ ] **Step 3 — Apply migration `_011_schedule_birthday_cron`** : crée le pg_cron job `birthday-daily` qui POST quotidiennement à 09:00 ICT (UTC+7 → cron `0 2 * * *` UTC) vers `https://ikcyvlovptebroadgtvd.functions.supabase.co/customer-birthday-notify` avec Authorization Bearer service_role.

- [ ] **Step 4 — Write Edge Function** `supabase/functions/customer-birthday-notify/index.ts` : service_role client, query `customers WHERE EXTRACT(month FROM birth_date)=EXTRACT(month FROM CURRENT_DATE) AND EXTRACT(day FROM birth_date)=EXTRACT(day FROM CURRENT_DATE)`, insère dans `notification_outbox` une row par customer avec template `customer.birthday`.

- [ ] **Step 5 — Vitest live test** `__tests__/birthday.test.ts` : seed 2 customers (un avec birth_date=today, un avec birth_date=tomorrow), call EF, assert outbox a 1 row pour le bon customer.

- [ ] **Step 6 — Smoke** : `gh secret list` pour confirmer `SERVICE_ROLE_KEY` est dispo localement ; trigger EF manuellement via `supabase functions invoke customer-birthday-notify` (ou execute_sql `SELECT cron.schedule(...)` validation).

- [ ] **Step 7 — Commit** : `feat(notifications): session 21 — phase 1.A.1 — pg_net-based birthday cron`.

### Sub-phase 1.A.2 — Cash Flow Investing/Financing (item 4)

**Files :**
- `supabase/migrations/20260525000020_add_cash_flow_section_to_accounts.sql`
- `supabase/migrations/20260525000021_update_cash_flow_v1_to_3sections.sql`
- `supabase/tests/cash_flow_v1.test.sql`
- `apps/backoffice/src/features/reports/cash-flow/CashFlowReport.tsx`
- `packages/domain/src/accounting/__tests__/cash-flow-shape.test.ts` (si existe — vérifier d'abord)

**Steps :**

- [ ] **Step 1 — Inspect existing `cash_flow_v1`** :
```sql
SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid)
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
 WHERE n.nspname='public' AND proname='cash_flow_v1';
```
Note la signature actuelle et le shape de retour pour planifier le `DROP+CREATE` (cf. critical pattern RPC versioning).

- [ ] **Step 2 — Apply `_020_add_cash_flow_section`** :
```sql
DO $$ BEGIN
  CREATE TYPE public.cash_flow_section AS ENUM ('operating','investing','financing','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS cash_flow_section public.cash_flow_section NOT NULL DEFAULT 'operating';

COMMENT ON COLUMN public.accounts.cash_flow_section IS
  'S21: cash flow report classification. operating=daily ops, investing=capex/divest, financing=debt/equity, none=non-cash.';
```

- [ ] **Step 3 — Apply `_021_update_cash_flow_v1_to_3sections`** : `DROP FUNCTION cash_flow_v1(<old args>)` ; `CREATE FUNCTION cash_flow_v1(...) RETURNS jsonb` retournant `{operating_total, investing_total, financing_total, net_change, lines: [...]}`.

- [ ] **Step 4 — pgTAP `cash_flow_v1.test.sql`** : 5 asserts — shape (4 keys top-level), `operating_total + investing_total + financing_total = net_change`, empty edge case, single-section edge case, ENUM coverage (insert 1 row per section).

- [ ] **Step 5 — Run pgTAP via MCP `execute_sql`** — expect 5 passes.

- [ ] **Step 6 — Update BO CashFlowReport** : render 3 sections avec sub-totals. Skip si fichier inexistant → créer task follow-up et marquer DEV-S21-1.A.2-XX.

- [ ] **Step 7 — Commit** : `feat(accounting): session 21 — phase 1.A.2 — cash flow investing/financing sections`.

**DoD Stream A :**
- 4 migrations appliquées sur V3 dev.
- pg_net (ou fallback) actif ; birthday cron schedulé ; EF birthday-notify déployée.
- `cash_flow_v1` retourne shape 3-sections.
- pgTAP 5 passes.
- BO UI 3 sections (ou follow-up documenté).
- 2 commits sur `swarm/session-21`.

**Complexity :** M (~4.5h). **Dependencies :** Phase 0.1.

---

## 5. Wave 1 — Stream B : Infra+CI (Phase 1.B)

**Module(s) :** 23 (Tests), 24 (CI/CD).
**Executor :** 1 subagent `cicd-engineer` sonnet, name `stream-b`.

### Sub-phase 1.B.1 — Playwright E2E (item 2)

**Files :**
- `playwright.config.ts` (racine)
- `.github/workflows/playwright-e2e.yml`
- `tests/e2e/pos-login-order.spec.ts`
- `tests/e2e/bo-admin-pin-reset.spec.ts`
- `tests/e2e/kiosk-display-realtime.spec.ts`
- `tests/e2e/fixtures/auth.ts`
- `package.json` (racine — devDependencies + scripts)
- `tests/e2e/README.md`

**Steps :**

- [ ] **Step 1 — Install Playwright** : `pnpm add -D -w @playwright/test` (workspace root) + `pnpm exec playwright install --with-deps chromium`.

- [ ] **Step 2 — `playwright.config.ts`** : `baseURL` = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}`, `retries: 2`, `screenshot: 'only-on-failure'`, `trace: 'on-first-retry'`, `use: { actionTimeout: 10_000 }`. Define 2 projects : `pos` et `backoffice`.

- [ ] **Step 3 — Write `fixtures/auth.ts`** : helper `loginWithPin(page, pin)` qui automatise le flow PIN via UI (pas via service_role direct — on teste justement le flow).

- [ ] **Step 4 — Write 3 specs** :
  - `pos-login-order.spec.ts` : login → ajoute 1 item au cart → complete payment cash → vérifie receipt screen + DB row via fetch API.
  - `bo-admin-pin-reset.spec.ts` : login admin → users page → trouve user CASHIER → click reset PIN → entre new PIN → vérifie toast success.
  - `kiosk-display-realtime.spec.ts` : ouvre `/display/orders` → vérifie que la page load + un compteur d'orders est visible. (Realtime broadcast vérification déférée si trop fragile — note dans deviation.)

- [ ] **Step 5 — Use `data-testid`** partout dans les sélecteurs (jamais `getByText`). Si un composant n'a pas de testid, ajouter dans le composant en même temps que le test (cross-cutting OK pour ce stream).

- [ ] **Step 6 — `.github/workflows/playwright-e2e.yml`** :
  - Trigger : `schedule` (nightly cron `0 22 * * *` UTC = 05:00 ICT) + `workflow_dispatch`.
  - Steps : checkout, setup-pnpm, install deps, `pnpm exec playwright install --with-deps chromium`, `pnpm exec playwright test`, upload-artifact (test-results + screenshots).
  - Env : `E2E_BASE_URL` = `https://<staging-pos-url>`, `E2E_BO_URL` = `https://<staging-bo-url>`, `E2E_PIN_CASHIER` + `E2E_PIN_ADMIN` (secrets).

- [ ] **Step 7 — Locally run** : `pnpm exec playwright test` contre le staging V3 dev — sera lent + premier run flaky. Documenter dans `tests/e2e/README.md`.

- [ ] **Step 8 — Commit** : `test(e2e): session 21 — phase 1.B.1 — playwright 3-flow smoke + ci nightly`.

### Sub-phase 1.B.2 — staging-deploy secrets (item 5)

**Files :**
- `.github/workflows/staging-deploy.yml` (MODIFY si existe ; CREATE sinon)
- `.github/workflows/STAGING_SETUP.md` (CREATE)

**Steps :**

- [ ] **Step 1 — Inventaire** : `ls .github/workflows/` + grep `staging` pour identifier le workflow existant. Si absent, créer un squelette minimal qui ne déploie rien mais établit les secrets.

- [ ] **Step 2 — Wire secrets** :
  - `${{ secrets.STAGING_SUPABASE_URL }}`
  - `${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}`
  - `${{ secrets.STAGING_SUPABASE_ANON_KEY }}`
  Remove tout hardcode `.env.staging` inline.

- [ ] **Step 3 — `STAGING_SETUP.md`** : doc onboarding listant les secrets requis + commande `gh secret set <name>` pour chacun + lien dashboard Supabase V3 dev.

- [ ] **Step 4 — `gh secret list`** pour vérifier ce qui est déjà set ; documenter le delta.

- [ ] **Step 5 — Commit** : `chore(ci): session 21 — phase 1.B.2 — staging-deploy secrets wiring`.

**DoD Stream B :**
- `playwright.config.ts` + 3 specs commitées.
- `playwright-e2e.yml` créé (vert ou clairement marqué first-run-may-flake).
- `staging-deploy.yml` secrets wired + doc.
- 2 commits sur `swarm/session-21`.

**Complexity :** M (~7h). **Dependencies :** Phase 0.1.

---

## 6. Wave 1 — Stream C : UI+LAN (Phase 1.C)

**Module(s) :** 21 (LAN), 22 (UI), 01 (Auth), 02 (POS).
**Executor :** 1 subagent `coder` sonnet, name `stream-c`.

### Sub-phase 1.C.1 — LAN dedup TTL 5s (item 1)

**Files :**
- `packages/lan-bus/src/dedup.ts` (CREATE)
- `packages/lan-bus/src/hub.ts` (MODIFY — wire dedup avant broadcast)
- `packages/lan-bus/src/client.ts` (MODIFY — wire dedup côté réception)
- `packages/lan-bus/src/__tests__/dedup.test.ts` (CREATE)

**Steps :**

- [ ] **Step 1 — Inspect packages/lan-bus current structure** via Read.

- [ ] **Step 2 — Create `dedup.ts`** : `class MessageDedup { private seen: Map<string, number>; constructor(private ttlMs = 5000) {} hasSeen(msgId: string): boolean { /* purge expired, check, return; mark seen + expire(now+ttl) */ } }`. Avec test unitaire de TTL purge (mock Date.now via vi.useFakeTimers).

- [ ] **Step 3 — Wire dans hub + client** : avant broadcast (hub) et avant onMessage handler (client), check `dedup.hasSeen(msg.id)` ; drop si true ; sinon proceed.

- [ ] **Step 4 — Tests** : `dedup.test.ts` couvre : (a) 1er message accepté ; (b) dup dans TTL droppé ; (c) après TTL, dup re-accepté ; (d) memory bounds (ajouter 1000 msgs sur TTL court vérifie GC).

- [ ] **Step 5 — Run** : `pnpm --filter @breakery/lan-bus test`. Expect green.

- [ ] **Step 6 — Commit** : `feat(lan): session 21 — phase 1.C.1 — message dedup ttl 5s`.

### Sub-phase 1.C.2 — useIdleTimeout warning toast (item 6)

**Files :**
- `packages/ui/src/hooks/useIdleTimeout.ts` (MODIFY — émettre warning event 30s avant fire)
- `packages/ui/src/components/IdleWarningToast.tsx` (CREATE)
- `packages/ui/src/index.ts` (MODIFY — export IdleWarningToast)
- `apps/pos/src/App.tsx` ou layout root (MODIFY — mount)
- `apps/backoffice/src/App.tsx` ou layout root (MODIFY — mount)

**Steps :**

- [ ] **Step 1 — Read useIdleTimeout current implementation**.

- [ ] **Step 2 — Add warning event** : 30s avant le timeout, émettre `dispatchEvent(new CustomEvent('idle:warning', {detail:{remainingMs:30000}}))`. Conserver le fire timeout actuel.

- [ ] **Step 3 — `IdleWarningToast.tsx`** : composant qui écoute `idle:warning` via `useEffect addEventListener`, affiche un toast persistant (shadcn `Toast` ou implementation existante) avec countdown 30→0 + bouton "Stay signed in" qui dispatche `idle:reset`. Au fire timeout (event `idle:fired`), unmount.

- [ ] **Step 4 — Wire `idle:reset`** dans le hook pour redémarrer le timer.

- [ ] **Step 5 — Mount dans POS + BO** : un seul mount à la racine de chaque app.

- [ ] **Step 6 — Tests RTL** : co-located `__tests__/IdleWarningToast.test.tsx` (3 cas — affiché à 30s, countdown décrémente, click "Stay" reset).

- [ ] **Step 7 — Commit** : `feat(auth): session 21 — phase 1.C.2 — idle timeout warning toast`.

### Sub-phase 1.C.3 — BO UserDetailPage PIN regex (item 7)

**Files :**
- `apps/backoffice/src/features/users/UserDetailPage.tsx` (MODIFY)

**Steps :**

- [ ] **Step 1 — Grep** `^\\\\d\{4,8\}$` dans `apps/backoffice/src/features/users/` pour localiser la regex.

- [ ] **Step 2 — Replace par `^\d{6}$`** + mise à jour du message d'erreur "exactly 6 digits".

- [ ] **Step 3 — Test RTL** : (a) 5 chiffres → submit disabled + message ; (b) 6 chiffres → submit enabled.

- [ ] **Step 4 — Commit** : `fix(backoffice): session 21 — phase 1.C.3 — pin regex 4-8 → exactly 6 digits`.

### Sub-phase 1.C.4 — POS ChangePinModal UX (item 8)

**Files :**
- `apps/pos/src/features/auth/ChangePinModal.tsx` (MODIFY)
- `apps/pos/src/features/auth/__tests__/ChangePinModal.test.tsx` (MODIFY/CREATE)

**Steps :**

- [ ] **Step 1 — Read current modal**.

- [ ] **Step 2 — Sub-fix (a) DEV-S19-3.C-01** : swap `NumpadPin` (collection composant) → `PinPad` (verification-only). Vérifier import path.

- [ ] **Step 3 — Sub-fix (b) DEV-S19-3.C-02** : déplacer le hint `evaluatePinStrength` du step 3 (confirm) → step 2 (saisie). UX : utilisateur voit la force au moment où il choisit, pas après.

- [ ] **Step 4 — Sub-fix (c) DEV-S19-3.C-03** : sur mismatch new/confirm, reset wizard à step 2 (saisie) au lieu de step 1 (verify ancien PIN). Évite à l'utilisateur de re-saisir son ancien PIN.

- [ ] **Step 5 — Tests RTL** : 3 cas — PinPad rendu, hint à step 2, mismatch → step 2.

- [ ] **Step 6 — Commit** : `fix(pos): session 21 — phase 1.C.4 — change pin modal ux polish (3 sub-fixes from DEV-S19-3.C-01..03)`.

**DoD Stream C :**
- LAN dedup green.
- IdleWarningToast monté POS+BO.
- BO PIN regex fixé.
- ChangePinModal 3 sub-fixes + tests.
- 4 commits sur `swarm/session-21`.

**Complexity :** M (~6.5h). **Dependencies :** Phase 0.1.

---

## 7. Wave 2 — Closeout (Phase 2.A)

**Files :**
- `packages/supabase/src/types.generated.ts` (MODIFY — regen)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/backlog-by-module/{08-customers-loyalty,11-accounting,21-lan,22-design-system,23-tests,24-cicd,01-auth-permissions,02-pos-core}.md` (MODIFY — Status notes append, max 7 dépendant des fichiers réellement existants)
- `docs/workplan/plans/2026-05-18-session-21-INDEX.md` (MODIFY — fill §10 + mark Phase 0.1 step 4 done)

**Steps :**

- [ ] **Step 1 — Quality gates** : `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`.
- [ ] **Step 2 — Types regen** via MCP `generate_typescript_types` ; écrire dans `packages/supabase/src/types.generated.ts` ; `git diff` — committer si non-vide.
- [ ] **Step 3 — Roadmap refresh** :
  - Items #3 (LAN dedup) + #6 (Playwright CI) rayés des Actifs.
  - Add S21 row dans Sessions complétées.
  - Add Indicateurs ligne `Items hardening reliquat S13-S19 fermés | 8/8 | DONE S21`.
- [ ] **Step 4 — Status notes** sur fichiers backlog réellement présents.
- [ ] **Step 5 — Fill INDEX §10 deviations**.
- [ ] **Step 6 — Final quality gates** rerun.
- [ ] **Step 7 — Wave 2 commit**.
- [ ] **Step 8 — Push + PR** :
```bash
git push -u origin swarm/session-21
gh pr create --title "session 21 — polish hardening reliquat (lan dedup + playwright e2e + pg_net birthday + cash flow 3-sections + secrets + ux polish)" --body "$(cat <<'EOF'
## Summary

3-stream parallel session ramassing 8 follow-ups (5 roadmap + 3 S19 UX polish) :

**Stream A — DB+EF:**
- `pg_net` birthday cron : daily 09:00 ICT, EF `customer-birthday-notify` queues outbox rows.
- Cash Flow `investing` + `financing` sections : new `accounts.cash_flow_section` ENUM ; `cash_flow_v1` v2 returns 3-section breakdown.

**Stream B — Infra+CI:**
- Playwright E2E nightly smoke (POS login+order, BO admin pin reset, kiosk display).
- `staging-deploy.yml` secrets wired + STAGING_SETUP.md.

**Stream C — UI+LAN:**
- LAN message dedup TTL 5s in `packages/lan-bus`.
- `useIdleTimeout` 30s warning toast with "Stay" button.
- BO UserDetailPage PIN regex `^\d{6}$`.
- POS ChangePinModal UX (PinPad swap + hint at step 2 + mismatch reset to step 2).

**Footprint :** 4 migrations (`20260525000010..021`), Playwright workflow + 3 specs, 1 EF, LAN dedup pkg, UI hook+toast.

## Test plan
- [ ] pgTAP `cash_flow_v1.test.sql` green via cloud MCP.
- [ ] Vitest `customer-birthday-notify` test green.
- [ ] `pnpm --filter @breakery/lan-bus test` green (dedup).
- [ ] RTL tests POS ChangePinModal + BO PIN regex green.
- [ ] Playwright nightly first-run yellow expected — flakes documented in tests/e2e/README.md.
- [ ] `pnpm typecheck`, `pnpm build`, `pnpm test` green modulo pre-existing flakes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Complexity :** M (~2h). **Dependencies :** Streams A, B, C tous DONE + reviewers spec+quality APPROVED.

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|------|--------|------------------|---------|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A, 1.B, 1.C | 3 parallel (subagent fan-out) | max(4.5, 7, 6.5) = 7 |
| 2 | 2.A | sequential | 2 |
| **TOTAL** | **5** | — | **~9.5h wall-time parallel ; ~18h serial** |

---

## 9. Comms entre subagents

```
lead (Claude)
  ├──► stream-a (backend-dev sonnet, run_in_background)
  ├──► stream-b (cicd-engineer sonnet, run_in_background)
  └──► stream-c (coder sonnet, run_in_background)

After all 3 stream subagents complete + commit, lead :
  ├──► spec-reviewer-A (reviewer sonnet) ◄── checks Stream A commits
  ├──► spec-reviewer-B (reviewer sonnet) ◄── checks Stream B commits
  ├──► spec-reviewer-C (reviewer sonnet) ◄── checks Stream C commits
  └──► (if all spec APPROVED) → quality reviewers in parallel → fix loop → Wave 2 closeout
```

Each stream subagent runs autonomously, commits as it goes, returns a final report. Lead waits for all 3 reports before dispatching reviewers in parallel.

---

## 10. Deviation packs (Session 21 → Session 22+)

*Finalized post-execution Phase 2.A. All informational unless marked otherwise.*

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| DEV-S21-1.A.1-01 | 1.A.1 | informational | EF `customer-birthday-notify` uses shared `x-cron-secret` header instead of vault-stored service_role Bearer. Fail-closed when env unset. |
| DEV-S21-1.A.1-02 | 1.A.1 | informational | Vitest test requires manual `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars. `BIRTHDAY_CRON_SECRET=birthday-cron-daily` must be set on deployed EF secret store. |
| DEV-S21-1.A.1-03 | 1.A.1 | informational | Migration `_011` uses positional `extensions.http_post` named args — corrective `_012` swapped to `net.http_post` (correct schema for pg_net). |
| DEV-S21-1.A.1-04 | 1.A.1 | low | The `x-cron-secret` literal `birthday-cron-daily` is hardcoded in migration `_011` body (visible in git history). Rotate via vault.secrets in S22+ — track as follow-up. |
| DEV-S21-1.A.2-01 | 1.A.2 | informational | New RPC `cash_flow_v1` is additive ; pre-existing indirect-method `get_cash_flow_v1` still wired in BO hook (unchanged). |
| DEV-S21-1.A.2-02 | 1.A.2 | informational | pgTAP test 6 inner-branch has an early-return path that is exercised only when accounts have no movements — not a defect, noted for coverage awareness. |
| DEV-S21-1.B.1-01 | 1.B.1 | informational | `pos-login-order.spec.ts` skips cart/payment when catalog empty. |
| DEV-S21-1.B.1-02 | 1.B.1 | informational | BO PIN reset spec uses 6-digit PIN matching the fixed regex. |
| DEV-S21-1.B.1-03 | 1.B.1 | informational | Realtime broadcast assertion soft in kiosk spec — deterministic multi-context fixture out of scope. |
| DEV-S21-1.B.1-04 | 1.B.1 | informational | Kiosk test prompts for kiosk-JWT pair when `E2E_KIOSK_JWT` absent — expected behavior. |
| DEV-S21-1.B.1-05 | 1.B.1 | informational | README example PIN `123456` looks like a real credential — documentation-only, no functional impact. |
| DEV-S21-1.B.2-01 | 1.B.2 | informational | `staging-deploy.yml` was already secretized in S14 — only minor updates needed (push trigger + dispatch default ref). |
| DEV-S21-1.C.1-01 | 1.C.1 | accepted | LAN dedup lives in `packages/domain/src/lan/` (pre-existing S13 implementation) not `packages/lan-bus/` (does not exist). Functional TTL 5s requirement met. Added 2 GC boundary tests. |
| DEV-S21-1.C.2-01 | 1.C.2 | informational | For timeouts ≤ 30s, `useIdleTimeout` warning fires at t=0 alongside main timer. No practical impact at production values (30-480 min). |
| DEV-S21-1.C.2-02 | 1.C.2 | informational | `IdleWarningToast.handleStay` duplicates `clearInterval` inline — minor code quality nit, no functional impact. |
| DEV-S21-1.C.4-01 | 1.C.4 | accepted | Spec requested `NumpadPin` → `PinPad` swap (per DEV-S19-3.C-01 naming). `PinPad` is verification-only (wired to `auth-verify-pin` EF, auto-submits) — cannot collect a new PIN in a wizard. `NumpadPin` retained ; S19 deviation note mischaracterised the issue. Sub-fixes (b) hint-at-step-2 and (c) mismatch-reset-to-step-2 both shipped. |

---

## 11. Out of scope (déféré Session 22+)

- Mobile shell Capacitor (TASK-18-***).
- WAC landed cost (TASK-07-012 partial S17).
- Modal focus-trap migration cross-modules.
- Compliance fiscale I1/I2/I3 (bloqué business PKP).
- `mv_pl_monthly` branched reuse (D-W6-6A-1).
- Tous autres DEV-S17/S18 informationals non listés en §1 items 6-8.
