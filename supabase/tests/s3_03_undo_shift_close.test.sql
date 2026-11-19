-- S3-03 : le propriétaire annule la dernière clôture d'un terminal (undo_shift_close_v2).
-- Comptes, terminaux, sessions et écritures de ce test disparaissent avec le ROLLBACK.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE s303_results(seq serial,tap text);

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();   -- propriétaire
  ca uuid := gen_random_uuid(); cp uuid := gen_random_uuid();   -- caissier
  c2a uuid := gen_random_uuid(); c2p uuid := gen_random_uuid(); -- second caissier
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); legacy uuid := gen_random_uuid(); o uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(oa),(ca),(c2a);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash) VALUES
    (op,oa,'SUPER_ADMIN','S3-03 owner','S303-O-'||left(op::text,8),true,extensions.crypt('246810',extensions.gen_salt('bf'))),
    (cp,ca,'CASHIER','S3-03 cashier','S303-C-'||left(cp::text,8),true,extensions.crypt('135791',extensions.gen_salt('bf'))),
    (c2p,c2a,'CASHIER','S3-03 cashier 2','S303-D-'||left(c2p::text,8),true,extensions.crypt('135792',extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(cp,'shift.close',true,'S3-03 coverage'),(c2p,'shift.close',true,'S3-03 coverage')
    ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
  INSERT INTO lan_devices(id,code,name,device_type,is_active) VALUES
    (t,'S303-'||left(t::text,8),'S3-03 terminal','pos',true),
    (t2,'S303-'||left(t2::text,8),'S3-03 terminal 2','pos',true);
  -- Fond de 100 000 : son émission est une écriture que l'annulation ne touche pas.
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status,terminal_id) VALUES(s,cp,100000,'open',t);
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total)
    VALUES(o,'S303-'||left(o::text,8),s,'paid','pos','take_out',50000,0,50000);
  INSERT INTO order_payments(order_id,session_id,method,amount) VALUES(o,s,'cash',50000);
  -- Une session historique, sans terminal, déjà clôturée.
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status,closed_at,closed_by,closing_cash)
    VALUES(legacy,c2p,0,'closed',now(),c2p,0);
  PERFORM set_config('s303.s',s::text,true);
  PERFORM set_config('s303.t',t::text,true);
  PERFORM set_config('s303.t2',t2::text,true);
  PERFORM set_config('s303.legacy',legacy::text,true);
  PERFORM set_config('s303.cp',cp::text,true);
  PERFORM set_config('s303.c2p',c2p::text,true);
  PERFORM set_config('s303.op',op::text,true);
  PERFORM set_config('s303.owner',jsonb_build_object('sub',oa,'role','authenticated')::text,true);
  PERFORM set_config('s303.cashier',jsonb_build_object('sub',ca,'role','authenticated')::text,true);
  PERFORM set_config('s303.cashier2',jsonb_build_object('sub',c2a,'role','authenticated')::text,true);
END $fixture$;

-- Clôture : écart de -100 (attendu 150 000, compté 149 900), puis règlement du tiroir.
SELECT set_config('request.jwt.claims',current_setting('s303.cashier'),true);
SELECT public.close_shift_v15(current_setting('s303.s')::uuid, 149900);
CREATE TEMP TABLE s303_first AS SELECT
  (SELECT id FROM journal_entries WHERE reference_type='shift_close' AND reference_id=current_setting('s303.s')::uuid) var_je,
  (SELECT settlement_je_id FROM shift_cash_treasury WHERE session_id=current_setting('s303.s')::uuid) set_je,
  (SELECT issued_je_id FROM shift_cash_treasury WHERE session_id=current_setting('s303.s')::uuid) float_je;
INSERT INTO s303_results(tap) SELECT ok((SELECT var_je IS NOT NULL AND set_je IS NOT NULL AND float_je IS NOT NULL FROM s303_first),
 'Fixture: the close posted a variance entry and a drawer settlement');

