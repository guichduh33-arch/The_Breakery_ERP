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

> Read this **before** opening code on inventory work.

- **Current session:** Session 12 — Inventory Complete (8 phases). INDEX: [`docs/workplan/plans/2026-05-12-session-12-inventory-complete-INDEX.md`](docs/workplan/plans/2026-05-12-session-12-inventory-complete-INDEX.md). Spec: [`docs/workplan/specs/2026-05-12-session-12-inventory-complete-spec.md`](docs/workplan/specs/2026-05-12-session-12-inventory-complete-spec.md).
- **Module reference (canonical):** [`docs/reference/04-modules/06-inventory-stock.md`](docs/reference/04-modules/06-inventory-stock.md) — Parts I/II/III/IV (fonctionnel, technique, backlog, design).
- **Backlog opérationnel:** [`docs/workplan/backlog-by-module/06-inventory-stock.md`](docs/workplan/backlog-by-module/06-inventory-stock.md).
- **Execution skill:** invoke `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) before running a phase. Each phase is isolated → one subagent per phase, parallelizable post-Phase 1.
- **Workplan layout:** `docs/workplan/{plans,specs,backlog-by-module}/`. Plans/specs are **dated, append-only history** — never rewrite past plans; create a new dated file. Backlog files are living docs (update in place).
- **Migration sequence active:** `20260516xxxxxx_*.sql` (Phase 1 = 01-11 MVP foundations + idempotency fixes ; Phase 2 = 12-20 sections / units / movement_type enum / section_stock). Keep numbering monotonic — check `supabase/migrations/` before picking the next number.

## Project Conventions (The Breakery ERP)

### Critical patterns — don't break these
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
- Commits: conventional commits (`feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs(scope): …`, `refactor(scope): …`). For session 12 phases: `feat(db|domain|ui|backoffice): session 12 — phase X — <topic>`. Co-author Claude when AI-assisted.

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

```bash
pnpm build && pnpm test     # turbo run build / turbo run test --concurrency=1
pnpm typecheck               # turbo run typecheck
pnpm db:reset                # supabase db reset (re-applies migrations + seed)
pnpm db:types                # regenerate packages/supabase/src/types.generated.ts
```

Targeted iteration (much faster than full suite during phase work):

```bash
pnpm --filter @breakery/supabase test inventory     # Vitest live RPC tests
pnpm --filter @breakery/backoffice test inventory   # BO smoke + unit
pnpm --filter @breakery/domain test inventory       # pure-TS unit
pnpm test:pgtap                                      # pgTAP suite (supabase/tests/*.test.sql)
bash supabase/tests/run_pgtap.sh inventory_phase1_complete   # one pgTAP file
```

After Supabase schema changes (new migration), **always** run `pnpm db:reset && pnpm db:types` and commit the regenerated `packages/supabase/src/types.generated.ts`. A missing regen is the #1 cause of broken CI on this repo.

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
