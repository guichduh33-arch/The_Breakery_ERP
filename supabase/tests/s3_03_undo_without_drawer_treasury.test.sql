-- pgtap:exclusive
-- S3-03 : l'annulation de clôture fonctionne sans le suivi du tiroir, comme en
-- production au 2026-11-19 (migration 20261030000007 jamais appliquée là-bas).
-- Le test reproduit cet état dans sa transaction : déclencheurs du tiroir
-- désactivés et table renommée. Tout disparaît avec le ROLLBACK.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE s303b_results(seq serial,tap text);

ALTER TABLE public.pos_sessions DISABLE TRIGGER issue_shift_cash_float;
ALTER TABLE public.pos_sessions DISABLE TRIGGER guard_shift_cash_treasury;
ALTER TABLE public.z_reports DISABLE TRIGGER settle_shift_cash_drawer;
ALTER TABLE public.shift_cash_treasury RENAME TO shift_cash_treasury_s303b;

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  ca uuid := gen_random_uuid(); cp uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); s uuid := gen_random_uuid(); o uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(oa),(ca);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash) VALUES
    (op,oa,'SUPER_ADMIN','S3-03b owner','S303B-O-'||left(op::text,8),true,extensions.crypt('246810',extensions.gen_salt('bf'))),
    (cp,ca,'CASHIER','S3-03b cashier','S303B-C-'||left(cp::text,8),true,extensions.crypt('135791',extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(cp,'shift.close',true,'S3-03b coverage')
    ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
  INSERT INTO lan_devices(id,code,name,device_type,is_active) VALUES(t,'S303B-'||left(t::text,8),'S3-03b terminal','pos',true);
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status,terminal_id) VALUES(s,cp,100000,'open',t);
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total)
    VALUES(o,'S303B-'||left(o::text,8),s,'paid','pos','take_out',50000,0,50000);
  INSERT INTO order_payments(order_id,session_id,method,amount) VALUES(o,s,'cash',50000);
  PERFORM set_config('s303b.s',s::text,true);
  PERFORM set_config('s303b.owner',jsonb_build_object('sub',oa,'role','authenticated')::text,true);
  PERFORM set_config('s303b.cashier',jsonb_build_object('sub',ca,'role','authenticated')::text,true);
END $fixture$;

-- Clôture avec un écart de -100, sans règlement du tiroir.
SELECT set_config('request.jwt.claims',current_setting('s303b.cashier'),true);
SELECT public.close_shift_v15(current_setting('s303b.s')::uuid, 149900);
CREATE TEMP TABLE s303b_first AS SELECT
  (SELECT id FROM journal_entries WHERE reference_type='shift_close' AND reference_id=current_setting('s303b.s')::uuid) var_je;
INSERT INTO s303b_results(tap) SELECT ok((SELECT var_je IS NOT NULL FROM s303b_first),
 'Fixture: the close posted a variance entry, no drawer tracking exists');

SELECT set_config('request.jwt.claims',current_setting('s303b.owner'),true);
CREATE TEMP TABLE s303b_undo AS
  SELECT public.undo_shift_close_v2(current_setting('s303b.s')::uuid,'246810','Recount') AS r;
INSERT INTO s303b_results(tap) SELECT is((SELECT r->>'ok' FROM s303b_undo),'true',
 'The undo works without the drawer tracking table');
INSERT INTO s303b_results(tap) SELECT ok((SELECT r->>'settlement_reversal_entry' IS NULL FROM s303b_undo),
 'No drawer settlement is reversed when none exists');
INSERT INTO s303b_results(tap) SELECT is((SELECT status::text FROM pos_sessions WHERE id=current_setting('s303b.s')::uuid),'open',
 'The session is open again');
INSERT INTO s303b_results(tap) SELECT is((SELECT count(*) FROM journal_entries
 WHERE metadata->>'reverses'=(SELECT var_je::text FROM s303b_first)),1::bigint,'The variance entry is reversed once');
INSERT INTO s303b_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM z_reports WHERE shift_id=current_setting('s303b.s')::uuid),
 'The draft Z-report is removed');
INSERT INTO s303b_results(tap) SELECT ok((SELECT payload->'treasury' = 'null'::jsonb OR payload->'treasury' IS NULL
 FROM audit_logs WHERE action='shift.close_undone' AND entity_id=current_setting('s303b.s')::uuid),
 'The audit log records no drawer tracking');

-- Reclôture : une nouvelle écriture d'écart passe.
SELECT set_config('request.jwt.claims',current_setting('s303b.cashier'),true);
SELECT public.close_shift_v15(current_setting('s303b.s')::uuid, 149800);
INSERT INTO s303b_results(tap) SELECT is((SELECT sum(l.debit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE j.reference_type='shift_close' AND j.reference_id=current_setting('s303b.s')::uuid
   AND NOT (COALESCE(j.metadata,'{}'::jsonb) ? 'reverses')
   AND j.id<>(SELECT var_je FROM s303b_first)),200::numeric,'The second close posts its own variance entry');

INSERT INTO s303b_results(tap) SELECT ok(to_regprocedure('public.undo_shift_close_v1(uuid,text,text)') IS NULL,
 'undo_shift_close_v1 is retired');
INSERT INTO s303b_results(tap) SELECT ok(NOT has_function_privilege('anon','public.undo_shift_close_v2(uuid,text,text)','EXECUTE'),
 'anon cannot execute undo_shift_close_v2');

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM s303b_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
