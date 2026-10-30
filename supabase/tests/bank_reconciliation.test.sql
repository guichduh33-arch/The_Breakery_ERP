-- Fixtures jetables : aucune donnée bancaire réelle, aucune transaction persistée.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE bank_fixture(
 auth_id uuid,actor uuid,bank uuid,card uuid,qris uuid,expense uuid,income uuid,
 opening numeric,payload jsonb,rec uuid,bank_ids uuid[],match_result jsonb,post_result jsonb,
 final_result jsonb,next_rec uuid
);
CREATE TEMP TABLE bank_gl(label text PRIMARY KEY,id uuid,je_id uuid);
CREATE TEMP TABLE bank_results(label text PRIMARY KEY,result jsonb);
DO $$ DECLARE a uuid:=gen_random_uuid();p uuid:=gen_random_uuid();BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'BANK-'||left(p::text,8),'Bank pgTAP fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO bank_fixture(auth_id,actor,bank,card,qris,expense,income,opening)
 SELECT a,p,(SELECT id FROM public.accounts WHERE code='1113'),
  (SELECT id FROM public.accounts WHERE code='1116'),(SELECT id FROM public.accounts WHERE code='1115'),
  (SELECT id FROM public.accounts WHERE account_class=6 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1),
  (SELECT id FROM public.accounts WHERE account_class=4 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1),
  (SELECT coalesce(sum(l.debit-l.credit),0) FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
   JOIN public.accounts ac ON ac.id=l.account_id WHERE ac.code='1113' AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<'2096-01-01');
END $$;
INSERT INTO public.fiscal_periods(period_start,period_end,status,notes) VALUES
 ('2096-01-01','2096-01-31','open','Bank pgTAP fixture'),('2096-02-01','2096-02-29','open','Bank pgTAP fixture');
GRANT SELECT,UPDATE ON bank_fixture TO authenticated;
GRANT SELECT,INSERT ON bank_results TO authenticated;
GRANT SELECT ON bank_gl TO authenticated;

SELECT is((SELECT array_agg(code ORDER BY code) FROM public.permissions WHERE code LIKE 'accounting.bank.%'),
 ARRAY['accounting.bank.manage','accounting.bank.read','accounting.bank.settle','accounting.bank.validate']::text[],
 'bank permission catalog contains the four explicit codes');
SELECT is((SELECT count(*)::int FROM public.role_permissions
 WHERE role_code='SUPER_ADMIN' AND permission_code LIKE 'accounting.bank.%' AND is_granted),4,
 'immutable SUPER_ADMIN grants retain all four bank permissions');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace
 AND relname IN ('bank_reconciliations','bank_statement_lines','bank_statement_imports','bank_reconciliation_operations',
 'bank_reconciliation_matches','bank_reconciliation_bank_claims','bank_reconciliation_gl_claims','bank_reconciliation_entries',
 'bank_reconciliation_clearing_claims','bank_reconciliation_entry_bank_claims','bank_reconciliation_transit')),'all banking tables enable RLS');
