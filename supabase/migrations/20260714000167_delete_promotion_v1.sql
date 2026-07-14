-- S78 (F-1) — delete_promotion_v1 : le soft-delete des promotions par UPDATE
-- direct est CASSÉ en live (42501 « new row violates row-level security ») :
-- le moteur applique la policy SELECT auth_read (deleted_at IS NULL) au NEW
-- row de l'UPDATE — la ligne soft-deleted devient invisible à son propre
-- writer. Personne (même SUPER_ADMIN) ne peut donc soft-deleter via PostgREST,
-- et le BO (useDeletePromotion) faisait exactement cet UPDATE.
--
-- Fix conforme à la doctrine projet (writes via RPC SECURITY DEFINER) :
-- delete_promotion_v1 gatée `promotions.delete` (ADMIN/SUPER_ADMIN — ce qui
-- ferme au passage le finding session 9 « MANAGER peut soft-deleter par
-- OR-merge des policies UPDATE » : la RPC applique le gate voulu par le spec
-- §3.5). Idempotente : re-suppression → enveloppe idempotent_replay=true.

CREATE OR REPLACE FUNCTION public.delete_promotion_v1(p_promotion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_profile_id UUID;
  v_promo      promotions%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'promotions.delete') THEN
    RAISE EXCEPTION 'Permission denied: promotions.delete' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo FROM promotions WHERE id = p_promotion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion % not found', p_promotion_id USING ERRCODE = 'P0002';
  END IF;

  IF v_promo.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'promotion_id',      v_promo.id,
      'deleted_at',        v_promo.deleted_at,
      'idempotent_replay', true
    );
  END IF;

  UPDATE promotions
     SET deleted_at = now(), is_active = false
   WHERE id = p_promotion_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'promotion.delete', 'promotion', p_promotion_id,
    jsonb_build_object('name', v_promo.name, 'slug', v_promo.slug, 'rpc_version', 'v1'));

  RETURN jsonb_build_object(
    'promotion_id',      p_promotion_id,
    'deleted_at',        now(),
    'idempotent_replay', false
  );
END;
$function$;

-- Anon defense-in-depth (S20) : REVOKE PUBLIC + anon, EXECUTE authenticated seulement.
REVOKE ALL ON FUNCTION public.delete_promotion_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_promotion_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_promotion_v1(uuid) TO authenticated;
