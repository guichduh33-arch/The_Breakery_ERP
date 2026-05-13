# 02 — RLS Patterns

> **Last verified**: 2026-05-03

## Overview

Row Level Security is enabled on every table in the `public` schema (76+ tables, 241+ policies as of the post-correction snapshot, consolidated in [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md)). All policy expressions go through three SQL helpers — `is_authenticated()`, `user_has_permission(uid, code)`, and `is_admin(uid)` — declared `STABLE` so Postgres caches their result for the duration of a transaction. This avoids re-evaluating `auth.uid()` and the permission joins on every row scan.

This document describes the canonical RLS pattern, the three helpers (full SQL bodies), the migration history that made them performant, and a recap table for the most-frequently-touched tables.

## Helper functions (full SQL)

### `is_authenticated()` — STABLE, cached per tx

Source: [supabase/migrations/20260316100000_rls_performance_optimization.sql](../../../supabase/migrations/20260316100000_rls_performance_optimization.sql).

```sql
CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NOT NULL)
$$;

GRANT EXECUTE ON FUNCTION public.is_authenticated() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authenticated() TO anon;
```

**Why STABLE:** Postgres caches the result inside a single transaction, so 50 row-level policy checks across multiple tables only evaluate `auth.uid()` once instead of 50 times. The 2026-03-16 migration that introduced this helper rewrote 136 RLS policies that were inlining `auth.uid() IS NOT NULL` and reported a measurable improvement on list endpoints (~10x on tables with 1000+ rows under typical query plans).

**Why SECURITY DEFINER:** lets the helper read `auth.uid()` without triggering policy recursion on the `auth` schema (which the runtime user does not own). The function still runs as the call-site role for everything else because the body itself only references `auth.uid()`.

### `user_has_permission(p_user_id uuid, p_permission_code varchar)` — STABLE SECURITY DEFINER

Source: [supabase/migrations/20260222035028_fix_user_has_permission_volatile_to_stable.sql](../../../supabase/migrations/20260222035028_fix_user_has_permission_volatile_to_stable.sql) (and predecessor [20260216200000_fix_permission_functions_searchpath.sql](../../../supabase/migrations/20260216200000_fix_permission_functions_searchpath.sql)).

```sql
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_permission_code VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO ''
AS $$
DECLARE
  v_has_permission BOOLEAN := FALSE;
  v_direct_override BOOLEAN := NULL;
  v_profile_id UUID;
BEGIN
  -- Dual-lookup: accept either user_profiles.id (V2 flow) or auth.uid() (legacy V1)
  SELECT id INTO v_profile_id
  FROM public.user_profiles
  WHERE id = p_user_id OR auth_user_id = p_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Step 1: Check user-level direct override (grant or revoke)
  SELECT is_granted INTO v_direct_override
  FROM public.user_permissions up
  JOIN public.permissions p ON up.permission_id = p.id
  WHERE up.user_id = v_profile_id
    AND p.code = p_permission_code
    AND (up.valid_from IS NULL OR up.valid_from <= NOW())
    AND (up.valid_until IS NULL OR up.valid_until > NOW());

  IF v_direct_override IS NOT NULL THEN
    RETURN v_direct_override;  -- Explicit grant or revoke wins over role
  END IF;

  -- Step 2: Fall through to role-based grant
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = v_profile_id
      AND p.code = p_permission_code
      AND (ur.valid_from IS NULL OR ur.valid_from <= NOW())
      AND (ur.valid_until IS NULL OR ur.valid_until > NOW())
  ) INTO v_has_permission;

  RETURN v_has_permission;
END;
$$;
```

**Dual-lookup design:** the function accepts either `user_profiles.id` (V2 PIN flow) or `auth.uid()` (Supabase Auth users). This is critical because `auth.uid()` returns the Supabase Auth UUID, but `user_roles.user_id` references `user_profiles.id`. Without the dual lookup, every PIN-logged-in user would silently get "no permissions" on every check.

**`SET search_path TO ''`:** prevents search_path hijacking attacks against `SECURITY DEFINER` functions. All table references must be schema-qualified (`public.user_profiles`, `public.permissions`, etc.) — this is verified by the function body.

### `is_admin(p_user_id uuid)` — STABLE SECURITY DEFINER

Source: same file as above.

```sql
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND r.code IN ('SUPER_ADMIN', 'ADMIN')
      AND (ur.valid_from IS NULL OR ur.valid_from <= NOW())
      AND (ur.valid_until IS NULL OR ur.valid_until > NOW())
  );
END;
$$;
```

