-- S1-07, suite — les trois helpers qui identifient l'appelant exigent un
-- profil actif, comme `has_permission`.
--
-- Constat de revue du 2026-11-12, vérifié sur les corps live (md5 égaux en dev
-- et en production) : `get_current_role`, `get_current_profile_id` et
-- `_current_profile_id` retenaient le profil sur `deleted_at IS NULL`
-- seulement. Des politiques RLS et des fonctions SECURITY DEFINER les lisent
-- sans passer par `has_permission` : un compte désactivé y gardait son rôle
-- et son identité tant que son jeton vivait.
--
-- Remplacées EN PLACE : helpers non versionnés, nommés tels quels par les
-- politiques. Attributs et droits repris du live ; seule la ligne `is_active`
-- est ajoutée. Pour un profil inactif elles rendent NULL, comme pour un
-- profil supprimé.

CREATE OR REPLACE FUNCTION public.get_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role_code FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
     AND is_active IS TRUE
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.get_current_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
     AND is_active IS TRUE
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public._current_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id
    FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
     AND is_active IS TRUE
   LIMIT 1
$function$;
