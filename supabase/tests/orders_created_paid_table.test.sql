-- S3-21 : la liste des commandes rend l'heure de création, l'heure de paiement
-- et la table ; le filtre par table est identique dans la liste et les compteurs.
-- Les fixtures évitent les écritures de paiement et disparaissent au ROLLBACK.
BEGIN;
SELECT set_config('statement_timeout','30s',true);
CREATE TEMP TABLE cpt_results(result text);
INSERT INTO cpt_results SELECT plan(14);

CREATE TEMP TABLE cpt_context AS
SELECT id AS profile_id,auth_user_id,gen_random_uuid() AS session_id
FROM public.user_profiles
WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL
  AND auth_user_id IS NOT NULL
ORDER BY id LIMIT 1;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM cpt_context) THEN RAISE EXCEPTION 'missing_active_owner_fixture'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders o JOIN cpt_context c ON c.profile_id=o.served_by
    WHERE o.created_at>='1997-03-10 00:00:00+08'::timestamptz
      AND o.created_at<'1997-03-11 00:00:00+08'::timestamptz) THEN
    RAISE EXCEPTION 'created_paid_table_fixture_window_not_empty';
  END IF;
END $$;

INSERT INTO public.pos_sessions(id,opened_by,opening_cash,opened_at,closed_at,
  closed_by,status,expected_cash,closing_cash,variance_total)
SELECT session_id,profile_id,0,'1997-03-10 00:00:00+08','1997-03-11 00:00:00+08',
  profile_id,'closed',0,0,0 FROM cpt_context;
-- n=1 : table 12, créée 10 h, payée 11 h. n=2 : sans table, sans heure de
-- paiement. n=3 : table 7. n=4 : table « 1 », pour prouver l'égalité stricte.
CREATE TEMP TABLE cpt_orders AS
SELECT gen_random_uuid() AS id,n,created_at::timestamptz,paid_at::timestamptz,table_number,total::numeric
FROM (VALUES
 (1,'1997-03-10 10:00:00+08','1997-03-10 11:00:00+08','12',10001),
 (2,'1997-03-10 12:00:00+08',NULL,NULL,10002),
 (3,'1997-03-10 13:00:00+08','1997-03-10 13:05:00+08','7',10003),
 (4,'1997-03-10 14:00:00+08','1997-03-10 14:02:00+08','1',10004)
) AS f(n,created_at,paid_at,table_number,total);
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,
  total,created_at,paid_at,table_number,session_id,served_by)
SELECT o.id,'PGTAP-CPT-'||o.id,'dine_in','completed',o.total,0,
  o.total,o.created_at,o.paid_at,o.table_number,c.session_id,c.profile_id
FROM cpt_orders o CROSS JOIN cpt_context c;
DO $$ DECLARE actor uuid; BEGIN
  SELECT auth_user_id INTO actor FROM cpt_context;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
END $$;

CREATE TEMP TABLE cpt_lines AS
SELECT o.n,line
FROM cpt_context c,
  jsonb_array_elements(public.get_orders_list_v8('1997-03-10','1997-03-10',
    jsonb_build_object('served_by',c.profile_id),200,'created_at','asc')->'lines') line
  JOIN cpt_orders o ON o.id=(line->>'id')::uuid;

INSERT INTO cpt_results SELECT is((SELECT count(*)::int FROM cpt_lines),4,
  'sans filtre de table : les quatre commandes, périmètre inchangé');
INSERT INTO cpt_results SELECT is((line->>'created_at')::timestamptz,
  '1997-03-10 10:00:00+08'::timestamptz,'heure de création rendue') FROM cpt_lines WHERE n=1;
INSERT INTO cpt_results SELECT is((line->>'paid_at')::timestamptz,
  '1997-03-10 11:00:00+08'::timestamptz,'heure de paiement rendue, distincte de la création') FROM cpt_lines WHERE n=1;
