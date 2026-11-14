-- S1-14 — les tâches planifiées qui appellent une Edge Function ne portent plus
-- l'adresse du projet de développement.
--
-- Constat (audit 01 §5.5, relevé du 2026-11-14) : deux tâches pg_cron appellent
-- une Edge Function par une adresse écrite en dur sur le projet dev :
--   - `birthday-daily-ef`              (20260525000012) → customer-birthday-notify
--   - `notification-dispatch-minutely` (20260716000169) → notification-dispatch
-- Ces deux migrations ne sont pas éditées (versionnement monotone). Rejouées
-- sur une autre base, elles feraient appeler le projet dev par cette base.
--
-- Correction : l'adresse de base du projet vit dans un secret Vault par base,
-- nommé `project_url` (forme `https://<ref>.supabase.co`, nom du modèle
-- documenté par Supabase pour pg_cron + pg_net). Aucune migration ne le crée :
-- c'est une donnée d'environnement, posée une fois par base par l'opérateur :
--   SELECT vault.create_secret('https://<ref>.supabase.co', 'project_url');
-- Sans ce secret, le helper rend NULL et la tâche n'envoie AUCUNE requête —
-- jamais un appel vers un autre projet.
--
-- Portée : la migration ne réécrit une tâche que si elle existe déjà. Elle
-- n'installe aucune tâche planifiée là où il n'y en a pas (la production en
-- porte 0 au 2026-11-14) : l'installation des tâches en production est un
-- geste distinct, que ce lot rend seulement possible.
--
-- Non modifié : le corps, l'horaire et les en-têtes des deux tâches, recopiés
-- de leur définition live du 2026-11-14 ; seule l'adresse change, et l'appel
-- passe de l'alias `<ref>.functions.supabase.co/<slug>` à la forme
-- canonique `<ref>.supabase.co/functions/v1/<slug>`.

CREATE SCHEMA IF NOT EXISTS scheduling_private;
REVOKE ALL ON SCHEMA scheduling_private FROM PUBLIC;
REVOKE ALL ON SCHEMA scheduling_private FROM anon, authenticated;

COMMENT ON SCHEMA scheduling_private IS
  'Helpers des tâches pg_cron. Non exposé par l''API : aucun droit pour anon ni authenticated.';

-- Adresse d'une Edge Function de CETTE base, lue dans le secret Vault
-- `project_url`. NULL si le secret est absent ou vide, ou si le slug est invalide.
CREATE FUNCTION scheduling_private.edge_function_url(p_slug text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT rtrim(s.decrypted_secret, '/') || '/functions/v1/' || p_slug
    FROM vault.decrypted_secrets s
   WHERE s.name = 'project_url'
     AND nullif(btrim(s.decrypted_secret), '') IS NOT NULL
     AND p_slug ~ '^[a-z0-9][a-z0-9-]*$'
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION scheduling_private.edge_function_url(text) IS
  'S1-14 : adresse d''une Edge Function de la base courante, depuis le secret Vault project_url. NULL si absent : la tâche appelante n''envoie rien.';

REVOKE ALL ON FUNCTION scheduling_private.edge_function_url(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION scheduling_private.edge_function_url(text) FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA scheduling_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $mig$
BEGIN
  -- La forme `SELECT ... FROM (helper) WHERE url IS NOT NULL` rend zéro ligne
  -- sans secret : net.http_post n'est alors jamais appelée.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'birthday-daily-ef') THEN
    PERFORM cron.schedule(
      'birthday-daily-ef',
      '0 2 * * *',
      $cron$
    SELECT net.http_post(
      u.url,
      jsonb_build_object('triggered_at', now()::text),
      '{}'::jsonb,
      '{"Content-Type": "application/json", "x-cron-secret": "birthday-cron-daily"}'::jsonb
    )
      FROM (SELECT scheduling_private.edge_function_url('customer-birthday-notify') AS url) u
     WHERE u.url IS NOT NULL;
  $cron$
    );
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-dispatch-minutely') THEN
    PERFORM cron.schedule(
      'notification-dispatch-minutely',
      '* * * * *',
      $cron$
    SELECT net.http_post(
      u.url,
      jsonb_build_object('triggered_at', now()::text),
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dispatch-secret', COALESCE(
          (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'notification_dispatch_secret' LIMIT 1),
          'unset')
      )
    )
      FROM (SELECT scheduling_private.edge_function_url('notification-dispatch') AS url) u
     WHERE u.url IS NOT NULL;
  $cron$
    );
  END IF;
END
$mig$;
