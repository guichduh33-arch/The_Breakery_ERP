# Équipe agents + skills projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer 6 agents implémenteurs (`.claude/agents/*.md`) + 8 skills domaine (`.claude/skills/<name>/SKILL.md`) entièrement adaptés à The Breakery ERP, versionnés, sans contredire les patterns CLAUDE.md.

**Architecture:** Approche A hybride (cf. spec `docs/superpowers/specs/2026-05-31-agents-skills-team-design.md`). Agents = personas spawnables (frontmatter `tools:`+`model:`). Skills = modules auto-déclenchés (frontmatter `pathPatterns:`+`promptSignals:`). Chaque fichier est autonome, pointe vers CLAUDE.md comme source de vérité, et n'ajoute que le surplus spécifique au périmètre. Aucune dépendance entre fichiers → tâches parallélisables.

**Tech Stack:** Markdown + YAML frontmatter. Vérifications via `git`, `git check-ignore`, et lecture des migrations/RPCs réels (`supabase/migrations/`) + MCP Supabase (V3 dev `ikcyvlovptebroadgtvd`) pour confirmer les noms de RPC/colonnes avant de les écrire.

**Branche:** `feat/agents-skills-team` (déjà créée, spec commitée @ `941c976`).

---

## Règles transverses (s'appliquent à TOUTES les tâches d'écriture de brique)

Chaque fichier agent/skill DOIT :
1. Commencer par `**`CLAUDE.md` est la source de vérité`** — n'ajoute que le surplus (surface map, checklists, schéma réel, commandes de vérif). Pas de redite des patterns globaux.
2. **Vérifier le réel avant d'écrire un fait** : tout nom de RPC, colonne, trigger, table, permission cité doit être confirmé soit dans `supabase/migrations/`, soit via MCP `execute_sql` contre V3 dev. NE PAS inventer. Si un fait n'est pas vérifiable, l'omettre ou le marquer explicitement comme à confirmer.
3. Style **bilingue FR/EN** (structure EN, français là où naturel — cf. `pos-specialist.md` / `stock-management/SKILL.md`).
4. Inclure une section **"Verification before completion"** (commandes `pnpm --filter` ciblées) et **"When to escalate"**.
5. Densité **~150-250 lignes**. Sous 250.
6. Ne JAMAIS contredire un "Critical pattern" CLAUDE.md.

