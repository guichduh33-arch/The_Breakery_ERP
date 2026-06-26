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

> Per-session history (S13→S49: specs, plans, INDEX files, numbered deviations) lives in
> `docs/workplan/{specs,plans}/` and `docs/superpowers/{specs,plans}/`, with merged sessions
> under `archive/`. **Do not duplicate that history here** — link to the dated file instead.
> Plans/specs are dated, append-only history: never rewrite a past plan; create a new dated file.

- **In flight:** **Spec B — remaining bulk import (Phase 2):** Sales + Expenses (later specs). Spec B-1 (dispatch/print routing) shipped via #125; held-order lifecycle (Spec A) via #120/#121. Spec-A design: `docs/superpowers/specs/2026-06-25-pos-held-order-lifecycle-design.md`; Spec-B-1 design: `docs/superpowers/specs/2026-06-26-pos-spec-b1-dispatch-routing-design.md`.
- **Merged (latest):** **Spec B-1 — dispatch/print routing** (#125) — POS station-routing rework: `display` vocab clarified, **full category→station mapping**, waiter ticket, and **per-product multi-station** dispatch (a product can fire to several KDS/print stations). New RPC `resolve_dispatch_stations_v1`; dispatch stations snapshotted into the order RPCs and exposed via the product RPCs. Migrations `20260710000031` (full category mapping), `20260710000040..043` (product dispatch stations, resolve RPC, snapshot in order RPCs, expose in product RPCs). Spec: `docs/superpowers/specs/2026-06-26-pos-spec-b1-dispatch-routing-design.md`.
- **Previously merged:** **#124** — route-split the backoffice app to cut initial bundle ~69% (perf, no schema change). **#123** — docs refresh (CLAUDE.md workplan + global roadmap). **#122** — `track_inventory`/`deduct_stock` flag wiring + global negative-stock setting: `track_inventory` = product carries its own counted stock (decremented at sale, raised at production); `deduct_stock` = consumes recipe materials (at production if tracked = croissant, at sale if not = café). New internal helper `_resolve_recipe_consumption_v1` (recursive BOM, stop-at-tracked-nodes; REVOKE PUBLIC+anon+authenticated). `complete_order_with_payment_v14` replaced in place (no version bump); `record_production_v1`/`record_batch_production_v1` gate on `deduct_stock`. New `business_config.allow_negative_stock BOOLEAN DEFAULT true` + `record_stock_movement_v1` gains `p_allow_negative` (13-arg). Migrations `20260710000020..025`. Plan: `docs/superpowers/plans/2026-06-26-stock-tracking-deduct-flags.md`. ⚠️ **Migration-bookkeeping caveat (still active):** a subagent's `supabase migration repair` damaged the cloud `schema_migrations` bookkeeping (~400 clock-stamped rows dropped; max `20260629000012`) — actual schema intact, MCP `apply_migration` workflow unaffected; not reconstructed.
- **Latest on `master`:** PR #125 — Spec B-1 dispatch/print routing (see Merged-latest bullet above). Earlier merged-bullet detail (held-order #120/#121, Phase 2a #116, Phase 1 #114/#115, #117 Cost Analytics, #118 POS P0 hardening, #106/#103/#95/#98/#99/#100) is archived in [`docs/workplan/2026-06-26-claude-md-workplan-archive.md`](docs/workplan/2026-06-26-claude-md-workplan-archive.md). Full per-session detail (S13→S49) lives in `docs/workplan/` — open the relevant dated INDEX.
- **Migrations:** numbering is monotonic. Check `supabase/migrations/` for the highest NAME-block before picking the next. Cloud `version`s are clock-assigned (S36+ convention); local file names use the NAME-block. Always regen types after a schema change (see Build & Test).
- **Next-session source:** triage `docs/workplan/backlog-by-module/01-…25-….md` (25 modules, ~280 tasks).
- **Execution skill:** invoke `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) before running a phase — one subagent per isolated phase, parallelizable per Wave.
- **Module reference (canonical):** [`docs/reference/04-modules/`](docs/reference/04-modules/) per module (e.g. `15-production-recipes.md`).

## Project Conventions (The Breakery ERP)

### Critical patterns — don't break these
- **DB target is Supabase cloud, NOT local Docker** — As of 2026-05-14, Docker / local supabase stack is **retired** on this machine. All migrations, RPCs, pgTAP tests, and types regen run against the V3 dev project on the cloud: **`ikcyvlovptebroadgtvd`** (`the-breakery-v3-dev`, region `ap-southeast-1`, Pro plan $10/mo) — dashboard: <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd>. Apply migrations via `mcp__plugin_supabase_supabase__apply_migration`, run SQL via `execute_sql`, regen types via `generate_typescript_types`. **DO NOT run** `pnpm db:reset`, `supabase start`, `supabase db reset`, or `bash supabase/tests/run_pgtap.sh` — they require Docker and will fail. Prod (ref `abjabuniwkqpfsenxljp`) is V2 monolith and incompatible with V3 migration lineage.
- **PIN auth fetch wrapper** — the `auth-verify-pin` EF issues HS256 JWTs that GoTrue (ES256) can't validate via the default header. The Supabase client uses a custom fetch wrapper that injects the PIN JWT on every request via `setSupabaseAccessToken` (in `packages/supabase`). Never bypass with raw `Authorization` headers or `auth.setSession`.
- **Realtime channel names must be unique per mount** — StrictMode double-mounts components and shared channel names collide silently. See `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`.
- **`packages/domain` is IO-free** — no `fetch`, no Supabase, no React. Pure TS, unit-testable.
- **Order writes go through RPCs** — never raw inserts. The POS POSTs the `process-payment` EF (`apps/pos/src/features/payment/hooks/useCheckout.ts`), which server-side calls the current money-path RPC `complete_order_with_payment_v14` (`supabase/functions/process-payment/index.ts`) — the POS never calls it directly. Other order RPCs: `pay_existing_order_v10`, `fire_counter_order_v4`, `create_tablet_order_v2`, `pickup_tablet_order` (unversioned), `evaluate_promotions_v1`, `mark_item_served` (unversioned). They handle JE triggers, loyalty, promotions, table state atomically. **RPC versions bump nearly every session — always verify the live version in `supabase/migrations/` + the call-site before relying on a number.**
- **`stock_movements` is an append-only ledger** — RLS revokes UPDATE/DELETE for `authenticated`. All writes go through SECURITY DEFINER RPCs (`record_stock_movement_v1` primitive ; `adjust_stock_v1`, `receive_stock_v1`, `record_incoming_stock_v1`, `waste_stock_v1`, future `*_transfer_v1` / `record_production_v1` / `finalize_opname_v1`). Never `INSERT INTO stock_movements` directly from app code or tests.
- **`stock_movements.unit` is NOT NULL** — any direct insert (tests, fixtures, RPCs) must populate `unit`. The `record_stock_movement_v1` primitive auto-resolves from `products.unit` if NULL is passed — don't bypass it. See migration `20260516000019_fix_record_stock_movement_v1_unit.sql`.
- **`stock_movements` section constraint is movement-type-aware** — `transfer_in/out` require both `from_section_id` AND `to_section_id` ; `adjustment*`, `waste`, `incoming`, `purchase`, `sale*`, `production*`, `opname*` require at least one (relaxed in migration `20260516000020`). Don't tighten without re-checking all RPCs.
- **`stock_movements.unit_cost` is per BASE unit** — receive must convert BOTH qty (×factor) AND cost (÷factor) to the base unit before recording; `purchase_order_items.unit_cost` stays per purchase unit (supplier price). All readers do `qty × cost`. Fixed 2026-06-20 (`receive_purchase_order_v2` + backfill, PR #103).
- **Inventory RPCs accept `p_idempotency_key UUID`** — replay returns the existing movement row instead of doubling it. Always pass one from the client on retry-able mutations.
- **RPC versioning is monotonic** — never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration if replacing. See `20260516000019` (drop original `record_stock_movement_v1` then recreate with `unit`).
- **Supabase auto-grants EXECUTE on public functions to `anon`** — `REVOKE ALL FROM PUBLIC` does NOT cancel it. Always add an explicit `REVOKE EXECUTE ... FROM anon` on admin-only RPCs to enforce gate intent at the role level (defense in depth). See S19 migration `20260523000022` for an example.
- **Anon GRANT defense-in-depth (S20)** — `REVOKE ALL FROM anon ON public.*` is the project-wide default for tables, views, AND functions, future-proofed via `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`. Critical caveat: `REVOKE EXECUTE ... FROM anon` on functions is INSUFFICIENT on its own — `anon` inherits EXECUTE through PUBLIC membership via the `=X/postgres` ACL entry. Future REVOKE-on-functions migrations MUST also `REVOKE EXECUTE ... FROM PUBLIC` and `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. See S20 migrations `20260524000020..031`. `supabase_admin`-owned extension objects (pgtap: `pg_all_foreign_keys`, `tap_funky`, pgtap helper functions) are platform-managed and not user-revocable — pgTAP suite excludes them. If a future feature legitimately needs anon (public landing-page RPC, embeddable widget), grant explicitly per-object with `COMMENT ON FUNCTION ... IS 'anon-callable: <reason>'`.
- **PIN / auth secrets en header HTTP, jamais en body JSON (S25)** — Any EF that consumes a manager PIN or other validation secret MUST read it from a dedicated HTTP header (e.g., `x-manager-pin`), NEVER from the JSON body. Rationale : request bodies get logged by default in PostgREST access logs, pgaudit, reverse proxies, and Supabase function logs ; headers are far less commonly captured. Hard cutover pattern : drop the body field in the SAME commit as the header read — no dual-mode fallback unless the EF has uncontrolled external callers (rare on this project, only POS calls these EFs). Reference : S25 `refund-order` migration body `manager_pin` → header `x-manager-pin` (`supabase/functions/refund-order/index.ts`). Sweep **DONE** : `void-order` + `cancel-item` hardened S34/PR #53 ; `kiosk-issue-jwt` verified compliant S36 (DEV-S36-A-01) ; all three read `x-manager-pin` from the header.
- **Idempotency 2-flavors selon la sémantique (S25)** — Two distinct patterns coexist on this project ; pick the right one for the flow :
  1. **HTTP `x-idempotency-key` header (EF retry safety)** — For HTTP requests where the client may legitimately retry (flaky network, double-click, React-Query auto-retry). The client generates a UUID v4 (`crypto.randomUUID()` stored in a `useRef` so it survives re-renders), sends it via header. The EF reads via `getIdempotencyKey(req)` from the shared helper `supabase/functions/_shared/idempotency.ts` (1 export, validates UUID regex, returns `string | null`) and propagates it as `p_idempotency_key` arg to the RPC. Reference : S25 `refund-order` EF + `refund_order_rpc_v2` (the RPC already had the arg from S13, only the EF + POS wiring was missing).
  2. **RPC arg `p_client_uuid` / `p_idempotency_key` (idempotence sémantique métier)** — For RPCs where idempotency is intrinsic to the business flow (e.g., "this cart, this tap" for tablet, "this payment record" for B2B, "this stock movement record" for inventory). The arg is REQUIRED at the RPC level (NOT NULL CHECK) and used as the primary key of a **dedicated** idempotency-keys table (never as a nullable column on the business table — isolation makes REVOKE simpler and avoids polluting the metric tables). Concurrency race handled via PK `unique_violation` catch + re-read. References : `create_tablet_order_v2(p_client_uuid)` with `tablet_order_idempotency_keys` (S25), `record_b2b_payment_v1(p_idempotency_key)` with `b2b_payments.idempotency_key UNIQUE` (S24), `record_stock_movement_v1` & family (S12). Replay returns the result of the first successful execution — by convention, RPCs return either the exact same value or an envelope `{ ..., idempotent_replay: true }` so callers can audit.

### Git
- Branches: `swarm/session-N` for ongoing session work, `feat/<scope>` or `fix/<scope>` for focused PRs. For phased plans, prefer `swarm/session-N` and squash-merge per phase.
- Commits: conventional commits (`feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs(scope): …`, `refactor(scope): …`). Co-author Claude when AI-assisted.

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

Reach for a multi-agent swarm (3+ agents) on: new features, cross-module refactors, API changes, security, performance. Use a single agent (or none) for: 1–2 line fixes, docs, config changes, questions.

| Task | Suggested agents |
|------|------------------|
| Bug fix | researcher, coder, tester |
| Feature | architect, coder, tester, reviewer |
| Refactor | architect, coder, reviewer |
| Security | security-architect, security-auditor |

> Optional tooling: the `claude-flow` / `ruflo` CLI (`npx @claude-flow/cli@latest …`) and its MCP coordination/memory tools (`memory_store`, `memory_search`, `swarm_init`, `agent_spawn`, `hooks_route`) are available — discover schemas via `ToolSearch("keyword")` if a task needs cross-session memory or hook routing. Day-to-day work uses the Agent + SendMessage team above and the project skills below.

## Agents

**Generic types** (any string works as a custom type): `coder`, `reviewer`, `tester`, `planner`, `researcher`, `system-architect`, `backend-dev`, `security-architect`, `security-auditor`, `performance-engineer`, `pr-manager`, `release-manager`, the coordinators (`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`), etc.

### Project agents & skills (The Breakery — adaptés au projet)

The repo versions a **specialized team** (PR #55). **Agents** (`.claude/agents/*.md`) are spawnable via the Agent tool ; **skills** (`.claude/skills/<name>/SKILL.md`) auto-trigger by `pathPatterns`/`promptSignals` when you touch their domain. Each points back to this CLAUDE.md as the source of truth and verifies the real schema (migrations/MCP) before asserting a fact.

**Agents** (`.claude/agents/`) :
- `pos-specialist` (sonnet) — `apps/pos/`
- `backoffice-specialist` (sonnet) — `apps/backoffice/`
- `db-engineer` (sonnet) — `supabase/migrations/` + RPCs (versioning, REVOKE pairs, MCP V3)
- `edge-functions-engineer` (sonnet) — `supabase/functions/` (PIN header, idempotency, rate-limit)
- `pattern-guardian` (sonnet, **read-only**) — reviews a diff vs the Critical patterns above
- `test-engineer` (sonnet) — pgTAP/Vitest/smoke + baseline env-gated
- `session-coordinator` (**opus**) — orchestration `swarm/session-N` (spec→plan→waves→closeout)

**Skills** (`.claude/skills/`, auto-triggered) :
- `stock-management` — inventory/recipes/production/WAC/lots
- `accounting` — COA/JE/PB1 NON-PKP/fiscal/GL/TB · `b2b-credit` — AR/credit-limit/b2b_payments
- `reports-exports` — report RPCs/PDF/CSV/Z-report/drill-down · `expense-governance` — thresholds/SOD/multi-step
- `products-catalog` — products CRUD/variants/categories · `orders` — lifecycle/list v2/edit-items/void/refund
- `security-auth` — RLS/REVOKE/perms/PIN-JWT/rate-limit · `breakery-ui-kit` — conventions `packages/ui`

Design : `docs/superpowers/specs/2026-05-31-agents-skills-team-design.md` (spec) + `docs/superpowers/plans/2026-05-31-agents-skills-team.md` (plan). `.gitignore` versions the root `.md` files of `.claude/agents/` ; the ruflo subfolders stay ignored.

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
