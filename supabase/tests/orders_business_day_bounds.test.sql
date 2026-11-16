-- ADR-019 / ADR-025 : bornes locales identiques, minuit suivant exclu.
-- Les fixtures évitent les écritures de paiement et disparaissent au ROLLBACK.
BEGIN;
SELECT set_config('statement_timeout','30s',true);
CREATE TEMP TABLE tzb_results(result text);
INSERT INTO tzb_results SELECT plan(21);

CREATE TEMP TABLE tzb_context AS
SELECT id AS profile_id,auth_user_id,gen_random_uuid() AS session_id
FROM public.user_profiles
WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL
  AND auth_user_id IS NOT NULL
ORDER BY id LIMIT 1;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM tzb_context) THEN RAISE EXCEPTION 'missing_active_owner_fixture'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders o JOIN tzb_context c ON c.profile_id=o.served_by
    WHERE o.created_at>='1998-06-14 00:00:00+08'::timestamptz
      AND o.created_at<'1998-06-17 00:00:00+08'::timestamptz) THEN
    RAISE EXCEPTION 'business_day_fixture_window_not_empty';
  END IF;
END $$;

INSERT INTO public.pos_sessions(id,opened_by,opening_cash,opened_at,closed_at,
  closed_by,status,expected_cash,closing_cash,variance_total)
SELECT session_id,profile_id,0,'1998-06-14 00:00:00+08','1998-06-17 00:00:00+08',
  profile_id,'closed',0,0,0 FROM tzb_context;
CREATE TEMP TABLE tzb_orders AS
SELECT gen_random_uuid() AS id,n,created_at::timestamptz,total::numeric
FROM (VALUES
 (0,'1998-06-14 23:59:59.999999+08',9001),
 (1,'1998-06-15 00:00:00+08',10001),
 (2,'1998-06-15 06:52:22+08',10002),
 (3,'1998-06-15 07:59:59.999999+08',10003),
 (4,'1998-06-15 08:00:00+08',10004),
 (5,'1998-06-15 23:59:59.999999+08',10005),
 (6,'1998-06-16 00:00:00+08',9002),
 (7,'1998-06-16 07:59:59.999999+08',9003),
 (8,'1998-06-16 08:00:00+08',9004)
) AS f(n,created_at,total);
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,
  total,created_at,session_id,served_by)
SELECT o.id,'PGTAP-TZB-'||o.id,'take_out','completed',o.total,0,
  o.total,o.created_at,c.session_id,c.profile_id FROM tzb_orders o CROSS JOIN tzb_context c;
DO $$ DECLARE actor uuid; BEGIN
  SELECT auth_user_id INTO actor FROM tzb_context;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
END $$;
CREATE TEMP TABLE tzb_snapshot AS
SELECT public.get_orders_list_v8('1998-06-15','1998-06-15',
  jsonb_build_object('served_by',profile_id),200,'created_at','asc') AS page,
  public.get_orders_counters_v6('1998-06-15','1998-06-15',
  jsonb_build_object('served_by',profile_id)) AS counters FROM tzb_context;

INSERT INTO tzb_results SELECT is(current_setting('TimeZone'),'Asia/Makassar','session métier WITA');
INSERT INTO tzb_results SELECT is(
  (SELECT array_agg(line->>'id' ORDER BY position) FROM tzb_snapshot,
    jsonb_array_elements(page->'lines') WITH ORDINALITY AS rows(line,position)),
  (SELECT array_agg(id::text ORDER BY n) FROM tzb_orders WHERE n BETWEEN 1 AND 5),
  'la journée locale contient exactement les cinq commandes attendues');
INSERT INTO tzb_results SELECT ok(EXISTS(SELECT 1 FROM tzb_snapshot,
  jsonb_array_elements(page->'lines') line JOIN tzb_orders o ON o.id=(line->>'id')::uuid WHERE n=1),
  'minuit de début inclus');
INSERT INTO tzb_results SELECT ok(EXISTS(SELECT 1 FROM tzb_snapshot,
  jsonb_array_elements(page->'lines') line JOIN tzb_orders o ON o.id=(line->>'id')::uuid WHERE n=2),
  'vente de 06:52 incluse avant 08:00');
INSERT INTO tzb_results SELECT ok(EXISTS(SELECT 1 FROM tzb_snapshot,
  jsonb_array_elements(page->'lines') line JOIN tzb_orders o ON o.id=(line->>'id')::uuid WHERE n=5),
  'dernière fraction de seconde de la journée incluse');
INSERT INTO tzb_results SELECT ok(NOT EXISTS(SELECT 1 FROM tzb_snapshot,
  jsonb_array_elements(page->'lines') line JOIN tzb_orders o ON o.id=(line->>'id')::uuid WHERE n=0),
  'dernière fraction du jour précédent exclue');
