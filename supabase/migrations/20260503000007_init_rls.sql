-- 20260503000007_init_rls.sql
-- Phase 2 / migration 8 : RLS sur toutes les tables public.*

-- ============================================================
-- ROLES + PERMISSIONS — lecture libre auth, écriture super-admin
-- ============================================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON roles FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON roles FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON permissions FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

-- ============================================================
-- USER PROFILES — lecture auth, écriture self ou users.update
-- ============================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON user_profiles FOR SELECT USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON user_profiles FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'users.create'));
CREATE POLICY "perm_update" ON user_profiles FOR UPDATE USING (
  auth_user_id = auth.uid()                        -- self
  OR has_permission(auth.uid(), 'users.update')
);

-- ============================================================
-- USER SESSIONS — own sessions only (Edge Functions bypassent via service_role)
-- ============================================================
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_sessions_read" ON user_sessions FOR SELECT USING (
  user_id IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
);
-- Pas de policy INSERT/UPDATE/DELETE → seul service_role peut écrire

-- ============================================================
-- CATEGORIES — lecture auth, écriture products.create/update
-- ============================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON categories FOR SELECT USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON categories FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'products.create'));
CREATE POLICY "perm_update" ON categories FOR UPDATE
  USING (has_permission(auth.uid(), 'products.update'));

-- ============================================================
-- PRODUCTS — lecture auth, écriture products.create/update
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON products FOR SELECT USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON products FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'products.create'));
CREATE POLICY "perm_update" ON products FOR UPDATE
  USING (has_permission(auth.uid(), 'products.update'));

-- ============================================================
-- POS SESSIONS — lecture auth, INSERT pos.session.open, UPDATE own ou close_other
-- ============================================================
ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON pos_sessions FOR SELECT USING (is_authenticated());
CREATE POLICY "perm_create" ON pos_sessions FOR INSERT
  WITH CHECK (
    has_permission(auth.uid(), 'pos.session.open')
    AND opened_by IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
  );
CREATE POLICY "perm_update" ON pos_sessions FOR UPDATE USING (
  (opened_by IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
    AND has_permission(auth.uid(), 'pos.session.close_own'))
  OR has_permission(auth.uid(), 'pos.session.close_other')
);

-- ============================================================
-- ORDERS, ORDER_ITEMS, ORDER_PAYMENTS — lecture auth, INSERT seulement via RPC SECURITY DEFINER
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON orders FOR SELECT USING (is_authenticated());
-- Pas de policy INSERT → seul le RPC complete_order_with_payment (SECURITY DEFINER) peut écrire
CREATE POLICY "perm_update" ON orders FOR UPDATE
  USING (has_permission(auth.uid(), 'pos.sale.update'));

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_items FOR SELECT USING (is_authenticated());

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_payments FOR SELECT USING (is_authenticated());

-- ============================================================
-- STOCK MOVEMENTS — lecture auth, INSERT seulement via RPC, jamais UPDATE
-- ============================================================
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON stock_movements FOR SELECT USING (is_authenticated());
-- Append-only via RPC

-- ============================================================
-- BUSINESS_CONFIG — lecture auth, écriture super-admin
-- ============================================================
ALTER TABLE business_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON business_config FOR SELECT USING (is_authenticated());
CREATE POLICY "super_admin_write" ON business_config FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code = 'SUPER_ADMIN')
);

-- ============================================================
-- ORDER_SEQUENCES — lecture auth, écriture via RPC seulement
-- ============================================================
ALTER TABLE order_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_sequences FOR SELECT USING (is_authenticated());

-- ============================================================
-- AUDIT_LOGS — lecture admin/super-admin, INSERT via RPC
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN'))
);
