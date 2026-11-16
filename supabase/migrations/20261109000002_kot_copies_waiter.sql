-- 20261109000002_kot_copies_waiter.sql
-- S1-22 (décision du propriétaire, 2026-11-09) : le nombre de copies du ticket
-- serveur (récapitulatif de commande imprimé sur l'imprimante 'waiter' à
-- l'envoi en cuisine) devient un réglage, comme les copies KOT par station.
-- Défaut 1, plage [0, 5], 0 = pas de papier.
--
-- Additif uniquement : set_setting_v13 / get_settings_by_category_v10 NE sont
-- PAS bumpées (le bundle POS LAN, mis à jour à la main, les appelle encore ;
-- un bump devrait les DROPer). L'écriture passe par une RPC étroite qui ne
-- touche que cette colonne ; autorisation, codes d'erreur et audit sont ceux
-- de la branche kot_copies_* de set_setting_v13.

ALTER TABLE public.business_config
  ADD COLUMN kot_copies_waiter INTEGER NOT NULL DEFAULT 1
    CONSTRAINT business_config_kot_copies_waiter_range CHECK (kot_copies_waiter BETWEEN 0 AND 5);

COMMENT ON COLUMN public.business_config.kot_copies_waiter IS
  'Copies du ticket serveur (imprimante waiter) à l''envoi en cuisine. Entier [0, 5], défaut 1 ; 0 = pas d''impression.';

CREATE OR REPLACE FUNCTION public.set_kot_copies_waiter_v1(p_copies integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_old      JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'settings.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor_id
    FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
    LIMIT 1;

  IF p_copies IS NULL THEN
    RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_waiter expects integer';
  END IF;
  IF p_copies < 0 OR p_copies > 5 THEN
    RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_waiter must be an integer in [0, 5]';
  END IF;

  SELECT to_jsonb(kot_copies_waiter) INTO v_old FROM business_config WHERE id = 1;
  UPDATE business_config SET kot_copies_waiter = p_copies, updated_at = now() WHERE id = 1;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_actor_id,
      'setting.update',
      'setting',
      NULL,
      jsonb_build_object(
        'key',      'kot_copies_waiter',
        'category', 'printing',
        'old',      COALESCE(v_old, 'null'::jsonb),
        'new',      to_jsonb(p_copies)
      )
    );
END;
$function$;

COMMENT ON FUNCTION public.set_kot_copies_waiter_v1(integer) IS
  'Copies du ticket serveur [0, 5] (0 = pas de papier). Même garde (settings.update), mêmes codes d''erreur et même audit setting.update que la branche kot_copies_* de set_setting_v13.';

REVOKE EXECUTE ON FUNCTION public.set_kot_copies_waiter_v1(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_kot_copies_waiter_v1(integer) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_kot_copies_waiter_v1(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_kot_copies_waiter_v1(integer) TO service_role;
