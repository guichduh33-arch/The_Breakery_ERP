-- La policy confidentiality_finished_orders doit rester équivalente, ligne pour
-- ligne, à can_view_order_v2(id) : ses conditions rapides ne font qu'éviter l'appel.
-- Attendu calculé par le propriétaire de la transaction (sans RLS) avec les mêmes
-- claims, observé sous le rôle authenticated. Tout disparaît avec le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE fastpath_results(seq serial,tap text);
CREATE TEMP TABLE fastpath_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@fastpath.invalid' FROM fastpath_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'FP-'||id,'Fast path fixture','invalid-test-hash',role_code,true FROM fastpath_actors;
CREATE TEMP TABLE fastpath_orders(label text PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO fastpath_orders(label) VALUES('old_paid'),('old_completed'),('old_outstanding'),('recent_paid'),
 ('today_paid_kitchen'),('today_paid_plain'),('today_pending'),('today_draft_tablet'),('b2b'),
 ('old_created_settled_today');
CREATE TEMP TABLE fastpath_session AS SELECT gen_random_uuid() id;
GRANT ALL ON fastpath_results TO authenticated;
GRANT SELECT ON fastpath_actors,fastpath_orders,fastpath_session TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE fastpath_results_seq_seq TO authenticated;

-- Isoler la journée des shifts DEV préexistants, uniquement dans cette transaction.
UPDATE public.pos_sessions SET status='closed',closed_at=coalesce(closed_at,now()) WHERE status<>'closed';
INSERT INTO public.pos_sessions(id,opened_by,opened_at,opening_cash,status)
 SELECT id,(SELECT id FROM fastpath_actors WHERE role_code='CASHIER'),now()-interval '3 days',1000,'open' FROM fastpath_session;

-- Fixtures sans les triggers comptables et de complétion : seule la visibilité est testée.
SET LOCAL session_replication_role=replica;
INSERT INTO public.orders(id,order_number,session_id,status,order_type,created_via,subtotal,tax_amount,total,created_at,paid_at,outstanding_at)
 SELECT o.id,'FP-'||o.id,
  CASE WHEN o.label IN('today_draft_tablet','b2b') THEN NULL ELSE (SELECT id FROM fastpath_session) END,
  (CASE o.label WHEN 'old_completed' THEN 'completed' WHEN 'old_outstanding' THEN 'pending_payment'
   WHEN 'today_pending' THEN 'pending_payment' WHEN 'today_draft_tablet' THEN 'draft'
   WHEN 'b2b' THEN 'b2b_pending' ELSE 'paid' END)::public.order_status,
  (CASE WHEN o.label='b2b' THEN 'b2b' ELSE 'take_out' END)::public.order_type,
  CASE WHEN o.label='today_draft_tablet' THEN 'tablet' ELSE 'pos' END,
  10000,0,10000,
  CASE WHEN o.label LIKE 'old_%' THEN now()-interval '10 days' WHEN o.label='recent_paid' THEN now()-interval '2 days' ELSE now() END,
  CASE WHEN o.label IN('old_paid','old_completed') THEN now()-interval '10 days' WHEN o.label='recent_paid' THEN now()-interval '2 days'
   WHEN o.label LIKE 'today_paid_%' THEN now() END,
  CASE WHEN o.label='old_outstanding' THEN now()-interval '10 days'
   WHEN o.label='old_created_settled_today' THEN now() END
 FROM fastpath_orders o;
-- Journée portée par outstanding_at seule : créée il y a dix jours, sans paid_at,
-- encaissée aujourd'hui. Une borne lue sur paid_at ou created_at la rendrait visible.
UPDATE public.orders SET status='completed',created_at=now()-interval '10 days'
 WHERE id=(SELECT id FROM fastpath_orders WHERE label='old_created_settled_today');
INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,dispatch_station,served_at)
 SELECT o.id,(SELECT id FROM public.products LIMIT 1),'Fast path item',10000,1,10000,
  CASE WHEN o.label='today_paid_kitchen' THEN 'ready' ELSE 'served' END,'kitchen',
  CASE WHEN o.label='today_paid_kitchen' THEN NULL ELSE now() END
 FROM fastpath_orders o WHERE o.label LIKE 'today_paid_%';
SET LOCAL session_replication_role=origin;

