-- 20260901000013_current_profile_id_helper.sql
--
-- Lot « actor_id transverse » — chantier hors lot du plan des cinq P0 (audit lot 1
-- du 2026-08-31, docs/audits/2026-08-31-audit-security-fraud-guard.md, finding 3 P1) :
-- ~34 RPC live écrivent auth.uid() dans audit_logs.actor_id, dont la clé étrangère
-- référence user_profiles(id). auth.uid() vaut user_profiles.auth_user_id ; tout compte
-- créé par le back-office (create_user_v*) a id <> auth_user_id, et pour lui chaque
-- geste de ces RPC échoue en 23503. Les lots précédents ont corrigé le KDS
-- (20260810000005) et les dépenses (20260901000005) par résolution inline. La classe
-- restante est trop large pour 32 résolutions recopiées : le plan validé le 2026-09-05
-- prévoit « un lot unique avec helper ».
--
-- Ce fichier crée le helper. Les trois fichiers suivants (…14 catalogue, …15 imports,
-- …16 commandes/coûts/coffre) bumpent les 32 RPC pour le consommer.
--
-- Contrat de _current_profile_id() :
--   · rend user_profiles.id du profil vivant dont auth_user_id = auth.uid() ;
--   · rend NULL quand auth.uid() est NULL (cron, service_role, trigger de fond) ou
--     quand aucun profil vivant ne correspond — il ne lève JAMAIS. La porte reste
--     has_permission(auth.uid(), …), déjà en tête de chaque RPC : un appelant sans
--     profil vivant y est refusé (42501 / P0003) avant toute écriture, le helper
--     n'a donc pas à porter de refus propre, et les codes d'erreur des RPC ne
--     bougent pas.
--   · distinct de get_current_profile_id() (20260510000002), helper de RLS granté à
--     authenticated : les corps SECURITY DEFINER ne doivent pas dépendre d'un objet
--     dont le contrat appartient aux policies. Préfixe « _ » = helper interne,
--     révoqué de authenticated (régime _assert_product_sellable_v1, 20260810000001) ;
--     un corps SECURITY DEFINER l'exécute avec les droits du propriétaire.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = '_current_profile_id') THEN
    RAISE EXCEPTION '_current_profile_id existe déjà — ce fichier ne remplace rien';
  END IF;
END $$;

CREATE FUNCTION public._current_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id
    FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public._current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._current_profile_id() FROM anon;
REVOKE ALL ON FUNCTION public._current_profile_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._current_profile_id() TO service_role;

COMMENT ON FUNCTION public._current_profile_id() IS
  'Helper interne (2026-09-06, lot actor_id transverse) : user_profiles.id du profil vivant de auth.uid(), NULL sans contexte auth ou sans profil vivant, ne lève jamais. À poser dans audit_logs.actor_id et toute colonne FK vers user_profiles(id) depuis un corps SECURITY DEFINER — jamais auth.uid(), qui est auth_user_id. La porte reste has_permission(auth.uid(), …). REVOKEd from authenticated.';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
