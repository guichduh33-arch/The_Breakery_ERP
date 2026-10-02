-- Preparation locale : executer seulement apres application dev autorisee.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE tablet_fx(actor uuid, session_id uuid, product_id uuid, order_id uuid, attempt uuid);
CREATE TEMP TABLE tablet_before AS SELECT * FROM public.order_items WHERE false;
DO $fixture$
DECLARE a uuid; u uuid; s uuid; p uuid; c uuid; o uuid;
BEGIN
  SELECT id, auth_user_id INTO a,u FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND auth_user_id IS NOT NULL
      AND public.has_permission_for_profile(id,'pos.sale.create') LIMIT 1;
  IF a IS NULL THEN RAISE EXCEPTION 'fixture: POS actor required'; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
  SELECT id INTO s FROM public.pos_sessions WHERE status='open' AND opened_by=a LIMIT 1;
  IF s IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by,opening_cash,status) VALUES(a,0,'open') RETURNING id INTO s;
  END IF;
  SELECT id INTO c FROM public.categories LIMIT 1;
  INSERT INTO public.products(sku,name,category_id,retail_price,unit,cost_price)
    VALUES('TABLET-APPEND-'||gen_random_uuid(),'Tablet append fixture',c,100,'pcs',0) RETURNING id INTO p;
  INSERT INTO public.orders(order_number,order_type,status,created_via,session_id,served_by,sent_to_kitchen_at,subtotal,tax_amount,total)
  VALUES('TABLET-APPEND-'||gen_random_uuid(),'take_out','draft','tablet',s,a,now(),170,0,170) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,is_locked,kitchen_status,sent_to_kitchen_at)
    VALUES(o,p,'Original ready',80,1,80,true,'ready',now()),(o,p,'Original pending',90,1,90,true,'pending',now());
  INSERT INTO tablet_before SELECT * FROM public.order_items WHERE order_id=o;
  INSERT INTO tablet_fx VALUES(a,s,p,o,gen_random_uuid());
END $fixture$;
SELECT lives_ok(format('SELECT public.fire_counter_order_v10(%L,%L,%L::jsonb,%L)',
  attempt,session_id,jsonb_build_array(
    jsonb_build_object('client_line_id','new-a','product_id',product_id,'quantity',1,'unit_price',999,'modifiers','[]'::jsonb),
    jsonb_build_object('client_line_id','new-b','product_id',product_id,'quantity',2,'unit_price',999,'modifiers','[]'::jsonb)),order_id),
  'append tablette deja reprise dans la meme session') FROM tablet_fx;
SELECT is((SELECT count(*)::int FROM public.order_items WHERE order_id=f.order_id),4,'deux nouvelles lignes seulement') FROM tablet_fx f;
SELECT ok(NOT EXISTS(SELECT 1 FROM tablet_before b JOIN public.order_items i USING(id)
  WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(i)),'lignes historiques entierement inchangees');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.order_items i JOIN tablet_fx f ON f.order_id=i.order_id
  WHERE i.client_line_id IN ('new-a','new-b') AND (i.unit_price<>100 OR NOT i.is_locked OR i.kitchen_status<>'pending')),'prix serveur et verrou des nouvelles lignes');
SELECT lives_ok(format('SELECT public.fire_counter_order_v10(%L,%L,%L::jsonb,%L)',attempt,session_id,'[]',order_id),'rejeu identique sans nouvel item') FROM tablet_fx;
SELECT is((SELECT count(*)::int FROM public.order_items WHERE order_id=f.order_id),4,'pas de doublon au rejeu') FROM tablet_fx f;
SELECT lives_ok(format('SELECT public.hold_fired_order_v3(%L,%L)',order_id,session_id),'hold meme session') FROM tablet_fx;
SELECT ok(o.is_held AND o.created_via='tablet' AND o.status='draft' AND o.order_number LIKE 'TABLET-APPEND-%','origine numero statut preserves') FROM public.orders o JOIN tablet_fx f ON f.order_id=o.id;
SELECT lives_ok(format('SELECT public.reopen_held_order_v5(%L,%L)',order_id,session_id),'reopen meme session') FROM tablet_fx;
SELECT ok(NOT o.is_held,'hold retire') FROM public.orders o JOIN tablet_fx f ON f.order_id=o.id;
SELECT throws_ok(format('SELECT public.hold_fired_order_v3(%L,%L)',order_id,gen_random_uuid()),'P0002','fired_order_not_found_or_not_holdable','hold autre session refuse') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L,%L)',order_id,gen_random_uuid()),'P0002','order_not_available_for_reopen','reopen autre session refuse') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.hold_fired_order_v3(%L)',order_id),'P0002','fired_order_not_found_or_not_holdable','hold sans session refuse') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L)',order_id),'P0002','order_not_available_for_reopen','reopen sans session refuse') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.fire_counter_order_v10(%L,%L,%L::jsonb,%L)',gen_random_uuid(),gen_random_uuid(),jsonb_build_array(jsonb_build_object('product_id',product_id,'quantity',1)),order_id),'P0002','Order not found or not appendable','append autre session refuse') FROM tablet_fx;
UPDATE public.orders SET status='pending_payment' WHERE id=(SELECT order_id FROM tablet_fx);
SELECT throws_ok(format('SELECT public.fire_counter_order_v10(%L,%L,%L::jsonb,%L)',gen_random_uuid(),session_id,jsonb_build_array(jsonb_build_object('product_id',product_id,'quantity',1)),order_id),'P0002','Order not found or not appendable','tablette non reprise refusee') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.hold_fired_order_v3(%L,%L)',order_id,session_id),'P0002','fired_order_not_found_or_not_holdable','hold tablette non reprise refuse') FROM tablet_fx;
SELECT throws_ok(format('SELECT public.reopen_held_order_v5(%L,%L)',order_id,session_id),'P0002','order_not_available_for_reopen','reopen tablette non reprise refuse') FROM tablet_fx;
SELECT * FROM finish();
ROLLBACK;
