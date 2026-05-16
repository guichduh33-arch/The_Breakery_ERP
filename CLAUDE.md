# Ruflo — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — this is a pnpm/turbo monorepo: code goes in `apps/{pos,backoffice}/src`, `packages/{domain,supabase,ui,utils}/src`, or `supabase/{functions,migrations,tests}`. Co-locate tests in `__tests__/` next to the code.
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Active Workplan

> Read this **before** opening code on Session 16 work.

- **Current session:** Session 16 — TBD (next session opens with backlog selection from `docs/workplan/backlog-by-module/`).
- **Previous session:** Session 15 — Bakery Production ✓ merged 2026-05-16 on `swarm/session-15` (53 commits, 6 waves, 32 migrations, INDEX: [`docs/workplan/plans/2026-05-15-session-15-INDEX.md`](docs/workplan/plans/2026-05-15-session-15-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-15-session-15-spec.md`](docs/workplan/specs/2026-05-15-session-15-spec.md). Delivered F6 sub-recipes (anti-cycle + cost cascade + recipe_versions + record_production cascade), F5 yield tracking (expected/actual + variance modal + JE actual), recipe pro features (IngredientPicker + DnD + Duplicate + Batch + Schedule + Margin alerts + Boulanger % + EU allergens). Deviations tracked in INDEX §13.
- **Session 14 reference:** UX completion ✓ merged `d7d60d5` on 2026-05-14 (68 commits, 6 waves). INDEX: [`docs/workplan/plans/2026-05-14-session-14-INDEX.md`](docs/workplan/plans/2026-05-14-session-14-INDEX.md).
- **Session 13 follow-ups (deferred Session 16+):** Playwright CI job (D-W6-6C-05), `pg_net`-based birthday cron (D-W6-6B-02), Cash Flow Investing/Financing sections (D-W6-6A-2), `mv_pl_monthly` branched reuse (D-W6-6A-1), staging-deploy.yml secrets (D-W6-CICD-01).
- **Session 15 follow-ups (deferred Session 16+):** Receipt template + customer display allergen integration (DEV-S15-5.C-01), per-version recipe cost reconstruction in history view (DEV-S15-2.B-01), `is_semi_finished` product flag (DEV-S15-3.A-01), `pg_trgm` indexes for product search ranking (DEV-S15-3.A-02), multi-level ingredient aggregate preview (DEV-S15-4.A-02). Full list in INDEX §13.
- **Module reference (canonical):** [`docs/reference/04-modules/`](docs/reference/04-modules/) per module (e.g., `15-production-recipes.md` for production).
- **Backlogs:** `docs/workplan/backlog-by-module/01-…25-….md` — 25 modules, ~280 tasks total. Session 16 source : TBD (open with backlog triage).
- **Execution skill:** invoke `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) before running a phase. Each phase is isolated → one subagent per phase, parallelizable per Wave.
- **Workplan layout:** `docs/workplan/{plans,specs,refs,backlog-by-module}/`. Plans/specs are **dated, append-only history** — never rewrite past plans; create a new dated file. Backlog files are living docs (update in place).
- **Migration sequence active:** Session 16 will start a new block `20260520xxxxxx...` ; Session 15 used `20260519000001..162` (32 migrations). Session 14 used `20260518000001..003`. Session 13 used `20260517xxxxxx`. Keep numbering monotonic — check `supabase/migrations/` before picking the next number.

## Project Conventions (The Breakery ERP)

### Critical patterns — don't break these
- **DB target is Supabase cloud, NOT local Docker** — As of 2026-05-14, Docker / local supabase stack is **retired** on this machine. All migrations, RPCs, pgTAP tests, and types regen run against the V3 dev project on the cloud: **`ikcyvlovptebroadgtvd`** (`the-breakery-v3-dev`, region `ap-southeast-1`, Pro plan $10/mo) — dashboard: <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd>. Apply migrations via `mcp__plugin_supabase_supabase__apply_migration`, run SQL via `execute_sql`, regen types via `generate_typescript_types`. **DO NOT run** `pnpm db:reset`, `supabase start`, `supabase db reset`, or `bash supabase/tests/run_pgtap.sh` — they require Docker and will fail. Prod (ref `abjabuniwkqpfsenxljp`) is V2 monolith and incompatible with V3 migration lineage.
- **PIN auth fetch wrapper** — the `auth-verify-pin` EF issues HS256 JWTs that GoTrue (ES256) can't validate via the default header. The Supabase client uses a custom fetch wrapper that injects the PIN JWT on every request via `setSupabaseAccessToken` (in `packages/supabase`). Never bypass with raw `Authorization` headers or `auth.setSession`.
- **Realtime channel names must be unique per mount** — StrictMode double-mounts components and shared channel names collide silently. See `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`.
- **`packages/domain` is IO-free** — no `fetch`, no Supabase, no React. Pure TS, unit-testable.
- **Order writes go through RPCs** — never raw inserts. RPCs: `complete_order` (v6), `pay_existing_order` (v3), `create_tablet_order`, `pickup_tablet_order`, `evaluate_promotions`, `mark_item_served`. They handle JE triggers, loyalty, promotions, table state atomically.
- **`stock_movements` is an append-only ledger** — RLS revokes UPDATE/DELETE for `authenticated`. All writes go through SECURITY DEFINER RPCs (`record_stock_movement_v1` primitive ; `adjust_stock_v1`, `receive_stock_v1`, `record_incoming_stock_v1`, `waste_stock_v1`, future `*_transfer_v1` / `record_production_v1` / `finalize_opname_v1`). Never `INSERT INTO stock_movements` directly from app code or tests.
- **`stock_movements.unit` is NOT NULL** — any direct insert (tests, fixtures, RPCs) must populate `unit`. The `record_stock_movement_v1` primitive auto-resolves from `products.unit` if NULL is passed — don't bypass it. See migration `20260516000019_fix_record_stock_movement_v1_unit.sql`.
- **`stock_movements` section constraint is movement-type-aware** — `transfer_in/out` require both `from_section_id` AND `to_section_id` ; `adjustment*`, `waste`, `incoming`, `purchase`, `sale*`, `production*`, `opname*` require at least one (relaxed in migration `20260516000020`). Don't tighten without re-checking all RPCs.
- **Inventory RPCs accept `p_idempotency_key UUID`** — replay returns the existing movement row instead of doubling it. Always pass one from the client on retry-able mutations.
- **RPC versioning is monotonic** — never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration if replacing. See `20260516000019` (drop original `record_stock_movement_v1` then recreate with `unit`).

### Git
- Branches: `swarm/session-N` for ongoing session work, `feat/<scope>` or `fix/<scope>` for focused PRs. For phased plans, prefer `swarm/session-N` and squash-merge per phase.
- Commits: conventional commits (`feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs(scope): …`, `refactor(scope): …`). For session 13 phases: `feat(db|domain|ui|backoffice|pos|edge|inventory): session 13 — phase X.Y — <topic>`. Co-author Claude when AI-assisted.

## Agent Comms (SendMessage-First Coordination)

Named agents coordinate via `SendMessage`, not polling or shared state.

```
Lead (you) ←→ architect ←→ developer ←→ tester ←→ reviewer
              (named agents message each other directly)
```

### Spawning a Coordinated Team

```javascript
// ALL agents in ONE message, each knows WHO to message next
Agent({ prompt: "Research the codebase. SendMessage findings to 'architect'.",
  subagent_type: "researcher", name: "researcher", run_in_background: true })
Agent({ prompt: "Wait for 'researcher'. Design solution. SendMessage to 'coder'.",
  subagent_type: "system-architect", name: "architect", run_in_background: true })
Agent({ prompt: "Wait for 'architect'. Implement it. SendMessage to 'tester'.",
  subagent_type: "coder", name: "coder", run_in_background: true })
Agent({ prompt: "Wait for 'coder'. Write tests. SendMessage results to 'reviewer'.",
  subagent_type: "tester", name: "tester", run_in_background: true })
Agent({ prompt: "Wait for 'tester'. Review code quality and security.",
  subagent_type: "reviewer", name: "reviewer", run_in_background: true })

// Kick off the pipeline
SendMessage({ to: "researcher", summary: "Start", message: "[task context]" })
```

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | A → B → C → D | Sequential dependencies (feature dev) |
| **Fan-out** | Lead → A, B, C → Lead | Independent parallel work (research) |
| **Supervisor** | Lead ↔ workers | Ongoing coordination (complex refactor) |

### Rules

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Swarm & Routing

### Config
- **Topology**: hierarchical-mesh (anti-drift)
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions

### 3-Tier Model Routing

| Tier | Handler | Use Cases |
|------|---------|-----------|
| 1 | Agent Booster (WASM) | Simple transforms — skip LLM, use Edit directly |
| 2 | Haiku | Simple tasks, low complexity |
| 3 | Sonnet/Opus | Architecture, security, complex reasoning |

## Memory & Learning

### Before Any Task
```bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
```

### After Success
```bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

### MCP Tools (use `ToolSearch("keyword")` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | `memory_store`, `memory_search`, `memory_search_unified` |
| **Bridge** | `memory_import_claude`, `memory_bridge_status` |
| **Swarm** | `swarm_init`, `swarm_status`, `swarm_health` |
| **Agents** | `agent_spawn`, `agent_list`, `agent_status` |
| **Hooks** | `hooks_route`, `hooks_post-task`, `hooks_worker-dispatch` |
| **Security** | `aidefence_scan`, `aidefence_is_safe`, `aidefence_has_pii` |
| **Hive-Mind** | `hive-mind_init`, `hive-mind_consensus`, `hive-mind_spawn` |

### Background Workers

| Worker | When |
|--------|------|
| `audit` | After security changes |
| `optimize` | After performance work |
| `testgaps` | After adding features |
| `map` | Every 5+ file changes |
| `document` | After API changes |

```bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
```

## Agents

**Core**: `coder`, `reviewer`, `tester`, `planner`, `researcher`
**Architecture**: `system-architect`, `backend-dev`, `mobile-dev`
**Security**: `security-architect`, `security-auditor`
**Performance**: `performance-engineer`, `perf-analyzer`
**Coordination**: `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
**GitHub**: `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

Any string works as a custom agent type.

## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing
- This project uses **pnpm 9.15** + **turbo** — never `npm`

### Local commands (no Docker required)
```bash
pnpm build && pnpm test     # turbo run build / turbo run test --concurrency=1
pnpm typecheck               # turbo run typecheck
```

### DB workflow — Supabase cloud staging (Docker retired 2026-05-14)
All DB operations target the cloud V3 dev project `ikcyvlovptebroadgtvd`. **Do NOT run** `pnpm db:reset`, `supabase start`, or `bash supabase/tests/run_pgtap.sh` — Docker is gone.

| Operation | MCP tool | Notes |
|---|---|---|
| Apply migration | `mcp__plugin_supabase_supabase__apply_migration` | `project_id='ikcyvlovptebroadgtvd'`, `name` in snake_case, body = SQL. Wrapped in transaction. |
| Run SQL (incl. pgTAP) | `mcp__plugin_supabase_supabase__execute_sql` | Use `BEGIN ... ROLLBACK` envelope for pgTAP. Extension `pgtap` already enabled. |
| Regen types | `mcp__plugin_supabase_supabase__generate_typescript_types` | Returns `{ types: "..." }` — write to `packages/supabase/src/types.generated.ts` and commit. |
| Check drift | `mcp__plugin_supabase_supabase__list_migrations` | Compares `supabase_migrations.schema_migrations` to local. |
| Direct psql (rare) | `postgresql://postgres.ikcyvlovptebroadgtvd:<URL_ENCODED_PWD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres` | Always go through the pooler — `db.<ref>.supabase.co` has no DNS A record. |

Dashboard: <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd>

### Targeted iteration (much faster than full suite during phase work)
```bash
pnpm --filter @breakery/supabase test inventory     # Vitest live RPC tests
pnpm --filter @breakery/backoffice test inventory   # BO smoke + unit
pnpm --filter @breakery/domain test inventory       # pure-TS unit
```

After Supabase schema changes (new migration via MCP `apply_migration`), **always** regen types via `mcp__plugin_supabase_supabase__generate_typescript_types`, write to `packages/supabase/src/types.generated.ts`, and commit. A missing regen is the #1 cause of broken CI on this repo.

### Inventory phase test layout
- pgTAP (DB): `supabase/tests/inventory.test.sql` (steady-state suite) + `supabase/tests/inventory_phase1_complete.test.sql` (phase 1 acceptance — T1-T15+).
- Vitest live RPC: `supabase/tests/functions/inventory-*.test.ts` (per-phase, one file per RPC family).
- Domain unit: co-located `__tests__/` in `packages/domain/src/inventory/`.
- BO smoke/unit: co-located `__tests__/` in `apps/backoffice/src/features/inventory*/`.

## CLI Quick Reference

```bash
npx @claude-flow/cli@latest init --start-all         # Setup (already done)
npx @claude-flow/cli@latest swarm init --v3-mode     # Start swarm
npx @claude-flow/cli@latest memory search --query "" # Vector search
npx @claude-flow/cli@latest hooks route --task ""    # Route to agent
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest security scan            # Security scan
npx @claude-flow/cli@latest performance benchmark    # Benchmarks
```

26 commands, 140+ subcommands. Use `--help` on any command for details.

## Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

**Agent tool** handles execution (agents, files, code, git). **MCP tools** handle coordination (swarm, memory, hooks). **CLI** is the same via Bash.
