-- 20260710000084_revoke_reversal_v4_v3_from_authenticated.sql
-- S55 P1.5 (audit T7) — reviewer Critical : REVOKE authenticated manquant sur les
-- nouvelles signatures de reversal.
--
-- Régression du même type que l'incident corrigé par
-- 20260709000010_revoke_pair_reversal_rpcs_from_authenticated.sql : recréer une
-- fonction sous une NOUVELLE signature repart d'une ACL fraîche, et le projet n'a
-- de default-privilege revoke QUE pour PUBLIC/anon (S20), PAS pour `authenticated`
-- (Supabase le grante par défaut). Les migrations _082 (void_order_rpc_v4) et _083
-- (cancel_order_item_rpc_v3) suivaient le précédent fautif _018 (grants 3-lignes :
-- REVOKE PUBLIC + REVOKE anon + GRANT service_role, sans REVOKE authenticated) —
-- vérifié live : has_function_privilege('authenticated', …, 'EXECUTE') = TRUE pour
-- les deux. Un cashier authentifié pouvait donc appeler ces RPCs directement via
-- PostgREST en passant n'importe quel manager en p_authorized_by, contournant le
-- PIN vérifié uniquement dans les edge functions void-order / cancel-item.
--
-- Fix : revoke pair complet (le REVOKE authenticated a aussi été ajouté in-place
-- en queue de _082/_083 pour les environnements pas encore migrés ; cette _084
-- corrige l'état cloud déjà appliqué ET laisse la trace).

REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v3(uuid, text, uuid, uuid, uuid) FROM authenticated;
