-- 20260801000003_get_audit_logs_v3_date_range.sql
--
-- Audit Reports 2026-08-01, lot B (R-10).
--
-- Ni v1 ni v2 n'acceptaient de bornes temporelles : la page Audit Log n'offrait
-- qu'acteur / action / type d'entite, en pagination curseur, sur une table qui
-- compte deja plusieurs milliers de lignes. Chercher « ce qui s'est passe la
-- semaine derniere » imposait de derouler « Load more » jusqu'a y arriver.
--
-- v3 = v2 + p_date_start / p_date_end, exprimes en dates METIER (YYYY-MM-DD) et
-- resolus dans business_config.timezone comme le reste du module — pas en UTC,
-- qui est precisement l'erreur corrigee par 20260801000002.
--
-- Les deux nouveaux parametres sont en fin de signature avec DEFAULT NULL :
-- les appelants existants (useProductAuditLog, useSettingsHistory) passent des
-- arguments nommes et n'ont donc qu'a viser v3.
--
-- NOTE DE PERIMETRE — v3 reproduit VOLONTAIREMENT la posture de securite de v2 :
-- SECURITY INVOKER, aucun gate has_permission, EXECUTE a authenticated. La
-- protection reelle vient de la RLS de audit_logs (policy admin_read, restreinte
-- a ADMIN/SUPER_ADMIN). L'audit a releve cette absence de gate (constat R-07) et
-- son arbitrage appartient au lot C / skill security-auth : durcir ici, en
-- passant, changerait le comportement d'un ecran hors du perimetre de ce lot.

CREATE OR REPLACE FUNCTION public.get_audit_logs_v3(
  p_cursor      TIMESTAMPTZ DEFAULT NULL,
  p_limit       INTEGER     DEFAULT 50,
  p_actor_id    UUID        DEFAULT NULL,
  p_action      TEXT        DEFAULT NULL,
  p_entity_type TEXT        DEFAULT NULL,
  p_entity_id   UUID        DEFAULT NULL,
  p_date_start  TEXT        DEFAULT NULL,
  p_date_end    TEXT        DEFAULT NULL
)
RETURNS TABLE(
  id          BIGINT,
  actor_id    UUID,
  action      TEXT,
  entity_type TEXT,
  entity_id   UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  bounds AS (
    SELECT
      CASE WHEN p_date_start IS NULL THEN NULL
           ELSE (p_date_start::date + TIME '00:00') AT TIME ZONE (SELECT tz FROM cfg)
      END AS lo,
      CASE WHEN p_date_end IS NULL THEN NULL
           ELSE ((p_date_end::date + 1) + TIME '00:00') AT TIME ZONE (SELECT tz FROM cfg)
      END AS hi
  )
  SELECT
    al.id,
    al.actor_id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.metadata,
    al.created_at
  FROM audit_logs al, bounds b
  WHERE (p_cursor IS NULL OR al.created_at < p_cursor)
    AND (p_actor_id IS NULL OR al.actor_id = p_actor_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    AND (b.lo IS NULL OR al.created_at >= b.lo)
    AND (b.hi IS NULL OR al.created_at <  b.hi)
  ORDER BY al.created_at DESC, al.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$function$;

COMMENT ON FUNCTION public.get_audit_logs_v3(TIMESTAMPTZ, INTEGER, UUID, TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Cursor-paginated audit trail. p_date_start/p_date_end are BUSINESS dates '
  '(YYYY-MM-DD) resolved in business_config.timezone, half-open [start, end+1day). '
  'SECURITY INVOKER: access is governed by the audit_logs RLS policy.';

-- REVOKE pair (S25 canonical pattern) : anon herite EXECUTE via PUBLIC, donc
-- REVOKE ... FROM anon seul est insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_audit_logs_v3(TIMESTAMPTZ, INTEGER, UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_logs_v3(TIMESTAMPTZ, INTEGER, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- Versioning monotone : v2 droppee dans la meme migration. v1 survivait a cote
-- de v2 (elle n'avait jamais ete droppee lors du bump v1 -> v2) et son unique
-- appelant, la page Audit Log, passe a v3 : on la retire aussi.
DROP FUNCTION IF EXISTS public.get_audit_logs_v2(TIMESTAMPTZ, INTEGER, UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_audit_logs_v1(TIMESTAMPTZ, INTEGER, UUID, TEXT, TEXT);
