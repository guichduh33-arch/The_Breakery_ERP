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

UPDATE bank_fixture SET rec=(public.bank_reconciliation_import_v2(payload,gen_random_uuid(),true)->>'reconciliation_id')::uuid;
UPDATE bank_fixture f SET bank_ids=(SELECT array_agg(id ORDER BY ordinal) FROM public.bank_statement_lines WHERE reconciliation_id=f.rec);
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
CREATE FUNCTION pg_temp.bank_post(p_fee numeric DEFAULT 3,p_pin text DEFAULT '285741') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.bank_reconciliation_post_v5(rec,ARRAY[bank_ids[3]],
  ARRAY[(SELECT id FROM bank_gl WHERE label='card100'),(SELECT id FROM bank_gl WHERE label='card_refund10')],
  expense,p_fee,'2096-01-04','Actual card settlement',p_pin,'ba030000-0000-4000-a000-000000000001') FROM bank_fixture;
$$;
-- Chaque sonde revient en arrière : aucun claim ne fuit vers la fixture suivante.
CREATE FUNCTION pg_temp.probe_clearing_source(p_reference text,p_status text DEFAULT 'posted')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; page jsonb; cursor_id uuid; target uuid; visible boolean:=false; result jsonb; accepted boolean:=false;
BEGIN
 SELECT * INTO f FROM bank_fixture;
 SELECT id INTO target FROM bank_gl WHERE label='card100';
 BEGIN
  UPDATE public.journal_entries SET reference_type=p_reference,status=p_status
   WHERE id=(SELECT je_id FROM bank_gl WHERE label='card100');
  LOOP
   page:=public.bank_reconciliation_clearing_v3(f.rec,cursor_id,100);
   visible:=visible OR EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') x WHERE x->>'id'=target::text);
   cursor_id:=(page->>'next_after')::uuid;
   EXIT WHEN visible OR cursor_id IS NULL;
  END LOOP;
  BEGIN
   result:=pg_temp.bank_post();
   accepted:=result->>'ok'='true' AND NOT EXISTS(
    SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
    WHERE l.journal_entry_id=(result->>'je_id')::uuid AND a.account_class=4);
   accepted:=accepted AND (SELECT total_debit=total_credit FROM public.journal_entries WHERE id=(result->>'je_id')::uuid);
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'clearing_line_unavailable' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe_rollback' USING ERRCODE='P0099';
 EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
 END;
 RETURN jsonb_build_object('visible',visible,'accepted',accepted);
END $$;
SELECT is(pg_temp.probe_clearing_source('pos_outstanding_payment'),'{"visible":true,"accepted":true}'::jsonb,
 'historical POS clearing is visible and settles with its signed refund');
SELECT is(pg_temp.probe_clearing_source('b2b_payment'),'{"visible":true,"accepted":true}'::jsonb,
 'B2B clearing is visible and settles without recreating revenue');
SELECT is(pg_temp.probe_clearing_source('pos_outstanding_payment','locked'),'{"visible":true,"accepted":true}'::jsonb,
 'locked historical payments remain effective');
SELECT is(pg_temp.probe_clearing_source('manual'),'{"visible":false,"accepted":false}'::jsonb,
 'unrelated manual clearing remains excluded from read and write');
SELECT is(pg_temp.probe_clearing_source('pos_outstanding_payment','draft'),'{"visible":false,"accepted":false}'::jsonb,
 'unposted historical sources remain excluded from read and write');
SELECT ok(to_regprocedure('public.bank_reconciliation_clearing_v2(uuid,uuid,integer)') IS NULL
 AND to_regprocedure('public.bank_reconciliation_post_v4(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[])') IS NULL,
 'published old RPCs are dropped in the same migration');

SELECT * FROM finish();
ROLLBACK;
