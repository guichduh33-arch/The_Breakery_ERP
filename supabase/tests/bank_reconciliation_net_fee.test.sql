-- Règlement B2B déjà en banque : seule la charge de frais réelle est créée.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE net_fixture(actor uuid,auth_id uuid,bank uuid,income uuid,expense uuid,rec uuid,
 bank_ids uuid[],gl_ids uuid[],entry_result jsonb);
CREATE TEMP TABLE net_sources(id uuid,je_id uuid);
DO $$ DECLARE a uuid:=gen_random_uuid();p uuid:=gen_random_uuid();b uuid;inc uuid;exp uuid;v jsonb;r jsonb;BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'NET-'||left(p::text,8),'Bank net fee fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 SELECT id INTO b FROM public.accounts WHERE code='1113';
 SELECT id INTO inc FROM public.accounts WHERE account_class=4 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1;
 SELECT id INTO exp FROM public.accounts WHERE account_class=6 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1;
 INSERT INTO public.fiscal_periods(period_start,period_end,status,notes) VALUES('2097-01-01','2097-01-31','open','Net fee pgTAP');
 r:=public.bank_reconciliation_import_v2(jsonb_build_object('account_id',b,'period_start','2097-01-01','period_end','2097-01-31',
  'currency','IDR','source_sha256',repeat('d',64),'sheet_name','Sheet1','file_name','net.csv','rows',jsonb_build_array(
   jsonb_build_object('source_row',2,'date','2097-01-05','amount',98000,'description','B2B gross100000 net98000','reference','NET-A'),
   jsonb_build_object('source_row',3,'date','2097-01-06','amount',98000,'description','Independent bank row','reference','NET-B'))),gen_random_uuid(),true);
 INSERT INTO net_fixture SELECT p,a,b,inc,exp,(r->>'reconciliation_id')::uuid,
  (SELECT array_agg(id ORDER BY ordinal) FROM public.bank_statement_lines WHERE reconciliation_id=(r->>'reconciliation_id')::uuid),'{}',NULL;
 v:=public.create_manual_je_v2('B2B original gross payment','2097-01-02',jsonb_build_array(
  jsonb_build_object('account_id',b,'debit',110000,'credit',0),jsonb_build_object('account_id',inc,'debit',0,'credit',110000)),'285741');
 UPDATE public.journal_entries SET reference_type='b2b_payment',reference_id=gen_random_uuid() WHERE id=(v->>'je_id')::uuid;
 INSERT INTO net_sources SELECT id,journal_entry_id FROM public.journal_entry_lines WHERE journal_entry_id=(v->>'je_id')::uuid AND account_id=b;
 v:=public.create_manual_je_v2('B2B original signed reversal','2097-01-03',jsonb_build_array(
  jsonb_build_object('account_id',b,'debit',0,'credit',10000),jsonb_build_object('account_id',inc,'debit',10000,'credit',0)),'285741');
 UPDATE public.journal_entries SET reference_type='b2b_payment',reference_id=gen_random_uuid() WHERE id=(v->>'je_id')::uuid;
 INSERT INTO net_sources SELECT id,journal_entry_id FROM public.journal_entry_lines WHERE journal_entry_id=(v->>'je_id')::uuid AND account_id=b;
 UPDATE net_fixture SET gl_ids=(SELECT array_agg(id ORDER BY id) FROM net_sources);
END $$;
CREATE FUNCTION pg_temp.net_post(p_key uuid DEFAULT 'be010000-0000-4000-a000-000000000001',p_fee numeric DEFAULT 2000,
 p_pin text DEFAULT '285741',p_bank_index integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[p_bank_index]],'{}',expense,p_fee,'2097-01-05',
  'Actual fee for banked B2B payment',p_pin,p_key,'net_fee',gl_ids) FROM net_fixture;
$$;
SELECT ok(to_regprocedure('public.bank_reconciliation_post_v1(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text)') IS NULL,'old post signature dropped atomically');
SELECT ok(NOT has_function_privilege('anon','public.bank_reconciliation_post_v5(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])','EXECUTE'),
 'net fee endpoint denies anon including PUBLIC inheritance');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.bank_reconciliation_net_fee_claims'::regclass)
 AND NOT has_table_privilege('authenticated','public.bank_reconciliation_net_fee_claims','SELECT,INSERT,UPDATE,DELETE'),
 'net fee reservations private under RLS');
