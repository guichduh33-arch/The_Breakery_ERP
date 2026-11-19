-- S3-02 : les totaux d'une session sont figés à sa clôture (close_shift_v15).
-- Comptes, session, commandes et écritures de ce test disparaissent avec le ROLLBACK.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE s302_results(seq serial,tap text);

DO $fixture$
DECLARE
  a uuid := gen_random_uuid(); p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid(); late uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
    VALUES(p,a,'CASHIER','S3-02 fixture','S302-'||left(p::text,8),true,'invalid-test-hash');
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(p,'shift.close',true,'S3-02 coverage')
    ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s,p,0,'open');
  -- Deux ventes payées (espèces, QRIS), une ardoise avec acompte espèces,
  -- une vente annulée : seules les trois premières comptent.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total) VALUES
    (o1,'S302-1-'||left(o1::text,8),s,'paid','pos','take_out',50000,0,50000),
    (o2,'S302-2-'||left(o2::text,8),s,'paid','pos','take_out',30000,0,30000);
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,outstanding_at)
    VALUES(o3,'S302-3-'||left(o3::text,8),s,'pending_payment','pos','take_out',20000,0,20000,now());
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,voided_at,voided_by,void_reason)
    VALUES(o4,'S302-4-'||left(o4::text,8),s,'voided','pos','take_out',15000,0,15000,now(),p,'S3-02 fixture');
  INSERT INTO order_payments(order_id,session_id,method,amount) VALUES
    (o1,s,'cash',50000),(o2,s,'qris',30000),(o3,s,'cash',5000);
  -- Une commande payée plus tard, dans une autre session, sur une commande de s.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total)
    VALUES(late,'S302-L-'||left(late::text,8),s,'pending_payment','pos','take_out',9000,0,9000);
  UPDATE orders SET is_held=true WHERE id=late;
  PERFORM set_config('s302.s',s::text,true);
  PERFORM set_config('s302.late',late::text,true);
  PERFORM set_config('s302.actor',jsonb_build_object('sub',a,'role','authenticated')::text,true);
END $fixture$;

SELECT set_config('request.jwt.claims',current_setting('s302.actor'),true);
CREATE TEMP TABLE s302_close AS
  SELECT public.close_shift_v15(current_setting('s302.s')::uuid, 55000) AS r;

