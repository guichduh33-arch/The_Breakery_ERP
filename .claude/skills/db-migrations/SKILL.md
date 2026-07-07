---
name: db-migrations
description: >-
  Migration & RPC hygiene expert for Supabase cloud V3 — RPC versioning
  monotone, REVOKE/anon defense-in-depth pairs, monotonic migration numbering,
  NO BEGIN/COMMIT in the body, mandatory types regen (the #1 cause of broken CI
  on this repo), and the cloud-MCP-only workflow (Docker retired 2026-05-14).
  Use this skill WHENEVER you create or edit a file in supabase/migrations/**,
  add / bump / DROP an RPC, alter a table or column, seed permissions, or touch
  SECURITY DEFINER / GRANT / REVOKE / packages/supabase/src/types.generated.ts —
  even a one-line migration. Boundary: THIS skill owns migration MECHANICS
  (sequencing, _vN→_vN+1 + DROP in the same migration, the 3-line REVOKE pair,
  anon inherits EXECUTE via PUBLIC, types regen, apply via MCP not Docker); the
  SECURITY SEMANTICS of a gate or RLS policy design → security-auth; whether a
  money-path RPC is correct → the domain skill (orders / accounting /
  stock-management / b2b-credit / expense-governance). Mirrors the db-engineer
  agent as an always-on guardrail — invoke it BEFORE writing migration SQL.
pathPatterns:
  - 'supabase/migrations/**'
  - 'packages/supabase/src/types.generated.ts'
promptSignals:
  phrases:
    - 'migration'
    - 'apply_migration'
    - 'RPC versioning'
    - 'DROP FUNCTION'
    - 'REVOKE'
    - 'GRANT EXECUTE'
    - 'types regen'
    - 'generate_typescript_types'
    - 'types.generated'
    - 'SECURITY DEFINER'
    - 'schema_migrations'
    - 'supabase cloud'
    - 'bump the RPC'
    - 'new migration'
    - 'seed permission'
---

# DB Migrations & RPC Hygiene — The Breakery ERP

**`CLAUDE.md` (Critical patterns + Active Workplan) is the source of truth.** This skill is the always-on guardrail that fires when you touch `supabase/migrations/**`; the deep procedures live in the **`db-engineer`** agent. Verify the live schema (MCP `list_tables` / `pg_get_functiondef`) before asserting a fact — cloud drifts from the migration files.

## The 8 rules you must not break

1. **Cloud V3 only — Docker is retired.** Apply/query/regen via MCP against `ikcyvlovptebroadgtvd`:
   - `mcp__plugin_supabase_supabase__apply_migration` (name snake_case, body = SQL)
   - `mcp__plugin_supabase_supabase__execute_sql` (pgTAP inside a `BEGIN … ROLLBACK` envelope)
   - `mcp__plugin_supabase_supabase__generate_typescript_types`
   - **NEVER** `pnpm db:reset`, `supabase start/db reset`, `bash supabase/tests/run_pgtap.sh` — they need Docker and fail.

2. **Never edit a published `_vN` signature.** Create `_vN+1` **and** `DROP FUNCTION public.<name>_vN(<exact old args>)` in the **same** migration. Bump nearly every session — always check the highest live version + the call-site first.

3. **Copy an RPC body from the LIVE definition** (`pg_get_functiondef`), never from the original migration file — cloud↔git drift is real (lesson DEV-S57-02).

4. **REVOKE pair (anon defense-in-depth).** Supabase auto-grants EXECUTE to `anon` via PUBLIC; `REVOKE … FROM anon` alone is INSUFFICIENT. Every admin RPC needs the trio:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   Money-path RPCs called by the EF via user JWT **must** `GRANT EXECUTE TO authenticated` (else the whole checkout breaks in `permission denied` — caveat S51/S55).

5. **No `BEGIN;` / `COMMIT;` in a migration body.** MCP `apply_migration` already wraps it in a transaction; an inner COMMIT ends it early and weakens atomicity (lesson S58).

6. **Monotonic numbering.** Check the highest NAME-block in `supabase/migrations/` before picking the next (`20260710000NNN`). Cloud `version`s are clock-assigned; local file names use the NAME-block.

7. **Always regen types after any schema change** → write to `packages/supabase/src/types.generated.ts` and commit. A missing regen is the **#1 cause of broken CI** on this repo. If a bump is behaviour-only (no signature/column change), tag it `[types-noop]` in the migration name.

8. **Append-only ledgers stay append-only.** `stock_movements`, `audit_logs`, `b2b_payment_allocations` — writes only through SECURITY DEFINER RPCs; never relax the RLS that revokes UPDATE/DELETE.

## Before you commit a migration — checklist
- [ ] Highest migration number checked; new name monotonic.
- [ ] If replacing an RPC: `_vN+1` created **and** old `_vN` dropped, body from live.
- [ ] REVOKE trio present for any non-public RPC; `GRANT authenticated` if EF-called.
- [ ] No `BEGIN/COMMIT` in the body.
- [ ] Types regenerated + committed (or `[types-noop]`).
- [ ] pgTAP added/updated and run live via `execute_sql` (BEGIN…ROLLBACK); money-path anchor `s44_money_gates` still 12/12 if you touched a sale RPC.
- [ ] Call-sites (hooks/EF) repointed to the new version.
