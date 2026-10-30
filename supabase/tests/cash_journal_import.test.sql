BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
DO $$
DECLARE a uuid := gen_random_uuid(); p uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
    VALUES(p,a,'CASHI-'||left(p::text,8),'Cash import fixture','SUPER_ADMIN',hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  PERFORM set_config('cashimport.profile',p::text,true);
  INSERT INTO fiscal_periods(period_start,period_end,status)
    VALUES(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date,'open')
    ON CONFLICT DO NOTHING;
  UPDATE fiscal_periods SET status='open' WHERE current_date BETWEEN period_start AND period_end;
END $$;
CREATE TEMP TABLE cash_test(payload jsonb, report jsonb, result jsonb);
INSERT INTO cash_test(payload) SELECT jsonb_build_object('version',1,'source_name','Fixture cash',
  'source_sha256',repeat('a',64),'entries',jsonb_build_array(jsonb_build_object(
    'source_key','fixture-cash:'||gen_random_uuid(),'date',current_date,'description','Fixture cash transfer',
    'lines',jsonb_build_array(
      jsonb_build_object('account_code','1111','debit',12000,'credit',0),
      jsonb_build_object('account_code','1110','debit',0,'credit',12000)))));
SELECT ok(NOT has_function_privilege('anon','preview_cash_journal_import_v3(jsonb)','EXECUTE'),'anon cannot preview');
SELECT ok(NOT has_function_privilege('anon','apply_cash_journal_import_v4(jsonb,text,text)','EXECUTE'),'anon cannot apply');
SELECT ok(NOT has_table_privilege('authenticated','cash_journal_import_rows','INSERT'),'no direct authenticated insertion');
SELECT ok(NOT has_table_privilege('authenticated','cash_journal_import_rows','UPDATE'),'no direct authenticated update');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='cash_journal_import_rows'::regclass),'RLS enabled');
UPDATE cash_test SET report=preview_cash_journal_import_v3(payload);
SELECT is((SELECT (report->>'ready')::int FROM cash_test),1,'preview validates transfer');
SELECT is((SELECT count(*)::int FROM cash_journal_import_rows WHERE source_name='Fixture cash'),0,'preview writes nothing');
SELECT is((SELECT report->>'total_debit' FROM cash_test),'12000','preview total');
SELECT is((SELECT jsonb_array_length(report->'account_impacts') FROM cash_test),2,'both account impacts visible');
SELECT is((SELECT apply_cash_journal_import_v4(payload,report->>'preview_hash','999999')->>'error' FROM cash_test),
  'invalid_pin','wrong PIN returns refusal');
SELECT is((SELECT failed_login_attempts FROM user_profiles WHERE id=current_setting('cashimport.profile')::uuid),
  1,'wrong PIN attempt survives returned refusal');
SELECT is((SELECT count(*)::int FROM cash_journal_import_rows WHERE source_name='Fixture cash'),0,'wrong PIN writes no journals');
SELECT throws_ok($q$ SELECT apply_cash_journal_import_v4(payload,'changed','285741') FROM cash_test $q$,
  '22023','preview_changed','changed preview rejected');
UPDATE cash_test SET result=apply_cash_journal_import_v4(payload,report->>'preview_hash','285741');
SELECT is((SELECT (result->>'created')::int FROM cash_test),1,'one journal posted');
SELECT is((SELECT created_by FROM cash_journal_import_rows WHERE source_name='Fixture cash'),
  current_setting('cashimport.profile')::uuid,'profile ID is preserved');
SELECT is((SELECT count(*)::int FROM journal_entry_lines l JOIN cash_journal_import_rows r ON r.journal_entry_id=l.journal_entry_id
  WHERE r.source_name='Fixture cash'),2,'two balanced journal lines');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN cash_journal_import_rows r ON r.journal_entry_id=l.journal_entry_id
  WHERE r.source_name='Fixture cash'),0::numeric,'journal balanced');
SELECT is((SELECT (apply_cash_journal_import_v4(payload,report->>'preview_hash','285741')->>'created')::int FROM cash_test),
  0,'replay creates nothing');
