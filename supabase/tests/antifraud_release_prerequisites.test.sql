-- Création depuis un état privé incomplet et rejeu idempotent, sans effet durable.
BEGIN;
SELECT plan(13);
-- Fixtures des seuls noms requis par la garde historique de retraite.
-- Ces signatures sans argument ne sont jamais des API applicatives.
CREATE FUNCTION public.record_production_v10() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
CREATE FUNCTION public.record_batch_production_v12() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
CREATE FUNCTION public.record_kitchen_production_v5() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
REVOKE ALL ON FUNCTION public.record_production_v10(),public.record_batch_production_v12(),public.record_kitchen_production_v5() FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION IF EXISTS stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason);
DROP FUNCTION IF EXISTS stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean);
\ir ../migrations/20261105000037_antifraud_native_release_dependencies.sql
\ir ../migrations/20261105000037_antifraud_native_release_dependencies.sql
SELECT is(md5(pg_get_functiondef('stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)'::regprocedure)),'12588c62025d406f5fb0a755458e063e','record_production_v8 is restored exactly and survives a replay');
SELECT ok(NOT has_function_privilege('authenticated','stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)','EXECUTE') AND NOT has_function_privilege('anon','stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)','EXECUTE'),'record_production_v8 remains private to its definer');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)'::regprocedure),'record_production_v8 retains its SECURITY DEFINER contract');
SELECT is(md5(pg_get_functiondef('stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean)'::regprocedure)),'bb79564c6b975b4202dede98eb47315a','pay_existing_order_v23 is restored exactly and survives a replay');
SELECT ok(NOT has_function_privilege('authenticated','stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean)','EXECUTE') AND NOT has_function_privilege('anon','stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean)','EXECUTE'),'pay_existing_order_v23 remains private to its definer');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean)'::regprocedure),'pay_existing_order_v23 retains its SECURITY DEFINER contract');
SELECT ok(to_regprocedure('public.record_production_v11(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)') IS NOT NULL,'Production wrapper remains published');
SELECT ok(to_regprocedure('public.pay_existing_order_v25(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,uuid,boolean)') IS NOT NULL,'Payment wrapper remains published');
-- Une ancienne API simulée dans cette transaction doit disparaître sans toucher au privé.
CREATE FUNCTION public.record_production_v8() RETURNS integer LANGUAGE sql AS 'SELECT 1';
\ir ../migrations/20261105000038_antifraud_retire_native_bypasses.sql
\ir ../migrations/20261105000038_antifraud_retire_native_bypasses.sql
SELECT ok(to_regprocedure('public.record_production_v8()') IS NULL,'Legacy public API is retired idempotently');
SELECT ok(to_regprocedure('stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)') IS NOT NULL,'Private production implementation is preserved');
DROP FUNCTION public.record_production_v10(),public.record_batch_production_v12(),public.record_kitchen_production_v5();
-- Le replay historique est ensuite rattrapé par la migration courante, deux fois.
\ir ../migrations/20261108000003_production_number_unbounded_sequence.sql
\ir ../migrations/20261108000003_production_number_unbounded_sequence.sql
SELECT ok(to_regprocedure('stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)') IS NULL,'Current migration retires the restored historical implementation');
SELECT ok(to_regprocedure('public.record_production_v10(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)') IS NULL,'Current migration does not restore the previous public signature');
SELECT is(stock_private.format_production_sequence(10000),'10000','Current migration replay retains unbounded production suffixes');
SELECT * FROM finish();
ROLLBACK;
