-- 20260702000010_create_get_audit_logs_v2_rpc.sql
-- Product detail "History" tab — additive bump of get_audit_logs_v1.
--
-- v1 (20260517000076) could not filter by a specific entity *id*, only by
-- entity_type. The product History tab needs the change-log of ONE product
-- (entity_type='product', entity_id=<product uuid>), so v2 adds an optional
-- `p_entity_id UUID` predicate. Everything else is identical to v1.
--
-- v2 is ADDITIVE — v1 keeps its existing consumer (the reports Audit Log page).
-- SECURITY INVOKER is preserved: the function inherits the `audit_logs`
-- admin_read RLS (ADMIN / SUPER_ADMIN), so a MANAGER sees an empty trail —
-- same posture as the existing reports audit page.

CREATE OR REPLACE FUNCTION public.get_audit_logs_v2(
  p_cursor       TIMESTAMPTZ DEFAULT NULL,
  p_limit        INT         DEFAULT 50,
  p_actor_id     UUID        DEFAULT NULL,
  p_action       TEXT        DEFAULT NULL,
  p_entity_type  TEXT        DEFAULT NULL,
  p_entity_id    UUID        DEFAULT NULL
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
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
  ORDER BY al.created_at DESC, al.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.get_audit_logs_v2(TIMESTAMPTZ, INT, UUID, TEXT, TEXT, UUID) IS
  'Additive bump of get_audit_logs_v1: adds an optional p_entity_id filter for '
  'per-entity change-logs (e.g. the product detail History tab). Cursor-based, '
  'newest first, limit clamped to 1..200. SECURITY INVOKER — inherits audit_logs RLS.';