INSERT INTO tzb_results SELECT ok(NOT EXISTS(SELECT 1 FROM tzb_snapshot,
  jsonb_array_elements(page->'lines') line JOIN tzb_orders o ON o.id=(line->>'id')::uuid WHERE n=6),
  'minuit suivant exclu');
INSERT INTO tzb_results SELECT is((counters->'total'->>'count')::int,5,'compteur total égal aux lignes') FROM tzb_snapshot;
INSERT INTO tzb_results SELECT is((counters->'total'->>'amount')::numeric,50015::numeric,'montant total sur la journée locale') FROM tzb_snapshot;
INSERT INTO tzb_results SELECT is((counters->'paid'->>'count')::int,5,'les cinq commandes réglées par statut sont comptées') FROM tzb_snapshot;
INSERT INTO tzb_results SELECT is((counters->'unpaid'->>'count')::int,0,'aucune commande impayée inventée') FROM tzb_snapshot;
INSERT INTO tzb_results SELECT is((counters->'by_status'->'completed'->>'count')::int,5,'panier statut cohérent avec la liste') FROM tzb_snapshot;
INSERT INTO tzb_results SELECT is(jsonb_array_length(public.get_orders_list_v8(
  '1998-06-15','1998-06-16',jsonb_build_object('served_by',profile_id),200)->'lines'),8,
  'plage de deux jours : lendemain inclus, jour précédent exclu') FROM tzb_context;
INSERT INTO tzb_results SELECT is((public.get_orders_counters_v6(
  '1998-06-14','1998-06-14',jsonb_build_object('served_by',profile_id))->'total'->>'count')::int,1,
  'jour précédent isolé sans chevauchement') FROM tzb_context;
INSERT INTO tzb_results SELECT is((public.get_orders_counters_v6(
  '1998-06-16','1998-06-16',jsonb_build_object('served_by',profile_id))->'total'->>'count')::int,3,
  'jour suivant isolé dès minuit') FROM tzb_context;
INSERT INTO tzb_results SELECT ok(
  jsonb_array_length(public.get_orders_list_v8('1998-06-15','1998-06-15',
    jsonb_build_object('served_by',profile_id,'hour',6),200)->'lines')=1
  AND (public.get_orders_counters_v6('1998-06-15','1998-06-15',
    jsonb_build_object('served_by',profile_id,'hour',6))->'total'->>'count')::int=1,
  'filtre horaire 06h cohérent entre lignes et compteurs') FROM tzb_context;
DO $$ DECLARE
  page jsonb; cursor_value text; cursor_id uuid; ids text[]:='{}'; expected text[];
  filters jsonb; guard int:=0;
BEGIN
  SELECT jsonb_build_object('served_by',profile_id) INTO filters FROM tzb_context;
  SELECT array_agg(id::text ORDER BY n) INTO expected FROM tzb_orders WHERE n BETWEEN 1 AND 5;
  LOOP
    page:=public.get_orders_list_v8('1998-06-15','1998-06-15',filters,2,
      'created_at','asc',cursor_value,cursor_id);
    ids:=ids||ARRAY(SELECT line->>'id' FROM jsonb_array_elements(page->'lines') line);
    cursor_value:=page->>'next_cursor_val'; cursor_id:=(page->>'next_cursor_id')::uuid;
    guard:=guard+1;
    EXIT WHEN cursor_value IS NULL OR guard>10;
  END LOOP;
  INSERT INTO tzb_results SELECT is(ids,expected,'pagination : cinq lignes sans perte ni doublon autour des bornes');
END $$;
INSERT INTO tzb_results SELECT ok(
  has_function_privilege('authenticated','public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_orders_counters_v6(text,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_orders_counters_v6(text,text,jsonb)','EXECUTE'),
  'droits authenticated conservés, anon/PUBLIC refusés');
INSERT INTO tzb_results SELECT ok(
  to_regprocedure('public.get_orders_list_v6(text,text,jsonb,integer,text,text,text,uuid)') IS NULL
  AND to_regprocedure('public.get_orders_counters_v4(text,text,jsonb)') IS NULL,
  'anciennes versions supprimées');
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
END $$;
INSERT INTO tzb_results SELECT throws_ok(
  $$SELECT public.get_orders_list_v8('1998-06-15','1998-06-15')$$,
  '42501','Authentication required','liste : absence de session refusée');
INSERT INTO tzb_results SELECT throws_ok(
  $$SELECT public.get_orders_counters_v6('1998-06-15','1998-06-15')$$,
  '42501','Authentication required','compteurs : absence de session refusée');
INSERT INTO tzb_results SELECT * FROM finish();
SELECT result FROM tzb_results;
ROLLBACK;