SELECT ok((SELECT bool_and(NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class
 WHERE relnamespace='public'::regnamespace AND relkind='r' AND (relname LIKE 'bank_reconciliation%' OR relname LIKE 'bank_statement%')),
 'authenticated has no direct banking table privileges');
SELECT ok((SELECT bool_and(NOT has_function_privilege('anon',oid,'EXECUTE')) FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND (proname LIKE 'bank_reconciliation_%' OR proname LIKE '\_bank\_%' ESCAPE '\')),
 'anon has no banking RPC or helper execute including PUBLIC inheritance');
SELECT ok((SELECT bool_and(NOT has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname LIKE '\_bank\_%' ESCAPE '\'),'internal helpers are not callable by users');
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT public.bank_reconciliation_catalog_v1()','42501',NULL,'anon cannot call banking catalog');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.bank_reconciliations','42501',NULL,'authenticated cannot bypass RPC via table read');
SELECT lives_ok('SELECT public.bank_reconciliation_catalog_v1()','authorized active PIN session can read catalog');
RESET ROLE;
-- ADR-031/032 : les autres rôles sont éditables ; seul ce rôle jetable est sans grants.
DO $$ DECLARE v_role text:='BANK_DENY_'||left(replace(gen_random_uuid()::text,'-',''),16);BEGIN
 INSERT INTO public.roles(code,name,is_system,session_timeout_minutes)
 VALUES(v_role,'Bank permission denial fixture',false,30);
 UPDATE public.user_profiles SET role_code=v_role WHERE id=(SELECT actor FROM bank_fixture);
END $$;
SELECT is((SELECT count(*)::int FROM public.role_permissions rp JOIN public.user_profiles p ON p.role_code=rp.role_code
 WHERE p.id=(SELECT actor FROM bank_fixture) AND rp.is_granted),0,'disposable denial role has no permissions');
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.bank_reconciliation_catalog_v1()','42501','forbidden','role without permissions cannot use bank permission from stale snapshot');
RESET ROLE;
UPDATE public.user_profiles SET role_code='SUPER_ADMIN' WHERE id=(SELECT actor FROM bank_fixture);
UPDATE public.user_sessions SET ended_at=now() WHERE user_id=(SELECT actor FROM bank_fixture);
SELECT throws_ok('SELECT public.bank_reconciliation_catalog_v1()','PT401','session_expired','ended PIN session denied');
SELECT pg_temp.authenticate_pin(auth_id) FROM bank_fixture;

UPDATE bank_fixture SET payload=jsonb_build_object('account_id',bank,'period_start','2096-01-01','period_end','2096-01-31',
 'currency','IDR','opening_balance',opening,'closing_balance',opening+133,
 'source_sha256',repeat('a',64),'sheet_name','Transactions','file_name','fixture.csv','duplicate_acknowledged',true,
 'rows',jsonb_build_array(
  jsonb_build_object('source_row',2,'date','2096-01-03','amount',20,'description','Identical legitimate transfer'),
  jsonb_build_object('source_row',3,'date','2096-01-03','amount',20,'description','Identical legitimate transfer'),
  jsonb_build_object('source_row',4,'date','2096-01-04','amount',87,'description','Net card settlement'),
  jsonb_build_object('source_row',5,'date','2096-01-05','amount',-5,'description','Actual isolated bank fee'),
  jsonb_build_object('source_row',6,'date','2096-01-06','amount',2,'description','Bank interest'),
  jsonb_build_object('source_row',7,'date','2096-01-07','amount',9,'description','Investigate transfer')));
INSERT INTO bank_results SELECT 'preview',public.bank_reconciliation_import_v2(payload,'ba010000-0000-4000-a000-000000000001',false) FROM bank_fixture;
SELECT is((SELECT (result->>'row_count')::int FROM bank_results WHERE label='preview'),6,'preview preserves every source row');
SELECT is((SELECT jsonb_array_length(result->'warnings') FROM bank_results WHERE label='preview'),1,'preview flags repeated content without deleting legitimate rows');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliations WHERE created_by=(SELECT actor FROM bank_fixture)),0,'preview creates no reconciliation');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,amount}','20.001'),gen_random_uuid(),false) FROM bank_fixture$q$,
 '22023','amount_requires_two_decimals','fraction of cent is rejected, never rounded');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{currency}','"USD"'),gen_random_uuid(),false) FROM bank_fixture$q$,
 '22023','invalid_statement_source','unsupported currency rejected');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,date}','"2095-12-31"'),gen_random_uuid(),false) FROM bank_fixture$q$,
 '22023','transaction_date_outside_period_or_order','out of period row rejected');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{closing_balance}',to_jsonb(opening+134)),gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','statement_balance_mismatch','unbalanced statement rejected');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,1,source_row}','2'),gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','duplicate_source_row','source row identities cannot duplicate');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(payload-'duplicate_acknowledged',gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','duplicate_acknowledgement_required','duplicate candidates require explicit acknowledgement');
INSERT INTO bank_results SELECT 'import',public.bank_reconciliation_import_v2(payload,'ba010000-0000-4000-a000-000000000001',true) FROM bank_fixture;
UPDATE bank_fixture SET rec=(SELECT (result->>'reconciliation_id')::uuid FROM bank_results WHERE label='import');
UPDATE bank_fixture f SET bank_ids=(SELECT array_agg(id ORDER BY ordinal) FROM public.bank_statement_lines WHERE reconciliation_id=f.rec);
SELECT is((SELECT count(*)::int FROM public.bank_statement_lines WHERE reconciliation_id=(SELECT rec FROM bank_fixture)),6,'confirm retains the two identical legitimate lines');
SELECT ok((SELECT (public.bank_reconciliation_import_v2(payload,'ba010000-0000-4000-a000-000000000001',true)->>'idempotent_replay')::boolean FROM bank_fixture),'same key replays first import');
SELECT ok((SELECT (public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true)->>'already_imported')::boolean FROM bank_fixture),'same source with another key does not duplicate');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(payload||'{"file_name":"changed.csv"}','ba010000-0000-4000-a000-000000000001',true) FROM bank_fixture$q$,
 '22023','idempotency_payload_conflict','same key with changed payload refused');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(jsonb_set(payload,'{rows,0,description}','"Remapped"'),gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','source_already_imported_with_different_mapping','same source cannot be silently remapped');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(payload||jsonb_build_object('source_sha256',repeat('b',64)),gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','reconciliation_period_overlap','overlapping reconciliation refused');
