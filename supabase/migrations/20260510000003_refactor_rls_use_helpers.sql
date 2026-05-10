-- 20260510000003_refactor_rls_use_helpers.sql
-- Session 8 — perf-debt fix D3 (policy refactor).
-- Drop + recreate des policies qui faisaient un sub-SELECT user_profiles per row,
-- les remplaçant par get_current_profile_id() / get_current_role() (STABLE, cached per query).
-- ISO-comportement — seuls les plans EXPLAIN devraient changer (Hash → cached function call).
--
-- Sub-SELECTs trouvés via grep (sessions 3 + 5) :
--   init_rls.sql        : roles (super_admin), permissions (super_admin), user_sessions (own),
--                         pos_sessions (perm_create + perm_update), business_config (super_admin),
--                         audit_logs (admin_read)
--   tablet_rls.sql      : orders.tablet_waiter_own_pending (waiter_id IN (SELECT id ...))
--   user_profiles.perm_update : laissé tel quel — `auth_user_id = auth.uid()` est déjà résolu
--                               directement par le moteur (pas de sub-SELECT).

-- ============================================================
-- ROLES — super_admin_write
-- ============================================================
DROP POLICY IF EXISTS "super_admin_write" ON roles;
CREATE POLICY "super_admin_write" ON roles FOR ALL
  USING (get_current_role() = 'SUPER_ADMIN');

-- ============================================================
-- PERMISSIONS — super_admin_write
-- ============================================================
DROP POLICY IF EXISTS "super_admin_write" ON permissions;
CREATE POLICY "super_admin_write" ON permissions FOR ALL
  USING (get_current_role() = 'SUPER_ADMIN');

-- ============================================================
-- USER_SESSIONS — own_sessions_read
-- ============================================================
DROP POLICY IF EXISTS "own_sessions_read" ON user_sessions;
CREATE POLICY "own_sessions_read" ON user_sessions FOR SELECT
  USING (user_id = get_current_profile_id());

-- ============================================================
-- POS_SESSIONS — perm_create + perm_update
-- ============================================================
DROP POLICY IF EXISTS "perm_create" ON pos_sessions;
CREATE POLICY "perm_create" ON pos_sessions FOR INSERT
  WITH CHECK (
    has_permission(auth.uid(), 'pos.session.open')
    AND opened_by = get_current_profile_id()
  );

DROP POLICY IF EXISTS "perm_update" ON pos_sessions;
CREATE POLICY "perm_update" ON pos_sessions FOR UPDATE USING (
  (opened_by = get_current_profile_id() AND has_permission(auth.uid(), 'pos.session.close_own'))
  OR has_permission(auth.uid(), 'pos.session.close_other')
);

-- ============================================================
-- BUSINESS_CONFIG — super_admin_write
-- ============================================================
DROP POLICY IF EXISTS "super_admin_write" ON business_config;
CREATE POLICY "super_admin_write" ON business_config FOR ALL
  USING (get_current_role() = 'SUPER_ADMIN');

-- ============================================================
-- AUDIT_LOGS — admin_read
-- ============================================================
DROP POLICY IF EXISTS "admin_read" ON audit_logs;
CREATE POLICY "admin_read" ON audit_logs FOR SELECT
  USING (get_current_role() IN ('SUPER_ADMIN', 'ADMIN'));

-- ============================================================
-- ORDERS — tablet_waiter_own_pending (session 5)
-- ============================================================
DROP POLICY IF EXISTS "tablet_waiter_own_pending" ON orders;
CREATE POLICY "tablet_waiter_own_pending" ON orders FOR SELECT
  USING (
    is_authenticated()
    AND created_via = 'tablet'
    AND status = 'pending_payment'
    AND (
      waiter_id = get_current_profile_id()
      OR has_permission(auth.uid(), 'payments.process')
    )
  );
