-- Préparé localement ; exécution cloud uniquement après autorisation des mutations dev.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE kitchen_fixture(root uuid, actor uuid, auth_id uuid, order_id uuid, key uuid);
DO $fixture$
DECLARE
  v_actor uuid; v_auth uuid; v_session uuid; v_order uuid; v_product uuid; v_category uuid;
  v_root uuid := gen_random_uuid();
BEGIN
  SELECT id, auth_user_id INTO v_actor, v_auth FROM public.user_profiles
    WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL
      AND public.has_permission(auth_user_id, 'kds.operate')
    ORDER BY (id = auth_user_id), id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'fixture: kitchen employee required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_session FROM public.pos_sessions WHERE status='open' LIMIT 1;
  IF v_session IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by, opening_cash, status) VALUES(v_actor,0,'open') RETURNING id INTO v_session;
  END IF;
  SELECT id INTO v_category FROM public.categories LIMIT 1;
  INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock)
    VALUES('KDS-OFFLINE-' || v_root::text,'Kitchen offline test',v_category,100,0,false,false) RETURNING id INTO v_product;
  INSERT INTO public.orders(order_number,order_type,status,subtotal,tax_amount,total,session_id)
    VALUES('KDS-OFFLINE-' || v_root::text,'take_out','draft',300,0,300,v_session) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,is_locked,sent_to_kitchen_at,client_line_id)
    SELECT v_order,v_product,'Kitchen offline test',100,1,100,'pending',true,now(),line
    FROM unnest(ARRAY['first','second','cancelled']) line;
  UPDATE public.order_items SET is_cancelled=true,cancelled_at=now(),cancelled_reason='fixture',cancelled_by=v_actor
    WHERE order_id=v_order AND client_line_id='cancelled';
  INSERT INTO public.counter_fire_idempotency_keys(client_uuid,order_id) VALUES(v_root,v_order);
  INSERT INTO kitchen_fixture VALUES(v_root,v_actor,v_auth,v_order,gen_random_uuid());
END;
$fixture$;

SELECT ok(NOT has_function_privilege('anon','public.resolve_kds_offline_order_v1(uuid)','EXECUTE'),'resolve inaccessible anon/PUBLIC');
SELECT ok(NOT has_function_privilege('anon','public.replay_kds_offline_status_v1(uuid,text,text,uuid,uuid,timestamptz)','EXECUTE'),'replay inaccessible anon/PUBLIC');
SELECT is((public.resolve_kds_offline_order_v1(root)->>'order_id')::uuid, order_id,'mapping counter canonique') FROM kitchen_fixture;
SELECT is(jsonb_array_length(public.resolve_kds_offline_order_v1(root)->'items'),3,'projection contient aussi annulation') FROM kitchen_fixture;
SELECT is(public.resolve_kds_offline_order_v1(gen_random_uuid()),NULL::jsonb,'racine pas encore synchronisée');
INSERT INTO public.tablet_order_idempotency_keys(client_uuid,order_id) SELECT gen_random_uuid(),order_id FROM kitchen_fixture;
SELECT is((public.resolve_kds_offline_order_v1(k.client_uuid)->>'order_id')::uuid,f.order_id,'mapping tablette canonique')
  FROM kitchen_fixture f JOIN public.tablet_order_idempotency_keys k ON k.order_id=f.order_id;

SELECT is(public.replay_kds_offline_status_v1(root,'first','ready',key,actor,now())->>'outcome','applied','pending vers ready atomique') FROM kitchen_fixture;
SELECT is(public.replay_kds_offline_status_v1(root,'first','ready',key,actor,now())->>'outcome','applied','ACK perdu : même résultat') FROM kitchen_fixture;
SELECT is((SELECT count(*)::int FROM public.audit_logs a WHERE a.action='kds.offline_replayed' AND a.metadata->>'idempotency_key'=f.key::text),1,'un audit au retry') FROM kitchen_fixture f;
SELECT throws_ok(format('SELECT public.replay_kds_offline_status_v1(%L,%L,%L,%L,%L,now())',root,'second','ready',key,actor),'22023','offline_idempotency_conflict','clé non réutilisable pour une autre ligne') FROM kitchen_fixture;
SELECT throws_ok(format('SELECT public.replay_kds_offline_status_v1(%L,%L,%L,%L,%L,now())',root,'first','served',key,actor),'22023','offline_idempotency_conflict','clé non réutilisable pour une autre cible') FROM kitchen_fixture;
SELECT throws_ok(format('SELECT public.replay_kds_offline_status_v1(%L,%L,%L,%L,%L,now())',root,'first','ready',key,gen_random_uuid()),'42501','offline_actor_mismatch','acteur vérifié avant replay') FROM kitchen_fixture;
SELECT is(public.replay_kds_offline_status_v1(root,'first','served',gen_random_uuid(),actor,now())->>'outcome','applied','served attribué employé courant') FROM kitchen_fixture;
SELECT is(public.replay_kds_offline_status_v1(root,'first','preparing',gen_random_uuid(),actor,now())->>'outcome','applied','ancien geste accepté sans recul') FROM kitchen_fixture;
SELECT is(i.kitchen_status,'served','served ne régresse pas') FROM public.order_items i JOIN kitchen_fixture f ON f.order_id=i.order_id WHERE client_line_id='first';
SELECT is(i.served_by,f.actor,'profil employé, pas auth.uid') FROM public.order_items i JOIN kitchen_fixture f ON f.order_id=i.order_id WHERE client_line_id='first';
SELECT is(public.replay_kds_offline_status_v1(root,'cancelled','served',gen_random_uuid(),actor,now())->>'outcome','cancelled','annulation prioritaire') FROM kitchen_fixture;
SELECT is(i.kitchen_status,'pending','ligne annulée inchangée') FROM public.order_items i JOIN kitchen_fixture f ON f.order_id=i.order_id WHERE client_line_id='cancelled';
SELECT is(public.replay_kds_offline_status_v1(root,'legacy-missing','ready',gen_random_uuid(),actor,now())->>'outcome','unresolved','legacy non rapproché heuristiquement') FROM kitchen_fixture;
SELECT is(public.replay_kds_offline_status_v1(gen_random_uuid(),'first','ready',gen_random_uuid(),actor,now())->>'outcome','waiting','absence racine ne perd pas intention') FROM kitchen_fixture;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok(format('SELECT public.resolve_kds_offline_order_v1(%L)',root),'42501','permission_denied: kds.operate required','pas de session : refus résolution') FROM kitchen_fixture;
SELECT throws_ok(format('SELECT public.replay_kds_offline_status_v1(%L,%L,%L,%L,%L,now())',root,'first','ready',key,actor),'42501','permission_denied: kds.operate required','pas de session : refus même clé déjà jouée') FROM kitchen_fixture;
SELECT * FROM finish();
ROLLBACK;