SELECT throws_ok($q$SELECT public.bank_reconciliation_import_v2(payload||jsonb_build_object('reconciliation_id',rec,'source_sha256',repeat('b',64)),gen_random_uuid(),true) FROM bank_fixture$q$,
 '22023','potential_duplicate_existing_statement','cross-file possible duplicates refused without deleting anything');

-- Émetteur normal pour les journaux fixtures ; seules les références source de test sont annotées ensuite.
DO $$ DECLARE f record;v jsonb;spec record;BEGIN
 SELECT * INTO f FROM bank_fixture;
 FOR spec IN SELECT * FROM (VALUES
  ('bank25',25::numeric,'bank'),('bank15',15,'bank'),('bank9',9,'bank'),('transit7',7,'bank'),
  ('card100',100,'card'),('card_refund10',-10,'card')) s(label,amount,target) LOOP
  v:=public.create_manual_je_v2('Bank fixture '||spec.label,'2096-01-02',jsonb_build_array(
   jsonb_build_object('account_id',CASE WHEN spec.target='bank' THEN f.bank ELSE f.card END,
    'debit',greatest(spec.amount,0),'credit',greatest(-spec.amount,0)),
   jsonb_build_object('account_id',f.income,'debit',greatest(-spec.amount,0),'credit',greatest(spec.amount,0))),'285741');
  INSERT INTO bank_gl SELECT spec.label,l.id,l.journal_entry_id FROM public.journal_entry_lines l
   WHERE l.journal_entry_id=(v->>'je_id')::uuid AND l.account_id=CASE WHEN spec.target='bank' THEN f.bank ELSE f.card END;
  IF spec.target='card' THEN UPDATE public.journal_entries SET reference_type=CASE WHEN spec.amount>0 THEN 'sale' ELSE 'sale_refund' END,
   reference_id=gen_random_uuid() WHERE id=(v->>'je_id')::uuid; END IF;
 END LOOP;
END $$;
SELECT ok((SELECT jsonb_array_length(public.bank_reconciliation_catalog_v1()->'bank_accounts')>=2),'eligible bank account catalog available');
-- Dates ajustées uniquement dans les fixtures pour une suggestion exacte.
UPDATE public.journal_entries SET entry_date='2096-01-07' WHERE id=(SELECT je_id FROM bank_gl WHERE label='bank9');
SELECT is((SELECT jsonb_array_length(public.bank_reconciliation_suggestions_v1(rec,0,1)->'items') FROM bank_fixture),
 1,'unique exact suggestion found before pagination');
SELECT is((SELECT public.bank_reconciliation_suggestions_v1(rec,0,1)->'items'->0->>'gl_line_id' FROM bank_fixture),
 (SELECT id::text FROM bank_gl WHERE label='bank9'),'exact suggestion exposes journal line ID');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_matches WHERE reconciliation_id=(SELECT rec FROM bank_fixture)),
 0,'suggestion read persists no match');
