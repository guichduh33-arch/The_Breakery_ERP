-- Lot 1 — Les partitions n heritent ni de RLS ni des GRANT de leur parent.
--
-- Une table creee par CREATE TABLE ... PARTITION OF nait avec RLS desactive et
-- les privileges par defaut du schema, quel que soit l etat du parent. PostgREST
-- expose ensuite chaque partition comme une table a part entiere : fermer le
-- parent ne ferme rien.
--
-- Mesure avant le correctif 20260802000005, sous le role authenticated sans la
-- permission reports.audit.read :
--   SELECT count(*) FROM public.pos_events         -> 0     (policy respectee)
--   SELECT count(*) FROM public.pos_events_2026_07 -> 1203  (journal expose)
-- Le journal d audit POS etait donc integralement lisible par tout utilisateur
-- connecte, et des evenements y etaient insertables. Les triggers no_update /
-- no_delete, herites eux, masquaient le trou en donnant l illusion d un ledger
-- protege.
--
-- Les deux premieres assertions portent sur TOUTES les partitions du schema, pas
-- sur les quatre partitions connues au moment de l ecriture : une partition
-- ajoutee plus tard sans passer par create_pos_events_partition_v1 doit faire
-- echouer cette suite, sinon le correctif expire au prochain mois.
BEGIN;

SELECT plan(3);

-- 1. Aucune partition ne tourne avec RLS desactive.
SELECT is_empty(
  $$ SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relispartition
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity $$,
  'aucune partition de public.* ne tourne avec RLS desactive'
);

-- 2. Aucune partition n accorde quoi que ce soit a un role client.
--    service_role est hors sujet : il porte les Edge Functions et bypasse RLS.
SELECT is_empty(
  $$ SELECT g.table_name, g.grantee, g.privilege_type
       FROM information_schema.role_table_grants g
       JOIN pg_class c ON c.relname = g.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE g.table_schema = 'public'
        AND c.relispartition
        AND g.grantee IN ('anon', 'authenticated', 'PUBLIC') $$,
  'aucune partition de public.* n accorde de droit a anon, authenticated ou PUBLIC'
);

-- 3. Garde-fou inverse : la lecture legitime passe toujours par le parent.
--    Sans cette assertion, une sur-revocation fermerait le journal a tout le
--    monde et les deux tests precedents resteraient verts.
SELECT isnt_empty(
  $$ SELECT 1
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'pos_events'
        AND grantee = 'authenticated'
        AND privilege_type = 'SELECT' $$,
  'le parent public.pos_events reste lisible par authenticated (policy reports.audit.read)'
);

SELECT * FROM finish();
ROLLBACK;
