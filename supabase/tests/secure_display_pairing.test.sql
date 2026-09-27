BEGIN;
SELECT plan(21);
SELECT ok(NOT has_table_privilege('kiosk_display', 'public.orders', 'SELECT'), 'aucune lecture des commandes');
SELECT ok(NOT has_table_privilege('kiosk_display', 'public.customers', 'SELECT'), 'aucune lecture clients');
SELECT ok(NOT has_table_privilege('kiosk_display', 'public.kiosk_devices', 'SELECT'), 'aucune lecture des secrets');
SELECT ok(NOT pg_has_role('kiosk_display', 'authenticated', 'MEMBER'), 'aucun héritage employé');
SELECT ok(NOT has_function_privilege('anon', 'public.get_kiosk_display_v1()', 'EXECUTE'), 'snapshot fermé à anon');
SELECT ok(NOT has_function_privilege('authenticated', 'public.authenticate_display_device_v1(text,text,uuid)', 'EXECUTE'), 'authentification appareil réservée serveur');
SELECT ok(NOT has_function_privilege('anon', 'public.manage_display_device_v1(uuid,text,uuid,text)', 'EXECUTE'), 'gestion fermée à anon et PUBLIC');
SELECT is_empty($$SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND p.proname <> 'get_kiosk_display_v1'
  AND has_function_privilege('kiosk_display',p.oid,'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')$$,
  'aucune autre fonction privilégiée accessible à l’écran');
SELECT throws_ok($$SELECT public.manage_display_device_v1(NULL, 'create', NULL, 'test')$$, '42501', 'permission_denied', 'acteur absent refusé');

CREATE TEMP TABLE display_test AS
SELECT id AS actor, public.manage_display_device_v1(id, 'create', NULL, 'Test transactionnel') AS created
FROM public.user_profiles WHERE is_active AND deleted_at IS NULL AND role_code = 'SUPER_ADMIN' LIMIT 1;
SELECT is((SELECT count(*) FROM display_test), 1::bigint, 'acteur de test présent');
SELECT throws_ok($$SELECT public.authenticate_display_device_v1(repeat('a',64), repeat('f',64), NULL)$$,
  '42501', 'kiosk_unauthorized', 'code inconnu refusé');
SELECT lives_ok($$SELECT public.authenticate_display_device_v1(repeat('a',64),
  encode(extensions.digest((SELECT created->>'pairing_code' FROM display_test),'sha256'),'hex'), NULL)$$,
  'appairage autorisé');
SELECT lives_ok($$SELECT public.authenticate_display_device_v1(repeat('a',64),
  encode(extensions.digest((SELECT created->>'pairing_code' FROM display_test),'sha256'),'hex'), NULL)$$,
  'retry avec même secret autorisé');
SELECT throws_ok($$SELECT public.authenticate_display_device_v1(repeat('b',64),
  encode(extensions.digest((SELECT created->>'pairing_code' FROM display_test),'sha256'),'hex'), NULL)$$,
  '42501', 'kiosk_unauthorized', 'code consommé refusé à un autre appareil');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','kiosk_display',
  'sub',(SELECT created->>'id' FROM display_test),
  'app_metadata',jsonb_build_object('provider','kiosk','scope','display'))::text, true);
SELECT lives_ok($$SELECT public.get_kiosk_display_v1()$$, 'snapshot accessible à l’appareil appairé');
SELECT ok(NOT (public.get_kiosk_display_v1() ? 'customers'), 'snapshot sans clients');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated',
  'sub',(SELECT created->>'id' FROM display_test),
  'app_metadata',jsonb_build_object('provider','kiosk','scope','display'))::text, true);
SELECT throws_ok($$SELECT public.get_kiosk_display_v1()$$, '42501', 'kiosk_unauthorized', 'ancien rôle employé refusé par la projection');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','kiosk_display',
  'sub',(SELECT created->>'id' FROM display_test),
  'app_metadata',jsonb_build_object('provider','kiosk','scope','tablet'))::text, true);
SELECT throws_ok($$SELECT public.get_kiosk_display_v1()$$, '42501', 'kiosk_unauthorized', 'autre usage refusé');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','kiosk_display',
  'sub',(SELECT created->>'id' FROM display_test),
  'app_metadata',jsonb_build_object('provider','kiosk','scope','display'))::text, true);
UPDATE public.kiosk_devices SET pairing_expires_at=now()-interval '1 minute'
  WHERE id=(SELECT (created->>'id')::uuid FROM display_test);
SELECT throws_ok($$SELECT public.authenticate_display_device_v1(repeat('a',64),
  encode(extensions.digest((SELECT created->>'pairing_code' FROM display_test),'sha256'),'hex'), NULL)$$,
  '42501', 'kiosk_unauthorized', 'code expiré refusé même en retry');
SELECT public.manage_display_device_v1(actor, 'revoke', (created->>'id')::uuid) FROM display_test;
SELECT throws_ok($$SELECT public.get_kiosk_display_v1()$$, '42501', 'kiosk_unauthorized', 'révocation immédiate malgré le JWT');
SELECT throws_ok($$SELECT public.authenticate_display_device_v1(repeat('a',64), NULL,
  (SELECT (created->>'id')::uuid FROM display_test))$$,
  '42501', 'kiosk_unauthorized', 'renouvellement révoqué refusé');
SELECT * FROM finish();
ROLLBACK;