CREATE FUNCTION pg_temp.suggestion_ambiguity() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE f record;v jsonb;none_found boolean;BEGIN
 SELECT * INTO f FROM bank_fixture;
 BEGIN
  v:=public.create_manual_je_v2('Duplicate exact candidate fixture','2096-01-07',jsonb_build_array(
   jsonb_build_object('account_id',f.bank,'debit',9,'credit',0),jsonb_build_object('account_id',f.income,'debit',0,'credit',9)),'285741');
  none_found:=jsonb_array_length(public.bank_reconciliation_suggestions_v1(f.rec,0,1)->'items')=0;
  RAISE EXCEPTION 'rollback_fixture' USING ERRCODE='P0099';
 EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
 END;
 RETURN none_found;
END $$;
SELECT ok(pg_temp.suggestion_ambiguity(),'GL ambiguity outside page suppresses unsafe suggestion globally');
UPDATE public.journal_entries SET status='locked' WHERE id=(SELECT je_id FROM bank_gl WHERE label='bank25');
SELECT ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(public.bank_reconciliation_detail_v2(rec,0,NULL,100)->'gl_lines') x
 WHERE x->>'id'=(SELECT id::text FROM bank_gl WHERE label='bank25')) FROM bank_fixture),'locked posted journals remain effective bank GL sources');
SELECT is((SELECT jsonb_array_length(public.bank_reconciliation_list_v1(bank,NULL,1)->'items') FROM bank_fixture),1,'list supports bounded keyset page');
SELECT throws_ok('SELECT public.bank_reconciliation_list_v1(NULL,NULL,101)','22023','invalid_page_size','unbounded list size refused');
SELECT is((SELECT jsonb_array_length(public.bank_reconciliation_detail_v2(rec,0,NULL,2)->'bank_lines') FROM bank_fixture),2,'bank detail paginates source rows');
SELECT ok((SELECT public.bank_reconciliation_detail_v2(rec,0,NULL,2)->>'next_bank_after' IS NOT NULL FROM bank_fixture),'bank keyset cursor returned');
SELECT ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(public.bank_reconciliation_clearing_v3(rec,NULL,100)->'items') x
 WHERE x->>'id'=(SELECT id::text FROM bank_gl WHERE label='card_refund10')) FROM bank_fixture),'clearing candidates preserve negative refund source');
SELECT throws_ok($q$SELECT public.bank_reconciliation_match_v2(rec,ARRAY[bank_ids[1]],ARRAY[(SELECT id FROM bank_gl WHERE label='bank25')],gen_random_uuid()) FROM bank_fixture$q$,
 '22023','match_amount_mismatch','no implicit amount tolerance');
UPDATE bank_fixture SET match_result=public.bank_reconciliation_match_v2(rec,bank_ids[1:2],
 ARRAY[(SELECT id FROM bank_gl WHERE label='bank25'),(SELECT id FROM bank_gl WHERE label='bank15')],
 'ba020000-0000-4000-a000-000000000001');
SELECT is((SELECT (match_result->>'amount')::numeric FROM bank_fixture),40::numeric,'group match N bank to M GL exact sum');
SELECT ok((SELECT (public.bank_reconciliation_match_v2(rec,bank_ids[1:2],
 ARRAY[(SELECT id FROM bank_gl WHERE label='bank25'),(SELECT id FROM bank_gl WHERE label='bank15')],
 'ba020000-0000-4000-a000-000000000001')->>'idempotent_replay')::boolean FROM bank_fixture),'match retry returns original result');
SELECT throws_ok($q$SELECT public.bank_reconciliation_match_v2(rec,bank_ids[1:2],
 ARRAY[(SELECT id FROM bank_gl WHERE label='bank25'),(SELECT id FROM bank_gl WHERE label='bank15')],gen_random_uuid()) FROM bank_fixture$q$,
 '22023','bank_line_unavailable','bank line cannot be allocated twice');
SELECT throws_ok($q$SELECT public.bank_reconciliation_match_v2(rec,bank_ids[1:2],
 ARRAY[(SELECT id FROM bank_gl WHERE label='bank25'),(SELECT id FROM bank_gl WHERE label='bank25')],gen_random_uuid()) FROM bank_fixture$q$,
 '22023','unique_match_lines_required','duplicate GL identifiers rejected');

