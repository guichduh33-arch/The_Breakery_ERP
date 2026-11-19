-- S3-01 : le terminal est obligatoire à l'ouverture, une session est unique par
-- terminal. Comptes, terminaux et sessions de ce test disparaissent avec le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE s301_results(seq serial,tap text);
GRANT ALL ON s301_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE s301_results_seq_seq TO authenticated;

CREATE TEMP TABLE s301_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,k
 FROM (VALUES('a'),('b'),('none')) r(k);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@s301.invalid' FROM s301_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'S301-'||id,'S3-01 fixture','invalid-test-hash','CASHIER',true FROM s301_actors;
-- La permission d'ouverture est posée par dérogation : le test ne dépend pas de la matrice vivante.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT id,'pos.session.open',k<>'none','S3-01 coverage' FROM s301_actors
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=EXCLUDED.is_granted,expires_at=NULL;

CREATE TEMP TABLE s301_dev AS SELECT gen_random_uuid() id,k,t,act
 FROM (VALUES('t1','pos',true),('t2','pos',true),('t3','pos',true),('off','pos',false),('tab','tablet',true)) r(k,t,act);
GRANT SELECT ON s301_dev TO authenticated;
INSERT INTO public.lan_devices(id,code,name,device_type,is_active)
 SELECT id,'S301-'||id,'S3-01 '||k,t,act FROM s301_dev;

-- Droits et structure.
INSERT INTO s301_results(tap) SELECT ok(NOT has_function_privilege('anon',
 'public.open_shift_v1(uuid,numeric,text,jsonb)','EXECUTE'),'anon cannot execute open_shift_v1');
INSERT INTO s301_results(tap) SELECT ok(has_function_privilege('authenticated',
 'public.open_shift_v1(uuid,numeric,text,jsonb)','EXECUTE'),'authenticated can execute open_shift_v1');
INSERT INTO s301_results(tap) SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE tablename='pos_sessions'
 AND indexname='one_open_session_per_terminal' AND indexdef ~ 'UNIQUE' AND indexdef ~ 'status = ''open'''),
 'One open session per terminal is a unique partial index');

-- Sans la permission : refus.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s301_actors WHERE k='none'));
SET LOCAL ROLE authenticated;
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 (SELECT id FROM s301_dev WHERE k='t3')),'P0003','forbidden','Opening without pos.session.open is refused');
RESET ROLE;

-- Caissier A : les refus de terminal, puis l'ouverture sur t1.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s301_actors WHERE k='a'));
SET LOCAL ROLE authenticated;
INSERT INTO s301_results(tap) SELECT throws_ok('SELECT public.open_shift_v1(NULL,0)',
 'P0001','terminal_required','Opening without a terminal is refused');
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 (SELECT id FROM s301_dev WHERE k='tab')),'P0001','terminal_invalid','A tablet is not a cash terminal');
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 (SELECT id FROM s301_dev WHERE k='off')),'P0001','terminal_invalid','An inactive terminal is refused');
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 gen_random_uuid()),'P0001','terminal_invalid','An unknown terminal is refused');
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,-1)',
 (SELECT id FROM s301_dev WHERE k='t1')),'P0001','invalid_opening_cash','A negative float is refused');
INSERT INTO s301_results(tap) SELECT is((public.open_shift_v1((SELECT id FROM s301_dev WHERE k='t1'),0,'  ')
 ->>'terminal_id')::uuid,(SELECT id FROM s301_dev WHERE k='t1'),'Cashier A opens a session on terminal 1');
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 (SELECT id FROM s301_dev WHERE k='t3')),'P0001','user_session_open','A cashier cannot hold two open sessions');
RESET ROLE;

INSERT INTO s301_results(tap) SELECT is((SELECT opened_by FROM public.pos_sessions
 WHERE terminal_id=(SELECT id FROM s301_dev WHERE k='t1') AND status='open'),
 (SELECT id FROM s301_actors WHERE k='a'),'The session belongs to the caller profile, not to a client value');
INSERT INTO s301_results(tap) SELECT ok((SELECT opening_notes IS NULL FROM public.pos_sessions
 WHERE terminal_id=(SELECT id FROM s301_dev WHERE k='t1') AND status='open'),'A blank note is stored as NULL');

-- L'API des tables ne contourne pas la fonction : pas d'INSERT direct, même avec la permission.
INSERT INTO s301_results(tap) SELECT ok(NOT has_table_privilege('authenticated','public.pos_sessions','INSERT'),
 'authenticated has no direct INSERT on pos_sessions');
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s301_actors WHERE k='b'));
SET LOCAL ROLE authenticated;
INSERT INTO s301_results(tap) SELECT throws_ok(format(
 'INSERT INTO public.pos_sessions(opened_by,opening_cash) VALUES(%L,0)',
 public.get_current_profile_id()),'42501',NULL,'A direct insert without a terminal is refused');
RESET ROLE;

-- Caissier B : t1 est pris, t2 passe.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s301_actors WHERE k='b'));
SET LOCAL ROLE authenticated;
INSERT INTO s301_results(tap) SELECT throws_ok(format('SELECT public.open_shift_v1(%L,0)',
 (SELECT id FROM s301_dev WHERE k='t1')),'P0001','terminal_session_open',
 'Two open sessions on the same terminal are refused');
INSERT INTO s301_results(tap) SELECT is((public.open_shift_v1((SELECT id FROM s301_dev WHERE k='t2'),0)
 ->>'terminal_id')::uuid,(SELECT id FROM s301_dev WHERE k='t2'),'Two different terminals both open');
RESET ROLE;

-- Le filet : même par une écriture directe, deux sessions ouvertes sur un terminal sont impossibles.
INSERT INTO s301_results(tap) SELECT throws_ok(format(
 'INSERT INTO public.pos_sessions(opened_by,opening_cash,terminal_id) VALUES(%L,0,%L)',
 (SELECT id FROM s301_actors WHERE k='none'),(SELECT id FROM s301_dev WHERE k='t2')),
 '23505',NULL,'The unique index refuses a second open session on a terminal');

-- Une session clôturée libère son terminal.
UPDATE public.pos_sessions SET status='closed',closed_at=now()
 WHERE terminal_id=(SELECT id FROM s301_dev WHERE k='t1') AND status='open';
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s301_actors WHERE k='a'));
SET LOCAL ROLE authenticated;
INSERT INTO s301_results(tap) SELECT ok(public.open_shift_v1((SELECT id FROM s301_dev WHERE k='t1'),0) ? 'id',
 'A closed session frees its terminal');
RESET ROLE;

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM s301_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
