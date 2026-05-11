-- 20260513000005_extend_rls_for_module_perms.sql
-- Session 11 — add the missing INSERT/UPDATE policies on entities the new
-- backoffice CRUDs need to write. Existing read policies stay untouched.
-- Multiple PG policies for the same row+command are OR'd, so adding new ones
-- never removes prior access.

-- categories: existing perm_create/update use 'products.create/update'. Add explicit
-- categories.* policies for the dedicated module perm.
DROP POLICY IF EXISTS "perm_create_module" ON categories;
CREATE POLICY "perm_create_module" ON categories FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'categories.create'));
DROP POLICY IF EXISTS "perm_update_module" ON categories;
CREATE POLICY "perm_update_module" ON categories FOR UPDATE
  USING (has_permission(auth.uid(), 'categories.update'));

-- customers: only had auth_read + auth_insert_retail (B2C self-create). Add manager CRUD.
DROP POLICY IF EXISTS "perm_create" ON customers;
CREATE POLICY "perm_create" ON customers FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'customers.create'));
DROP POLICY IF EXISTS "perm_update" ON customers;
CREATE POLICY "perm_update" ON customers FOR UPDATE
  USING (has_permission(auth.uid(), 'customers.update'));

-- customer_categories: only had auth_read. ADMIN+ for write.
DROP POLICY IF EXISTS "perm_create" ON customer_categories;
CREATE POLICY "perm_create" ON customer_categories FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'customer_categories.create'));
DROP POLICY IF EXISTS "perm_update" ON customer_categories;
CREATE POLICY "perm_update" ON customer_categories FOR UPDATE
  USING (has_permission(auth.uid(), 'customer_categories.update'));

-- restaurant_tables: only had auth_read. MANAGER+ for write.
DROP POLICY IF EXISTS "perm_create" ON restaurant_tables;
CREATE POLICY "perm_create" ON restaurant_tables FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'tables.create'));
DROP POLICY IF EXISTS "perm_update" ON restaurant_tables;
CREATE POLICY "perm_update" ON restaurant_tables FOR UPDATE
  USING (has_permission(auth.uid(), 'tables.update'));

-- combo_items: only had auth_read. MANAGER+ for write.
DROP POLICY IF EXISTS "perm_create" ON combo_items;
CREATE POLICY "perm_create" ON combo_items FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'combos.create'));
DROP POLICY IF EXISTS "perm_update" ON combo_items;
CREATE POLICY "perm_update" ON combo_items FOR UPDATE
  USING (has_permission(auth.uid(), 'combos.update'));

-- product_modifiers (session 2 / modifier groups): may need module CRUD too in future ;
-- v1 ships read-only on this table since modifier admin is not part of session 11.
