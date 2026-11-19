-- Virement sortant + frais de transfert, et lecture agrégée des jours d'attente QRIS / carte.
-- Année 2093 : aucun autre test ne pose de période fiscale ni de relevé sur cette année.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE grp_fixture(actor uuid,auth_id uuid,bank uuid,income uuid,expense uuid,rec uuid,
 bank_ids uuid[],src_line uuid,pos_src_line uuid,fee_result jsonb,settle_result jsonb);
CREATE TEMP TABLE grp_clearing(label text,line_id uuid);
DO $$ DECLARE a uuid:=gen_random_uuid();p uuid:=gen_random_uuid();b uuid;inc uuid;exp uuid;v jsonb;r jsonb;
 c15 uuid;c16 uuid;src uuid;possrc uuid;spec record;BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'GRP-'||left(p::text,8),'Bank grouped fees fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 SELECT id INTO b FROM public.accounts WHERE code='1113';
 SELECT id INTO c15 FROM public.accounts WHERE code='1115';
 SELECT id INTO c16 FROM public.accounts WHERE code='1116';
 SELECT id INTO inc FROM public.accounts WHERE account_class=4 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1;
 SELECT id INTO exp FROM public.accounts WHERE account_class=6 AND is_active AND is_postable AND deleted_at IS NULL ORDER BY code LIMIT 1;
 INSERT INTO public.fiscal_periods(period_start,period_end,status,notes) VALUES('2093-01-01','2093-01-31','open','Grouped fees pgTAP');
 r:=public.bank_reconciliation_import_v2(jsonb_build_object('account_id',b,'period_start','2093-01-01','period_end','2093-01-31',
  'currency','IDR','source_sha256',repeat('e',64),'sheet_name','Sheet1','file_name','grouped.csv','rows',jsonb_build_array(
   jsonb_build_object('source_row',2,'date','2093-01-05','amount',-329000,'description','CENAIDJA/SUPPLIER INVOICE','reference','GRP-A'),
   jsonb_build_object('source_row',3,'date','2093-01-05','amount',-2500,'description','Transfer fee','reference','GRP-B'),
   jsonb_build_object('source_row',4,'date','2093-01-12','amount',118000,'description','QRIS settlement batch','reference','GRP-C'))),gen_random_uuid(),true);
 -- Sortie fournisseur : bank au crédit, charge au débit, type de référence effectif.
 v:=public.create_manual_je_v2('Supplier transfer gross','2093-01-04',jsonb_build_array(
  jsonb_build_object('account_id',exp,'debit',329000,'credit',0),jsonb_build_object('account_id',b,'debit',0,'credit',329000)),'285741');
 UPDATE public.journal_entries SET reference_type='purchase_payment',reference_id=gen_random_uuid() WHERE id=(v->>'je_id')::uuid;
 SELECT id INTO src FROM public.journal_entry_lines WHERE journal_entry_id=(v->>'je_id')::uuid AND account_id=b;
 -- Source positive, pour le refus de changement de sens.
 v:=public.create_manual_je_v2('Positive bank source','2093-01-03',jsonb_build_array(
  jsonb_build_object('account_id',b,'debit',100000,'credit',0),jsonb_build_object('account_id',inc,'debit',0,'credit',100000)),'285741');
 UPDATE public.journal_entries SET reference_type='b2b_payment',reference_id=gen_random_uuid() WHERE id=(v->>'je_id')::uuid;
 SELECT id INTO possrc FROM public.journal_entry_lines WHERE journal_entry_id=(v->>'je_id')::uuid AND account_id=b;
 INSERT INTO grp_fixture SELECT p,a,b,inc,exp,(r->>'reconciliation_id')::uuid,
  (SELECT array_agg(id ORDER BY ordinal) FROM public.bank_statement_lines WHERE reconciliation_id=(r->>'reconciliation_id')::uuid),
  src,possrc,NULL,NULL;
 -- Lignes d'attente : deux 1115 le même jour, une 1116, une 1115 hors fenêtre (avant period_start-7).
 FOR spec IN SELECT * FROM (VALUES('q1',50000::numeric,'2093-01-10'::date,'1115'),('q2',70000,'2093-01-10','1115'),
  ('c1',30000,'2093-01-10','1116'),('old',40000,'2093-01-10','1115')) s(label,amount,d,code) LOOP
  v:=public.create_manual_je_v2('Clearing fixture '||spec.label,'2093-01-10',jsonb_build_array(
   jsonb_build_object('account_id',(SELECT id FROM public.accounts WHERE code=spec.code),'debit',spec.amount,'credit',0),
   jsonb_build_object('account_id',inc,'debit',0,'credit',spec.amount)),'285741');
  UPDATE public.journal_entries SET reference_type='sale',reference_id=gen_random_uuid(),
   entry_date=CASE WHEN spec.label='old' THEN '2092-12-20'::date ELSE spec.d END WHERE id=(v->>'je_id')::uuid;
  INSERT INTO grp_clearing SELECT spec.label,id FROM public.journal_entry_lines
   WHERE journal_entry_id=(v->>'je_id')::uuid AND account_id=(SELECT id FROM public.accounts WHERE code=spec.code);
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.grp_fee(p_fee numeric DEFAULT 2500,p_key uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.bank_reconciliation_post_v6(rec,ARRAY[bank_ids[1],bank_ids[2]],'{}',expense,p_fee,'2093-01-05',
  'Supplier transfer fee','285741',p_key,'net_fee',ARRAY[src_line]) FROM grp_fixture;
$$;
CREATE FUNCTION pg_temp.grp_days(p_date date) RETURNS SETOF jsonb LANGUAGE sql AS $$
 SELECT i FROM grp_fixture f,jsonb_array_elements(public.bank_reconciliation_clearing_days_v1(f.rec)->'items') i
 WHERE (i->>'entry_date')::date=p_date;
$$;
SELECT ok(to_regprocedure('public.bank_reconciliation_post_v5(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])') IS NULL,'post_v5 signature dropped');
SELECT ok(NOT has_function_privilege('anon','public.bank_reconciliation_post_v6(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])','EXECUTE'),
 'post_v6 denies anon including PUBLIC inheritance');
SELECT ok(NOT has_function_privilege('anon','public.bank_reconciliation_clearing_days_v1(uuid)','EXECUTE'),'clearing_days_v1 denies anon including PUBLIC inheritance');
SELECT throws_ok($q$SELECT public.bank_reconciliation_clearing_days_v1(gen_random_uuid())$q$,'P0002','reconciliation_not_found',
 'clearing_days_v1 refuses an unknown reconciliation');
SELECT throws_ok('SELECT pg_temp.grp_fee(2499)','22023','net_fee_amount_mismatch','outgoing net fee wrong amount refused');
SELECT throws_ok($q$SELECT public.bank_reconciliation_post_v6(rec,ARRAY[bank_ids[1]],'{}',expense,2500,'2093-01-05',
 'Sign mismatch','285741',gen_random_uuid(),'net_fee',ARRAY[pos_src_line]) FROM grp_fixture$q$,
 '22023','net_fee_sign_mismatch','outgoing bank movement against incoming source refused');
UPDATE grp_fixture SET fee_result=pg_temp.grp_fee();
SELECT ok((SELECT (fee_result->>'ok')::boolean FROM grp_fixture),'outgoing transfer and its fee posted together');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines l,grp_fixture f WHERE l.journal_entry_id=(f.fee_result->>'je_id')::uuid),
 2,'fee journal has exactly two lines');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,grp_fixture f
 WHERE l.journal_entry_id=(f.fee_result->>'je_id')::uuid AND l.account_id=f.expense),2500::numeric,'fee journal debits the class 6 counter account');
