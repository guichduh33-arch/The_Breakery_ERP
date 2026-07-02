-- 20260710000088_drop_audit_log_compat_view.sql
-- S56 P2.2 : démantèlement de la couche compat S13 (20260517000034).
-- Zéro writer fonctionnel (cf. _087, assertion dure) et zéro lecteur runtime
-- (grep repo + live pg_proc) — la table audit_logs est désormais l'unique
-- surface de l'audit-trail. Les suites de tests qui lisaient la vue sont
-- migrées vers audit_logs dans le même changeset (S56).
DROP TRIGGER IF EXISTS audit_log_compat_insert ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_insert_trigger();
DROP VIEW IF EXISTS public.audit_log;

-- D7 (spec S56) : la dualité JSONB est volontaire et documentée — ne pas fusionner.
COMMENT ON COLUMN public.audit_logs.metadata IS
  'Free-form audit context (who/what/params). Target of the legacy compat-view payload mapping — all RPC writers write here.';
COMMENT ON COLUMN public.audit_logs.payload IS
  'Structured before/after diff (S19, 20260523000019). Distinct from metadata — do not fold.';