INSERT INTO cpt_results SELECT is(line->>'table_number','12','numéro de table rendu') FROM cpt_lines WHERE n=1;
INSERT INTO cpt_results SELECT ok(
  line ? 'table_number' AND line ? 'paid_at'
  AND line->>'table_number' IS NULL AND line->>'paid_at' IS NULL,
  'commande sans table ni paiement : clés présentes, valeurs nulles, aucune erreur') FROM cpt_lines WHERE n=2;

INSERT INTO cpt_results SELECT is(
  (SELECT array_agg(o.n ORDER BY o.n) FROM jsonb_array_elements(
     public.get_orders_list_v8('1997-03-10','1997-03-10',
       jsonb_build_object('served_by',c.profile_id,'table_number','12'),200)->'lines') line
     JOIN cpt_orders o ON o.id=(line->>'id')::uuid),
  ARRAY[1],'filtre table 12 : cette table seulement') FROM cpt_context c;
INSERT INTO cpt_results SELECT is(
  (SELECT array_agg(o.n ORDER BY o.n) FROM jsonb_array_elements(
     public.get_orders_list_v8('1997-03-10','1997-03-10',
       jsonb_build_object('served_by',c.profile_id,'table_number','1'),200)->'lines') line
     JOIN cpt_orders o ON o.id=(line->>'id')::uuid),
  ARRAY[4],'filtre table 1 : égalité stricte, la table 12 n''est pas ramenée') FROM cpt_context c;
INSERT INTO cpt_results SELECT is(
  jsonb_array_length(public.get_orders_list_v8('1997-03-10','1997-03-10',
    jsonb_build_object('served_by',c.profile_id,'table_number','404'),200)->'lines'),0,
  'filtre sur une table inconnue : liste vide, aucune erreur') FROM cpt_context c;

INSERT INTO cpt_results SELECT is((public.get_orders_counters_v6('1997-03-10','1997-03-10',
  jsonb_build_object('served_by',c.profile_id))->'total'->>'count')::int,4,
  'compteurs sans filtre de table : quatre commandes') FROM cpt_context c;
INSERT INTO cpt_results SELECT ok(
  (public.get_orders_counters_v6('1997-03-10','1997-03-10',
    jsonb_build_object('served_by',c.profile_id,'table_number','12'))->'total'->>'count')::int=1
  AND (public.get_orders_counters_v6('1997-03-10','1997-03-10',
    jsonb_build_object('served_by',c.profile_id,'table_number','12'))->'total'->>'amount')::numeric=10001,
  'filtre table cohérent entre lignes et compteurs') FROM cpt_context c;

INSERT INTO cpt_results SELECT ok(
  has_function_privilege('authenticated','public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_orders_counters_v6(text,text,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_product_sales_lines_v6(uuid,date,date,integer,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_orders_counters_v6(text,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_product_sales_lines_v6(uuid,date,date,integer,text)','EXECUTE'),
  'droits authenticated posés, anon/PUBLIC refusés sur les trois fonctions');
INSERT INTO cpt_results SELECT ok(
  to_regprocedure('public.get_orders_list_v7(text,text,jsonb,integer,text,text,text,uuid)') IS NULL
  AND to_regprocedure('public.get_orders_counters_v5(text,text,jsonb)') IS NULL
  AND to_regprocedure('public.get_product_sales_lines_v5(uuid,date,date,integer,text)') IS NULL,
  'anciennes versions supprimées');
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
END $$;
INSERT INTO cpt_results SELECT throws_ok(
  $$SELECT public.get_orders_list_v8('1997-03-10','1997-03-10')$$,
  '42501','Authentication required','liste : absence de session refusée');
INSERT INTO cpt_results SELECT throws_ok(
  $$SELECT public.get_orders_counters_v6('1997-03-10','1997-03-10')$$,
  '42501','Authentication required','compteurs : absence de session refusée');
INSERT INTO cpt_results SELECT * FROM finish();
SELECT result FROM cpt_results;
ROLLBACK;
