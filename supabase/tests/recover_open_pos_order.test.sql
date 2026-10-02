-- Reprise caisse : fixtures privées à cette transaction, aucun effacement métier.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE reopen_cases(label text, id uuid);
CREATE TEMP TABLE reopen_actor(profile_id uuid, auth_id uuid);
CREATE TEMP TABLE reopen_snapshots(value jsonb);
DO $fixture$
DECLARE
  v_actor uuid; v_auth uuid; v_session uuid; v_product uuid; v_category uuid;
  v_order uuid; v_label text; v_root uuid := gen_random_uuid();
BEGIN
  SELECT id, auth_user_id INTO v_actor, v_auth FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND auth_user_id IS NOT NULL
      AND public.has_permission_for_profile(id, 'pos.sale.create') LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'fixture: active POS actor required'; END IF;
  INSERT INTO reopen_actor VALUES(v_actor,v_auth);
  PERFORM set_config('request.jwt.claim.sub',v_auth::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_auth)::text,true);
  SELECT id INTO v_session FROM public.pos_sessions WHERE opened_by=v_actor AND status='open';
  IF v_session IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by,opening_cash,status)
      VALUES(v_actor,0,'open') RETURNING id INTO v_session;
  END IF;
  SELECT id INTO v_category FROM public.categories LIMIT 1;
  INSERT INTO public.products(sku,name,category_id,retail_price,unit,cost_price)
    VALUES('REOPEN-'||v_root,'Reopen fixture',v_category,100,'pcs',0) RETURNING id INTO v_product;
  FOREACH v_label IN ARRAY ARRAY['pos_open','pos_held','tablet_open','tablet_held','draft','paid','completed','voided'] LOOP
    INSERT INTO public.orders(order_number,order_type,status,created_via,is_held,
      subtotal,tax_amount,total,session_id,served_by,sent_to_kitchen_at)
    VALUES('REOPEN-'||v_label||'-'||v_root,'take_out',
      CASE WHEN v_label='draft' THEN 'draft'::public.order_status ELSE 'pending_payment'::public.order_status END,
      CASE WHEN v_label LIKE 'tablet_%' THEN 'tablet' ELSE 'pos' END,
      v_label IN ('pos_held','tablet_held'),100,0,100,v_session,v_actor,now()) RETURNING id INTO v_order;
    INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
      kitchen_status,is_locked,sent_to_kitchen_at)
    VALUES(v_order,v_product,'Reopen fixture',100,1,100,'pending',true,now());
    IF v_label IN ('paid','completed') THEN
      INSERT INTO public.order_payments(order_id,method,amount) VALUES(v_order,'cash',100);
      UPDATE public.orders SET status='paid' WHERE id=v_order;
      IF v_label='completed' THEN UPDATE public.orders SET status='completed' WHERE id=v_order; END IF;
    ELSIF v_label='voided' THEN
      UPDATE public.orders SET status='voided',voided_at=now(),voided_by=v_actor,void_reason='Reopen fixture void' WHERE id=v_order;
    END IF;
    INSERT INTO reopen_cases VALUES(v_label,v_order);
  END LOOP;
END;
$fixture$;
SELECT ok(NOT has_function_privilege('anon','public.reopen_held_order_v5(uuid,uuid)','EXECUTE'),'anon et PUBLIC refusés');
SELECT ok(has_function_privilege('authenticated','public.reopen_held_order_v5(uuid,uuid)','EXECUTE'),'client authentifié autorisé');
SELECT ok(has_function_privilege('service_role','public.reopen_held_order_v5(uuid,uuid)','EXECUTE'),'grant service_role conservé');
SELECT ok(to_regprocedure('public.reopen_held_order_v3(uuid)') IS NULL,'ancienne version supprimée');
INSERT INTO reopen_snapshots SELECT public.reopen_held_order_v5(id) FROM reopen_cases WHERE label='pos_open';
SELECT is(value->>'order_id',(SELECT id::text FROM reopen_cases WHERE label='pos_open'),'commande non held récupérée') FROM reopen_snapshots;
SELECT is(public.reopen_held_order_v5(id),(SELECT value FROM reopen_snapshots),'reprise répétée : même snapshot') FROM reopen_cases WHERE label='pos_open';
SELECT is((SELECT count(*)::int FROM public.order_items WHERE order_id=c.id),1,'aucune ligne dupliquée') FROM reopen_cases c WHERE label='pos_open';
SELECT ok(NOT o.is_held AND o.status='pending_payment','statut et ouverture préservés')
  FROM reopen_cases c JOIN public.orders o ON o.id=c.id WHERE c.label='pos_open';
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE entity_id=c.id AND action='order.reopened'),2,'deux reprises auditées')
  FROM reopen_cases c WHERE label='pos_open';
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_logs a JOIN reopen_cases c ON c.id=a.entity_id
  WHERE c.label='pos_open' AND a.action='order.reopened'
    AND (a.actor_id IS DISTINCT FROM (SELECT profile_id FROM reopen_actor)
      OR a.metadata->>'recovered_open_order' IS DISTINCT FROM 'true')),'profil et contexte audit corrects');
SELECT lives_ok(format('SELECT public.reopen_held_order_v5(%L)',id),'voie held préservée : '||label)
  FROM reopen_cases WHERE label IN ('pos_held');
SELECT ok(NOT o.is_held,'hold retiré : '||c.label) FROM reopen_cases c JOIN public.orders o ON o.id=c.id
  WHERE c.label IN ('pos_held');
SELECT is(o.status::text,c.label,'fixture statut réel : '||c.label)
  FROM reopen_cases c JOIN public.orders o ON o.id=c.id WHERE c.label IN ('draft','paid','completed','voided');
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L)',id),'P0002','order_not_available_for_reopen','refus : '||label)
  FROM reopen_cases WHERE label IN ('draft','paid','completed','voided','tablet_open','tablet_held');
SELECT is((SELECT count(*)::int FROM public.audit_logs a JOIN reopen_cases c ON c.id=a.entity_id
  WHERE c.label IN ('draft','paid','completed','voided','tablet_open') AND a.action='order.reopened'),0,'aucun audit de reprise refusée');
SELECT set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'))::text,true);
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L)',id),'P0003','Permission denied: pos.sale.create','identité sans permission refusée') FROM reopen_cases WHERE label='pos_open';
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L)',id),'P0001','Not authenticated','absence identité refusée')
  FROM reopen_cases WHERE label='pos_open';
SELECT * FROM finish();
ROLLBACK;
