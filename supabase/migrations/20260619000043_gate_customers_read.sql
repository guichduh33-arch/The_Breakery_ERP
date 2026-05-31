-- 20260619000043_gate_customers_read.sql
-- Security hardening FINALIZER (security-fraud-guard gap 4, checklist D).
--
-- ⚠️ DEFERRED — DO NOT APPLY until the POS app's customer reads are fully migrated
-- off the direct `customers` SELECT and onto the definer RPCs (search_customers_v1
-- / get_customer_v1 / create_customer_v1 / get_pos_b2b_debts_v1 — migrations _040 /
-- _042), THEN rebuilt and redeployed. Flipping this policy is a HARD CUTOVER: the
-- currently-deployed POS reads `customers` directly and would break the moment this
-- lands. Same pattern as the S25 refund PIN header cutover, operator-driven.
--
-- ⚠️ Prerequisite NOT yet done (S34 partial): the POS still has 3 direct customer
-- reads to migrate first —
--   • apps/pos/src/pages/Pos.tsx  searchCustomers/createCustomer (inline)
--   • apps/pos/src/features/customers/hooks/useCustomerSearch.ts
--   • apps/pos/src/features/customers/hooks/useCreateCustomer.ts
--   • apps/pos/src/features/customers/hooks/useOutstandingDebts.ts (orders→customer embed)
-- These need the customer-category embed (customer_categories) for POS pricing,
-- which search_customers_v1 does NOT return — so the migration is non-trivial:
-- either extend search_customers_v1 to join customer_categories, or fetch the
-- category separately. Bundle that work + this gate as one cutover.
--
-- What it does once applied:
--   1. Gate the customers SELECT policy behind `customers.read`, closing the open
--      PII read channel (any authenticated role could `SELECT * FROM customers`).
--   2. Grant customers.read to BackOffice management roles only (MANAGER/ADMIN/
--      SUPER_ADMIN). POS/waiter roles use the narrow definer RPCs instead.
--
-- role_permissions schema on this project is (role_code, permission_code,
-- is_granted, granted_at, granted_by) — NOT (role_id, permission_id). The
-- customers.read permission row already exists in `permissions`.
--
-- Verified before authoring: no PostgREST customer EMBED remains in the POS after
-- the _040/_042 hook migrations (useOutstandingDebts moved to get_pos_b2b_debts_v1).
-- BackOffice keeps direct customers reads, now authorized by customers.read.
-- The BO useOrderDetail embed `customers(name)` runs with a MANAGER+ session that
-- holds customers.read, so it remains valid.

ALTER POLICY auth_read ON public.customers
  USING (has_permission(auth.uid(), 'customers.read') AND deleted_at IS NULL);

INSERT INTO public.role_permissions (role_code, permission_code, is_granted)
SELECT r.code, 'customers.read', true
FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;
