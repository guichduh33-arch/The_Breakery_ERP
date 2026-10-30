BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
DO $$ DECLARE a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
    VALUES(p,a,'CEX-'||left(p::text,8),'Cash expense fixture','SUPER_ADMIN',hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  PERFORM set_config('cex.profile',p::text,true);
  INSERT INTO fiscal_periods(period_start,period_end,status)
    VALUES(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date,'open')
    ON CONFLICT DO NOTHING;
  UPDATE fiscal_periods SET status='open' WHERE current_date BETWEEN period_start AND period_end;
END $$;
CREATE TEMP TABLE cex(payload jsonb,report jsonb,result jsonb);
INSERT INTO cex(payload) SELECT jsonb_build_object('version',1,'source_name','Cash expense fixture',
  'source_sha256',repeat('b',64),'entries',jsonb_build_array(jsonb_build_object(
    'source_key','expense-fixture:'||gen_random_uuid(),'kind','expense','expense_term_code','ELECTRICITY',
    'date',current_date,'description','Electricity','remarks','Original bill fixture',
    'lines',jsonb_build_array(jsonb_build_object('account_code','6113','debit',12000,'credit',0),
      jsonb_build_object('account_code','1111','debit',0,'credit',12000)))));
SELECT is((SELECT (preview_cash_journal_import_v3(payload)->>'ready')::int FROM cex),1,'canonical historical expense validates');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,expense_term_code}','"UNKNOWN"')) FROM cex $q$,
  '22023',NULL,'unknown expense term rejected');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,lines,0,account_code}','"6190"')) FROM cex $q$,
  '22023',NULL,'expense cannot override term account');
SELECT throws_ok($q$ SELECT preview_cash_journal_import_v3(jsonb_set(payload,'{entries,0,description}','"PLN alternate name"')) FROM cex $q$,
  '22023',NULL,'noncanonical expense name rejected');
UPDATE cex SET report=preview_cash_journal_import_v3(payload);
SELECT is((SELECT apply_cash_journal_import_v4(payload,report->>'preview_hash','999999')->>'error' FROM cex),
  'invalid_pin','wrong PIN cannot import expense');
UPDATE cex SET result=apply_cash_journal_import_v4(payload,report->>'preview_hash','285741');
SELECT is((SELECT (result->>'created')::int FROM cex),1,'expense imported once');
SELECT ok(EXISTS(SELECT 1 FROM cash_journal_import_rows r JOIN expenses ex ON ex.id=r.expense_id
  WHERE r.source_key=(SELECT payload#>>'{entries,0,source_key}' FROM cex) AND ex.description='Electricity'
  AND ex.remarks='Original bill fixture' AND ex.status='paid' AND ex.is_historical_import
  AND ex.je_id=r.journal_entry_id),'expense keeps canonical term, remark, historical paid state and journal link');
SELECT is((SELECT count(*)::int FROM journal_entry_lines l JOIN cash_journal_import_rows r ON r.journal_entry_id=l.journal_entry_id
  WHERE r.source_key=(SELECT payload#>>'{entries,0,source_key}' FROM cex)),2,'exactly one balanced journal, no duplicate emitter');
SELECT is((SELECT (apply_cash_journal_import_v4(payload,report->>'preview_hash','285741')->>'created')::int FROM cex),
  0,'expense replay does not duplicate either object');
SELECT is((SELECT count(*)::int FROM expenses WHERE created_by=current_setting('cex.profile')::uuid),1,'one expense after replay');
SELECT ok(EXISTS(SELECT 1 FROM expenses WHERE created_by=current_setting('cex.profile')::uuid
  AND submitted_by IS NULL AND approved_by IS NULL AND paid_by IS NULL
  AND submitted_at IS NULL AND approved_at IS NULL),'historical workflow actors and approvals are not invented');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE actor_id=current_setting('cex.profile')::uuid
  AND action='expenses.imported' AND metadata->>'original_approvals_unknown'='true'
  AND metadata->>'original_payer_unknown'='true'),'import audit explicitly preserves unknown original provenance');
SELECT * FROM finish();
ROLLBACK;
