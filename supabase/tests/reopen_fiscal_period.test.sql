-- S1-03 — réouverture d'une période fiscale : propriétaire, PIN, closed -> open.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(18);

DO $$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  ma uuid := gen_random_uuid(); mp uuid := gen_random_uuid();
  closed_id uuid := gen_random_uuid(); locked_id uuid := gen_random_uuid();
  open_id uuid := gen_random_uuid(); yc_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES (oa), (ma);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
  VALUES (op,oa,'RFP-O-'||left(op::text,6),'Reopen owner fixture','SUPER_ADMIN',public.hash_pin('285741'),true),
         (mp,ma,'RFP-M-'||left(mp::text,6),'Reopen manager fixture','MANAGER',public.hash_pin('285741'),true);
  -- Exercices lointains : aucune collision avec les périodes semées.
  INSERT INTO public.fiscal_periods(id,period_start,period_end,status,closed_by,closed_at) VALUES
    (closed_id,'2090-03-01','2090-03-31','closed',op,now()),
    (yc_id,    '2091-03-01','2091-03-31','closed',op,now());
  INSERT INTO public.fiscal_periods(id,period_start,period_end,status,closed_by,closed_at,locked_by,locked_at) VALUES
    (locked_id,'2090-04-01','2090-04-30','locked',op,now(),op,now());
  INSERT INTO public.fiscal_periods(id,period_start,period_end,status) VALUES
    (open_id,'2090-05-01','2090-05-31','open'),
    (gen_random_uuid(),'2091-12-01','2091-12-31','open');
  -- Exercice 2091 déjà clôturé annuellement.
  INSERT INTO public.journal_entries(entry_number,entry_date,description,reference_type,status,total_debit,total_credit,created_by)
  VALUES ('JE-RFP-YC-2091','2091-12-31','Year close fixture','year_close','posted',0,0,op);
  UPDATE public.fiscal_periods SET status='closed' WHERE period_end='2091-12-31';

  PERFORM set_config('rfp.owner_auth',oa::text,true);
  PERFORM set_config('rfp.owner',op::text,true);
  PERFORM set_config('rfp.manager_auth',ma::text,true);
  PERFORM set_config('rfp.closed',closed_id::text,true);
  PERFORM set_config('rfp.locked',locked_id::text,true);
  PERFORM set_config('rfp.open',open_id::text,true);
  PERFORM set_config('rfp.yc',yc_id::text,true);
  INSERT INTO public.business_config DEFAULT VALUES ON CONFLICT DO NOTHING;
END $$;

SELECT ok(NOT has_function_privilege('anon','public.reopen_fiscal_period_v1(uuid,text,text)','EXECUTE'),
  'anon cannot execute, inherited PUBLIC grant included');
SELECT ok(has_function_privilege('authenticated','public.reopen_fiscal_period_v1(uuid,text,text)','EXECUTE'),
  'authenticated keeps execute');

-- Non-propriétaire : refus, même avec le bon PIN.
SELECT pg_temp.authenticate_pin(current_setting('rfp.manager_auth')::uuid);
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.closed')::uuid,'285741') $q$,
  'P0003','forbidden','a non-owner is refused');
SELECT is((SELECT status FROM public.fiscal_periods WHERE id=current_setting('rfp.closed')::uuid),
  'closed','the refused call leaves the period closed');

-- Propriétaire.
SELECT pg_temp.authenticate_pin(current_setting('rfp.owner_auth')::uuid);
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.closed')::uuid,NULL) $q$,
  'P0001','pin_required','a missing PIN is refused');
SELECT is(public.reopen_fiscal_period_v1(current_setting('rfp.closed')::uuid,'999999')->>'error',
  'invalid_pin','a wrong PIN returns a refusal');
SELECT is((SELECT failed_login_attempts FROM public.user_profiles WHERE id=current_setting('rfp.owner')::uuid),
  1,'the wrong PIN is counted');
SELECT is((SELECT status FROM public.fiscal_periods WHERE id=current_setting('rfp.closed')::uuid),
  'closed','a wrong PIN leaves the period closed');
SELECT throws_ok($q$ SELECT public.check_fiscal_period_open('2090-03-15'::date) $q$,
  'P0004',NULL,'writes are refused while the period is closed');

SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.locked')::uuid,'285741') $q$,
  'P0003','period_locked_irreversible','a locked period stays locked');
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.open')::uuid,'285741') $q$,
  'P0003','period_not_closed','an open period cannot be reopened');
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.yc')::uuid,'285741') $q$,
  'P0003','fiscal_year_already_closed','a period of a year-closed exercise is refused');
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(gen_random_uuid(),'285741') $q$,
  'P0002','period_not_found','an unknown period is refused');

SELECT is(public.reopen_fiscal_period_v1(current_setting('rfp.closed')::uuid,'285741','  Late supplier invoice ')->>'new_status',
  'open','the owner reopens a closed period with a valid PIN');
SELECT ok((SELECT status='open' AND closed_by IS NULL AND closed_at IS NULL
  FROM public.fiscal_periods WHERE id=current_setting('rfp.closed')::uuid),
  'the period is open and its closing stamps are cleared');
SELECT lives_ok($q$ SELECT public.check_fiscal_period_open('2090-03-15'::date) $q$,
  'writes pass again after the reopening');
SELECT is((SELECT count(*)::int FROM public.audit_logs
  WHERE action='accounting.period.reopened' AND entity_id=current_setting('rfp.closed')::uuid
    AND actor_id=current_setting('rfp.owner')::uuid
    AND metadata->>'reason'='Late supplier invoice' AND metadata->>'old_status'='closed'
    AND payload IS NULL),
  1,'one audit line carries the profile as actor, the trimmed reason, and no payload');

-- Compte verrouillé : le refus précède toute lecture de période.
UPDATE public.user_profiles SET locked_until = now() + interval '5 minutes'
  WHERE id=current_setting('rfp.owner')::uuid;
SELECT throws_ok($q$ SELECT public.reopen_fiscal_period_v1(current_setting('rfp.yc')::uuid,'285741') $q$,
  'P0004','account_locked','a locked account is refused even with the right PIN');

SELECT * FROM finish();
ROLLBACK;
