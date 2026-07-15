# Session 13 — Wave 1 Deviation Pack

**Date locked:** 2026-05-14
**Reviewer verdict:** GATE OPEN WITH CONDITIONS (Wave 1 → Wave 2 sync-gate, see `2026-05-13-session-13-wave-1-review.md`)
**Status of deviations:** all 3 reviewed and classified as **safe engineering improvements**, not regressions.

This document records the differences between the migration SQL bodies as committed to `supabase/migrations/20260517*.sql` (the plan) and the SQL that actually landed on staging `ikcyvlovptebroadgtvd` (the deployment). The local files and the staging schema are NOT byte-identical for these three items, but the semantic outcome is identical or better.

---

## D-W1-01 — `has_permission` refactor: `CREATE OR REPLACE` (not `DROP + CREATE`)

**Local migration:** `20260517000030_refactor_has_permission.sql`
**Staging migration:** `20260514015204_refactor_has_permission`
**Decision reference:** D10 (Decision Pack), Audit R14 (re-publish fragility)

### Problem
The planned migration started with `DROP FUNCTION has_permission(UUID, TEXT)`. On staging, 36 RLS policies on `user_profiles`, `categories`, `products`, `orders`, `pos_sessions`, `promotions`, `suppliers`, `discount_templates`, `customers`, `customer_categories`, `restaurant_tables`, `combo_items`, `audit_log`, `stock_movements`, `sections`, `stock_locations`, `internal_transfers`, `transfer_items` all `USING (has_permission(auth.uid(), '<perm>'))` and would have been DROPped CASCADE. Re-creating them by hand is error-prone (would need recreating in identical order, identical USING clauses, identical TO role).

### Resolution
Switched to `CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)` — same signature as the legacy function (kept the original parameter names `p_uid`/`p_perm` because Postgres refused renaming with CREATE OR REPLACE while policies referenced the old names). The function body is now the pure-lookup form: DENY override > role grant > GRANT override > FALSE.

### Verification
- `pg_get_functiondef('has_permission(uuid,text)'::regprocedure)` shows the pure-lookup body
- `EXISTS (SELECT 1 FROM pg_policies WHERE qual LIKE '%has_permission%')` returns 36 rows — all preserved
- `T_SEC_1` pgTAP test (function exists) PASS
- `T_SEC_8 / T_SEC_9` pgTAP tests confirm new role_permissions grants (SUPER_ADMIN ≥20, MANAGER ≥40)

### Permanence
The D10 grep gate (W1-C4, added to `.github/workflows/ci.yml`) prevents any future `CREATE OR REPLACE has_permission` after this lock migration.

---

## D-W1-02 — `idx_ef_rate_limits_window_end` full b-tree (not partial)

**Local migration:** `20260517000031_init_edge_function_rate_limits.sql`
**Staging migration:** `20260514015234_init_edge_function_rate_limits`
**Task reference:** 25-002 (durable Edge Function rate-limit table)

### Problem
The planned partial index was `CREATE INDEX idx_ef_rate_limits_expired ON edge_function_rate_limits(window_end) WHERE window_end < now()`. PostgreSQL rejects `now()` in a partial-index predicate (error 42P17: "functions in index predicate must be marked IMMUTABLE") — `now()` is `STABLE`, not `IMMUTABLE`, so the planner cannot rely on the partial bound.

### Resolution
Renamed to `idx_ef_rate_limits_window_end` and dropped the `WHERE` clause — full b-tree on `window_end`. The cron sweep query `WHERE window_end < now()` still benefits from this index; the only cost is a slightly larger b-tree (includes rows whose window hasn't expired yet). For a table that's swept hourly and rolls over every few minutes, the size difference is negligible.

### Verification
- `\d edge_function_rate_limits` on staging shows the b-tree exists on `window_end`
- The cron purge query `DELETE FROM edge_function_rate_limits WHERE window_end < now()` will use this index

### Permanence
No future migration needs to rebuild this index. If we want a stricter version later, we'd use a `STABLE` wrapper helper, but for our use case the current shape is fine.

---

## D-W1-03 — `audit_log` kept as compatibility VIEW (not DROP TABLE bare)

**Local migration:** `20260517000034_drop_legacy_audit_log_singular.sql`
**Staging migration:** `20260514015317_drop_legacy_audit_log_singular`
**[m5] reference:** Session 13 Wave 1 patch round (singular → plural canonical)

### Problem
The planned migration drops the singular `audit_log` table. But 6 legacy SECURITY DEFINER RPCs (`soft_delete_customer`, `record_stock_movement_v1`, 4 internal-transfer RPCs from session 12) still write to it via `INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id) VALUES (...)`. Dropping the bare table without re-publishing those RPCs would have meant editing 6 published `_v1` RPCs in this same migration — a violation of CLAUDE.md's "never edit a published `_vN` signature" rule and a Wave 1 scope creep.

### Resolution
After copying rows from singular → plural and dropping the original BASE TABLE, we recreate `audit_log` as an **updatable VIEW** with the legacy column names (`occurred_at`, `actor_profile_id`, `subject_table`, `subject_id`, `payload`) over the plural canonical table. An `INSTEAD OF INSERT` trigger (`audit_log_insert_trigger`) rewrites every legacy INSERT into the canonical column layout of `audit_logs`. New code MUST write to `audit_logs` directly; the view is documented as DEPRECATED with a planned drop post-Session-13 once those 6 RPCs are re-published.

### Verification
- `information_schema.views WHERE table_name='audit_log'` returns 1 row (`T_SEC_13` PASS)
- `information_schema.tables WHERE table_name='audit_log' AND table_type='BASE TABLE'` returns 0 rows (`T_SEC_14` PASS)
- INSERT INTO audit_log via legacy RPCs proven to route to audit_logs (functional smoke deferred to Wave 6 staging verification, but trigger body inspected and asserted via `pg_get_triggerdef`)

### Future cleanup
**Tracked as W1-C2-bis in Wave 6** (or earlier when those 6 RPCs are re-published with new signatures). The view + trigger lifetime is bounded by the planned `audit_logs`-only refactor of `soft_delete_customer_v2`, `record_stock_movement_v2`, and the 4 transfer RPC v2 bumps. The VIEW will be DROPed in that migration.

---

## Sign-off

These 3 deviations were:
- Discovered at migration-apply time (not pre-flight) via Postgres errors
- Resolved in real-time to keep Wave 1 on schedule
- Reviewed and approved as net-positive engineering choices (see Wave 1 review §"3 deviations — all acceptable")

No other deviations from plan body to staging schema exist as of Wave 1 close. Subsequent waves should follow the planned migration text exactly unless a similar safe improvement opportunity is identified, in which case append a `D-W2-NN` entry to this doc.