INSERT INTO s302_results(tap) SELECT is((SELECT r->>'status' FROM s302_close),'closed','The session closes');
INSERT INTO s302_results(tap) SELECT is((SELECT closing_sales_total FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 100000::numeric(15,2),'Sales total is frozen: two paid sales and the tab, not the void');
INSERT INTO s302_results(tap) SELECT is((SELECT closing_order_count FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 3,'Order count is frozen with the same scope as the sales total');
INSERT INTO s302_results(tap) SELECT is((SELECT closing_payment_totals FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 '{"cash": 55000, "qris": 30000}'::jsonb,'Payment totals are frozen per method and equal the session receipts');
INSERT INTO s302_results(tap) SELECT is((SELECT closing_payment_totals FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 (SELECT snapshot->'totals_by_payment_method' FROM z_reports WHERE shift_id=current_setting('s302.s')::uuid),
 'The session and its Z-report carry the same payment totals');
INSERT INTO s302_results(tap) SELECT is((SELECT (r->>'closing_order_count')::int FROM s302_close),3,
 'close_shift_v15 returns the frozen order count');

-- Une vente rattachée plus tard à la session ne change pas les totaux figés.
UPDATE orders SET status='paid',is_held=false WHERE id=current_setting('s302.late')::uuid;
INSERT INTO order_payments(order_id,session_id,method,amount)
  VALUES(current_setting('s302.late')::uuid,current_setting('s302.s')::uuid,'card',9000);
INSERT INTO s302_results(tap) SELECT is((SELECT closing_sales_total FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 100000::numeric(15,2),'A later sale does not change the frozen sales total');
INSERT INTO s302_results(tap) SELECT is((SELECT closing_order_count FROM pos_sessions WHERE id=current_setting('s302.s')::uuid),
 3,'A later sale does not change the frozen order count');

-- Le rapport de session lit les valeurs figées, pas le calcul du jour. La
-- journée en cours ne se lit que par le propriétaire : le rapport se lit sous lui.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',up.auth_user_id,'role','authenticated')::text,true)
  FROM user_profiles up
 WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL AND up.role_code='SUPER_ADMIN'
 ORDER BY up.created_at, up.id LIMIT 1;
CREATE TEMP TABLE s302_report AS
  SELECT e FROM jsonb_array_elements(public.get_pos_sessions_report_v5(current_date - 1, current_date + 1)->'sessions') e
   WHERE e->>'session_id' = current_setting('s302.s');
INSERT INTO s302_results(tap) SELECT is((SELECT (e->>'sales_total')::numeric FROM s302_report),100000::numeric,
 'The session report shows the frozen sales total');
INSERT INTO s302_results(tap) SELECT is((SELECT (e->>'order_count')::int FROM s302_report),3,
 'The session report shows the frozen order count, not the live count of 4');

-- Les totaux figés ne se réécrivent pas tant que la session reste clôturée.
INSERT INTO s302_results(tap) SELECT throws_ok(format(
 'UPDATE public.pos_sessions SET closing_sales_total = 1 WHERE id = %L',current_setting('s302.s')),
 'P0001','closing_totals_frozen','Frozen totals cannot be rewritten on a closed session');

-- S3-01 (décision du 2026-11-19) : la session d'un autre caissier se clôture
-- seulement avec pos.session.close_other ; l'aperçu suit la même règle.
DO $other$
DECLARE a uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  m uuid := gen_random_uuid(); mp uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(a),(m);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash) VALUES
    (p,a,'CASHIER','S3-02 other','S302-X-'||left(p::text,8),true,'invalid-test-hash'),
    (mp,m,'CASHIER','S3-02 manager','S302-M-'||left(mp::text,8),true,'invalid-test-hash');
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason) VALUES
    (p,'shift.close',true,'S3-02 coverage'),(p,'pos.session.close_other',false,'S3-02 coverage'),
    (mp,'shift.close',true,'S3-02 coverage'),(mp,'pos.session.close_other',false,'S3-02 coverage')
    ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=EXCLUDED.is_granted,expires_at=NULL;
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s,p,0,'open');
  PERFORM set_config('s302.other_s',s::text,true);
  PERFORM set_config('s302.other_mp',mp::text,true);
  PERFORM set_config('s302.manager',jsonb_build_object('sub',m,'role','authenticated')::text,true);
END $other$;
SELECT set_config('request.jwt.claims',current_setting('s302.manager'),true);
INSERT INTO s302_results(tap) SELECT throws_ok(format('SELECT public.get_shift_close_preview_v2(%L)',current_setting('s302.other_s')),
 'P0001','no_open_shift','Without pos.session.close_other, another cashier''s shift cannot be previewed');
INSERT INTO s302_results(tap) SELECT throws_ok(format('SELECT public.close_shift_v15(%L,0)',current_setting('s302.other_s')),
 'P0003','forbidden','Without pos.session.close_other, another cashier''s shift cannot be closed');
UPDATE user_permission_overrides SET is_granted=true
 WHERE user_profile_id=current_setting('s302.other_mp')::uuid AND permission_code='pos.session.close_other';
INSERT INTO s302_results(tap) SELECT ok(public.get_shift_close_preview_v2(current_setting('s302.other_s')::uuid) ? 'expectedCash',
 'With pos.session.close_other, a manager previews another cashier''s shift');
INSERT INTO s302_results(tap) SELECT is(public.close_shift_v15(current_setting('s302.other_s')::uuid,0)->>'status','closed',
 'With pos.session.close_other, a manager closes another cashier''s shift');

-- Droits.
INSERT INTO s302_results(tap) SELECT ok(NOT has_function_privilege('anon',
 'public.get_shift_close_preview_v2(uuid)','EXECUTE'),'anon cannot execute get_shift_close_preview_v2');
INSERT INTO s302_results(tap) SELECT ok(NOT has_function_privilege('anon',
 'public.close_shift_v15(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)','EXECUTE'),'anon cannot execute close_shift_v15');
INSERT INTO s302_results(tap) SELECT ok(NOT has_function_privilege('anon',
 'public.get_pos_sessions_report_v5(date,date)','EXECUTE'),'anon cannot execute get_pos_sessions_report_v5');
INSERT INTO s302_results(tap) SELECT ok(NOT has_function_privilege('authenticated',
 'public._guard_frozen_shift_totals_v1()','EXECUTE'),'authenticated cannot execute the guard function');
INSERT INTO s302_results(tap) SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guard_frozen_shift_totals'
 AND tgrelid='public.pos_sessions'::regclass AND tgenabled<>'D'),'The frozen-totals guard trigger is enabled');

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM s302_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