-- Refus.
SELECT set_config('request.jwt.claims',current_setting('s303.cashier'),true);
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.s'),'135791'),'P0003','forbidden','A non-owner cannot undo a close');
SELECT set_config('request.jwt.claims',current_setting('s303.owner'),true);
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,NULL)',
 current_setting('s303.s')),'P0001','pin_required','The owner PIN is required');
INSERT INTO s303_results(tap) SELECT is(public.undo_shift_close_v2(current_setting('s303.s')::uuid,'000000')->>'error',
 'invalid_pin','A wrong PIN is refused');
UPDATE user_profiles SET failed_login_attempts=0,locked_until=NULL WHERE id=current_setting('s303.op')::uuid;
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.legacy'),'246810'),'P0001','terminal_unknown','A session without terminal cannot be undone');
-- Une session plus récente sur le même terminal : la clôture n'est plus la dernière.
INSERT INTO pos_sessions(id,opened_by,opening_cash,status,terminal_id,opened_at)
  VALUES('00000000-0000-4000-8000-000000000303',current_setting('s303.c2p')::uuid,0,'open',
         current_setting('s303.t')::uuid,now()+interval '1 minute');
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.s'),'246810'),'P0001','session_not_last','A close followed by a newer session on the terminal is refused');
-- La session plus récente change de terminal : la clôture redevient la dernière du sien.
UPDATE pos_sessions SET terminal_id=current_setting('s303.t2')::uuid
 WHERE id='00000000-0000-4000-8000-000000000303';
-- Un rapport Z signé : refus.
UPDATE z_reports SET status='signed',signed_at=now(),signed_by=current_setting('s303.op')::uuid
 WHERE shift_id=current_setting('s303.s')::uuid;
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.s'),'246810'),'P0001','zreport_not_draft','A signed Z-report forbids the undo');
UPDATE z_reports SET status='draft',signed_at=NULL,signed_by=NULL WHERE shift_id=current_setting('s303.s')::uuid;
-- L'argent déposé en fonds non déposés en est sorti (dépôt en banque) : refus
-- (décision de Mamat du 2026-11-19). L'écriture de sortie est retirée ensuite.
DO $moved$
DECLARE v_acc uuid := resolve_mapping_account('CASH_WALLET_UNDEPOSITED');
  v_other uuid := resolve_mapping_account('SALE_PAYMENT_CASH'); v_bal numeric; v_out numeric; v_je uuid;
BEGIN
  SELECT COALESCE(SUM(l.debit-l.credit),0) INTO v_bal FROM journal_entry_lines l
    JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.account_id=v_acc AND j.status IN ('posted','locked');
  v_out := v_bal - 49899;  -- il reste 49 899, sous les 49 900 que la clôture a déposés
  INSERT INTO journal_entries(entry_number,entry_date,description,reference_type,status,total_debit,total_credit)
    VALUES(next_journal_entry_number(CURRENT_DATE),CURRENT_DATE,'S3-03 fixture: cash taken to the bank','manual','posted',v_out,v_out)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit) VALUES(v_je,v_other,v_out,0),(v_je,v_acc,0,v_out);
  PERFORM set_config('s303.moved_je',v_je::text,true);
END $moved$;
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.s'),'246810'),'P0001','undeposited_cash_moved',
 'The undo is refused once the deposited cash has left the undeposited funds');
DELETE FROM journal_entry_lines WHERE journal_entry_id=current_setting('s303.moved_je')::uuid;
DELETE FROM journal_entries WHERE id=current_setting('s303.moved_je')::uuid;

-- Annulation.
CREATE TEMP TABLE s303_undo AS
  SELECT public.undo_shift_close_v2(current_setting('s303.s')::uuid,'246810','Recount requested') AS r;
INSERT INTO s303_results(tap) SELECT is((SELECT r->>'ok' FROM s303_undo),'true','The owner undoes the last close');
INSERT INTO s303_results(tap) SELECT ok((SELECT status='open' AND closed_at IS NULL AND closing_cash IS NULL
 AND variance_total IS NULL AND closing_sales_total IS NULL AND closing_order_count IS NULL
 AND closing_payment_totals IS NULL FROM pos_sessions WHERE id=current_setting('s303.s')::uuid),
 'The session is open again, its close fields and frozen totals cleared');