SELECT is((SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l,grp_fixture f
 WHERE l.journal_entry_id=(f.fee_result->>'je_id')::uuid AND l.account_id=f.bank),-2500::numeric,'fee journal credits the bank for the fee only');
SELECT is((SELECT cardinality(m.bank_line_ids) FROM public.bank_reconciliation_matches m,grp_fixture f
 WHERE m.id=(f.fee_result->>'match_id')::uuid),2,'match holds both statement lines');
SELECT ok((SELECT cardinality(m.gl_line_ids)=2 AND m.gl_line_ids@>ARRAY[f.src_line,(f.fee_result->>'bank_gl_line_id')::uuid]
 FROM public.bank_reconciliation_matches m,grp_fixture f WHERE m.id=(f.fee_result->>'match_id')::uuid),
 'match holds the source line and the new fee line');
SELECT is((SELECT count(*)::int FROM pg_temp.grp_days('2093-01-10') i WHERE i->>'account_code'='1115' AND (i->>'line_count')::int=2
 AND (i->>'gross')::numeric=120000),1,'two 1115 lines of the same day form one item with summed gross');
SELECT is((SELECT count(*)::int FROM pg_temp.grp_days('2093-01-10') i WHERE i->>'account_code'='1116' AND (i->>'line_count')::int=1
 AND (i->>'gross')::numeric=30000),1,'1116 line forms its own item');
SELECT is((SELECT count(*)::int FROM grp_fixture f,jsonb_array_elements(public.bank_reconciliation_clearing_days_v1(f.rec)->'items') i
 WHERE (i->>'entry_date')::date<'2093-01-01'),0,'line before period_start-7 excluded');
UPDATE grp_fixture SET settle_result=public.bank_reconciliation_post_v6(rec,ARRAY[bank_ids[3]],
 (SELECT array_agg(line_id ORDER BY line_id) FROM grp_clearing WHERE label IN('q1','q2')),expense,2000,'2093-01-12',
 'QRIS settlement','285741',gen_random_uuid(),'settlement','{}');
SELECT ok((SELECT (settle_result->>'ok')::boolean FROM grp_fixture),'settlement of the grouped 1115 day posted');
SELECT is((SELECT count(*)::int FROM pg_temp.grp_days('2093-01-10') i WHERE i->>'account_code'='1115'),0,'claimed 1115 item disappears');
SELECT is((SELECT count(*)::int FROM pg_temp.grp_days('2093-01-10') i WHERE i->>'account_code'='1116'),1,'unclaimed 1116 item remains');
SELECT * FROM finish();
ROLLBACK;
