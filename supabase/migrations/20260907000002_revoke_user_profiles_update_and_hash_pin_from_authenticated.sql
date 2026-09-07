-- Audit lot 2, P0 n°2 — escalade de privilèges par UPDATE direct sur user_profiles.
--
-- La policy `perm_update` (posée par 20260503000007_init_rls.sql) porte
-- `USING (auth_user_id = auth.uid() OR has_permission(auth.uid(), 'users.update'))`
-- et **aucun WITH CHECK**. Postgres réutilise alors le USING comme check : la
-- contrainte porte sur l'IDENTITÉ de la ligne, jamais sur les colonnes écrites.
-- Combiné au grant TABLE `authenticated=awdDxtm` (le `w` couvre toutes les
-- colonnes), tout compte authentifié pouvait faire
--   PATCH /rest/v1/user_profiles?id=eq.<le sien>  {"role_code":"SUPER_ADMIN"}
-- et devenir SUPER_ADMIN — ou réécrire pin_hash, is_active, locked_until,
-- failed_login_attempts, deleted_at sur sa propre ligne.
--
-- Un WITH CHECK ne peut pas fermer ce trou : la clause RLS n'a pas accès à
-- l'ancienne ligne, elle ne peut donc pas interdire un CHANGEMENT de colonne.
-- Le verrou correct est le grant : plus rien de légitime n'a besoin d'UPDATE
-- sur cette table en tant qu'`authenticated`.
--
-- Vérifié avant d'écrire cette migration :
--   * les 4 gestes d'administration du back-office passent par des RPC
--     SECURITY DEFINER gatées — create_user_v1, update_user_role_v1,
--     reset_user_pin_v1, delete_user_v1 (features/users/hooks) ;
--   * les seules écritures directes vivent dans les Edge Functions
--     auth-verify-pin et auth-change-pin, qui utilisent le client `admin`
--     (service_role), non concerné par ce REVOKE ;
--   * aucun `.from('user_profiles').update(` sous apps/ ni packages/.
--
-- INSERT reste accordé : sa policy `perm_create` porte un vrai WITH CHECK
-- (`has_permission(auth.uid(), 'users.create')`). DELETE n'a aucune policy,
-- donc la RLS le refuse déjà. Le résiduel TRUNCATE (`D`) est systémique sur la
-- base (67 relations sur 100) et relève d'un lot dédié, pas de ce correctif.

REVOKE UPDATE ON TABLE public.user_profiles FROM authenticated;
REVOKE UPDATE ON TABLE public.user_profiles FROM PUBLIC;

COMMENT ON POLICY perm_update ON public.user_profiles IS
  'Inerte pour authenticated depuis l''audit lot 2 (P0-2) : le grant UPDATE est revoque. Les ecritures passent par les RPC gatees (update_user_role_v1, reset_user_pin_v1, delete_user_v1) et les Edge Functions en service_role.';

-- Facteur aggravant du meme P0 : hash_pin(text) etait executable par
-- `authenticated`, ce qui fournissait a l'attaquant un generateur de hash bcrypt
-- valide — de quoi se POSER un PIN choisi apres s'etre eleve.
-- Ses deux appelants SQL (create_user_v1, reset_user_pin_v1) sont SECURITY
-- DEFINER et s'executent donc en `postgres` ; l'Edge Function auth-change-pin
-- l'appelle avec le client `admin` (service_role). Aucun appelant ne perd rien.
REVOKE EXECUTE ON FUNCTION public.hash_pin(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hash_pin(text) FROM anon;