SELECT throws_ok('SELECT pg_temp.net_post(p_fee:=1999)','22023','net_fee_amount_mismatch','net fee exact signed gross minus actual fee');
SELECT throws_ok('SELECT pg_temp.net_post(p_fee:=2000.001)','22023','amount_requires_two_decimals','net fee fractions of cent refused');
SELECT throws_ok('SELECT pg_temp.net_post(p_fee:=0)','22023','net_fee_sources_required','zero fee cannot emit adjustment');
SELECT throws_ok($q$SELECT public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[1]],'{}',income,2000,'2097-01-05',
 'Wrong expense account','285741',gen_random_uuid(),'net_fee',gl_ids) FROM net_fixture$q$,
 '22023','explicit_counter_account_required','net fee counterparty must be explicit postable expense');
SELECT is(pg_temp.net_post(p_pin:='999999')->>'error','invalid_pin','invalid net fee PIN is committable refusal');
SELECT is((SELECT failed_login_attempts FROM public.user_profiles WHERE id=(SELECT actor FROM net_fixture)),1,'net fee invalid PIN retains failure count');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_net_fee_claims WHERE gl_line_id IN(SELECT id FROM net_sources)),0,
 'PIN failure creates no permanent source reservation');
UPDATE net_fixture SET entry_result=pg_temp.net_post();
SELECT ok((SELECT (entry_result->>'ok')::boolean FROM net_fixture),'banked B2B actual fee posted');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines l,net_fixture f WHERE l.journal_entry_id=(f.entry_result->>'je_id')::uuid),
 2,'only one expense and one bank line emitted');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,net_fixture f
 WHERE l.journal_entry_id=(f.entry_result->>'je_id')::uuid AND l.account_id=f.bank),-2000::numeric,'fee journal credits bank only actual fee');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,net_fixture f
 WHERE l.journal_entry_id=(f.entry_result->>'je_id')::uuid AND l.account_id=f.expense),2000::numeric,'fee journal debits explicit expense');
SELECT ok((SELECT total_debit=2000 AND total_credit=2000 FROM public.journal_entries j,net_fixture f
 WHERE j.id=(f.entry_result->>'je_id')::uuid),'fee-only journal exactly balanced');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l WHERE l.id IN(SELECT id FROM net_sources)),100000::numeric,
 'original signed bank payment sources untouched');
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_clearing_claims c,net_fixture f
 JOIN public.bank_reconciliation_entries e ON e.id=(f.entry_result->>'entry_id')::uuid WHERE c.bank_entry_id=e.id),0,
 'already banked B2B payment never enters clearing settlement');
SELECT is((SELECT cardinality(m.gl_line_ids) FROM public.bank_reconciliation_matches m,net_fixture f
 WHERE m.id=(f.entry_result->>'match_id')::uuid),3,'net98000 matched with two signed original bank sources and fee-2000');
SELECT ok((pg_temp.net_post()->>'idempotent_replay')::boolean,'net fee replay returns original journal');
SELECT throws_ok($q$SELECT pg_temp.net_post(p_fee:=1999)$q$,'22023','idempotency_payload_conflict','net fee key rejects changed fee payload');
SELECT throws_ok($q$SELECT pg_temp.net_post(gen_random_uuid(),2000,'285741',2)$q$,'22023','net_fee_gl_source_unavailable',
 'same bank sources cannot fund second net fee');
SELECT public.bank_reconciliation_unmatch_v1((entry_result->>'match_id')::uuid,'Reassign bank matching only',gen_random_uuid()) FROM net_fixture;
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_net_fee_claims WHERE gl_line_id IN(SELECT id FROM net_sources)),2,
 'unmatch preserves permanent gross bank source reservations');
SELECT is((SELECT count(*)::int FROM public.journal_entries j,net_fixture f WHERE j.id=(f.entry_result->>'je_id')::uuid),1,
 'unmatch preserves fee journal');
SELECT ok((pg_temp.net_post()->>'idempotent_replay')::boolean,'net fee replay after unmatch emits nothing');
SELECT throws_ok($q$SELECT pg_temp.net_post(gen_random_uuid(),2000,'285741',2)$q$,'22023','net_fee_gl_source_unavailable',
 'unmatch cannot reopen bank sources for duplicate fee emission');
SELECT public.bank_reconciliation_match_v2(rec,ARRAY[bank_ids[1]],gl_ids||ARRAY[(entry_result->>'bank_gl_line_id')::uuid],gen_random_uuid()) FROM net_fixture;
SELECT is((SELECT count(*)::int FROM public.bank_reconciliation_gl_claims c WHERE c.gl_line_id IN(SELECT id FROM net_sources)),2,
 'original gross and signed reversal can rematch with existing fee journal');
SELECT ok((SELECT a.actor_id=f.actor AND a.payload->>'kind'='net_fee' AND a.payload->'bank_gl_line_ids'=to_jsonb(f.gl_ids)
 FROM public.audit_logs a,net_fixture f WHERE a.entity_id=f.rec AND a.action='accounting.bank.posted'),
 'net fee audit records profile actor and exact original bank sources');
SELECT * FROM finish();
ROLLBACK;
