-- Régressions : verrous globaux, cumul multi-fichiers et références réutilisées.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE import_fixture(actor uuid,auth_id uuid,bank uuid,march uuid,april uuid,payload jsonb,result jsonb);
DO $$ DECLARE a uuid:=gen_random_uuid();p uuid:=gen_random_uuid();BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'BIMP-'||left(p::text,8),'Bank import regression fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO import_fixture(actor,auth_id,bank) SELECT p,a,id FROM public.accounts WHERE code='1113';
END $$;

-- Ces assertions prouvent la structure de prévention ; elles ne remplacent pas une course multi-connexion.
SELECT ok(position('FOR UPDATE' IN pg_get_functiondef('public._bank_actor(text)'::regprocedure))>0,
 'common bank guard locks profile before callers acquire account or table locks');
SELECT ok((SELECT bool_and(position('public._bank_actor' IN prosrc)>0) FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname LIKE 'bank_reconciliation_%'),
 'every exposed banking family uses the common profile guard');
SELECT ok((SELECT position('public._bank_replay' IN prosrc)<position('FROM public.fiscal_periods' IN prosrc)
 AND position('FROM public.fiscal_periods' IN prosrc)<position('bank-account:' IN prosrc)
 AND position('bank-account:' IN prosrc)<position('FROM public.journal_entries j' IN prosrc)
 AND position('FROM public.journal_entries j' IN prosrc)<position('public.create_manual_je_v2' IN prosrc)
 FROM pg_proc WHERE oid='public.bank_reconciliation_post_v5(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])'::regprocedure),
 'post order is profile then replay then fiscal then account then source journal then emitter');
SELECT ok((SELECT position('public._bank_actor' IN prosrc)<position('LOCK TABLE public.journal_entries' IN prosrc)
 FROM pg_proc WHERE oid='public.bank_reconciliation_finalize_v3(uuid,jsonb,uuid)'::regprocedure),
 'finalization obtains profile before journal table SHARE locks');
SELECT ok((SELECT bool_and(position('_verify_pin_with_lockout' IN prosrc)<position('FROM fiscal_periods' IN prosrc))
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('close_fiscal_period_v2','close_fiscal_year_v3')),
 'existing fiscal closers obtain profile PIN lock before fiscal period locks');
SELECT ok(to_regprocedure('public.bank_reconciliation_import_v1(jsonb,uuid,boolean)') IS NULL
 AND to_regprocedure('public.bank_reconciliation_post_v3(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])') IS NULL
 AND to_regprocedure('public.bank_reconciliation_finalize_v2(uuid,jsonb,uuid)') IS NULL
 AND to_regprocedure('public.bank_reconciliation_balances_v1(uuid,numeric,numeric,uuid)') IS NULL,
 'all four superseded signatures dropped');

UPDATE import_fixture SET payload=jsonb_build_object('account_id',bank,'period_start','2095-03-01','period_end','2095-03-31',
 'currency','IDR','opening_balance',100,'closing_balance',NULL,'source_sha256',repeat('1',64),
 'sheet_name','Transactions','file_name','march-first.csv','rows',jsonb_build_array(jsonb_build_object(
 'source_row',2,'date','2095-03-10','amount',30,'balance',130,'description','First portion','reference','REUSED-REFERENCE')));
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true);
UPDATE import_fixture SET march=(result->>'reconciliation_id')::uuid;
UPDATE import_fixture SET payload=payload||jsonb_build_object('reconciliation_id',march,'source_sha256',repeat('2',64),
 'file_name','march-second.csv','rows',jsonb_build_array(jsonb_build_object('source_row',2,'date','2095-03-20',
 'amount',20,'balance',150,'description','Second portion','reference','REUSED-REFERENCE')));
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,balance}','151'),gen_random_uuid(),false) FROM import_fixture$q$,
 '22023','running_balance_mismatch','append rejects running balance inconsistent with preceding file');
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),false);
SELECT ok((SELECT result->'warnings' @> '[{"code":"potential_duplicate_reference","source_row":2}]'::jsonb FROM import_fixture),
 'reused reference on different date and amount produces preview warning');
SELECT is((SELECT (result->>'total')::numeric FROM import_fixture),50::numeric,
 'append preview total includes already imported amounts');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true) FROM import_fixture$q$,
 '22023','duplicate_acknowledgement_required','reused reference requires explicit confirmation');
UPDATE import_fixture SET payload=payload||'{"duplicate_acknowledged":true}',
 result=NULL;
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,'ba050000-0000-4000-a000-000000000001',true);
SELECT ok((SELECT (result->>'ok')::boolean FROM import_fixture),
 'append accepts correct cumulative balance 150 after existing amount30 and new amount20');
