-- 20260621000018_gate_customers_read.sql
-- Session 37 / Wave C / Task C5 (DB-06) — ré-auteur de 20260619000043 dans le bloc S37
-- pour numérotation monotone (D7 : l'original n'a jamais été appliqué au cloud).
--
-- ⚠️ HARD CUTOVER — appliquer EN DERNIER, uniquement après que les 4+1 sites POS
-- (Pos.tsx searchCustomers/createCustomer inline, useCustomerSearch, useCreateCustomer,
-- useRestoreHeldOrder re-fetch, useOutstandingDebts) consomment les RPCs v2
-- (search_customers_v2 / get_customer_v2 / create_customer_v2 / get_pos_b2b_debts_v1)
-- et que le POS est rebuild/redeployé. Pattern S25 refund cutover, operator-driven.
--
-- Effet :
--   1. Gate la policy SELECT de customers derrière `customers.read` — ferme le canal
--      de lecture PII ouvert (n'importe quel rôle authenticated pouvait
--      SELECT * FROM customers : phones, emails, birth_dates).
--   2. Grant customers.read aux rôles management BO uniquement (MANAGER/ADMIN/
--      SUPER_ADMIN). Les rôles POS/waiter passent par les RPCs definer v2.

ALTER POLICY auth_read ON public.customers
  USING (has_permission(auth.uid(), 'customers.read') AND deleted_at IS NULL);

INSERT INTO public.role_permissions (role_code, permission_code, is_granted)
SELECT r.code, 'customers.read', true
FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;
