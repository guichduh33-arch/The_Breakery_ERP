-- Contrat des compteurs PIN : appelant stable malgré le changement d'IP.
-- Clés synthétiques et transaction annulée ; aucune opération commerciale.
BEGIN;
SELECT plan(12);

SELECT ok(has_function_privilege('service_role',
  'public.record_rate_limit_v1(text,text,text,integer,integer)', 'execute'),
  'Le serveur peut écrire les compteurs');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.record_rate_limit_v1(text,text,text,integer,integer)', 'execute'),
  'Le caissier ne peut pas écrire directement les compteurs');
SELECT ok(NOT has_function_privilege('anon',
  'public.record_rate_limit_v1(text,text,text,integer,integer)', 'execute'),
  'Un appel anonyme ne peut pas écrire les compteurs');

DO $$ BEGIN
  PERFORM set_config('test.pin_actor', 'actor:' || gen_random_uuid()::text, true);
  PERFORM set_config('test.pin_other', 'actor:' || gen_random_uuid()::text, true);
  PERFORM set_config('test.pin_ip', 'ip:test-' || gen_random_uuid()::text, true);
END $$;

SET LOCAL ROLE service_role;
SELECT is((SELECT current_count FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.1', 5, 900)), 1,
  'Le premier échec crée le compteur de l’appelant');

DO $$ BEGIN
  FOR n IN 2..4 LOOP
    PERFORM * FROM record_rate_limit_v1('manager-pin-fail',
      current_setting('test.pin_actor'), '192.0.2.' || n::text, 5, 900);
  END LOOP;
END $$;
SELECT is((SELECT current_count FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.5', 5, 900)), 5,
  'Cinq IP différentes alimentent le même compteur d’appelant');
SELECT is((SELECT allowed FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.6', 5, 900)), false,
  'Une nouvelle IP ne contourne pas la limite de cinq échecs');
SELECT ok((SELECT retry_after_sec > 0 FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.7', 5, 900)),
  'Le serveur fournit le délai de blocage');
SELECT is((SELECT current_count FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.8', 5, 900)), 5,
  'Un refus ne réinitialise pas le compteur');
SELECT is((SELECT allowed FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_other'), '192.0.2.8', 5, 900)), true,
  'Un autre appelant conserve son compteur indépendant');
SELECT is((SELECT allowed FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_ip'), '192.0.2.8', 5, 900)), true,
  'Le compteur IP reste indépendant du compteur d’appelant');

RESET ROLE;
UPDATE edge_function_rate_limits
  SET window_start = now() - interval '901 seconds', window_end = now() - interval '1 second'
  WHERE function_name = 'manager-pin-fail' AND bucket_key = current_setting('test.pin_actor');
SET LOCAL ROLE service_role;
SELECT is((SELECT allowed FROM record_rate_limit_v1('manager-pin-fail',
  current_setting('test.pin_actor'), '192.0.2.9', 5, 900)), true,
  'La fin de fenêtre libère l’appelant');
SELECT is((SELECT request_count FROM edge_function_rate_limits
  WHERE function_name = 'manager-pin-fail' AND bucket_key = current_setting('test.pin_actor')
    AND window_end > now()), 1,
  'La nouvelle fenêtre repart à un échec');

SELECT * FROM finish();
ROLLBACK;
