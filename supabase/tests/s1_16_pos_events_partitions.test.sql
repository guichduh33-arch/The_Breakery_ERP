-- S1-16 : le journal du POS a une partition par mois, et la partition par
-- défaut reste vide. Test en lecture seule sur l'état de la base.
BEGIN;
SELECT plan(8);

SELECT ok(to_regclass('public.pos_events_2026_10') IS NOT NULL, 'october 2026 partition exists');
SELECT ok(to_regclass('public.pos_events_2026_11') IS NOT NULL, 'november 2026 partition exists');

SELECT is((SELECT count(*) FROM public.pos_events_default), 0::bigint,
  'the default partition holds no row');

-- Au moins la partition du mois prochain existe : la tâche planifiée la crée à l'avance.
SELECT ok(to_regclass('public.pos_events_' || to_char(now() + interval '1 month', 'YYYY_MM')) IS NOT NULL,
  'next month partition exists ahead of time');

SELECT is(
  (SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.pos_events'::regclass AND NOT c.relrowsecurity),
  0::bigint, 'every partition has row level security enabled');

SELECT is(
  (SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.pos_events'::regclass
      AND (has_table_privilege('authenticated', c.oid, 'SELECT,INSERT')
        OR has_table_privilege('anon', c.oid, 'SELECT,INSERT'))),
  0::bigint, 'no partition grants SELECT or INSERT to anon or authenticated');

SELECT is(
  (SELECT count(*) FROM cron.job WHERE jobname = 'pos-events-partitions-ahead'
     AND command LIKE '%create_pos_events_partition_v1%'),
  1::bigint, 'the partition job is scheduled');

SELECT is(
  (SELECT count(*) FROM cron.job WHERE jobname = 'pos-events-partitions-ahead' AND command ~ 'https?://'),
  0::bigint, 'the partition job calls no URL');

SELECT * FROM finish();
ROLLBACK;