CREATE FUNCTION pg_temp.bank_post(p_fee numeric DEFAULT 3,p_pin text DEFAULT '285741') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[3]],
  ARRAY[(SELECT id FROM bank_gl WHERE label='card100'),(SELECT id FROM bank_gl WHERE label='card_refund10')],
  expense,p_fee,'2096-01-04','Actual card settlement',p_pin,'ba030000-0000-4000-a000-000000000001') FROM bank_fixture;
$$;
SELECT throws_ok('SELECT pg_temp.bank_post(2)','22023','settlement_net_mismatch','settlement uses signed clearing minus actual fee exactly');
SELECT throws_ok('SELECT pg_temp.bank_post(3.001)','22023','amount_requires_two_decimals','settlement fee rejects fractional cent');
INSERT INTO bank_results VALUES('invalid_pin',pg_temp.bank_post(3,'999999'));
SELECT is((SELECT result->>'error' FROM bank_results WHERE label='invalid_pin'),'invalid_pin','invalid PIN returned as committable refusal');
SELECT is((SELECT failed_login_attempts FROM public.user_profiles WHERE id=(SELECT actor FROM bank_fixture)),1,'PIN refusal counter survives function return');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_entries WHERE reconciliation_id=(SELECT rec FROM bank_fixture)),0,'invalid PIN creates no bank journal link');
UPDATE public.fiscal_periods SET status='closed' WHERE period_start='2096-01-01';
SELECT throws_ok('SELECT pg_temp.bank_post()','P0004',NULL,'closed fiscal period refuses settlement');
UPDATE public.fiscal_periods SET status='open' WHERE period_start='2096-01-01';
CREATE FUNCTION pg_temp.fail_bank_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_atomic_abort' USING ERRCODE='P0001';END $$;
CREATE TRIGGER fixture_fail_bank_entry BEFORE INSERT ON public.bank_reconciliation_entries FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_bank_entry();
SELECT throws_ok('SELECT pg_temp.bank_post()','P0001','fixture_atomic_abort','failure after journal emission aborts full settlement');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE description='Actual card settlement'),0,'failed settlement leaves no orphan journal');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_clearing_claims WHERE gl_line_id IN(SELECT id FROM bank_gl)),0,'failed settlement leaves no clearing reservation');
DROP TRIGGER fixture_fail_bank_entry ON public.bank_reconciliation_entries;
UPDATE bank_fixture SET post_result=pg_temp.bank_post();
SELECT ok((SELECT (post_result->>'ok')::boolean FROM bank_fixture),'correct PIN posts actual settlement');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_clearing_claims WHERE gl_line_id IN(SELECT id FROM bank_gl)),2,'both positive sale and negative refund reserved once');
SELECT ok((SELECT j.total_debit=j.total_credit AND j.status='posted' FROM public.journal_entries j,bank_fixture f
 WHERE j.id=(f.post_result->>'je_id')::uuid),'settlement journal posted and balanced');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,bank_fixture f
 WHERE l.journal_entry_id=(f.post_result->>'je_id')::uuid AND l.account_id=f.card),-90::numeric,'clearing uses signed net100 minus refund10');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,bank_fixture f
 WHERE l.journal_entry_id=(f.post_result->>'je_id')::uuid AND l.account_id=f.expense),3::numeric,'actual expense booked once');
SELECT ok((pg_temp.bank_post()->>'idempotent_replay')::boolean,'settlement retry returns same journal');
SELECT throws_ok($q$SELECT public.bank_reconciliation_unmatch_v1((post_result->>'match_id')::uuid,'',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','reason_required','removing a match requires reason');
SELECT public.bank_reconciliation_unmatch_v1((post_result->>'match_id')::uuid,'Correct bank linking',gen_random_uuid()) FROM bank_fixture;
SELECT is((SELECT count(*)::int FROM public.journal_entries j,bank_fixture f WHERE j.id=(f.post_result->>'je_id')::uuid),1,'unmatch never removes journal');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_clearing_claims WHERE gl_line_id IN(SELECT id FROM bank_gl)),2,'unmatch never releases clearing reservations');
SELECT ok((pg_temp.bank_post()->>'idempotent_replay')::boolean,'replay after unmatch does not create a new journal');
SELECT throws_ok($q$SELECT public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[3]],
 ARRAY[(SELECT id FROM bank_gl WHERE label='card100'),(SELECT id FROM bank_gl WHERE label='card_refund10')],
 expense,3,'2096-01-04','Actual card settlement','285741',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','bank_line_unavailable_for_posting','source bank line cannot emit second journal after unmatch');
