# Design — Équipe d'agents + skills projet (The Breakery ERP)

**Date:** 2026-05-31
**Statut:** validé (roster + approche), prêt pour plan d'implémentation
**Base:** `master` @ `dafc500` (post-merge PR #53)

## 1. Objectif

Construire une **équipe complète d'agents implémenteurs + skills d'audit/guidance entièrement adaptés au projet** (couverture build + maintenance + coordination sur tout le monorepo). On étend le pattern déjà en place (`pos-specialist` agent + `stock-management` skill) à l'ensemble des surfaces et domaines métier livrés jusqu'à S33.

Non-objectif : remplacer ou dupliquer les ~90 agents génériques ruflo (`.claude/agents/*/`, sous-dossiers, auto-générés, gitignorés). On ne touche pas à ceux-là.

## 2. Approche retenue — Hybride par responsabilité (Approche A)

Le projet utilise déjà deux mécaniques distinctes ; on capitalise sur les deux :

- **Agents** (`.claude/agents/*.md`, frontmatter `tools:` + `model:`) = personas **spawnables** via la tâche Agent, pour du travail **parallélisable et délégable** (build d'une wave, review d'un diff, exécution d'une suite de tests).
- **Skills** (`.claude/skills/<name>/SKILL.md`, frontmatter `pathPatterns:` + `promptSignals:`) = modules de connaissance **auto-déclenchés** qui s'injectent dans le contexte courant quand on touche un chemin/sujet du domaine. Guidance + audit passifs, zéro effort.

Rejeté :
- **Tout-agents (B)** : perd l'auto-déclenchement, n'exploite pas les `pathPatterns` déjà utilisés par le projet.
- **Tout-skills (C)** : un skill ne s'exécute pas en parallèle (il s'injecte, il ne se délègue pas) → perd le build parallèle, objectif #1.

## 3. Roster (16 briques : 2 existantes + 6 agents + 8 skills)

### 3.1 Conservé
| Brique | Type | Périmètre |
|---|---|---|
| `pos-specialist` | agent (sonnet) | `apps/pos/` + workspace deps |
| `stock-management` | skill | inventory / recipes / production / WAC / lots |

### 3.2 Nouveaux agents — `.claude/agents/` (implémenteurs / process)

| ID | Agent | Modèle | Périmètre | Patterns embarqués |
|---|---|---|---|---|
| A1 | `backoffice-specialist` | sonnet | `apps/backoffice/` (+ workspace deps) | miroir pos-specialist : `features/`, routes, `Sidebar`, `PermissionGate`, `ExportButtons`, infinite-query cursor, gates `*.read/write`, groupes sidebar (7 groupes + sous-groupes collapsibles) |
| A2 | `db-engineer` | sonnet | `supabase/migrations/` + RPCs | RPC versioning monotone (`_vN`→`_vN+1` + DROP même migration), REVOKE pair S25 (PUBLIC+anon+ALTER DEFAULT PRIVILEGES), SECURITY DEFINER + `has_permission`, séquençage migrations (vérifier dernier timestamp), types regen via MCP, cloud V3 `ikcyvlovptebroadgtvd` uniquement (Docker retiré) |
| A3 | `edge-functions-engineer` | sonnet | `supabase/functions/` (Deno) | PIN en header `x-manager-pin` (jamais body), `_shared/idempotency.ts::getIdempotencyKey`, rate-limit durable Postgres (`record_rate_limit_v1`), JWT HS256 + fetch wrapper, hard-cutover (pas de dual-mode) |
| A4 | `pattern-guardian` | sonnet | revue de diffs avant merge | applique tous les "Critical patterns" CLAUDE.md : append-only ledgers (`stock_movements`, `display_movements`, `audit_logs`), anon defense-in-depth, idempotency 2-flavors, PIN header, realtime channel unique, `packages/domain` IO-free. Sort une liste de violations, pas de fixes auto. |
| A5 | `test-engineer` | sonnet | tests transverses | pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK envelope), Vitest live RPC (env-gated `SUPABASE_SERVICE_ROLE_KEY`), BO/POS smoke, connaît la baseline d'échecs pré-existants (`DEV-S25-2.A-02` env-gated) pour ne pas les confondre avec des régressions |
| A6 | `session-coordinator` | **opus** | orchestration `swarm/session-N` | layout `docs/workplan/{specs,plans}/`, INDEX + déviations numérotées (`DEV-SNN-x.y-zz`), découpage en waves parallélisables, squash-merge per phase, bump `CLAUDE.md` Active Workplan en closeout |

### 3.3 Nouveaux skills — `.claude/skills/` (domaine, auto-déclenchés)