INSERT INTO s303_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM z_reports WHERE shift_id=current_setting('s303.s')::uuid),
 'The draft Z-report is removed');
INSERT INTO s303_results(tap) SELECT ok((SELECT settled_at IS NULL AND settlement_je_id IS NULL
 AND issued_je_id=(SELECT float_je FROM s303_first) FROM shift_cash_treasury WHERE session_id=current_setting('s303.s')::uuid),
 'The drawer is unsettled; the opening float entry is untouched');
INSERT INTO s303_results(tap) SELECT is((SELECT count(*) FROM journal_entries WHERE metadata->>'reverses' IN
 ((SELECT var_je::text FROM s303_first),(SELECT set_je::text FROM s303_first))),2::bigint,
 'The variance entry and the settlement are each reversed once');
-- Contre-passation exacte : chaque compte touché revient à zéro.
INSERT INTO s303_results(tap) SELECT is((SELECT count(*) FROM (
  SELECT l.account_id FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
   WHERE j.id IN ((SELECT var_je FROM s303_first),(SELECT set_je FROM s303_first))
      OR j.metadata->>'reverses' IN ((SELECT var_je::text FROM s303_first),(SELECT set_je::text FROM s303_first))
   GROUP BY l.account_id HAVING sum(l.debit)-sum(l.credit)<>0) x),0::bigint,
 'Every account touched by the close nets to zero after the undo');
INSERT INTO s303_results(tap) SELECT ok((SELECT actor_id=current_setting('s303.op')::uuid
 AND metadata->>'reason'='Recount requested' AND payload->'before'->>'status'='closed'
 AND payload->'zreport' IS NOT NULL
 FROM audit_logs WHERE action='shift.close_undone' AND entity_id=current_setting('s303.s')::uuid),
 'The audit log carries the owner profile, the reason and the state before');
INSERT INTO s303_results(tap) SELECT throws_ok(format('SELECT public.undo_shift_close_v2(%L,%L)',
 current_setting('s303.s'),'246810'),'P0001','session_not_closed','An open session cannot be undone');

-- Reclôture : nouvelle écriture d'écart, nouveau rapport Z, nouveau règlement.
SELECT set_config('request.jwt.claims',current_setting('s303.cashier'),true);
SELECT public.close_shift_v15(current_setting('s303.s')::uuid, 149800);
INSERT INTO s303_results(tap) SELECT is((SELECT sum(l.debit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE j.reference_type='shift_close' AND j.reference_id=current_setting('s303.s')::uuid
   AND NOT (COALESCE(j.metadata,'{}'::jsonb) ? 'reverses')
   AND j.id<>(SELECT var_je FROM s303_first)),200::numeric,'The second close posts its own variance entry');
INSERT INTO s303_results(tap) SELECT ok(EXISTS(SELECT 1 FROM z_reports WHERE shift_id=current_setting('s303.s')::uuid AND status='draft'),
 'The second close creates a new draft Z-report');
INSERT INTO s303_results(tap) SELECT ok((SELECT settled_at IS NOT NULL AND settlement_je_id<>(SELECT set_je FROM s303_first)
 FROM shift_cash_treasury WHERE session_id=current_setting('s303.s')::uuid),'The second close settles the drawer again');
INSERT INTO s303_results(tap) SELECT is((SELECT closing_sales_total FROM pos_sessions WHERE id=current_setting('s303.s')::uuid),
 50000::numeric(15,2),'The second close freezes the totals again');

-- Droits.
INSERT INTO s303_results(tap) SELECT ok(NOT has_function_privilege('anon','public.undo_shift_close_v2(uuid,text,text)','EXECUTE'),
 'anon cannot execute undo_shift_close_v2');
INSERT INTO s303_results(tap) SELECT ok(NOT has_function_privilege('authenticated',
 'public._reverse_shift_journal_entry_v1(uuid,text,uuid,jsonb)','EXECUTE'),'authenticated cannot execute the reversal helper');

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM s303_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