SELECT public.bank_reconciliation_match_v2(rec,ARRAY[bank_ids[3]],ARRAY[(post_result->>'bank_gl_line_id')::uuid],gen_random_uuid()) FROM bank_fixture;
INSERT INTO bank_results SELECT 'fee',public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[4]],'{}',expense,0,
 '2096-01-05','Isolated actual bank fee','285741',gen_random_uuid(),'fee') FROM bank_fixture;
INSERT INTO bank_results SELECT 'interest',public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[5]],'{}',income,0,
 '2096-01-06','Actual bank interest','285741',gen_random_uuid(),'interest') FROM bank_fixture;
SELECT ok((SELECT (result->>'ok')::boolean FROM bank_results WHERE label='fee'),'isolated outgoing fee posts against explicit expense');
SELECT ok((SELECT (result->>'ok')::boolean FROM bank_results WHERE label='interest'),'incoming interest posts against explicit income');
SELECT throws_ok($q$SELECT public.bank_reconciliation_finalize_v3(rec,'[]',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','unmatched_bank_lines','unknown bank transaction blocks finalization');
SELECT public.bank_reconciliation_match_v2(rec,ARRAY[bank_ids[6]],ARRAY[(SELECT id FROM bank_gl WHERE label='bank9')],gen_random_uuid()) FROM bank_fixture;
SELECT throws_ok($q$SELECT public.bank_reconciliation_finalize_v3(rec,'[]',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','every_unmatched_gl_requires_transit_reason','unexplained accounting transit blocks finalization');
SELECT throws_ok($q$SELECT public.bank_reconciliation_finalize_v3(rec,jsonb_build_array(jsonb_build_object('gl_line_id',
 (SELECT id FROM bank_gl WHERE label='transit7'),'reason','')),gen_random_uuid()) FROM bank_fixture$q$,
 '22023','transit_reason_required','every carried accounting line needs written reason');
SELECT public.bank_reconciliation_balances_v2(rec,NULL,NULL,gen_random_uuid()) FROM bank_fixture;
SELECT throws_ok($q$SELECT public.bank_reconciliation_finalize_v3(rec,'[]',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','statement_balances_required','missing balances remain unavailable and block finalization');
SELECT public.bank_reconciliation_balances_v2(rec,opening,opening+133,gen_random_uuid()) FROM bank_fixture;
UPDATE bank_fixture SET final_result=public.bank_reconciliation_finalize_v3(rec,jsonb_build_array(jsonb_build_object(
 'gl_line_id',(SELECT id FROM bank_gl WHERE label='transit7'),'reason','Transfer reaches bank next month')),
 'ba040000-0000-4000-a000-000000000001');
SELECT is((SELECT final_result->>'status' FROM bank_fixture),'finalized','exact balances and justified accounting transit finalize');
SELECT is((SELECT (final_result->>'transit_total')::numeric FROM bank_fixture),7::numeric,'signed transit amount frozen');
SELECT ok((SELECT r.snapshot_sha256=encode(extensions.digest(r.snapshot::text,'sha256'),'hex') FROM public.bank_reconciliations r,bank_fixture f
 WHERE r.id=f.rec),'final snapshot hash matches exact captured data');
SELECT throws_ok($q$SELECT public.bank_reconciliation_unmatch_v1((match_result->>'match_id')::uuid,'Too late correction',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','reconciliation_finalized','finalized reconciliation cannot unmatch');
SELECT throws_ok($q$SELECT public.bank_reconciliation_balances_v2(rec,opening,opening+133,gen_random_uuid()) FROM bank_fixture$q$,
 '22023','reconciliation_finalized','finalized balances cannot change');
SELECT ok((SELECT (public.bank_reconciliation_finalize_v3(rec,jsonb_build_array(jsonb_build_object(
 'gl_line_id',(SELECT id FROM bank_gl WHERE label='transit7'),'reason','Transfer reaches bank next month')),
 'ba040000-0000-4000-a000-000000000001')->>'idempotent_replay')::boolean FROM bank_fixture),'finalization replay works after state changed');

UPDATE bank_fixture SET payload=jsonb_build_object('account_id',bank,'period_start','2096-02-01','period_end','2096-02-29',
 'currency','IDR','opening_balance',opening+133,'closing_balance',opening+140,'source_sha256',repeat('c',64),
 'sheet_name','Transactions','file_name','next.csv','rows',jsonb_build_array(jsonb_build_object('source_row',2,
 'date','2096-02-02','amount',7,'description','Prior month transit now banked')));
UPDATE bank_fixture SET next_rec=(public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true)->>'reconciliation_id')::uuid;
SELECT ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(public.bank_reconciliation_detail_v2(next_rec,0,NULL,100)->'gl_lines') x
 WHERE x->>'id'=(SELECT id::text FROM bank_gl WHERE label='transit7')) FROM bank_fixture),'next reconciliation includes unresolved prior transit by original line ID');
UPDATE public.journal_entry_lines SET debit=8 WHERE id=(SELECT id FROM bank_gl WHERE label='transit7');
SELECT is((SELECT public.bank_reconciliation_detail_v2(rec,0,NULL,100)->'source_integrity'->>'state' FROM bank_fixture),
 'changed','final detail explicitly identifies live GL drift from frozen snapshot');
SELECT is((SELECT (public.bank_reconciliation_detail_v2(rec,0,NULL,100)->'balances'->>'gl_closing')::numeric FROM bank_fixture),
 (SELECT opening+140 FROM bank_fixture),'final detail keeps frozen GL balance after later source change');
UPDATE public.journal_entry_lines SET debit=7 WHERE id=(SELECT id FROM bank_gl WHERE label='transit7');
SELECT is((SELECT public.bank_reconciliation_detail_v2(rec,0,NULL,100)->'source_integrity'->>'state' FROM bank_fixture),
 'consistent','restored identical source hash is consistent');
UPDATE public.journal_entry_lines SET debit=8 WHERE id=(SELECT id FROM bank_gl WHERE label='transit7');
SELECT throws_ok($q$SELECT public.bank_reconciliation_finalize_v3(next_rec,'[]',gen_random_uuid()) FROM bank_fixture$q$,
 '22023','previous_reconciliation_source_changed','next finalization refuses a changed prior GL source');
UPDATE public.journal_entry_lines SET debit=7 WHERE id=(SELECT id FROM bank_gl WHERE label='transit7');
SELECT public.bank_reconciliation_match_v2(next_rec,
 ARRAY[(SELECT id FROM public.bank_statement_lines WHERE reconciliation_id=f.next_rec)],
 ARRAY[(SELECT id FROM bank_gl WHERE label='transit7')],gen_random_uuid()) FROM bank_fixture f;
SELECT is((SELECT public.bank_reconciliation_finalize_v3(next_rec,'[]',gen_random_uuid())->>'status' FROM bank_fixture),
 'finalized','carried line settles once in next period with coherent opening and closing balances');
SELECT is((SELECT count(*)::int FROM public.audit_logs a,bank_fixture f WHERE a.actor_id=f.actor AND a.action='accounting.bank.finalized'),
 2,'each finalization writes profile-linked audit');
SELECT ok((SELECT bool_and(a.actor_id<>f.auth_id AND a.metadata?'session_id' AND a.payload IS NOT NULL)
 FROM public.audit_logs a,bank_fixture f WHERE a.actor_id=f.actor AND a.action LIKE 'accounting.bank.%'),
 'bank audit separates profile actor, session context, and payload');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_operations o,bank_fixture f WHERE o.actor_id=f.actor
 AND (o.result::text LIKE '%285741%' OR o.result::text LIKE '%999999%')),'durable replay records contain no PIN');
SELECT * FROM finish();
ROLLBACK;
