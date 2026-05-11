-- 20260515000001_harden_customers_column_grants.sql
-- Session 12 hardening — column-level GRANT fix.
--
-- Session 12 shipped 20260514000002 with a column-level
-- `REVOKE UPDATE (loyalty_points, ...) ON customers FROM authenticated`.
-- Postgres column-REVOKE cannot subtract from a pre-existing table-level
-- GRANT — Supabase auto-grants `authenticated=arwdDxtm/postgres` to every
-- public table, so the REVOKE was a no-op. Any caller with the
-- `customers.update` RLS policy could `UPDATE customers SET loyalty_points = ...`
-- directly, bypassing the adjust_loyalty_points RPC, its perm gate, and
-- the loyalty_transactions ledger.
--
-- Fix : drop the table-level GRANT and re-grant only the writable columns.
-- Protected columns (loyalty_points, lifetime_points, total_spent,
-- total_visits, last_visit_at, deleted_at) are now mutable only by
-- SECURITY DEFINER RPCs that explicitly target them.
--
-- Auto-managed columns (id, created_at, updated_at) are not in the writable
-- set — id is PK, created_at is immutable, updated_at is set by the trigger
-- which runs as the table owner (postgres) and is not blocked by GRANTs.

REVOKE ALL ON customers FROM authenticated;

GRANT SELECT ON customers TO authenticated;

GRANT INSERT (name, phone, email, customer_type, category_id)
  ON customers TO authenticated;

GRANT UPDATE (name, phone, email, customer_type, category_id)
  ON customers TO authenticated;

-- Anon must remain locked out: no GRANT here. `auth_read` RLS already
-- requires is_authenticated(), but defense-in-depth at the role level
-- means anon cannot select PII columns even if a policy regresses.
REVOKE ALL ON customers FROM anon;

COMMENT ON TABLE customers IS
  'Customers v1 (retail only). Writable columns: name/phone/email/customer_type/category_id. '
  'Loyalty columns (loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at) '
  'are mutated only by SECURITY DEFINER RPCs (adjust_loyalty_points, complete_order_with_payment). '
  'deleted_at is mutated only by soft_delete_customer.';
