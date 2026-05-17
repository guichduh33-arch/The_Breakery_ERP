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

> Read this **before** opening code on Session 20+ work.

- **Current session:** Session 19 — Hardening polish ✓ ready to merge `swarm/session-19` (12 commits, 4 waves, 7 migrations, INDEX: [`docs/workplan/plans/2026-05-17-session-19-INDEX.md`](docs/workplan/plans/2026-05-17-session-19-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-17-session-19-spec.md`](docs/workplan/specs/2026-05-17-session-19-spec.md). Delivered three hardening threads : **Thread A** — durable Postgres-backed rate-limit (`record_rate_limit_v1` RPC + `pg_advisory_xact_lock` race fix + `pg_cron rl-purge` daily + `checkRateLimitDurable` wired + 5 EFs migrated — `auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item` — closing TASK-01-002 follow-up from S13) ; **Thread B** — per-role session timeout (`roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` + per-role seed CASHIER 30 / waiter 30 / MANAGER 60 / ADMIN 120 / SUPER_ADMIN 240 + `update_role_session_timeout_v1` admin-gated audit-logged RPC + `useIdleTimeout` hook in `packages/ui` mounted in POS+BO + new `/settings/security` BO page + `auth-get-session` EF returns `session_timeout_minutes` — closing TASK-01-006) ; **Thread C** — PIN strength warn-only (`evaluatePinStrength` in `packages/utils` + Deno mirror with cross-package sync test + `auth-change-pin` extended `{ ok, weak, weak_reason? }` + BO `UserDetailPage` weak banner + new POS greenfield `ChangePinModal` 3-step + `SideMenuDrawer` "Change PIN" item + `useChangePin` hook — closing TASK-01-008). 7 migrations applied (block `20260523000010..022`, including 1 race-fix `12` and 1 corrective REVOKE `22`). Deviations tracked in INDEX §10.
- **Previous session:** Session 18 — Recipe Cost History Report ✓ merged 2026-05-17 on `swarm/session-18` (5 commits : `7924822`, `8851c70`, `423bad8`, `4f4c1a6`, `510ffdb`, 4 waves, 1 migration, INDEX: [`docs/workplan/plans/2026-05-17-session-18-INDEX.md`](docs/workplan/plans/2026-05-17-session-18-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-17-session-18-spec.md`](docs/workplan/specs/2026-05-17-session-18-spec.md). Delivered: Recipe Cost History Report — new RPC `recipe_cost_history_v1` (dual-mode) + 2 BO pages (Overview cross-recipe + Timeline single-recipe with recharts LineChart) + wiring (routes + sidebar + tile). Closes the read-side gap on S17's append-only `recipe_versions` history. Gated by `reports.financial.read`. 1 migration applied (block `20260522000010`). Deviations tracked in INDEX §10 (DEV-S18-1.A-01, 2.A-01/02, 2.B-01/02 — all informational).
- **Session 17 reference:** Full price chain ✓ merged 2026-05-17 via PR #21 (commit `5e79509`) on `swarm/session-17` (6 commits, 4 waves, 7 migrations, INDEX: [`docs/workplan/plans/2026-05-17-session-17-INDEX.md`](docs/workplan/plans/2026-05-17-session-17-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-17-session-17-spec.md`](docs/workplan/specs/2026-05-17-session-17-spec.md). Delivered: full price chain — PO receipt → WAC auto-update of `products.cost_price` → ancestor recipe snapshots cascade via `WITH RECURSIVE` walk → full-cascade `product_cost_at_version` (depth-5) + new `recipe_bom_full_v1` RPC replacing client-side BFS + `IngredientAggregatePreview` UI rewire — resolves `DEV-S16-2.B-01/03/04/05`, `DEV-S16-2.C-01/02` + new PO→cost requirement via WAC. 7 migrations applied (block `20260521000010..030`, including 1 corrective `21_fix_recipe_bom_full_v1_numeric_cast`). Deviations tracked in INDEX §10 (DEV-S17-1.A-01, 1.B-01, 1.C-01/02, 2.A-01).
- **Session 16 reference:** CI revival + S15 follow-ups ✓ merged 2026-05-16 via PR #20 (commit `f7c83b2`) on `swarm/session-16` (11 commits, 4 waves, 8 migrations, INDEX: [`docs/workplan/plans/2026-05-16-session-16-INDEX.md`](docs/workplan/plans/2026-05-16-session-16-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-16-session-16-spec.md`](docs/workplan/specs/2026-05-16-session-16-spec.md). Delivered: dropped broken Docker `supabase-tests` job and added `.github/workflows/pgtap-nightly.yml` cron `0 19 * * *` UTC against V3 dev — resolves `DEV-S15-CI-01` (medium) ; `products.is_semi_finished` boolean flag + maintenance trigger + pg_trgm GIN indexes on `name`/`sku` + trigram ranking in `search_ingredients_v1` — resolves `DEV-S15-3.A-01/02` ; per-version recipe cost embedded in `recipe_versions.snapshot` (breaking shape change) + history UI cost column with legacy-row tolerance + CHECK constraint — resolves `DEV-S15-2.B-01` ; new `expandRecipeCascade` domain helper + BFS graph builder in `IngredientAggregatePreview` — resolves `DEV-S15-4.A-02`. 8 migrations applied (block `20260520000010..022`). Deviations tracked in INDEX §10 (DEV-S16-1.A-01, 2.A-01, 2.B-02, 2.C-01..02 — others resolved by S17).
- **Session 15 reference:** Bakery Production ✓ merged 2026-05-16 on `swarm/session-15` (53 commits, 6 waves, 32 migrations, INDEX: [`docs/workplan/plans/2026-05-15-session-15-INDEX.md`](docs/workplan/plans/2026-05-15-session-15-INDEX.md)). Delivered F6 sub-recipes (anti-cycle + cost cascade + recipe_versions + record_production cascade), F5 yield tracking, recipe pro features (IngredientPicker + DnD + Duplicate + Batch + Schedule + Margin alerts + Boulanger % + EU allergens). Deviations tracked in INDEX §13.
- **Session 14 reference:** UX completion ✓ merged `d7d60d5` on 2026-05-14 (68 commits, 6 waves). INDEX: [`docs/workplan/plans/2026-05-14-session-14-INDEX.md`](docs/workplan/plans/2026-05-14-session-14-INDEX.md).
- **Session 13 follow-ups (deferred Session 20+):** Playwright CI job (D-W6-6C-05), `pg_net`-based birthday cron (D-W6-6B-02), Cash Flow Investing/Financing sections (D-W6-6A-2), `mv_pl_monthly` branched reuse (D-W6-6A-1), staging-deploy.yml secrets (D-W6-CICD-01).
- **Session 15 follow-ups:** DEV-S15-5.C-01 (Receipt template + customer display allergen integration) — **WONTFIX per user decision 2026-05-17** (memory: `project_allergens_wontfix`) — no allergens module needed for receipt/display.
- **Session 16 follow-ups (deferred Session 20+):** Trigram indexes not yet engaged by RPC predicate (DEV-S16-2.A-01, would need `%` operator + `set_limit`) ; legacy `recipe_versions` rows have no cost reconstructible (DEV-S16-2.B-02) ; nightly pgTAP is the only automated check, no PR-time gate (DEV-S16-1.A-01).
- **Session 17 follow-ups (deferred Session 20+):** N-snapshots-in-one-tx for high-fanout recipe graphs (DEV-S17-1.A-01, informational, Breakery depth ≤ 5 well within bounds) ; manual `products.cost_price` UPDATE bypasses WAC and doesn't emit `stock_movements` audit row (DEV-S17-1.B-01) ; WAC applies uniformly to all purchase movements, no opt-out for sample stock / promo (DEV-S17-1.C-01, low) ; WAC garbage-in if `current_stock` stale (DEV-S17-1.C-02, informational) ; `expandRecipeCascade` has no current consumer in `apps/` — preserved as public `@breakery/domain` API (DEV-S17-2.A-01, informational, downgraded).
- **Session 18 follow-ups (deferred Session 20+):** RPC scans all `recipe_versions` per call — no index on `(product_id, created_at DESC)` ; at current cardinality (~13 products × ~3 versions) negligible (DEV-S18-1.A-01, informational) ; overview baseline lookup uses correlated subqueries (~2× planner work), could be rewritten with a window function (DEV-S18-2.A-01, informational ; note: implem uses correlated subquery, not LATERAL as originally written) ; CSV exports raw NUMERIC without locale formatting (DEV-S18-2.A-02, informational) ; timeline chart X-axis = raw ISO date strings, no locale formatting (DEV-S18-2.B-01, informational) ; no zoom interaction on chart (DEV-S18-2.B-02, informational).
- **Session 19 follow-ups (deferred Session 20+):** RPC `record_rate_limit_v1` holds a row-lock during upsert — under sustained attack ≥100 req/s on the same bucket, attacker + defender serialize on the same bucket ; inconsequential at Breakery's traffic (DEV-S19-1.A-01, informational) ; fail-open on DB error is a deliberate trade-off — investigate pool sizing before reconsidering fail-closed (DEV-S19-1.A-02, informational) ; `audit_logs.entity_id` is NULL for `role.session_timeout_changed` rows — `role_code` lives in `payload` JSON instead (DEV-S19-1.B-01, informational) ; **medium** — `REVOKE FROM anon` is not implied by `REVOKE ALL FROM PUBLIC` on public-schema functions ; the corrective migration `20260523000022` adds explicit `REVOKE EXECUTE ... FROM anon` on `update_role_session_timeout_v1` and is now a project-wide critical pattern (DEV-S19-1.B-02, medium, see Critical patterns below) ; Vitest env vars unset in `supabase/tests/functions/*` mean the cross-instance RL simulation requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exported manually (DEV-S19-2.A-01, informational) ; 429 responses lack `Retry-After` header — project-wide gap (DEV-S19-2.A-02, informational) ; `pin-strength.ts` duplicated in `packages/utils` and `supabase/functions/_shared` — sync test catches drift but doesn't prevent it ; consider build-time copy (DEV-S19-2.B-01, informational) ; top-100 leaked PIN list inlined as a literal array — manual refresh cadence (DEV-S19-2.B-02, informational) ; `COMMON_PINS` has 101 entries including dead string `'232425'` (DEV-S19-2.B-03, informational) ; `useIdleTimeout` fires `signOut()` immediately — no "you are about to be signed out" warning toast (DEV-S19-3.A-01, informational) ; pre-existing : `UserDetailPage` validates 4-8 digits, EF requires exactly 6 — one-line regex fix for S20+ (DEV-S19-3.B-01, informational) ; BO admin-reset uses `reset_user_pin_v1` RPC (not `auth-change-pin` EF) ; shared `evaluatePinStrength` util preserves single source of truth (DEV-S19-3.B-02, informational) ; POS used `NumpadPin` collection primitive instead of verification-only `PinPad` — minor spec wording deviation (DEV-S19-3.C-01, informational) ; hint surfaces at step 3 not step 2 (DEV-S19-3.C-02, informational, UX polish) ; mismatch resets to step 1 instead of conventional step 2 (DEV-S19-3.C-03, informational, UX polish).
- **Module reference (canonical):** [`docs/reference/04-modules/`](docs/reference/04-modules/) per module (e.g., `15-production-recipes.md` for production).
- **Backlogs:** `docs/workplan/backlog-by-module/01-…25-….md` — 25 modules, ~280 tasks total. Session 20+ source : TBD (open with backlog triage post-S19 merge).
- **Execution skill:** invoke `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) before running a phase. Each phase is isolated → one subagent per phase, parallelizable per Wave.
- **Workplan layout:** `docs/workplan/{plans,specs,refs,backlog-by-module}/`. Plans/specs are **dated, append-only history** — never rewrite past plans; create a new dated file. Backlog files are living docs (update in place).
- **Migration sequence active:** Session 19 used `20260523000001..099` (7 migrations applied : Thread A `10_create_record_rate_limit_v1_rpc` + `11_schedule_rl_purge_cron` + corrective `12_fix_record_rate_limit_v1_race` ; Thread B `19_audit_logs_add_payload` + `20_add_session_timeout_to_roles` + `21_create_update_role_session_timeout_v1_rpc` + corrective `22_fix_update_role_session_timeout_v1_revoke_anon`). Session 18 used `20260522000001..099` (1 migration applied : `10_create_recipe_cost_history_v1_rpc`). Session 17 used `20260521000001..099` (7 migrations applied : 6 planned + 1 corrective `21_fix_recipe_bom_full_v1_numeric_cast`). Session 16 used `20260520000001..099` (8 planned). Session 15 used `20260519000001..162` (32 migrations). Session 14 used `20260518000001..003`. Session 13 used `20260517xxxxxx`. Keep numbering monotonic — check `supabase/migrations/` before picking the next number.

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
- **Supabase auto-grants EXECUTE on public functions to `anon`** — `REVOKE ALL FROM PUBLIC` does NOT cancel it. Always add an explicit `REVOKE EXECUTE ... FROM anon` on admin-only RPCs to enforce gate intent at the role level (defense in depth). See S19 migration `20260523000022` for an example.

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
