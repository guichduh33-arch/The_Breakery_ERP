-- 20260517000030_refactor_has_permission.sql
-- Session 13 / Phase 1.B — D10 / Audit R14 :
--   Refactor has_permission() into a PURE LOOKUP function.
--
-- Replaces the CASE-WHEN hardcoded body (v1..v8 — 11 prior migrations
-- CREATE OR REPLACE'd this function) with a 4-tier decision:
--   1. Explicit user-level DENY override   → FALSE
--   2. Role-based GRANT (role_permissions) → TRUE
--   3. Explicit user-level GRANT override  → TRUE
--   4. Default DENY                        → FALSE
--
-- Companion: has_permission_for_profile() mirrors the same logic.
--
-- After this migration:
--   - New permissions = INSERT INTO permissions + INSERT INTO role_permissions
--   - NO migration may `CREATE OR REPLACE FUNCTION has_permission` again
--     (CI grep gate enforces this — see docs/workplan/refs/2026-05-13-has_permission-refactor-design.md §7)
--
-- Design ref : docs/workplan/refs/2026-05-13-has_permission-refactor-design.md
-- Spec ref   : docs/workplan/specs/2026-05-13-session-13-spec.md D10
-- Plan ref   : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B

-- ============================================================
-- 1. Tables : role_permissions + user_permission_overrides
-- ============================================================

-- role_permissions : role → permission grant matrix.
-- One row = one role can use one permission.
CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  is_granted      BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (role_code, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON role_permissions(role_code) WHERE is_granted = TRUE;
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm
  ON role_permissions(permission_code) WHERE is_granted = TRUE;

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- user_permission_overrides : per-user explicit GRANT or DENY beating role default.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  is_granted      BOOLEAN NOT NULL,                                   -- TRUE = GRANT, FALSE = DENY
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (user_profile_id, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_upo_expires
  ON user_permission_overrides(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 1.5. Canonical roles seed (defensive — supabase/seed.sql runs AFTER
--      migrations, so fresh CI Docker resets would FK-violate when the
--      role_permissions seeds below reference SUPER_ADMIN/ADMIN/MANAGER/
--      CASHIER. Idempotent ON CONFLICT — no-op on cloud where these rows
--      already exist. Hotfix 2026-05-16 (Session 15 supabase-tests CI gate).
-- ============================================================
INSERT INTO roles (code, name, description, is_system) VALUES
  ('SUPER_ADMIN', 'Super Admin', 'Accès complet système',                          true),
  ('ADMIN',       'Admin',       'Administration métier',                          true),
  ('MANAGER',     'Manager',     'Gestion opérationnelle (POS + produits)',        true),
  ('CASHIER',     'Cashier',     'Caissier — POS sale + open shift',               true),
  ('waiter',      'Waiter',      'Floor staff — capture orders on tablet',         false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 1.6. Defensive base permissions seed — same rationale as 1.5 (seed.sql
--      runs AFTER migrations). Section 3 below has MANAGER/CASHIER/waiter
--      role_permissions inserts that reference permission codes which are
--      seeded only in seed.sql on cloud. Idempotent — no-op on cloud.
-- ============================================================
INSERT INTO permissions (code, module, action, description) VALUES
  -- POS session + sale (canonical seed.sql)
  ('pos.session.open',         'pos',       'session.open',  'Ouvrir une session de caisse'),
  ('pos.session.close_own',    'pos',       'session.close', 'Clôturer sa propre session'),
  ('pos.session.close_other',  'pos',       'session.close', 'Clôturer la session d''un autre'),
  ('pos.session.view_all',     'pos',       'session.view',  'Voir toutes les sessions'),
  ('pos.sale.create',          'pos',       'sale.create',   'Encaisser une vente'),
  ('pos.sale.void',            'pos',       'sale.void',     'Annuler une vente'),
  ('pos.sale.update',          'pos',       'sale.update',   'Modifier une vente'),
  ('pos.sale.refund',          'pos',       'sale.refund',   'Refund une vente'),
  ('pos.sale.cancel_item',     'pos',       'sale.cancel',   'Annuler un item'),
  -- Catalog + customers + tables + combos
  ('products.read',            'products',  'read',          'Voir le catalogue'),
  ('products.create',          'products',  'create',        'Créer un produit'),
  ('products.update',          'products',  'update',        'Modifier un produit'),
  ('categories.read',          'categories','read',          'Voir les catégories'),
  ('categories.create',        'categories','create',        'Créer une catégorie'),
  ('categories.update',        'categories','update',        'Modifier une catégorie'),
  ('customers.read',           'customers', 'read',          'Voir les clients'),
  ('customers.create',         'customers', 'create',        'Créer un client'),
  ('customers.update',         'customers', 'update',        'Modifier un client'),
  ('tables.read',              'tables',    'read',          'Voir les tables'),
  ('tables.create',            'tables',    'create',        'Créer une table'),
  ('tables.update',            'tables',    'update',        'Modifier une table'),
  ('combos.read',              'combos',    'read',          'Voir les combos'),
  ('combos.create',            'combos',    'create',        'Créer un combo'),
  ('combos.update',            'combos',    'update',        'Modifier un combo'),
  -- Payments + sales + promotions + suppliers + loyalty
  ('payments.process',         'payments',  'process',       'Process payment at POS'),
  ('sales.create',             'sales',     'create',        'Create a tablet/floor order'),
  ('sales.discount',           'sales',     'discount',      'Manager discount verification'),
  ('promotions.read',          'promotions','read',          'Voir les promotions'),
  ('promotions.create',        'promotions','create',        'Créer une promotion'),
  ('promotions.update',        'promotions','update',        'Modifier une promotion'),
  ('suppliers.read',           'suppliers', 'read',          'Voir les fournisseurs'),
  ('suppliers.create',         'suppliers', 'create',        'Créer un fournisseur'),
  ('suppliers.update',         'suppliers', 'update',        'Modifier un fournisseur'),
  ('loyalty.read',             'loyalty',   'read',          'Voir loyalty data'),
  -- Inventory
  ('inventory.read',           'inventory', 'read',          'Voir le stock'),
  ('inventory.receive',        'inventory', 'receive',       'Receive stock'),
  ('inventory.waste',          'inventory', 'waste',         'Record waste'),
  ('inventory.transfer.create','inventory', 'transfer.create','Create stock transfer'),
  ('inventory.transfer.receive','inventory','transfer.receive','Receive stock transfer'),
  ('inventory.opname.create',  'inventory', 'opname.create', 'Create stock opname'),
  ('inventory.production.create','inventory','production.create','Record production batch')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. New permission rows (Session 13 module additions)
--    Inserted BEFORE function body so role_permissions seeds below resolve.
-- ============================================================
INSERT INTO permissions (code, module, action, description) VALUES
  -- rbac (RLS for role_permissions / user_permission_overrides tables)
  ('rbac.read',                 'rbac',        'read',   'Read RBAC config (roles, role_permissions, overrides).'),
  ('rbac.update',               'rbac',        'update', 'Mutate RBAC config (role grants, user overrides).'),

  -- accounting (Session 13 G1 — fondation accounting V3)
  ('accounting.read',           'accounting',  'read',   'Read GL accounts, journal entries, mappings.'),
  ('accounting.post',           'accounting',  'create', 'Post a journal entry.'),
  ('accounting.reverse',        'accounting',  'update', 'Reverse a journal entry.'),
  ('accounting.mapping.update', 'accounting',  'update', 'Edit accounting_mappings rows.'),
  ('accounting.period.close',   'accounting',  'update', 'Close / lock a fiscal_period.'),

  -- expenses (Session 13 G4)
  ('expenses.read',             'expenses',    'read',   'Read expense records.'),
  ('expenses.create',           'expenses',    'create', 'Create an expense.'),
  ('expenses.update',           'expenses',    'update', 'Edit an expense before approval.'),
  ('expenses.approve',          'expenses',    'update', 'Approve an expense (posts the JE).'),
  ('expenses.delete',           'expenses',    'delete', 'Delete / void an expense.'),

  -- cash_register (Session 13 G4 — shift close)
  ('cash_register.read',        'cash_register','read',  'Read cash register / shift data.'),
  ('cash_register.open',        'cash_register','create','Open a cash register shift.'),
  ('cash_register.close',       'cash_register','update','Close a cash register shift (posts variance JE).'),
  ('cash_register.adjust',      'cash_register','update','Manual cash adjustment within a shift.'),

  -- reports (Session 13 G5 — phase 6 cascade)
  ('reports.read',              'reports',     'read',   'Read standard reports (sales, inventory, accounting).'),
  ('reports.export',            'reports',     'create', 'Export a report (CSV/PDF).'),

  -- settings (Session 13 Phase 5 — module 19)
  ('settings.read',             'settings',    'read',   'Read business / app settings.'),
  ('settings.update',           'settings',    'update', 'Mutate business / app settings.'),
  ('settings.holidays.manage',  'settings',    'update', 'Manage holiday calendar.'),
  ('settings.kiosk.manage',     'settings',    'update', 'Pair / revoke kiosk devices.'),

  -- users (Session 13 Phase 5 — module 20 RBAC UI)
  ('users.read',                'users',       'read',   'Read user profiles.'),
  ('users.view_audit',          'users',       'read',   'Read audit logs (cross-user).'),

  -- kiosk (issuance audit gate — used by EFs)
  ('kiosk.issue',               'kiosk',       'create', 'Mint a kiosk JWT (EF kiosk-issue-jwt).'),

  -- audit_log (consumed by audit_logs RLS post-merge)
  ('audit_log.read',            'audit',       'read',   'Read forensic audit trail.')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. role_permissions seeds — derived from has_permission v8 body.
--    SUPER_ADMIN / ADMIN : grant EVERY existing permission.
--    MANAGER             : the v8 whitelist + Session 13 additions.
--    CASHIER             : minimal whitelist + payments.process.
--    waiter              : minimal whitelist (sales.create + products.read).
-- ============================================================

-- SUPER_ADMIN + ADMIN : all permissions
INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'SUPER_ADMIN', code, TRUE FROM permissions
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'ADMIN', code, TRUE FROM permissions
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- MANAGER : v8 whitelist + Session 13 (accounting.read, expenses.*, cash_register.*, reports.*, settings.read)
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  -- POS core (sessions, sales)
  ('MANAGER', 'pos.session.open',          TRUE),
  ('MANAGER', 'pos.session.close_own',     TRUE),
  ('MANAGER', 'pos.session.close_other',   TRUE),
  ('MANAGER', 'pos.session.view_all',      TRUE),
  ('MANAGER', 'pos.sale.create',           TRUE),
  ('MANAGER', 'pos.sale.void',             TRUE),
  ('MANAGER', 'pos.sale.update',           TRUE),
  ('MANAGER', 'pos.sale.refund',           TRUE),
  ('MANAGER', 'pos.sale.cancel_item',      TRUE),
  -- Catalog
  ('MANAGER', 'products.read',             TRUE),
  ('MANAGER', 'products.create',           TRUE),
  ('MANAGER', 'products.update',           TRUE),
  -- Payments / discounts
  ('MANAGER', 'payments.process',          TRUE),
  ('MANAGER', 'sales.discount',            TRUE),
  -- Promotions (no delete)
  ('MANAGER', 'promotions.read',           TRUE),
  ('MANAGER', 'promotions.create',         TRUE),
  ('MANAGER', 'promotions.update',         TRUE),
  -- BO CRUDs (no delete, no customer_categories, no discount_templates)
  ('MANAGER', 'categories.read',           TRUE),
  ('MANAGER', 'categories.create',         TRUE),
  ('MANAGER', 'categories.update',         TRUE),
  ('MANAGER', 'customers.read',            TRUE),
  ('MANAGER', 'customers.create',          TRUE),
  ('MANAGER', 'customers.update',          TRUE),
  ('MANAGER', 'tables.read',               TRUE),
  ('MANAGER', 'tables.create',             TRUE),
  ('MANAGER', 'tables.update',             TRUE),
  ('MANAGER', 'combos.read',               TRUE),
  ('MANAGER', 'combos.create',             TRUE),
  ('MANAGER', 'combos.update',             TRUE),
  ('MANAGER', 'suppliers.read',            TRUE),
  ('MANAGER', 'suppliers.create',          TRUE),
  ('MANAGER', 'suppliers.update',          TRUE),
  -- Loyalty
  ('MANAGER', 'loyalty.read',              TRUE),
  -- Inventory standard (no opname.finalize / production.delete / recipes.update / sections.update)
  ('MANAGER', 'inventory.read',            TRUE),
  ('MANAGER', 'inventory.receive',         TRUE),
  ('MANAGER', 'inventory.waste',           TRUE),
  ('MANAGER', 'inventory.transfer.create', TRUE),
  ('MANAGER', 'inventory.transfer.receive',TRUE),
  ('MANAGER', 'inventory.opname.create',   TRUE),
  ('MANAGER', 'inventory.production.create', TRUE),
  -- Session 13 additions (managerial visibility)
  ('MANAGER', 'accounting.read',           TRUE),
  ('MANAGER', 'expenses.read',             TRUE),
  ('MANAGER', 'expenses.create',           TRUE),
  ('MANAGER', 'expenses.update',           TRUE),
  ('MANAGER', 'expenses.approve',          TRUE),
  ('MANAGER', 'cash_register.read',        TRUE),
  ('MANAGER', 'cash_register.open',        TRUE),
  ('MANAGER', 'cash_register.close',       TRUE),
  ('MANAGER', 'cash_register.adjust',      TRUE),
  ('MANAGER', 'reports.read',              TRUE),
  ('MANAGER', 'reports.export',            TRUE),
  ('MANAGER', 'settings.read',             TRUE),
  ('MANAGER', 'users.read',                TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- CASHIER : minimal session + sale + payments + read inventory + read reports
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('CASHIER', 'pos.session.open',      TRUE),
  ('CASHIER', 'pos.session.close_own', TRUE),
  ('CASHIER', 'pos.sale.create',       TRUE),
  ('CASHIER', 'products.read',         TRUE),
  ('CASHIER', 'payments.process',      TRUE),
  ('CASHIER', 'cash_register.read',    TRUE),
  ('CASHIER', 'cash_register.open',    TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- waiter : minimal (tablet flow)
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('waiter', 'sales.create',   TRUE),
  ('waiter', 'products.read',  TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ============================================================
-- 4. Drop legacy bodies, recreate as PURE LOOKUP.
--    Both functions resolved by `(p_user_id UUID, p_permission TEXT) RETURNS BOOLEAN`.
--    Param names renamed (p_uid → p_user_id, p_perm → p_permission) for clarity ;
--    positional callers (auth.uid()-based RPCs) unaffected.
-- ============================================================

-- DROP FUNCTION removed 2026-05-16 (Session 15 CI gate fix) :
-- Fresh CI Docker has RLS policies on tables that depend on has_permission(uuid,text)
-- by the time this migration runs, so DROP errors with 2BP01. CREATE OR REPLACE
-- works only when param names stay the same — so we keep the canonical Session 12
-- names (p_uid, p_perm) here. Cloud V3 dev `ikcyvlovptebroadgtvd` already uses these
-- names (restored via execute_sql on 2026-05-16). No drift.

CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile_id UUID;
  v_role_code  TEXT;
BEGIN
  IF p_uid IS NULL OR p_perm IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id, role_code
    INTO v_profile_id, v_role_code
    FROM user_profiles
   WHERE auth_user_id = p_uid
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_profile_id IS NULL OR v_role_code IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Explicit user-level DENY override (beats everything, expiry-aware)
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_perm
       AND is_granted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Role-based grant (the 95% path)
  IF EXISTS (
    SELECT 1
      FROM role_permissions
     WHERE role_code = v_role_code
       AND permission_code = p_perm
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. User-level explicit GRANT (override role default deny, expiry-aware)
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_perm
       AND is_granted = TRUE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN TRUE;
  END IF;

  -- 4. Default DENY
  RETURN FALSE;
END $$;

COMMENT ON FUNCTION has_permission(UUID, TEXT) IS
  'LOCKED 2026-05-14 (Session 13 Phase 1.B). Lookup-pure: '
  'user_permission_overrides (DENY) > role_permissions > user_permission_overrides (GRANT) > FALSE. '
  'DO NOT CREATE OR REPLACE. New perms = INSERT INTO permissions + role_permissions.';

CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_code TEXT;
BEGIN
  IF p_profile_id IS NULL OR p_perm IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role_code
    INTO v_role_code
    FROM user_profiles
   WHERE id = p_profile_id
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_role_code IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Explicit DENY override
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = p_profile_id
       AND permission_code = p_perm
       AND is_granted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Role grant
  IF EXISTS (
    SELECT 1
      FROM role_permissions
     WHERE role_code = v_role_code
       AND permission_code = p_perm
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. User GRANT
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = p_profile_id
       AND permission_code = p_perm
       AND is_granted = TRUE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END $$;

COMMENT ON FUNCTION has_permission_for_profile(UUID, TEXT) IS
  'LOCKED 2026-05-14. Profile-id variant of has_permission(). Same lookup rules.';

-- ============================================================
-- 5. RLS on the two new tables (must come AFTER function recreate
--    because policies reference has_permission()).
-- ============================================================

-- role_permissions : ADMIN+ can read all; non-admin can only see their own role's grants.
CREATE POLICY "admin_read"
  ON role_permissions FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'rbac.read'));

CREATE POLICY "self_read"
  ON role_permissions FOR SELECT TO authenticated
  USING (
    role_code = (
      SELECT role_code FROM user_profiles
       WHERE auth_user_id = auth.uid()
         AND deleted_at IS NULL
    )
  );

REVOKE INSERT, UPDATE, DELETE ON role_permissions FROM authenticated;

-- user_permission_overrides : ADMIN+ read all; users read their own row only.
CREATE POLICY "admin_read"
  ON user_permission_overrides FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'rbac.read'));

CREATE POLICY "self_read"
  ON user_permission_overrides FOR SELECT TO authenticated
  USING (
    user_profile_id = (
      SELECT id FROM user_profiles
       WHERE auth_user_id = auth.uid()
         AND deleted_at IS NULL
    )
  );

REVOKE INSERT, UPDATE, DELETE ON user_permission_overrides FROM authenticated;

COMMENT ON TABLE role_permissions IS
  'Role → permission grant matrix. Writes via SECURITY DEFINER RPCs only.';
COMMENT ON TABLE user_permission_overrides IS
  'Per-user explicit GRANT/DENY beating role defaults. DENY wins over role.';