SELECT is((SELECT count(*)::int FROM public.bank_statement_lines WHERE reconciliation_id=(SELECT march FROM import_fixture)),2,
 'reused reference preserves both legitimate source rows');
SELECT ok((SELECT (public.bank_reconciliation_import_v2(payload,'ba050000-0000-4000-a000-000000000001',true)->>'idempotent_replay')::boolean FROM import_fixture),
 'same key still replays original confirmed import');
SELECT ok((SELECT (public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true)->>'already_imported')::boolean FROM import_fixture),
 'same file and source row with another key creates no duplicate');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,source_row}','3'),gen_random_uuid(),true) FROM import_fixture$q$,
 '22023','source_already_imported_with_different_mapping','same file cannot replay under another source-row mapping');
SELECT ok((SELECT (public.bank_reconciliation_balances_v2(march,100,150,gen_random_uuid())->>'ok')::boolean FROM import_fixture),
 'header balance update agrees with chronological multi-file running balances');

-- Soldes inconnus : un fichier antérieur est autorisé, sans inventer de solde de départ.
UPDATE import_fixture SET payload=jsonb_build_object('account_id',bank,'period_start','2095-04-01','period_end','2095-04-30',
 'currency','IDR','opening_balance',NULL,'closing_balance',NULL,'source_sha256',repeat('3',64),
 'sheet_name','Transactions','file_name','april-middle.csv','rows',jsonb_build_array(jsonb_build_object(
 'source_row',2,'date','2095-04-10','amount',30,'balance',130,'description','Middle before full statement','reference','REUSED-REFERENCE')));
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),false);
SELECT ok((SELECT result->'warnings' @> '[{"code":"potential_duplicate_reference"}]'::jsonb FROM import_fixture),
 'reference reused across historical periods is warning, not permanent rejection');
UPDATE import_fixture SET payload=payload||'{"duplicate_acknowledged":true}';
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true);
UPDATE import_fixture SET april=(result->>'reconciliation_id')::uuid;
UPDATE import_fixture SET payload=payload||jsonb_build_object('reconciliation_id',april,'source_sha256',repeat('4',64),
 'file_name','april-late.csv','rows',jsonb_build_array(jsonb_build_object('source_row',2,'date','2095-04-20',
 'amount',20,'balance',150,'description','Late portion','reference','APR-LATE')));
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,balance}','151'),gen_random_uuid(),true) FROM import_fixture$q$,
 '22023','running_balance_mismatch','existing running balance anchors append even when opening header is NULL');
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true);
SELECT ok((SELECT (result->>'ok')::boolean FROM import_fixture),'append with unknown opening validates against earlier running balance');
UPDATE import_fixture SET payload=payload||jsonb_build_object('source_sha256',repeat('5',64),'file_name','april-earlier.csv',
 'rows',jsonb_build_array(jsonb_build_object('source_row',2,'date','2095-04-05','amount',-10,'balance',100,
 'description','Earlier portion imported last','reference','APR-EARLY')));
UPDATE import_fixture SET result=public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true);
SELECT ok((SELECT (result->>'ok')::boolean FROM import_fixture),'earlier file is merged by transaction date, not arrival order');
SELECT ok((SELECT opening_balance IS NULL AND closing_balance IS NULL FROM public.bank_reconciliations
 WHERE id=(SELECT april FROM import_fixture)),'internally inferred baseline never replaces missing statement header balances');
SELECT throws_ok($q$SELECT public.bank_reconciliation_balances_v2(april,100,140,gen_random_uuid()) FROM import_fixture$q$,
 '22023','running_balance_mismatch','arithmetically balanced but wrong baseline is rejected against running balances');
SELECT ok((SELECT (public.bank_reconciliation_balances_v2(april,110,150,gen_random_uuid())->>'ok')::boolean FROM import_fixture),
 'setting header balances after earlier file uses chronological order consistently');
SELECT is((SELECT sum(amount) FROM public.bank_statement_lines WHERE reconciliation_id=(SELECT april FROM import_fixture)),40::numeric,
 'earlier, middle, and later source movements retained exactly');
SELECT ok((SELECT count(*)=2 AND min(reference)='REUSED-REFERENCE' FROM public.bank_statement_lines
 WHERE reconciliation_id IN((SELECT march FROM import_fixture),(SELECT april FROM import_fixture))
 AND reference='REUSED-REFERENCE' AND transaction_date IN('2095-03-20','2095-04-10')),
 'confirmed reference reuse across periods retains legitimate rows');
SELECT ok((SELECT metadata?'session_id' AND actor_id=(SELECT actor FROM import_fixture)
 FROM public.audit_logs WHERE entity_id=(SELECT april FROM import_fixture) AND action='accounting.bank.imported'
 ORDER BY id DESC LIMIT 1),'append audit keeps session context and profile actor');
SELECT * FROM finish();
ROLLBACK;
