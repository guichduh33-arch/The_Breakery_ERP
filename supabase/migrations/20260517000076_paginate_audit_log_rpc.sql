-- 20260517000076_paginate_audit_log_rpc.sql
-- Session 13 / Phase 2.B / migration 7 :
--   - RPC `get_audit_logs_v1` : cursor-based pagination over the
--     `audit_logs` (plural) table. Replaces ad-hoc `LIMIT 5000` queries
--     (audit P2 finding 14-002).
--   - INSERT 4 new fine-grained permissions for the reports module
--     (reports.sales.read, reports.inventory.read, reports.audit.read,
--      reports.financial.read) and grant them to ADMIN + MANAGER roles.
--
-- The RPC SIGNATURE uses the real `audit_logs` columns
-- (entity_type / entity_id) — NOT the INDEX-suggested resource_*. Cf. the
-- Wave-2 deviations doc §1-§2.
--
-- Cursor pagination contract :
--   - Caller passes `p_cursor` = the `created_at` of the last row of the
--     previous page (or NULL for first page).
--   - Server returns up to `p_limit` rows STRICTLY OLDER than the cursor.
--   - Server clamps `p_limit` to LEAST(p_limit, 200) to bound load.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.F

-- ============================================================
-- 1) RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_logs_v1(
  p_cursor       TIMESTAMPTZ DEFAULT NULL,
  p_limit        INT         DEFAULT 50,
  p_actor_id     UUID        DEFAULT NULL,
  p_action       TEXT        DEFAULT NULL,
  p_entity_type  TEXT        DEFAULT NULL
)
RETURNS TABLE (
  id           BIGINT,
  actor_id     UUID,
  action       TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  metadata     JSONB,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    al.id,
    al.actor_id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.metadata,
    al.created_at
  FROM audit_logs al
  WHERE (p_cursor IS NULL OR al.created_at < p_cursor)
    AND (p_actor_id IS NULL OR al.actor_id = p_actor_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
  ORDER BY al.created_at DESC, al.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.get_audit_logs_v1(TIMESTAMPTZ, INT, UUID, TEXT, TEXT) IS
  'Phase 2.B — Cursor-based pagination over audit_logs (fix 14-002). Caller passes '
  'the created_at of the last row of the previous page. Limit clamped to 1..200.';

GRANT EXECUTE ON FUNCTION public.get_audit_logs_v1(TIMESTAMPTZ, INT, UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 2) New fine-grained reports permissions
-- ============================================================
-- INSERT only — has_permission() is NOT touched (Wave 1 CI gate).
INSERT INTO permissions (code, module, action, description) VALUES
  ('reports.sales.read',     'reports', 'sales.read',     'View sales-category reports (by hour, category, staff, etc.)'),
  ('reports.inventory.read', 'reports', 'inventory.read', 'View inventory-category reports (stock variance, low stock, etc.)'),
  ('reports.audit.read',     'reports', 'audit.read',     'View audit/logs-category reports (general audit log, void abuse, etc.)'),
  ('reports.financial.read', 'reports', 'financial.read', 'View finance & payments reports (P&L, cash variance, VAT, etc.)')
ON CONFLICT (code) DO NOTHING;

-- Grant to ADMIN + MANAGER (most permissive set). SUPER_ADMIN already
-- typically wildcards via override or pre-existing seed ; if not, the same
-- INSERT will still be a no-op when the user is super-admin (downstream
-- consumers check this perm and the role bypass).
INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at)
SELECT r.role_code, p.permission_code, TRUE, now()
FROM (VALUES ('ADMIN'), ('MANAGER'), ('SUPER_ADMIN')) AS r(role_code)
CROSS JOIN (VALUES
  ('reports.sales.read'),
  ('reports.inventory.read'),
  ('reports.audit.read'),
  ('reports.financial.read')
) AS p(permission_code)
ON CONFLICT (role_code, permission_code) DO NOTHING;
