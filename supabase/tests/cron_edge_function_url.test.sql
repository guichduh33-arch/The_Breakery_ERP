-- S1-14 — les tâches planifiées lisent l'adresse du projet dans le secret Vault
-- `project_url` de leur base, jamais une adresse écrite en dur. Transaction
-- annulée : le secret de test et la suppression du secret réel s'annulent.
BEGIN;
SELECT plan(9);

-- Point de départ connu : aucune adresse de projet sur cette base.
DELETE FROM vault.secrets WHERE name = 'project_url';

SELECT is(scheduling_private.edge_function_url('notification-dispatch'), NULL,
  'sans secret project_url, le helper ne rend aucune adresse');

SELECT is(
  (SELECT count(*)::int
     FROM (SELECT scheduling_private.edge_function_url('notification-dispatch') AS url) u
    WHERE u.url IS NOT NULL),
  0,
  'sans secret, la forme de la tâche ne produit aucune ligne, donc aucun appel');

-- Une autre base : le helper suit son secret, pas le projet dev.
SELECT vault.create_secret('https://otherprojectref0000.supabase.co/', 'project_url');

SELECT is(scheduling_private.edge_function_url('notification-dispatch'),
  'https://otherprojectref0000.supabase.co/functions/v1/notification-dispatch',
  'avec un secret, l''adresse est celle de la base courante, barre finale retirée');

SELECT is(scheduling_private.edge_function_url('customer-birthday-notify'),
  'https://otherprojectref0000.supabase.co/functions/v1/customer-birthday-notify',
  'le slug est ajouté à la forme canonique /functions/v1/');

SELECT is(scheduling_private.edge_function_url('../auth/v1'), NULL,
  'un slug hors de [a-z0-9-] ne produit aucune adresse');

SELECT is(
  (SELECT count(*)::int FROM cron.job
    WHERE command ~ '[a-z]{20}\.(functions\.)?supabase\.co'),
  0,
  'aucune tâche planifiée ne porte une adresse de projet écrite en dur');

SELECT is(
  (SELECT count(*)::int FROM cron.job
    WHERE command LIKE '%net.http_post%'
      AND command NOT LIKE '%scheduling_private.edge_function_url(%'),
  0,
  'toute tâche qui appelle une Edge Function passe par le helper');

SELECT ok(
  NOT has_function_privilege('anon', 'scheduling_private.edge_function_url(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'scheduling_private.edge_function_url(text)', 'EXECUTE'),
  'anon et authenticated ne peuvent pas exécuter le helper');

SELECT ok(
  NOT has_schema_privilege('anon', 'scheduling_private', 'USAGE')
  AND NOT has_schema_privilege('authenticated', 'scheduling_private', 'USAGE'),
  'le schéma des helpers n''est pas accessible à anon ni à authenticated');

SELECT * FROM finish();
ROLLBACK;