| ID | Skill | Domaine (session) | Contenu principal |
|---|---|---|---|
| S1 | `accounting` | S26/S26b | COA, journal entries, PB1 NON-PKP (`current_pb1_rate`, ADR-003), fiscal periods (`close_fiscal_period_v1`), GL/TB RPCs, mapping keys, JE balance + fiscal-open guards, cockpit BO |
| S2 | `b2b-credit` | S24 | AR aging (`view_ar_aging`), `b2b_payments` ledger append-only, credit-limit gate (`validate_b2b_credit_limit_v1`), FIFO allocation, `create_b2b_order_v1` |
| S3 | `reports-exports` | S29-S33 | RPCs reports (cursor-paginées), EF `generate-pdf` (17 templates `_shared/pdf-templates/`), `buildCsv` (RFC 4180 + BOM + id-ID), Z-reports flow 2-temps + signature PIN, `buildDrilldownUrl` |
| S4 | `expense-governance` | S28 | `expense_approval_thresholds`, SOD (UNIQUE approver), multi-step chain, snapshot-at-submit (`required_approval_steps_snapshot`), cash sync trigger, `submit/approve_expense_v2` |
| S5 | `products-catalog` | S27/27b/27c | products CRUD (`create/update_product_v1` allowlist), variants linked-products (XOR + anti-nesting trigger), categories DnD reorder, units/sections/modifiers RPCs |
| S6 | `orders` | S32/S33 | `get_orders_list_v2` server-side filters, edit-items RPCs atomiques (`add/update/remove_order_item_v1` + `_recalc_order_totals`), void/refund BO, `order_status` enum réel (draft/paid/voided/pending_payment/completed/b2b_pending), realtime `useOrdersRealtime` |
| S7 | `security-auth` | S19/S20/S25 | RLS policies, REVOKE/anon defense-in-depth (PUBLIC inheritance trap), perm gates `has_permission`, roles/permissions/role_permissions, PIN JWT fetch wrapper (HS256 vs ES256), rate-limit durable, per-role session timeout |
| S8 | `breakery-ui-kit` | transverse | conventions `packages/ui` : primitives exportées vs absentes (pas de `Select`/`RadioGroup`/`SelectItem` → fallbacks HTML natifs / 3-button), semantic design tokens, patterns Dialog/Sheet/Badge, `useIdleTimeout` |

## 4. Frontières anti-recouvrement (éviter le bruit de `promptSignals`)

- `orders` (skill, domaine cross-app : list/edit/void/refund logique métier) ≠ `pos-specialist` (agent, surface POS UI) ≠ `backoffice-specialist` (agent, surface BO UI). Le skill porte la **logique métier ordres** ; les agents portent la **surface UI**.
- `security-auth` (skill) porte le **savoir** RLS/REVOKE/perms ; `db-engineer` (agent) **applique** ce savoir en écrivant migrations. Le skill s'injecte quand l'agent travaille.
- `reports-exports` couvre RPCs reports + EF PDF + CSV ; les pages BO reports relèvent de `backoffice-specialist`.
- `breakery-ui-kit` est volontairement transverse (pas de session) — déclenché par `packages/ui/**` et par les signaux "Select/RadioGroup/dialog/token".
- Chaque skill liste des `pathPatterns` disjoints + `promptSignals` spécifiques pour minimiser les déclenchements simultanés.

## 5. Conventions de chaque brique

Toutes les briques :
1. **Pointent vers `CLAUDE.md` comme source de vérité** — n'ajoutent que le surplus spécifique (surface map, checklists, schéma réel vérifié, commandes de vérif). Pas de redite des patterns globaux.
2. **Style bilingue FR/EN** comme l'existant (structure EN, français là où naturel — mémoire `feedback_french_english_mixed`).
3. **Section "Verification before completion"** avec les commandes `pnpm --filter` ciblées du périmètre.
4. **Section "When to escalate"** — quand remonter à l'utilisateur (bump RPC majeur, relax CHECK/RLS, override pattern CLAUDE.md).
5. **Densité ~150-250 lignes**, niveau `pos-specialist`/`stock-management`.

Agents en plus : frontmatter `tools:` (sous-ensemble adapté — ex. pattern-guardian read-only : Glob/Grep/Read/Bash) + `model:`.
Skills en plus : frontmatter `pathPatterns:` + `promptSignals:` (phrases).

## 6. Fix `.gitignore` (prérequis versioning agents)

État actuel (`.gitignore` lignes 46-47) :
```
.claude/*
!.claude/skills/
```
`pos-specialist.md` survit car tracké avant la règle ; tout nouvel agent serait ignoré. Correctif :
```
.claude/*
!.claude/skills/
!.claude/agents/
.claude/agents/*/      # re-ignore les sous-dossiers ruflo auto-générés
```
Effet : les `.md` à la racine de `.claude/agents/` (agents projet) deviennent versionnables ; les ~90 agents ruflo en sous-dossiers restent ignorés. Vérifier après : `git check-ignore .claude/agents/core/coder.md` (doit matcher) et `git status` doit voir les nouveaux agents racine.

## 7. Plan d'implémentation (esquisse — détaillé dans le plan)

Découpage en vagues parallélisables (chaque brique est indépendante) :
- **Wave 0** : fix `.gitignore` + scaffolding dossiers.
- **Wave 1 (agents)** : A1-A6, parallélisables (un sous-agent par fichier).
- **Wave 2 (skills)** : S1-S8, parallélisables.
- **Wave 3** : relecture croisée `pattern-guardian` sur les frontières + commit + bump éventuel `CLAUDE.md` (pointeur vers l'équipe).

Chaque brique = un fichier autonome ; pas de dépendances entre fichiers → fan-out maximal. Vérification : un agent de test relit que chaque fichier a frontmatter valide + pointe vers CLAUDE.md + ne contredit pas les patterns.

## 8. Critères de succès

- 16 fichiers présents et versionnés (6 agents racine `.claude/agents/`, 8 skills `.claude/skills/`, + 2 existants intacts).
- `.gitignore` corrigé : agents projet trackés, ruflo ignorés.
- Chaque brique : frontmatter valide, pointe vers CLAUDE.md, `promptSignals`/`pathPatterns` disjoints, schéma/RPC réels vérifiés contre V3 dev (pas d'invention).
- Aucune contradiction avec les "Critical patterns" CLAUDE.md.
- `pos-specialist` + `stock-management` inchangés (sauf si une frontière l'exige, alors flag).
