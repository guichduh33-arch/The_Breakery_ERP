-- supabase/tests/orders_list_v4_sort.test.sql
-- Lot 5 chantier 4 (2026-08-13) — tri serveur blanc-listé de get_orders_list_v4.
-- Exécution : MCP execute_sql, enveloppe BEGIN … ROLLBACK.

BEGIN;
SELECT plan(9);

SELECT ok(has_function_privilege('authenticated','public.get_orders_list_v4(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE'),
  'authenticated peut exécuter v4');
SELECT ok(NOT has_function_privilege('anon','public.get_orders_list_v4(text,text,jsonb,integer,text,text,text,uuid)','EXECUTE'),
  'anon ne peut pas');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='get_orders_list_v3'), 0,
  'v3 droppée (versioning monotone)');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM user_profiles
                             WHERE id='0e2e0000-0000-4000-a000-000000000001'))::text, true);

SELECT throws_ok($$SELECT get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,5,'evil; DROP','desc')$$,
  '22023', NULL, 'tri hors liste blanche rejeté');
SELECT throws_ok($$SELECT get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,5,'total','sideways')$$,
  '22023', NULL, 'direction invalide rejetée');
SELECT ok(jsonb_array_length((get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,5,'created_at','desc'))->'lines') > 0,
  'tri défaut rend des lignes');

SELECT ok((
  WITH r AS (SELECT (get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,10,'total','asc'))->'lines' AS l)
  SELECT bool_and(((l->i->>'total')::numeric) <= ((l->(i+1)->>'total')::numeric))
  FROM r, generate_series(0, jsonb_array_length((SELECT l FROM r))-2) i
), 'tri total asc: totaux croissants');

SELECT ok((
  WITH p1 AS (SELECT get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,2,'total','asc') AS r),
       p2 AS (SELECT get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,2,'total','asc',
                (SELECT r->>'next_cursor_val' FROM p1),(SELECT (r->>'next_cursor_id')::uuid FROM p1)) AS r)
  SELECT ((SELECT r->'lines'->1->>'total' FROM p1)::numeric) <= ((SELECT r->'lines'->0->>'total' FROM p2)::numeric)
     AND (SELECT r->'lines'->0->>'id' FROM p2) NOT IN
         ((SELECT r->'lines'->0->>'id' FROM p1),(SELECT r->'lines'->1->>'id' FROM p1))
), 'curseur composite: page 2 continue sans doublon');

SELECT ok((
  WITH a AS (SELECT (get_orders_list_v4('2026-01-01','2026-12-31','{}'::jsonb,3,'order_type','asc'))->'lines' AS l)
  SELECT bool_and((l->i->>'order_type') <= (l->(i+1)->>'order_type'))
  FROM a, generate_series(0, jsonb_array_length((SELECT l FROM a))-2) i
), 'tri texte (order_type asc) ordonné');

SELECT finish();
ROLLBACK;