SELECT is((SELECT (preview_cash_journal_import_v3(payload)->>'already_imported')::int FROM cash_test),1,'preview reports replay');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,description}','"Changed source"')) FROM cash_test $q$,
  '22023',NULL,'same source key cannot change');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries}',(payload->'entries')||(payload->'entries'))) FROM cash_test $q$,
  '22023','duplicate_source_key','same key cannot occur twice in a batch');
-- Nouvelle clé pour parcourir les validations, sans être court-circuité par le rejeu.
UPDATE cash_test SET payload=jsonb_set(payload,'{entries,0,source_key}',to_jsonb('fixture-new:'||gen_random_uuid()));
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,debit}','12001')) FROM cash_test $q$,
  '22023',NULL,'unbalanced entry rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,debit}','-1')) FROM cash_test $q$,
  '22023',NULL,'negative amount rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,debit}','12000.001')) FROM cash_test $q$,
  '22023',NULL,'fractional cent rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,debit}','"12000"')) FROM cash_test $q$,
  '22023',NULL,'numeric strings rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,account_code}','"1151"')) FROM cash_test $q$,
  '22023',NULL,'inactive reserved tax account rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,account_code}','"1100"')) FROM cash_test $q$,
  '22023',NULL,'synthetic account rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,date}',to_jsonb((current_date+1)::text))) FROM cash_test $q$,
  '22023',NULL,'future date rejected');
UPDATE fiscal_periods SET status='closed' WHERE current_date BETWEEN period_start AND period_end;
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(payload) FROM cash_test $q$,NULL,NULL,'closed fiscal period rejected');
UPDATE fiscal_periods SET status='open' WHERE current_date BETWEEN period_start AND period_end;
-- La paie peut être constatée en dette, mais pas n'importe quelle JE sans trésorerie.
UPDATE cash_test SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{entries,0,kind}','"salary_accrual"'),
  '{entries,0,lines,0,account_code}','"6111"'),'{entries,0,lines,1,account_code}','"2141"');
SELECT is((SELECT (preview_cash_journal_import_v3(payload)->>'ready')::int FROM cash_test),1,'salary accrual accepted');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,account_code}','"6190"')) FROM cash_test $q$,
  '22023',NULL,'salary kind cannot disguise other expense');
-- Correction liée à la JE originale : ni achat ni règlement fournisseur recréé.
DO $$ DECLARE original jsonb; BEGIN
  original:=create_manual_je_v2('Original purchase fixture',current_date,jsonb_build_array(
    jsonb_build_object('account_id',(SELECT id FROM accounts WHERE code='2141'),'debit',12000,'credit',0),
    jsonb_build_object('account_id',(SELECT id FROM accounts WHERE code='1110'),'debit',0,'credit',12000)),'285741');
  UPDATE journal_entries SET reference_type='purchase_payment' WHERE id=(original->>'je_id')::uuid;
  UPDATE cash_test SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,
    '{entries,0,kind}','"purchase_cash_correction"'),'{entries,0,corrects_je_id}',original->'je_id'),
    '{entries,0,lines,0,account_code}','"1110"'),'{entries,0,lines,1,account_code}','"1111"');
END $$;
UPDATE cash_test SET report=preview_cash_journal_import_v3(payload);
SELECT is((SELECT (report->>'ready')::int FROM cash_test),1,'original purchase cash reclassification valid');
UPDATE cash_test SET result=apply_cash_journal_import_v4(payload,report->>'preview_hash','285741');
SELECT is((SELECT (result->>'created')::int FROM cash_test),1,'correction posts one journal');
UPDATE cash_test SET payload=jsonb_set(payload,'{entries,0,source_key}',to_jsonb('second-correction:'||gen_random_uuid()));
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(payload) FROM cash_test $q$,'22023',NULL,'original cannot be corrected twice');
SELECT is((SELECT count(*)::int FROM audit_logs WHERE action='accounting.cash_imported'
  AND actor_id=current_setting('cashimport.profile')::uuid),2,'both successful batches audited, replay not repeated');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(payload) FROM cash_test $q$,'42501','permission_denied','unauthenticated preview denied');
SELECT throws_ok($q$ SELECT apply_cash_journal_import_v4(payload,'x','285741') FROM cash_test $q$,'42501','permission_denied','unauthenticated apply denied');
SELECT * FROM finish();
ROLLBACK;