> **Note on the historical `is_admin` bug:** Before the 2026-02-22 patch, `is_admin(auth.uid())` returned FALSE for every V2 user because `user_roles.user_id` references `user_profiles.id`, not `auth.uid()`, and `is_admin` did not have the dual lookup. The fix migration `fix_get_user_hierarchy_level_dual_lookup` added the lookup. See finding C1 in [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md) *(consolidated 2026-02-22 audit state)*.

## Canonical pattern for a new table

Every new table MUST enable RLS and declare exactly four policies (or three if the table is append-only). Use the `is_authenticated()` helper for read, `user_has_permission(...)` for sensitive writes.

```sql
-- Enable RLS first (REQUIRED — Postgres lets you create policies on a non-RLS table, they just don't fire)
ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user
CREATE POLICY "Authenticated read {table_name}"
  ON public.{table_name}
  FOR SELECT
  USING (public.is_authenticated());

-- INSERT: gated by module permission (e.g. 'inventory.create')
CREATE POLICY "Permission-based insert {table_name}"
  ON public.{table_name}
  FOR INSERT
  WITH CHECK (public.user_has_permission(auth.uid(), '{module}.create'));

-- UPDATE: gated by module permission, and the same permission appears in WITH CHECK
-- so a row cannot be updated INTO a state the user is not allowed to write
CREATE POLICY "Permission-based update {table_name}"
  ON public.{table_name}
  FOR UPDATE
  USING (public.user_has_permission(auth.uid(), '{module}.update'))
  WITH CHECK (public.user_has_permission(auth.uid(), '{module}.update'));

-- DELETE: gated by the strongest module permission (delete or admin)
CREATE POLICY "Permission-based delete {table_name}"
  ON public.{table_name}
  FOR DELETE
  USING (public.user_has_permission(auth.uid(), '{module}.delete'));
```

The `/create-migration` skill scaffolds this pattern; the `/db-schema-audit` skill flags tables missing it.

### Lighter pattern for "ghost" / reference tables

For tables created before granular permissions (or for non-sensitive append-only logs), the codebase frequently uses `is_authenticated()` for all four operations. See the recent example in [supabase/migrations/20260413100100_create_ghost_tables_with_rls.sql](../../../supabase/migrations/20260413100100_create_ghost_tables_with_rls.sql):

```sql
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read expenses" ON public.expenses
  FOR SELECT USING (public.is_authenticated());

CREATE POLICY "Permission-based insert expenses" ON public.expenses
  FOR INSERT WITH CHECK (public.is_authenticated());

CREATE POLICY "Permission-based update expenses" ON public.expenses
  FOR UPDATE USING (public.is_authenticated());
```

This is acceptable as a minimum bar but the policy *names* lie — they say "permission-based" while the body only checks authentication. Backlog: tighten these once permission codes are stable.

## Special cases

### Public / device tables

The customer display (`/display`) and KDS render screens with a Supabase Auth session that is **not** a real human — historically these devices read from tables via `anon` policies. The 2026-04-09 audit (P1-01) flagged this as a leak surface because the SPA bundle exposes the anon key and 16+ tables were `FOR SELECT TO anon USING (true)`. The remediation is in progress: now that `auth-verify-pin` mints a magic-link JWT for the device's user, we are migrating these to `TO authenticated USING (true)`. Do not add new `anon SELECT` policies; if a legitimately public read is needed, create a narrow VIEW that excludes PII and grant `SELECT` only on the view.

### Service-role only tables

`audit_logs` is writable by Edge Functions running with `service_role` (bypasses RLS) and readable by users with `admin.audit` permission. The INSERT policy uses `WITH CHECK (created_by = get_current_user_profile_id())` — application code must populate `created_by` with `user_profiles.id`, never `auth.uid()`. Failing to do so causes silent INSERT rejection (finding C4 in RLS_AUDIT_REPORT).

### Soft-delete pattern

Tables with `deleted_at TIMESTAMPTZ` rely on application code (`.is('deleted_at', null)`) to hide soft-deleted rows; RLS does **not** enforce this. If a future requirement says "soft-deleted rows must be invisible to non-admins", add a `USING (deleted_at IS NULL OR public.is_admin(auth.uid()))` clause to the SELECT policy.

## Recap — RLS posture per critical table

