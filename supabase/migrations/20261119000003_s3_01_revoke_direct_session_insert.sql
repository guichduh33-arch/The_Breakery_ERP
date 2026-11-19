-- S3-01, partie RETRAIT. À appliquer en production APRÈS l'installation du
-- paquet caisse qui ouvre par open_shift_v1 : l'ancien paquet ouvre encore par
-- INSERT direct, et ce retrait le bloquerait.
--
-- Sans ce retrait, un client pourrait contourner open_shift_v1 et ouvrir une
-- session sans terminal par l'API des tables. La fonction d'ouverture, SECURITY
-- DEFINER, n'a pas besoin de ce droit. La règle d'insertion perm_create devient
-- sans objet pour le rôle authenticated ; on la retire pour qu'aucune lecture
-- ne la prenne pour un chemin vivant.
REVOKE INSERT ON public.pos_sessions FROM authenticated;
REVOKE INSERT ON public.pos_sessions FROM anon;
REVOKE INSERT ON public.pos_sessions FROM PUBLIC;
DROP POLICY IF EXISTS perm_create ON public.pos_sessions;
