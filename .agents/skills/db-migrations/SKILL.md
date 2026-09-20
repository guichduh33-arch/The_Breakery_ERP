---
name: db-migrations
description: >-
  Migrations et RPC Postgres The Breakery : consulter avant un changement de schéma, un
  ajout ou bump de RPC, un GRANT/REVOKE ou une régénération des types. Couvre
  supabase/migrations, versions monotones, droits PUBLIC/anon, types et exécution sur
  Supabase cloud V3. La sémantique des permissions relève de security-auth ; les règles
  métier restent au skill du domaine concerné.
---

Périmètre : supabase/migrations et packages/supabase/src/types.generated.ts, avant toute écriture SQL de schéma ou de RPC. Le choix de ce skill vient de la tâche ; les chemins sont des repères de lecture, pas un hook automatique. Associer [security-auth](../security-auth/SKILL.md) pour le sens des droits et le skill métier concerné pour les invariants.

# DB Migrations & RPC Hygiene — The Breakery ERP

**`AGENTS.md` (Critical patterns) is the source of truth.** This skill is the always-on guardrail that fires when you touch `supabase/migrations/**`; the deep procedures live in the **`db-engineer`** agent. Verify the live schema (MCP `list_tables` / `pg_get_functiondef`) before asserting a fact — cloud drifts from the migration files.

## The 8 rules you must not break

1. **Cloud V3 only — Docker is retired.** Apply/query/regen via MCP against `ikcyvlovptebroadgtvd`:
   - `mcp__claude_ai_Supabase__apply_migration` (name snake_case, body = SQL)
   - `mcp__claude_ai_Supabase__execute_sql` (pgTAP inside a `BEGIN … ROLLBACK` envelope)
   - `mcp__claude_ai_Supabase__generate_typescript_types`
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