-- Compare, pour un acteur, l'ensemble visible sous RLS à celui de can_view_order_v2.
CREATE FUNCTION pg_temp.check_actor(p_role text,p_scenario text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_expected text[]; v_actual text[]; v_days int;
BEGIN
 PERFORM pg_temp.authenticate_pin((SELECT auth_user_id FROM fastpath_actors WHERE role_code=p_role));
 SELECT coalesce(array_agg(label ORDER BY label),'{}') INTO v_expected FROM fastpath_orders WHERE public.can_view_order_v2(id);
 SELECT count(*) INTO v_days FROM generate_series(current_date-12,current_date+1,interval '1 day') g(d)
  WHERE (g.d::date < public.sales_day_visible_before_v1()) IS TRUE
   IS DISTINCT FROM (public.can_view_sales_day_v1(g.d::date) AND NOT public.is_business_owner_v1());
 SET LOCAL ROLE authenticated;
 SELECT coalesce(array_agg(f.label ORDER BY f.label),'{}') INTO v_actual
  FROM public.orders o JOIN fastpath_orders f ON f.id=o.id;
 INSERT INTO fastpath_results(tap) SELECT is(v_actual,v_expected,
  format('%s / %s: policy rows equal can_view_order_v2 (%s)',p_scenario,p_role,array_to_string(v_expected,',')));
 RESET ROLE;
 IF p_role<>'SUPER_ADMIN' THEN
  INSERT INTO fastpath_results(tap) SELECT is(v_days,0,
   format('%s / %s: day bound matches can_view_sales_day_v1 on every day',p_scenario,p_role));
 END IF;
END $$;

-- A. Un shift ouvert depuis trois jours garde ces journées privées.
SELECT pg_temp.check_actor(r,'open shift') FROM unnest(ARRAY['SUPER_ADMIN','ADMIN','CASHIER']) r;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM fastpath_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO fastpath_results(tap) SELECT ok(EXISTS(SELECT 1 FROM public.orders o JOIN fastpath_orders f USING(id) WHERE f.label='today_paid_kitchen'),
 'CASHIER keeps the paid kitchen exception through the full check');
INSERT INTO fastpath_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM public.orders o JOIN fastpath_orders f USING(id) WHERE f.label IN('today_paid_plain','recent_paid')),
 'CASHIER still cannot see paid orders of an open shift');
INSERT INTO fastpath_results(tap) SELECT ok(EXISTS(SELECT 1 FROM public.orders o JOIN fastpath_orders f USING(id) WHERE f.label='old_paid'),
 'CASHIER sees a published sales day');
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM fastpath_actors WHERE role_code='ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO fastpath_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM public.orders o JOIN fastpath_orders f USING(id) WHERE f.label='today_pending'),
 'ADMIN gets no pending-order shortcut');
RESET ROLE;

-- B. Le shift se clôt aujourd'hui : toutes les journées sont publiées.
UPDATE public.pos_sessions SET status='closed',closed_at=now() WHERE id=(SELECT id FROM fastpath_session);
SELECT pg_temp.check_actor(r,'closed today') FROM unnest(ARRAY['SUPER_ADMIN','ADMIN','CASHIER']) r;

-- C. Le shift fixture se clôt avant-hier. Seule sa clôture change : modifier
-- opened_at d'un shift doté d'un fond de caisse lève issued_shift_float_is_immutable,
-- et les shifts DEV restent intouchés. Si aucun autre shift clos ne couvre
-- aujourd'hui, la journée courante redevient privée ; l'équivalence tient dans
-- les deux cas.
UPDATE public.pos_sessions SET closed_at=now()-interval '2 days' WHERE id=(SELECT id FROM fastpath_session);
SELECT pg_temp.check_actor(r,'today uncovered') FROM unnest(ARRAY['SUPER_ADMIN','ADMIN','CASHIER']) r;

INSERT INTO fastpath_results(tap) SELECT ok(NOT has_function_privilege('anon','public.sales_day_visible_before_v1()','EXECUTE'),
 'Day bound denies anonymous execution');
INSERT INTO fastpath_results(tap) SELECT ok(
 (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polname='confidentiality_finished_orders'
   AND polrelid='public.orders'::regclass) LIKE '%can_view_order_v2(id)%',
 'The full check stays the last resort of the policy');
SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM fastpath_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
