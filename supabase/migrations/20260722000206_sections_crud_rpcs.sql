-- ADR-007 décision 5 — l'écran Sections passe par des RPCs comme tout le reste.
--
-- useSectionsList.ts écrivait directement dans la table sections (seul écran
-- du domaine hors pattern RPC SECURITY DEFINER + audit_logs). Deux RPCs :
--   upsert_section_v1(p_payload)  — id présent = update, absent = insert
--   delete_section_v1(p_section_id) — soft-delete (deleted_at + is_active=false)
-- Gate : inventory.sections.update (déjà seedée ADMIN/SUPER_ADMIN — même gate
-- que l'UI SectionsPage). Les policies RLS d'écriture directe sont droppées
-- dans la même migration : la RPC devient l'unique chemin d'écriture.

CREATE FUNCTION public.upsert_section_v1(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id CONSTANT UUID := auth.uid();
  v_id UUID := NULLIF(p_payload->>'id', '')::UUID;
  v_code TEXT := upper(NULLIF(trim(p_payload->>'code'), ''));
  v_name TEXT := NULLIF(trim(p_payload->>'name'), '');
  v_kind TEXT := NULLIF(trim(p_payload->>'kind'), '');
  v_is_active BOOLEAN := COALESCE((p_payload->>'is_active')::BOOLEAN, true);
  v_display_order INTEGER := COALESCE((p_payload->>'display_order')::INTEGER, 0);
  v_row sections%ROWTYPE;
  v_action TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'inventory.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_kind IS NULL OR (v_id IS NULL AND v_code IS NULL) THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE = '22023',
      HINT = 'name, kind (and code on create) are required';
  END IF;
  IF v_kind NOT IN ('warehouse', 'production', 'sales') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023',
      HINT = 'kind must be warehouse | production | sales';
  END IF;
  IF v_display_order < 0 THEN
    RAISE EXCEPTION 'invalid_display_order' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    -- create (23505 naturel si code déjà pris)
    INSERT INTO sections (code, name, kind, is_active, display_order)
      VALUES (v_code, v_name, v_kind, v_is_active, v_display_order)
      RETURNING * INTO v_row;
    v_action := 'section.create';
  ELSE
    -- update — le code est immuable (le formulaire le fige aussi) : ignoré.
    UPDATE sections
       SET name = v_name, kind = v_kind, is_active = v_is_active,
           display_order = v_display_order, updated_at = now()
     WHERE id = v_id AND deleted_at IS NULL
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_action := 'section.update';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, v_action, 'section', v_row.id, p_payload,
            jsonb_build_object('code', v_row.code));

  RETURN to_jsonb(v_row);
END $function$;

CREATE FUNCTION public.delete_section_v1(p_section_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id CONSTANT UUID := auth.uid();
  v_row sections%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'inventory.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE sections
     SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE id = p_section_id AND deleted_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'section.delete', 'section', p_section_id,
            jsonb_build_object('soft_delete', true),
            jsonb_build_object('code', v_row.code));

  RETURN jsonb_build_object('section_id', p_section_id, 'deleted', true);
END $function$;

-- REVOKE trio (anon defense-in-depth) + grants appelants légitimes.
REVOKE EXECUTE ON FUNCTION public.upsert_section_v1(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_section_v1(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_section_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_section_v1(UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_section_v1(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_section_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_section_v1(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_section_v1(UUID) TO service_role;

-- Fermeture du chemin d'écriture directe : la RPC est désormais l'unique
-- voie (SECURITY DEFINER). La policy SELECT auth_read reste inchangée.
DROP POLICY perm_write_insert ON public.sections;
DROP POLICY perm_write_update ON public.sections;
