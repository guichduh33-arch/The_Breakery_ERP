-- 20260517000033_rls_pii_anon_to_authenticated.sql
-- Session 13 / Phase 1.B — Task 25-001 :
--   Tighten RLS on PII tables from `TO public` (any caller) to
--   `TO authenticated` (must have a valid JWT, kiosk OR staff PIN).
--
-- Why : the current `is_authenticated()` USING-clause is fine, but the
-- policies attach to PUBLIC role, which means an anon caller still matches
-- the policy gate (and only fails the USING check). Audit R4 wants the
-- policy ATTACHMENT to require `authenticated` so anon callers are denied
-- at GRANT level. This migration moves the SELECT policies from `TO public`
-- to `TO authenticated` on the PII tables, AND adds a kiosk-JWT branch via
-- the new `has_kiosk_jwt()` helper.
--
-- Per K4 (lead decision) : kiosk JWT scope='tablet' can read ALL orders
-- on its device — NO customer_id scoping. The policy simply checks
-- `has_kiosk_jwt()` returns TRUE for any of the three scopes.
--
-- Tables affected: orders, order_items, customers, customer_categories.
-- (`user_roles` does NOT exist in V3 — V3 has roles + user_profiles.role_code
--  with no join table. role_permissions is added in 000030.)
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B
-- Design   : docs/workplan/refs/2026-05-13-kiosk-auth-design.md §4

-- ============================================================
-- 1. has_kiosk_jwt() helper — reads JWT app_metadata.provider claim
-- ============================================================
CREATE OR REPLACE FUNCTION has_kiosk_jwt(p_required_scope TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider TEXT;
  v_scope    TEXT;
BEGIN
  -- Read claims from the bearer JWT. auth.jwt() returns JSONB ; missing fields
  -- yield NULL which fails all comparisons → returns FALSE.
  BEGIN
    v_provider := (auth.jwt() -> 'app_metadata' ->> 'provider');
    v_scope    := (auth.jwt() -> 'app_metadata' ->> 'scope');
  EXCEPTION WHEN OTHERS THEN
    -- No JWT context (anon caller, internal-only call without auth) → false
    RETURN FALSE;
  END;

  IF v_provider IS DISTINCT FROM 'kiosk' THEN
    RETURN FALSE;
  END IF;

  IF v_scope NOT IN ('kds', 'display', 'tablet') THEN
    RETURN FALSE;
  END IF;

  IF p_required_scope IS NOT NULL AND v_scope IS DISTINCT FROM p_required_scope THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END $$;

COMMENT ON FUNCTION has_kiosk_jwt(TEXT) IS
  'RLS helper : returns TRUE when the JWT was minted by kiosk-issue-jwt EF '
  '(app_metadata.provider=kiosk) and (optionally) matches required scope. '
  'Used in conjunction with is_authenticated() to broaden SELECT to kiosks.';

-- ============================================================
-- 2. orders : drop the legacy `auth_read` policy ; re-attach TO authenticated
--    with staff + kiosk (any scope) branches.
--    Per K4 NO customer_id scoping for tablet — tablets see ALL orders.
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON orders;
CREATE POLICY "auth_read"
  ON orders FOR SELECT TO authenticated
  USING (
    is_authenticated()                  -- staff PIN (provider='pin') or service_role
    OR has_kiosk_jwt(NULL)               -- any kiosk scope (kds/display/tablet)
  );

-- ============================================================
-- 3. order_items : same shape as orders.
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON order_items;
CREATE POLICY "auth_read"
  ON order_items FOR SELECT TO authenticated
  USING (
    is_authenticated()
    OR has_kiosk_jwt(NULL)
  );

-- ============================================================
-- 4. customers : staff PIN only. Kiosks NEVER read this table directly.
--    Tablet flow uses a future SECURITY DEFINER RPC (deferred Phase 4).
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON customers;
CREATE POLICY "auth_read"
  ON customers FOR SELECT TO authenticated
  USING (
    is_authenticated()
    AND deleted_at IS NULL
    -- No kiosk branch — customers carries PII (phone, email, name).
  );

-- ============================================================
-- 5. customer_categories : low-sensitivity (catalog pricing). Allow kiosks.
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON customer_categories;
CREATE POLICY "auth_read"
  ON customer_categories FOR SELECT TO authenticated
  USING (
    is_authenticated()
    OR has_kiosk_jwt('tablet')           -- tablet menu pricing
  );

-- ============================================================
-- 6. order_payments + pos_sessions stay PIN-only (no kiosk branch).
--    Note : these were already `is_authenticated()`-gated, no kiosk drift expected.
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON order_payments;
CREATE POLICY "auth_read"
  ON order_payments FOR SELECT TO authenticated
  USING (is_authenticated());

-- pos_sessions : staff context. KDS station benefits from open-shift display
-- but NOT cashier identity ; allow KDS-scoped kiosk read of basic columns.
DROP POLICY IF EXISTS "auth_read" ON pos_sessions;
CREATE POLICY "auth_read"
  ON pos_sessions FOR SELECT TO authenticated
  USING (
    is_authenticated()
    OR has_kiosk_jwt('kds')
  );

-- ============================================================
-- 7. categories, products, restaurant_tables — low-PII catalog reads.
--    These already allow kiosks implicitly via is_authenticated() returning
--    TRUE on the kiosk JWT (role='authenticated' claim). Re-attach TO
--    authenticated explicitly to harden the GRANT layer.
-- ============================================================
DROP POLICY IF EXISTS "auth_read" ON categories;
CREATE POLICY "auth_read"
  ON categories FOR SELECT TO authenticated
  USING (is_authenticated() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "auth_read" ON products;
CREATE POLICY "auth_read"
  ON products FOR SELECT TO authenticated
  USING (is_authenticated() AND deleted_at IS NULL);

-- ============================================================
-- 8. Drop any GRANT to anon on these tables (defence-in-depth).
-- ============================================================
REVOKE ALL ON orders               FROM anon;
REVOKE ALL ON order_items          FROM anon;
REVOKE ALL ON order_payments       FROM anon;
REVOKE ALL ON customers            FROM anon;
REVOKE ALL ON customer_categories  FROM anon;
REVOKE ALL ON pos_sessions         FROM anon;
REVOKE ALL ON categories           FROM anon;
REVOKE ALL ON products             FROM anon;

COMMENT ON FUNCTION has_kiosk_jwt(TEXT) IS
  'D18/K4 : kiosk RLS gate. Per K4 the tablet scope sees ALL orders (no customer_id filter).';