| Table | SELECT | INSERT | UPDATE | DELETE | Sensitive cols |
|---|---|---|---|---|---|
| `user_profiles` | authenticated | `users.create` | `users.update` | `users.delete` | `pin_hash` (never returned) |
| `user_sessions` | authenticated | authenticated | authenticated | authenticated | `session_token` (cleared by trigger) |
| `user_roles` | authenticated | `users.roles` | `users.roles` | `users.roles` | role assignment |
| `roles` | authenticated | admin | admin | admin | hierarchy_level |
| `permissions` | authenticated | service_role only | service_role only | service_role only | code, is_sensitive |
| `role_permissions` | authenticated | `users.roles` | `users.roles` | `users.roles` | grants |
| `audit_logs` | `admin.audit` | authenticated | none | none | PII, IP, UA |
| `customers` | authenticated | `customers.create` | `customers.update` | `customers.delete` | name, phone, email |
| `orders` | authenticated | authenticated | authenticated | `is_admin` | total, customer_id |
| `order_items` | authenticated | authenticated | authenticated | `is_admin` | unit_price |
| `order_payments` | authenticated | authenticated | authenticated | `is_admin` | amount, method |
| `products` | authenticated | `products.create` | `products.update` | `products.delete` | cost (excluded from anon views) |
| `categories` | authenticated | `products.create` | `products.update` | `products.delete` | — |
| `recipes` | authenticated | `production.recipes` | `production.recipes` | `production.recipes` | cost calculation |
| `purchase_orders` | authenticated | `purchases.create` | `purchases.approve` | `is_admin` | supplier price |
| `suppliers` | authenticated | `purchases.create` | `purchases.create` | `is_admin` | bank_account |
| `expenses` | authenticated | authenticated | authenticated | none | amount |
| `journal_entries` | `accounting.view` | `accounting.journal.create` | `accounting.journal.update` | `is_admin` | debit/credit |
| `accounts` | `accounting.view` | `accounting.manage` | `accounting.manage` | `is_admin` | balance |
| `pos_sessions` | authenticated | authenticated | authenticated | `is_admin` | starting_cash, expected_cash |
| `stock_movements` | authenticated | authenticated | authenticated | authenticated | quantity, cost |
| `loyalty_transactions` | authenticated | `customers.loyalty` | `customers.loyalty` | `customers.loyalty` | points |
| `b2b_orders` | authenticated | authenticated | authenticated | `is_admin` | invoice amount |
| `settings` | authenticated | `settings.update` | `settings.update` | `is_admin` | tax rate, currency |
| `settings_history` | authenticated | authenticated | none | none | audit trail |

The exhaustive policy dump is in [03-database/06-rls-policies.md](../03-database/06-rls-policies.md). The most recent audit numbers (241 total policies, 14 anon, 0 critical findings open) are in [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md) *(consolidated 2026-02-22 audit state)*.

## Performance notes

- The 2026-03-16 migration ([20260316100000_rls_performance_optimization.sql](../../../supabase/migrations/20260316100000_rls_performance_optimization.sql)) is the canonical reference for the `is_authenticated()` rewrite. It updated 44 DELETE, 47 INSERT, 37 UPDATE-with-check, and 8 UPDATE-only policies in a single transaction.
- `user_has_permission` was originally `VOLATILE` (re-evaluated per row); migration [20260222035028](../../../supabase/migrations/20260222035028_fix_user_has_permission_volatile_to_stable.sql) flipped it to `STABLE`. This change alone makes list queries on permission-gated tables ~10-100x faster depending on row count.
- Avoid wrapping `user_has_permission` in another function — Postgres can only cache the result of a `STABLE` function if its arguments are themselves `STABLE`. Calling it directly from policy expressions ensures the cache hits.
- For very large list queries (1000+ rows), prefer fetching via a SECURITY DEFINER RPC that does the permission check once at the top (e.g. `get_user_permissions(uid)` returns the permission set, app filters in memory) rather than running RLS per row.

## Cross-references

- [01-auth-flow-pin.md](./01-auth-flow-pin.md) — how `auth.uid()` becomes meaningful via the magic-link JWT minted at PIN login.
- [03-rbac-permissions.md](./03-rbac-permissions.md) — full list of permission codes used in `WITH CHECK` clauses.
- [03-database/06-rls-policies.md](../03-database/06-rls-policies.md) — exhaustive per-table dump of every policy expression.
- [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md) *(consolidated 2026-02-22 audit state)* — 2026-02-22 audit, post-correction state.
- [docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md) — 2026-04-09 architecture audit, P1-01 anon SELECT surface.