Modèles de référence à imiter (lire avant d'écrire) :
- Agent : `.claude/agents/pos-specialist.md`
- Skill : `.claude/skills/stock-management/SKILL.md`

---

## File Structure

```
.gitignore                                          # MODIFY — un-ignore agents racine
.claude/agents/backoffice-specialist.md             # CREATE (A1)
.claude/agents/db-engineer.md                        # CREATE (A2)
.claude/agents/edge-functions-engineer.md            # CREATE (A3)
.claude/agents/pattern-guardian.md                   # CREATE (A4)
.claude/agents/test-engineer.md                      # CREATE (A5)
.claude/agents/session-coordinator.md                # CREATE (A6)
.claude/skills/accounting/SKILL.md                   # CREATE (S1)
.claude/skills/b2b-credit/SKILL.md                   # CREATE (S2)
.claude/skills/reports-exports/SKILL.md              # CREATE (S3)
.claude/skills/expense-governance/SKILL.md           # CREATE (S4)
.claude/skills/products-catalog/SKILL.md             # CREATE (S5)
.claude/skills/orders/SKILL.md                       # CREATE (S6)
.claude/skills/security-auth/SKILL.md                # CREATE (S7)
.claude/skills/breakery-ui-kit/SKILL.md              # CREATE (S8)
```

---

## Task 0: Fix `.gitignore` + scaffolding

**Files:**
- Modify: `.gitignore:46-47`

- [ ] **Step 1: Lire le bloc actuel**

Run: `git check-ignore -v .claude/agents/pos-specialist.md ; grep -n "claude" .gitignore`
Expected: voir `.claude/*` puis `!.claude/skills/`. `pos-specialist.md` non listé par check-ignore (tracké).

- [ ] **Step 2: Remplacer le bloc**

Remplacer :
```
.claude/*
!.claude/skills/
```
par :
```
.claude/*
!.claude/skills/
!.claude/agents/
.claude/agents/*/
```
(Le `!.claude/agents/` ré-inclut le dossier ; `.claude/agents/*/` ré-ignore les sous-dossiers ruflo générés.)

- [ ] **Step 3: Vérifier l'effet**

Run:
```bash
git check-ignore -v .claude/agents/core/coder.md      # DOIT matcher (.claude/agents/*/)
git check-ignore .claude/agents/pos-specialist.md     # DOIT être vide (non ignoré)
```
Expected: le 1er ligne d'ignore sur le sous-dossier ; le 2e vide (racine versionnable).

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): version project agents (.claude/agents/*.md), keep ruflo subdirs ignored"
```

---

## Task A1: Agent `backoffice-specialist`

**Files:**
- Create: `.claude/agents/backoffice-specialist.md`
- Sources à miner: `apps/backoffice/src/` (features/, routes/, layouts/Sidebar.tsx), `pos-specialist.md` (modèle), CLAUDE.md (menu reorg 7 groupes + sous-groupes collapsibles).

- [ ] **Step 1: Frontmatter exact**

```yaml
---
name: backoffice-specialist
description: Use proactively for any apps/backoffice work — reports, accounting cockpit, inventory admin, products, orders list, expenses, B2B, settings. Knows the project's critical patterns (RPC versioning, REVOKE pairs, PermissionGate, ExportButtons, infinite-query cursor, 7-group sidebar).
tools: Glob, Grep, Read, Edit, Write, Bash, TodoWrite, WebFetch
model: sonnet
---
```

- [ ] **Step 2: Corps — sections requises avec contenu concret**

Écrire ces sections (miroir de pos-specialist, surface BO) :
- **Mission** : `apps/backoffice/` (Vite + React 18 + Zustand authStore + React Query) + workspace deps.
- **Critical patterns** : reprendre les 10 de pos-specialist MAIS angle BO : `PermissionGate` sur routes + gate `has_permission`/authStore ; `ExportButtons` générique (CSV/PDF) ; infinite-query cursor pattern (AuditLog S13 / OrdersListPage S32) ; URL state = source of truth (OrdersListPage) ; types regen obligatoire.
- **Surface BO map** : lister les feature folders réels (vérifier via `Glob apps/backoffice/src/features/*`) — accounting, inventory*, products, orders, expenses, b2b, reports, customers, rbac, settings. Donner routes (`src/routes/index.tsx`), Sidebar (`src/layouts/Sidebar.tsx`), la structure 7 groupes (Operations/Sales/Purchase/Stock/Finance/Reports/Settings) + 9 sous-groupes collapsibles (localStorage `bo:sidebar:subgroups`).
- **Workflow checklists** : A) avant d'ajouter une page (route + PermissionGate + sidebar entry + gate) ; B) avant un hook RQ (version RPC, gate, invalidation ciblée, toast sonner) ; C) avant un export (ExportButtons + buildCsv domaine + EF generate-pdf template).
- **Verification** : `pnpm --filter @breakery/app-backoffice typecheck` + `pnpm --filter @breakery/app-backoffice test <feature>`. Baseline : ~24 BO échecs env-gated (`VITE_SUPABASE_URL Required`, `DEV-S25-2.A-02`) ≠ régression.
- **When to escalate** : bump RPC majeur, nouvelle permission à seeder, override pattern CLAUDE.md.

- [ ] **Step 3: Vérifier frontmatter + faits**

Run: `Glob apps/backoffice/src/features/*` et `Read apps/backoffice/src/layouts/Sidebar.tsx` (confirmer les groupes/entries réels avant de les citer).
Expected: les feature folders et groupes cités existent réellement.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/backoffice-specialist.md
git commit -m "feat(agents): backoffice-specialist — apps/backoffice surface specialist"
```

---

## Task A2: Agent `db-engineer`

**Files:**
- Create: `.claude/agents/db-engineer.md`
- Sources: `supabase/migrations/` (échantillon récent), CLAUDE.md (DB workflow MCP + RPC versioning + REVOKE patterns), `stock-management/SKILL.md` §Critical patterns 6-7.

- [ ] **Step 1: Frontmatter exact**

```yaml
---
name: db-engineer
description: Use proactively for any supabase/migrations or RPC work — new RPCs, migration sequencing, REVOKE pairs, SECURITY DEFINER gates, types regen. Targets Supabase cloud V3 dev via MCP (Docker retired). Enforces RPC versioning monotone + anon defense-in-depth.
tools: Glob, Grep, Read, Edit, Write, Bash, TodoWrite
model: sonnet
---
```

- [ ] **Step 2: Corps — sections requises**

- **Mission** : auteur de migrations + RPCs Postgres sur V3 dev `ikcyvlovptebroadgtvd`.
- **Critical patterns** (concrets) :
  1. Cloud V3 only via MCP (`apply_migration`, `execute_sql`, `generate_typescript_types`). JAMAIS `pnpm db:reset` / `supabase start` / `run_pgtap.sh` (Docker retiré).
  2. RPC versioning monotone : `_vN`→`_vN+1` + `DROP FUNCTION ... vN(<args exacts>)` dans LA MÊME migration.
  3. REVOKE pair S25 canonique (bloc 3 lignes : `REVOKE EXECUTE ... FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`). Expliquer le piège : anon hérite via PUBLIC, `REVOKE FROM anon` seul insuffisant.
  4. SECURITY DEFINER + `has_permission(auth.uid(), 'scope.action')` + `audit_logs` canonical cols (actor_id/action/entity_type/entity_id/metadata) + `SET search_path`/pg_temp hardening.
  5. Séquençage : vérifier le dernier timestamp dans `supabase/migrations/` avant de choisir le prochain (numérotation monotone). Citer le bloc actif courant (lire CLAUDE.md "Migration sequence active").
  6. Idempotency 2-flavors (header HTTP vs RPC arg + table dédiée idempotency-keys).
  7. Types regen OBLIGATOIRE post-schema → `packages/supabase/src/types.generated.ts` + commit (#1 cause de CI cassée).
- **Migration authoring checklist** : nom snake_case, body transactionnel, REVOKE pair, perm seed si nouvelle perm, pgTAP, types regen.
- **Verification** : pgTAP via MCP `execute_sql` BEGIN/ROLLBACK ; `pnpm typecheck`.
- **When to escalate** : relax CHECK/NOT NULL/RLS (couvre souvent un bug latent — cf. S25 `_014`/`_015`) ; bump RPC majeur.

- [ ] **Step 3: Vérifier**

Run: `Glob supabase/migrations/*.sql | tail` (confirmer le dernier timestamp réel) + `Read` d'une migration REVOKE pair récente pour citer le format exact.
Expected: format REVOKE pair confirmé tel quel.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/db-engineer.md
git commit -m "feat(agents): db-engineer — migrations + RPC versioning + REVOKE pairs (MCP V3)"
```

---

## Task A3: Agent `edge-functions-engineer`

**Files:**
- Create: `.claude/agents/edge-functions-engineer.md`
- Sources: `supabase/functions/` (`_shared/idempotency.ts`, `refund-order/index.ts`, `_shared/` autres), CLAUDE.md §PIN header + idempotency 2-flavors + S19 rate-limit.

- [ ] **Step 1: Frontmatter exact**

```yaml
---
name: edge-functions-engineer
description: Use proactively for supabase/functions (Deno edge functions) work — PIN-in-header, idempotency keys, durable rate-limit, JWT/fetch-wrapper. Enforces hard-cutover (no dual-mode) and the _shared helpers.
tools: Glob, Grep, Read, Edit, Write, Bash, TodoWrite
model: sonnet
---
```

- [ ] **Step 2: Corps — sections requises**

- **Mission** : EFs Deno (`supabase/functions/`), wrappers HTTP autour des RPCs.
- **Critical patterns** :
  1. PIN/secret en header `x-manager-pin` (jamais body JSON — body loggé par PostgREST/pgaudit/proxies). Hard cutover (drop body field même commit, pas de dual-mode).
  2. Idempotency : `_shared/idempotency.ts::getIdempotencyKey(req)` lit `x-idempotency-key`, propage `p_idempotency_key` au RPC. Client : `useRef(crypto.randomUUID())` reset on success/dismiss.
  3. Rate-limit durable Postgres (`checkRateLimitDurable` → RPC `record_rate_limit_v1`, S19). Fail-open sur erreur DB (trade-off documenté).
  4. JWT HS256 (auth-verify-pin) vs GoTrue ES256 → fetch wrapper `setSupabaseAccessToken` (`packages/supabase`). Ne jamais bypasser avec `Authorization` brut.
  5. EFs PIN-en-header à migrer (sweep différé) : `void-order`, `cancel-item`, `kiosk-issue-jwt` — flag si on les touche.
- **EF authoring checklist** : déploiement via MCP, idempotency helper, rate-limit bucket, audit_logs sur replay (`*.replay` action), CORS.
- **Verification** : Vitest live `supabase/tests/functions/*.test.ts` (env-gated `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`).
- **When to escalate** : nouvelle EF appelant un RPC non encore créé ; changement de mécanisme auth.

- [ ] **Step 3: Vérifier**

Run: `Read supabase/functions/_shared/idempotency.ts` + `Glob supabase/functions/*/index.ts` (confirmer les EFs réelles citées).
Expected: signature `getIdempotencyKey` + liste EFs confirmées.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/edge-functions-engineer.md
git commit -m "feat(agents): edge-functions-engineer — Deno EFs, PIN header, idempotency, rate-limit"
```

---

## Task A4: Agent `pattern-guardian` (reviewer, read-only)

**Files:**
- Create: `.claude/agents/pattern-guardian.md`
- Sources: CLAUDE.md §"Critical patterns — don't break these" (la liste complète).

- [ ] **Step 1: Frontmatter exact** (read-only tools — pas d'Edit/Write)

```yaml
---
name: pattern-guardian
description: Use to review a diff/branch BEFORE merge against the project's CLAUDE.md critical patterns. Read-only — emits a violations list, applies no fixes. Checks append-only ledgers, anon defense-in-depth, idempotency 2-flavors, PIN header, RPC versioning, realtime channel uniqueness, domain IO-free.
tools: Glob, Grep, Read, Bash
model: sonnet
---
```

- [ ] **Step 2: Corps — sections requises**

- **Mission** : revue de conformité pré-merge. Sort une liste numérotée de violations (sévérité + fichier:ligne + pattern enfreint + correctif suggéré). N'édite RIEN.
- **Checklist de conformité** (un check par pattern CLAUDE.md, chacun avec la commande grep/SQL de détection) :
  1. `INSERT INTO stock_movements` / `display_movements` / `audit_logs` direct → interdit (grep).
  2. RPC sans REVOKE pair complet (PUBLIC+anon+ALTER DEFAULT PRIVILEGES) → grep les nouvelles `CREATE FUNCTION` vs REVOKE.
  3. PIN dans body JSON au lieu de header → grep `manager_pin` dans body.
  4. RPC `_vN` édité sans bump → diff sur signatures publiées.
  5. Realtime channel name non-unique par mount → grep `.channel('` sans `useId`/`randomUUID`.
  6. `packages/domain` avec import fetch/supabase/react → grep imports.
  7. Types non regen après migration → migration touchée mais `types.generated.ts` absent du diff.
  8. Permission utilisée mais non seedée.
- **Output format** : tableau `| # | Sévérité | Fichier:ligne | Pattern | Fix |`.
- **When to escalate** : violation de sévérité haute non triviale.

- [ ] **Step 3: Vérifier** — relire CLAUDE.md §Critical patterns, s'assurer que chaque pattern a un check.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/pattern-guardian.md
git commit -m "feat(agents): pattern-guardian — read-only CLAUDE.md pattern compliance reviewer"
```

---

## Task A5: Agent `test-engineer`

**Files:**
- Create: `.claude/agents/test-engineer.md`
- Sources: CLAUDE.md §Build & Test + §Targeted iteration, `supabase/tests/` layout, `stock-management/SKILL.md` §Verification.

- [ ] **Step 1: Frontmatter exact**

```yaml
---
name: test-engineer
description: Use to write or run tests — pgTAP (via MCP execute_sql BEGIN/ROLLBACK), Vitest live RPC, BO/POS smoke + unit, domain unit. Knows the pre-existing env-gated failure baseline and never confuses it with regressions.
tools: Glob, Grep, Read, Edit, Write, Bash, TodoWrite
model: sonnet
---
```

- [ ] **Step 2: Corps — sections requises**

- **Mission** : auteur/exécuteur de tests, 4 niveaux.
- **Les 4 niveaux** (concret) :
  1. pgTAP (DB) : via MCP `execute_sql`, envelope `BEGIN; SELECT plan(N); ...; SELECT * FROM finish(); ROLLBACK;`. Fichiers `supabase/tests/*.test.sql`. Pattern GUC pour chaîner pass/fail entre DO blocks (cf. DEV-S25-2.A-03).
  2. Vitest live RPC : `supabase/tests/functions/*.test.ts`, env-gated (`SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`).
  3. BO/POS smoke + unit : co-localisés `__tests__/`, `pnpm --filter @breakery/app-{backoffice,pos} test <feature>`.
  4. Domain unit : `packages/{domain,utils}/src/**/__tests__/`, pure TS.
- **Baseline pré-existante** : ~3 POS + ~24 BO échecs env-gated (`VITE_SUPABASE_URL Required`, `DEV-S25-2.A-02`). NE PAS confondre avec régression — vérifier contre master si doute. Ne jamais `-u` les snapshots à l'aveugle.
- **Test design checklist** : happy path + perm denied + idempotency replay + edge cases + audit_logs row.
- **Verification** : commandes ciblées (`--filter`).
- **When to escalate** : échec hors baseline non expliqué.

- [ ] **Step 3: Vérifier** — `Glob supabase/tests/*.test.sql` (confirmer le layout) + lire un test pgTAP existant.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/test-engineer.md
git commit -m "feat(agents): test-engineer — pgTAP/Vitest/smoke, env-gated baseline aware"
```

---

## Task A6: Agent `session-coordinator`

**Files:**
- Create: `.claude/agents/session-coordinator.md`
- Sources: CLAUDE.md §Active Workplan (format sessions) + §Workplan layout + un INDEX existant (`docs/workplan/plans/*-INDEX.md`).

- [ ] **Step 1: Frontmatter exact** (opus pour reasoning d'orchestration)

```yaml
---
name: session-coordinator
description: Use to plan and orchestrate a swarm/session-N workstream — spec → plan → waves → closeout. Knows the docs/workplan layout, INDEX + numbered deviations convention, squash-merge per phase, and CLAUDE.md Active Workplan bump.
tools: Glob, Grep, Read, Edit, Write, Bash, TodoWrite, Task
model: opus
---
```

- [ ] **Step 2: Corps — sections requises**

- **Mission** : orchestrateur de session. Décompose un objectif en spec → plan → waves parallélisables, suit l'exécution, fait le closeout.
- **Layout workplan** : `docs/workplan/{specs,plans,refs,backlog-by-module}/`. Plans/specs = historique daté append-only (jamais réécrire un plan passé, créer un nouveau fichier daté). Backlogs = living docs.
- **Conventions** : branche `swarm/session-N`, commits conventionnels per phase, squash-merge ; INDEX `docs/workplan/plans/<date>-session-N-INDEX.md` avec §déviations numérotées `DEV-SNN-<wave>.<phase>-<nn>` (sévérité medium/informational) ; bump `CLAUDE.md` Active Workplan en closeout (nouveau session reference + migration sequence active + follow-ups).
- **Wave decomposition** : une brique/phase indépendante = un sous-agent (SendMessage-first coordination, cf. CLAUDE.md §Agent Comms). Parallélisable par wave.
- **Spawn pattern** : référencer le pattern pipeline/fan-out de CLAUDE.md.
- **When to escalate** : ambiguïté de scope, décision business (ex. NON-PKP ratification S26), bump RPC majeur transverse.

- [ ] **Step 3: Vérifier** — `Read` d'un INDEX existant pour copier le format §déviations exact.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/session-coordinator.md
git commit -m "feat(agents): session-coordinator — swarm session orchestration (opus)"
```

---

## Skills (S1-S8) — structure commune

Chaque skill = `.claude/skills/<name>/SKILL.md` avec frontmatter `name` + `description` + `pathPatterns` (liste) + `promptSignals.phrases` (liste). Corps : Mental model du domaine + Critical patterns vérifiés + Audit checklist + Sources de vérité (pointeurs migrations/tests/docs) + Verification + When to escalate. Modèle : `stock-management/SKILL.md`.

**RÈGLE ANTI-RECOUVREMENT** : les `pathPatterns` et `promptSignals` de chaque skill doivent être disjoints de ceux des autres (cf. spec §4). Avant de commit un skill, grep les `promptSignals` déjà utilisés dans les autres `SKILL.md` pour éviter les collisions.

---

## Task S1: Skill `accounting`

**Files:**
- Create: `.claude/skills/accounting/SKILL.md`
- Sources: CLAUDE.md §S26/S26b, `docs/adr/003-pkp-status-non-pkp.md`, migrations `20260603000010..026`, `supabase/tests/s26_db_hardening.test.sql`.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: accounting
description: Accounting cockpit expert — COA, journal entries, PB1 (NON-PKP, ADR-003), fiscal periods, general ledger, trial balance. Audit JE balance/mapping/fiscal-guard AND guide accounting changes.
pathPatterns:
  - 'apps/backoffice/src/features/accounting/**'
  - 'apps/backoffice/src/pages/accounting/**'
  - 'apps/backoffice/src/pages/settings/SettingsAccountingPage*'
  - 'supabase/migrations/*journal*.sql'
  - 'supabase/migrations/*fiscal*.sql'
  - 'supabase/migrations/*ledger*.sql'
  - 'supabase/migrations/*pb1*.sql'
  - 'supabase/tests/*accounting*.test.sql'
  - 'supabase/tests/*s26*.test.sql'
promptSignals:
  phrases: ['journal entry', 'COA', 'chart of accounts', 'PB1', 'PPN', 'NON-PKP', 'fiscal period', 'general ledger', 'trial balance', 'COGS', 'retained earnings', 'mapping account']
---
```

- [ ] **Step 2: Corps — contenu concret à couvrir**

- **Mental model NON-PKP** (ADR-003, ratifié 2026-05-20) : PB1 10% sortie (PEMDA Bali), PPN 11% input supplier NON récupérable → fold dans inventory cost. `current_pb1_rate()` lit `business_config.tax_rate`. `calculate_pb1_payable_v1` : `pb1_payable = pb1_output` (pas de crédit input).
- **JE backbone** : `create_sale_journal_entry` (PB1 dynamic + split par `order_payments.method` → 1110/1115/1116), `create_purchase_journal_entry` (fold PPN dans INVENTORY 1130). Trigger `tr_20_je_emit` (fonction `tr_stock_movement_je`) pour waste/adjustment_*/opname_*/production_*. Idempotent (UNIQUE `journal_entries_je_idempotency_uniq`), fiscal-guarded (`check_fiscal_period_open`).
- **Cockpit RPCs** (S26) : `close_fiscal_period_v1(p_period_id, p_manager_pin, p_lock)`, `get_general_ledger_v1` (cursor-paginé + opening_balance), `get_trial_balance_v1`, `create_manual_je_v1` (validation : lines≥2, balanced, debit XOR credit, accounts is_active+is_postable), `update_account_active_v1` (S26b, SUPER_ADMIN).
- **COA réel** : 1110/1112/1115/1116 (cash/bank/...), 1130 inventory, 1151 VAT Input DÉSACTIVÉ (NON-PKP), 2110 PB1 Payable, 3100 owner capital, 3200 Retained Earnings, 5910 reclassé classe 6.
- **Permissions** : `accounting.{period.close, je.create_manual, gl.read, tb.read, coa.read, coa.write}`.
- **Audit checklist** : JE balance (Σdebit=Σcredit), mapping account existe+postable, fiscal guard actif, dedupe sale_void/sale_refund (P&L+BS).
- **Sources de vérité** + **Verification** (`pnpm --filter @breakery/app-backoffice test accounting`) + **When to escalate** (toucher PB1 rate, fiscal lock, mapping key).

- [ ] **Step 3: Vérifier les RPC/comptes via MCP** `execute_sql` (ex. `SELECT proname FROM pg_proc WHERE proname LIKE '%fiscal%'`) avant de les citer.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/accounting/SKILL.md
git commit -m "feat(skills): accounting — COA/JE/PB1 NON-PKP/fiscal/GL/TB domain expert"
```

---

## Task S2: Skill `b2b-credit`

**Files:**
- Create: `.claude/skills/b2b-credit/SKILL.md`
- Sources: CLAUDE.md §S24, migrations `20260601000005..022`, `supabase/tests/b2b_foundation.test.sql`.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: b2b-credit
description: B2B credit & AR expert — AR aging, b2b_payments ledger, credit-limit gate, B2B orders, FIFO allocation. Audit AR integrity AND guide B2B changes.
pathPatterns:
  - 'apps/backoffice/src/features/b2b/**'
  - 'apps/pos/src/features/**/*b2b*'
  - 'supabase/migrations/*b2b*.sql'
  - 'supabase/tests/*b2b*.test.sql'
promptSignals:
  phrases: ['B2B', 'AR aging', 'accounts receivable', 'credit limit', 'b2b_payments', 'b2b_current_balance', 'invoice', 'FIFO allocation', 'account customer']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **Mental model** : `customer_type` enum `retail|b2b`. `customers.b2b_current_balance` (UPDATE revoked pour authenticated/anon — S24 `_013`). `order_type='b2b'`, `order_status` inclut `b2b_pending`. `orders.session_id` NOT NULL relaxé pour b2b (CHECK).
- **Ledger** : `b2b_payments` append-only (RLS, REVOKE INSERT/UPDATE/DELETE, séquence `b2b_payment_seq` → `BP-YYYY-NNNN`, `idempotency_key UNIQUE`).
- **Views** : `view_b2b_invoices`, `view_ar_aging` (SECURITY INVOKER, buckets current/31-60/61-90/90+ sur `CURRENT_DATE - orders.created_at`).
- **RPCs** : `record_b2b_payment_v1(p_idempotency_key)` (DR Cash/Bank CR B2B_AR + FIFO allocation metadata), `adjust_b2b_balance_v1`, `create_b2b_order_v1` (gate `validate_b2b_credit_limit_v1` → payload `would_exceed_by`). Mapping `B2B_PAYMENT_BANK`→1112.
- **Schema reality** : `customers.name` (pas full_name), `refunds.total` (pas amount).
- **Audit checklist** : Σ b2b_payments allocations = orders payés ; aging cohérent ; credit-limit gate appelé avant create.
- **Sources/Verification/Escalate.**

- [ ] **Step 3: Vérifier via MCP** (proname LIKE '%b2b%', colonnes customers).

- [ ] **Step 4: Commit** `feat(skills): b2b-credit — AR aging/payments/credit-limit gate`.

---

## Task S3: Skill `reports-exports`

**Files:**
- Create: `.claude/skills/reports-exports/SKILL.md`
- Sources: CLAUDE.md §S29-S33, migrations reports, `supabase/functions/generate-pdf` + `_shared/pdf-templates/`, `packages/domain` buildCsv/buildDrilldownUrl.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: reports-exports
description: Reports, exports & Z-reports expert — report RPCs, generate-pdf EF (17 templates), CSV (buildCsv), Z-report sign flow, drill-down (buildDrilldownUrl). Guide new reports + export wiring.
pathPatterns:
  - 'apps/backoffice/src/features/reports/**'
  - 'apps/backoffice/src/pages/reports/**'
  - 'apps/backoffice/src/features/zreports/**'
  - 'supabase/functions/generate-pdf/**'
  - 'supabase/functions/generate-zreport-pdf/**'
  - 'supabase/functions/_shared/pdf-templates/**'
  - 'supabase/migrations/*report*.sql'
  - 'supabase/migrations/*zreport*.sql'
  - 'packages/domain/src/**/buildCsv*'
  - 'packages/domain/src/**/*drilldown*'
promptSignals:
  phrases: ['report', 'export', 'CSV', 'PDF', 'Z-report', 'zreport', 'drill-down', 'drilldown', 'generate-pdf', 'ExportButtons', 'buildCsv', 'compare period', 'wastage', 'payment by method', 'perishable turnover']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **Report RPCs** (cursor-paginées, REVOKE pair, gate `reports.{financial,inventory}.read`) : `get_wastage_report_v1`, `get_payments_by_method_v1`, `get_pb1_report_v1`, `get_stock_movements_v1`, `get_perishable_turnover_v1`, `get_orders_list_v2` (→ skill orders). 17 reports BO total.
- **EF generate-pdf** : registry 17 templates (`_shared/pdf-templates/`), rate-limit 30/min durable, bucket `reports-exports/` TTL 30d.
- **Z-report flow 2-temps** : `close_shift_v2` insère draft `z_reports` (snapshot JSONB figé) → EF `generate-zreport-pdf` (idempotent, bucket `zreports/` 7 ans) → manager signe via `sign_zreport_v1` (PIN header) ; `void_zreport_v1` ; `get_zreport_snapshot_v1`. Perms `zreports.{read,sign,void}`.
- **Domain helpers** : `buildCsv<T>(rows, columns, opts?)` (RFC 4180 + UTF-8 BOM + id-ID locale), `previousPeriod`/`formatDelta`, `buildDrilldownUrl(entity, id, filter)` (entities incl. `order_list` filter-only).
- **BO** : `<ExportButtons>` générique, `<DateRangePickerWithCompare>`, `<DrilldownLink>`.
- **Audit checklist** : chaque report RPC a REVOKE pair + gate ; template PDF enregistré dans registry ; CSV locale-formatted.
- **Sources/Verification/Escalate.**

- [ ] **Step 3: Vérifier** templates réels via `Glob supabase/functions/_shared/pdf-templates/*`.

- [ ] **Step 4: Commit** `feat(skills): reports-exports — report RPCs/PDF/CSV/Z-report/drill-down`.

---

## Task S4: Skill `expense-governance`

**Files:**
- Create: `.claude/skills/expense-governance/SKILL.md`
- Sources: CLAUDE.md §S28, migrations `20260524111854..123026`, `supabase/tests/expense_governance.test.sql`.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: expense-governance
description: Expense approval workflow expert — thresholds, SOD, multi-step chain, snapshot-at-submit, cash sync. Audit approval integrity AND guide expense governance changes.
pathPatterns:
  - 'apps/backoffice/src/features/expenses/**'
  - 'apps/backoffice/src/pages/**/expense*'
  - 'apps/backoffice/src/pages/settings/*ExpenseThreshold*'
  - 'supabase/migrations/*expense*.sql'
  - 'supabase/tests/*expense*.test.sql'
promptSignals:
  phrases: ['expense', 'approval threshold', 'SOD', 'separation of duties', 'multi-step approval', 'expense approval', 'auto-approve', 'cash expense', 'approval chain']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **Mental model snapshot-at-submit** : règles figées au submit dans `expenses.required_approval_steps_snapshot JSONB` (legacy NULL = workflow v1 fallback 1-step). `current_approval_step SMALLINT`, `auto_approved BOOLEAN`.
- **Tables** : `expense_approval_thresholds` (per-category, 3 defaults : [0-100k auto], [100k-1M 1-step MANAGER], [1M+ 2-step MANAGER+ADMIN]), `expense_approvals` append-only (UNIQUE(expense_id, approver_user_id) = SOD).
- **RPCs** : `submit_expense_v2(p_expense_id, p_idempotency_key)` (threshold resolution `ORDER BY category_id NULLS LAST LIMIT 1` + snapshot freeze + auto-approve), `approve_expense_v2` (SOD block 1 `created_by != caller` + SOD block 2 UNIQUE approver + chaîne multi-step + JE sur final step, PIN header), `set/delete_expense_threshold_v1` (overlap validation), trigger `sync_cash_expense_to_session` (paid+cash → `pos_sessions.cash_out_total += amount+vat`). Helper `_emit_expense_je` (REVOKEd). Perms `expenses.thresholds.{read,write}`.
- **VAT trap** : `vat_amount > 0` raise P0002 (compte 1151 désactivé NON-PKP) — non-régression S28.
- **Audit checklist** : SOD respecté (jamais 2 steps même approver) ; snapshot figé ; auto-approve borné inclusif.
- **Sources/Verification/Escalate.**

- [ ] **Step 3: Vérifier** via MCP (proname LIKE '%expense%').

- [ ] **Step 4: Commit** `feat(skills): expense-governance — thresholds/SOD/multi-step/snapshot`.

---

## Task S5: Skill `products-catalog`

**Files:**
- Create: `.claude/skills/products-catalog/SKILL.md`
- Sources: CLAUDE.md §S27/27b/27c, migrations variants `20260524002129..012658` + product CRUD.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: products-catalog
description: Product catalog expert — products CRUD, variants (linked-products), categories, units/sections/modifiers. Guide catalog changes; knows the variant XOR + anti-nesting invariants.
pathPatterns:
  - 'apps/backoffice/src/features/products/**'
  - 'apps/backoffice/src/features/categories/**'
  - 'apps/backoffice/src/pages/**/Product*'
  - 'apps/backoffice/src/pages/**/Categor*'
  - 'supabase/migrations/*product*.sql'
  - 'supabase/migrations/*variant*.sql'
  - 'supabase/migrations/*categor*.sql'
  - 'supabase/tests/*product*.test.sql'
  - 'supabase/tests/*variant*.test.sql'
promptSignals:
  phrases: ['product', 'variant', 'parent product', 'category', 'SKU', 'modifier', 'product unit', 'product section', 'is_display_item', 'linked product']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **Mental model variants linked-products** (S27c) : `products` étendu 4 cols (`parent_product_id`, `variant_label`, `variant_axis` enum flavor|size|format, `variant_sort_order`) + CHECK XOR + trigger `enforce_variant_no_nesting` (1 niveau max). 3 cas : standalone / parent (ne se vend pas, modal POS) / variant.
- **RPCs** : `create_product_v1(jsonb)` (21-col allowlist + SKU unique + seed product_unit_contexts), `update_product_v1(uuid,jsonb)` (18-col allowlist incl `is_display_item`), `convert_product_to_parent_v1`, `create/update/delete_variant_v1`, `reorder_variants_v1`, `convert_parent_to_standalone_v1`, `create/update_category_v1`, `reorder_categories_v1`. Perms `products.{create,update,variants.read,variants.write}`, `categories.read`.
- **Pièges** : `products.sku` UNIQUE GLOBAL (pas partial) → hard-delete parent sur dissolve (orphan SKU). XOR partial-NULL sur soft-deleted variants (corrective `_012658`).
- **Display-stock** : `is_display_item` dans allowlist create/update (cf. skill orders + memory `project_pos_display_stock_isolation`).
- **Audit checklist** : XOR variant intègre ; pas de nesting ; SKU unique ; sort_order complete-coverage.
- **Sources/Verification/Escalate.**

- [ ] **Step 3: Vérifier** via MCP (colonnes products, proname LIKE '%variant%').

- [ ] **Step 4: Commit** `feat(skills): products-catalog — CRUD/variants/categories/units`.

---

## Task S6: Skill `orders`

**Files:**
- Create: `.claude/skills/orders/SKILL.md`
- Sources: CLAUDE.md §S32/S33 + §order RPCs, migrations `20260618000010..023` + `20260617000013`.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: orders
description: Orders domain expert — order lifecycle, list v2 server-filters, edit-items RPCs, void/refund, realtime. Cross-app business logic (POS writes + BO management). Distinct from pos-specialist (POS UI surface) and backoffice-specialist (BO UI surface).
pathPatterns:
  - 'apps/backoffice/src/features/orders/**'
  - 'apps/backoffice/src/pages/**/Order*'
  - 'apps/pos/src/features/order-history/**'
  - 'supabase/migrations/*order*.sql'
  - 'supabase/tests/*order*.test.sql'
promptSignals:
  phrases: ['order list', 'order status', 'edit order item', 'void order', 'order refund', 'pending_payment', 'get_orders_list', 'order totals', 'orders realtime']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **order_status enum réel** : `draft, paid, voided, pending_payment, completed, b2b_pending` (PAS de `open`). `order_type` enum incl b2b/tablet.
- **Write RPCs** (jamais d'insert direct) : `complete_order_with_payment_v10` (double déduction display_stock + current_stock pour is_display_item), `pay_existing_order_v3`, `create_tablet_order_v2(p_client_uuid)`, `refund_order_rpc_v2` (PIN header + idempotency), `void_order`, `mark_item_served`.
- **List/edit (S32/S33)** : `get_orders_list_v2(p_start, p_end, p_filters JSONB, p_limit, p_cursor)` server-side filters (status/order_type/refund_status/hour/terminal_id via JOIN pos_sessions). Edit-items atomiques sur draft/pending_payment : `add_order_item_v1`, `update_order_item_qty_v1`, `remove_order_item_v1` + helper `_recalc_order_totals` + table `order_edit_idempotency_keys`. Orchestrateur BO `useEditOrderItems` (removes→updates→adds). Perms `orders.{read, edit_open, void}`.
- **Realtime** : `useOrdersRealtime` (postgres_changes INSERT+UPDATE, StrictMode-safe via useId).
- **Schema reality** : `orders.total` + `served_by`, `order_items.name_snapshot` + `modifiers`, table `refunds` (`.total`).
- **Audit checklist** : edit-items seulement sur draft/pending_payment ; totals recalculés ; idempotency keys propres par RPC.
- **Sources/Verification/Escalate.**

- [ ] **Step 3: Vérifier** enum réel via MCP (`SELECT enum_range(NULL::order_status)`).

- [ ] **Step 4: Commit** `feat(skills): orders — lifecycle/list v2/edit-items/void/refund`.

---

## Task S7: Skill `security-auth`

**Files:**
- Create: `.claude/skills/security-auth/SKILL.md`
- Sources: CLAUDE.md §Critical patterns (anon defense, REVOKE, PIN) + §S19/S20/S25, migrations S19/S20.

- [ ] **Step 1: Frontmatter**

```yaml
---
name: security-auth
description: Security & auth expert — RLS, REVOKE/anon defense-in-depth, permission gates, PIN JWT fetch wrapper, durable rate-limit, per-role session timeout. Audit security posture AND guide auth changes.
pathPatterns:
  - 'apps/*/src/features/auth/**'
  - 'apps/backoffice/src/features/rbac/**'
  - 'apps/backoffice/src/pages/settings/*Security*'
  - 'packages/supabase/src/rls/**'
  - 'supabase/migrations/*rls*.sql'
  - 'supabase/migrations/*permission*.sql'
  - 'supabase/migrations/*rate_limit*.sql'
  - 'supabase/functions/auth-*/**'
  - 'supabase/functions/kiosk-issue-jwt/**'
promptSignals:
  phrases: ['RLS', 'REVOKE', 'anon', 'permission', 'has_permission', 'role_permissions', 'PIN', 'JWT', 'rate limit', 'session timeout', 'RBAC', 'SECURITY DEFINER', 'defense in depth']
---
```

- [ ] **Step 2: Corps — contenu concret**

- **Anon defense-in-depth (S20)** : `REVOKE ALL FROM anon` default (tables/views/functions) + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`. Piège central : `REVOKE EXECUTE FROM anon` SEUL insuffisant — anon hérite via PUBLIC (`=X/postgres` ACL). Toujours `REVOKE FROM PUBLIC` aussi. Objets extension `supabase_admin` non-révocables (pgtap exclus).
- **REVOKE pair canonique** (3 lignes) — répéter le bloc exact.
- **Perm gates** : `has_permission(auth.uid(), 'scope.action')` dans tout SECURITY DEFINER. `roles`/`permissions`/`role_permissions`. `PermissionGate` côté UI + authStore.
- **PIN auth** : `auth-verify-pin` EF émet HS256 ; GoTrue ES256 ne valide pas → fetch wrapper `setSupabaseAccessToken` (`packages/supabase`). Jamais `Authorization` brut / `auth.setSession`. PIN en header `x-manager-pin`.
- **Rate-limit durable (S19)** : `record_rate_limit_v1` + `pg_advisory_xact_lock` + cron `rl-purge`. Fail-open documenté. Pas de `Retry-After` (gap).
- **Session timeout (S19)** : `roles.session_timeout_minutes` (5-480) + `update_role_session_timeout_v1` + `useIdleTimeout` (packages/ui).
- **PIN strength (S19)** : `evaluatePinStrength` (packages/utils + Deno mirror), warn-only.
- **Audit checklist** : chaque RPC perm-gated + REVOKE pair complet + audit_logs row ; RLS UPDATE/DELETE revoked sur ledgers ; pas d'`Authorization` brut.
- **Sources/Verification/Escalate** (relax RLS = flag systématique).

- [ ] **Step 3: Vérifier** `Read packages/supabase/src/rls/permissions.ts` + un REVOKE migration.

- [ ] **Step 4: Commit** `feat(skills): security-auth — RLS/REVOKE/perms/PIN-JWT/rate-limit`.

---

## Task S8: Skill `breakery-ui-kit`

**Files:**
- Create: `.claude/skills/breakery-ui-kit/SKILL.md`
- Sources: `packages/ui/src/` (vérifier les exports réels), CLAUDE.md mentions S26b/S28 (pas de Select/RadioGroup).

- [ ] **Step 1: Frontmatter**

```yaml
---
name: breakery-ui-kit
description: '@breakery/ui conventions — which primitives exist vs not (no Select/RadioGroup exports → native fallbacks), semantic design tokens, Dialog/Sheet/Badge patterns, useIdleTimeout. Use when building any BO/POS component.'
pathPatterns:
  - 'packages/ui/**'
  - 'apps/*/src/**/components/**'
promptSignals:
  phrases: ['@breakery/ui', 'Select', 'RadioGroup', 'SelectItem', 'design token', 'Dialog', 'Sheet', 'Badge', 'component primitive', 'useIdleTimeout', 'shadcn']
---
```

- [ ] **Step 2: Corps — contenu concret (VÉRIFIER les exports réels d'abord)**

- **Primitives exportées vs absentes** : confirmer via `Glob packages/ui/src/**/index.ts` + grep exports. Documenter : pas de `Select`/`SelectItem`/`RadioGroup` (S26b/S28) → fallbacks = `<select>` HTML natif ou 3-button group. Lister ce qui EXISTE (Dialog, Sheet, Badge, Button, etc.).
- **Semantic design tokens** : où sont définis, comment les consommer (pas de couleurs hardcodées).
- **Patterns** : Dialog stepper (multi-step), Sheet drawer (drill-down), Badge color-coded status, `useIdleTimeout` (monté POS+BO).
- **Anti-patterns** : importer un primitive inexistant, hardcoder une couleur, dupliquer un composant déjà dans @breakery/ui.
- **Verification** : `pnpm --filter @breakery/ui typecheck` (NOTE baseline : @breakery/ui typecheck peut échouer sur env install incomplet `@dnd-kit`/`recharts`/`sonner` — reproduit sur master, pas une régression).
- **When to escalate** : besoin d'un nouveau primitive partagé (l'ajouter à @breakery/ui, pas dans l'app).

- [ ] **Step 3: Vérifier** — IMPÉRATIF : `Glob packages/ui/src/**` + lire les barrels d'export AVANT d'affirmer ce qui existe/n'existe pas.

- [ ] **Step 4: Commit** `feat(skills): breakery-ui-kit — packages/ui conventions + tokens + fallbacks`.

---

## Task Z: Cross-review + closeout

**Files:** aucun nouveau (revue + commit final).

- [ ] **Step 1: Anti-recouvrement** — Grep tous les `promptSignals` à travers les 8 SKILL.md, lister les phrases dupliquées entre skills. Si collision, déplacer/spécialiser la phrase vers le skill le plus pertinent.

Run: `grep -rh "      - '" .claude/skills/*/SKILL.md | sort | uniq -d`
Expected: idéalement vide. Sinon résoudre.

- [ ] **Step 2: Frontmatter valide** — vérifier que chaque fichier parse (frontmatter YAML entre `---`, `name`+`description` présents ; agents ont `tools`+`model` ; skills ont `pathPatterns`+`promptSignals`).

Run: `for f in .claude/agents/*.md .claude/skills/*/SKILL.md; do echo "== $f =="; head -8 "$f"; done`
Expected: frontmatter cohérent partout.

- [ ] **Step 3: Pointer-to-CLAUDE.md** — grep que chaque fichier référence CLAUDE.md comme source de vérité.

Run: `grep -L "CLAUDE.md" .claude/agents/*.md .claude/skills/*/SKILL.md`
Expected: vide (tous référencent).

- [ ] **Step 4: Versioning** — confirmer que les 6 agents sont trackés (pas ignorés).

Run: `git status --short .claude/agents/ ; git check-ignore .claude/agents/db-engineer.md`
Expected: agents listés comme nouveaux/trackés ; check-ignore vide.

- [ ] **Step 5: (Optionnel) Pointer CLAUDE.md** — si souhaité, ajouter une courte sous-section "Project agents & skills" dans CLAUDE.md listant le roster. À confirmer avec l'utilisateur (CLAUDE.md règle : pas de doc non demandée).

- [ ] **Step 6: Commit final éventuel + résumé** — tout est déjà commité par tâche ; produire un résumé (16 fichiers, branche `feat/agents-skills-team`).

---

## Self-Review (rempli par l'auteur du plan)

- **Spec coverage** : §3.1 conservé (pas de tâche, intact) ✓ ; §3.2 6 agents → A1-A6 ✓ ; §3.3 8 skills → S1-S8 ✓ ; §4 anti-recouvrement → Task Z step 1 + règle commune skills ✓ ; §5 conventions → règles transverses ✓ ; §6 gitignore → Task 0 ✓ ; §7 waves → ordre des tâches (0, A*, S*, Z) ✓ ; §8 critères → Task Z ✓.
- **Placeholder scan** : pas de TBD ; chaque tâche liste frontmatter exact + sections concrètes nommées (RPC/colonnes/perms réels) + sources à vérifier + commandes. Le contenu prose est délégué (à dessein) au worker QUI VÉRIFIE le réel — chaque tâche impose la vérification MCP/lecture avant d'écrire un fait.
- **Type consistency** : noms de RPC/tables/perms repris verbatim de CLAUDE.md ; enum `order_status` cohérent (S6) ; REVOKE pair décrit identiquement (A2/S7) ; gitignore bloc identique spec §6 / Task 0.
