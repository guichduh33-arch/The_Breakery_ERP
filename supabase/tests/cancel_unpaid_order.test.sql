-- Préparé localement ; exécution cloud après déploiement et autorisation explicite.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE cancel_fixture(actor uuid, auth_id uuid, order_id uuid, product_id uuid, key uuid, stamp timestamptz, items jsonb, losses jsonb);
DO $fixture$
DECLARE
  v_actor uuid; v_auth uuid; v_session uuid; v_order uuid; v_product uuid; v_category uuid;
  v_root uuid := gen_random_uuid();
BEGIN
  SELECT id, auth_user_id INTO v_actor, v_auth FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND auth_user_id IS NOT NULL
      AND public.has_permission_for_profile(id, 'payments.process')
      AND public.has_permission_for_profile(id, 'pos.sale.cancel_item') LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'fixture: authorized active manager required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_session FROM public.pos_sessions WHERE opened_by=v_actor AND status='open';
  IF v_session IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by, opening_cash, status) VALUES(v_actor,0,'open') RETURNING id INTO v_session;
  END IF;
  SELECT id INTO v_category FROM public.categories LIMIT 1;
  INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit,cost_price)
    VALUES('CANCEL-UNPAID-' || v_root::text,'Cancellation fixture',v_category,100,10,true,true,'pcs',0) RETURNING id INTO v_product;
  INSERT INTO public.orders(order_number,order_type,status,created_via,subtotal,tax_amount,total,session_id)
    VALUES('CANCEL-UNPAID-' || v_root::text,'take_out','pending_payment','pos',400,0,400,v_session) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,is_locked,sent_to_kitchen_at)
    SELECT v_order,v_product,'Cancellation fixture',100,2,200,'pending',true,now() FROM generate_series(1,2);
  INSERT INTO cancel_fixture SELECT v_actor,v_auth,v_order,v_product,gen_random_uuid(),o.updated_at,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=v_order),
    (SELECT jsonb_agg(jsonb_build_object('id',i.id,'waste_qty',1) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=v_order)
    FROM public.orders o WHERE id=v_order;
END;
$fixture$;
SELECT ok(NOT has_function_privilege('anon','public.cancel_unpaid_order_v1(uuid,timestamptz,jsonb,jsonb,text,uuid,uuid,uuid)','EXECUTE'),'anon/PUBLIC refusés');
SELECT ok(NOT has_function_privilege('authenticated','public.cancel_unpaid_order_v1(uuid,timestamptz,jsonb,jsonb,text,uuid,uuid,uuid)','EXECUTE'),'client direct refusé');
SELECT ok(has_function_privilege('service_role','public.cancel_unpaid_order_v1(uuid,timestamptz,jsonb,jsonb,text,uuid,uuid,uuid)','EXECUTE'),'EF autorisée');
CREATE TEMP TABLE cancel_denied AS
  SELECT id,auth_user_id FROM public.user_profiles WHERE is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    AND NOT public.has_permission_for_profile(id,'payments.process')
    AND NOT public.has_permission_for_profile(id,'pos.sale.cancel_item') LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM cancel_denied) THEN RAISE EXCEPTION 'fixture: active profile without cancellation/payment permissions required'; END IF; END $$;
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,items,losses,'Test reason',actor,d.auth_user_id,key),
  'P0003','permission_denied','acteur sans permission refusé') FROM cancel_fixture CROSS JOIN cancel_denied d;
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,items,losses,'Test reason',d.id,auth_id,key),
  'P0003','manager_permission_denied','manager sans permission refusé') FROM cancel_fixture CROSS JOIN cancel_denied d;
-- Fixtures distinctes déjà payées : aucun changement du statut de la commande test.
CREATE TEMP TABLE cancel_paid_cases(id uuid, label text);
DO $paid_fixture$
DECLARE v_label text; v_order uuid; v_fixture record;
BEGIN
  SELECT f.actor,o.session_id INTO v_fixture
    FROM cancel_fixture f JOIN public.orders o ON o.id=f.order_id;
  FOREACH v_label IN ARRAY ARRAY['paid','completed'] LOOP
    INSERT INTO public.orders(order_number,order_type,status,created_via,subtotal,tax_amount,total,session_id,served_by)
    VALUES ('CANCEL-PAID-'||gen_random_uuid(),'take_out','pending_payment','pos',100,0,100,v_fixture.session_id,v_fixture.actor)
    RETURNING id INTO v_order;
    INSERT INTO public.order_payments(order_id,method,amount) VALUES(v_order,'cash',100);
    UPDATE public.orders SET status='paid' WHERE id=v_order;
    IF v_label='completed' THEN
      UPDATE public.orders SET status='completed' WHERE id=v_order;
    END IF;
    INSERT INTO cancel_paid_cases VALUES(v_order,v_label);
  END LOOP;
END;
$paid_fixture$;
SELECT is(o.status::text,p.label,'fixture réellement '||p.label)
  FROM cancel_paid_cases p JOIN public.orders o ON o.id=p.id;
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',p.id,stamp,items,losses,'Test reason',actor,auth_id,gen_random_uuid()),
  '23514','unpaid_order_required','statut '||p.label||' refusé') FROM cancel_fixture CROSS JOIN cancel_paid_cases p;
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,'[]',losses,'Test reason',actor,auth_id,key),
  'P0014','order_changed','snapshot périmé refusé') FROM cancel_fixture;
-- La seconde perte échoue après la première annulation : tous ses effets doivent être annulés.
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,items,
  jsonb_set(losses,'{1,waste_qty}','3'),'Test reason',actor,auth_id,key),
  '22023','invalid_waste_qty','perte supérieure à la quantité refusée atomiquement') FROM cancel_fixture;
SELECT is((SELECT count(*)::int FROM public.order_items i WHERE i.order_id=f.order_id AND i.is_cancelled),0,'aucune ligne partiellement annulée') FROM cancel_fixture f;
SELECT is((SELECT current_stock FROM public.products WHERE id=f.product_id),10::numeric,'stock restauré après échec') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.stock_movements WHERE product_id=f.product_id),0,'aucun mouvement résiduel après échec') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.unpaid_order_cancel_keys WHERE key=f.key),0,'pas de clé consommée après échec') FROM cancel_fixture f;
-- Une ligne servie est refusée avant toute écriture.
UPDATE public.order_items SET kitchen_status='served' WHERE id=(SELECT (items->0->>'id')::uuid FROM cancel_fixture);
UPDATE cancel_fixture f SET items=(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=f.order_id),
  stamp=(SELECT updated_at FROM public.orders WHERE id=f.order_id);
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,items,losses,'Test reason',actor,auth_id,key),
  '23514','served_item_cannot_be_cancelled','ligne servie protégée') FROM cancel_fixture;
UPDATE public.order_items SET kitchen_status='pending' WHERE order_id=(SELECT order_id FROM cancel_fixture);
UPDATE cancel_fixture f SET items=(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=f.order_id),
  stamp=(SELECT updated_at FROM public.orders WHERE id=f.order_id);
SELECT is(public.cancel_unpaid_order_v1(order_id,stamp,items,losses,'Test reason',actor,auth_id,key)->>'status','voided','annulation totale') FROM cancel_fixture;
SELECT is(public.cancel_unpaid_order_v1(order_id,stamp,items,losses,'Test reason',actor,auth_id,key)->>'status','voided','ACK perdu : rejeu même résultat') FROM cancel_fixture;
SELECT is((SELECT count(*)::int FROM public.order_items i WHERE i.order_id=f.order_id AND i.is_cancelled),2,'deux lignes annulées') FROM cancel_fixture f;
SELECT is((SELECT current_stock FROM public.products WHERE id=f.product_id),8::numeric,'pertes une seule fois') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.stock_movements WHERE product_id=f.product_id),2,'deux mouvements sans doublon') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.refunds WHERE order_id=f.order_id),0,'aucun remboursement') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.order_payments WHERE order_id=f.order_id),0,'aucun paiement') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE reference_id=f.order_id),0,'aucune JE de vente ou extourne pour la commande impayée') FROM cancel_fixture f;
SELECT is((SELECT total FROM public.orders WHERE id=f.order_id),0::numeric,'total nul') FROM cancel_fixture f;
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE entity_id=f.order_id AND action='order.cancel_unpaid'),1,'audit global unique') FROM cancel_fixture f;
SELECT throws_ok(format('SELECT public.cancel_unpaid_order_v1(%L,%L,%L,%L,%L,%L,%L,%L)',order_id,stamp,items,losses,'Test reason',actor,auth_id,gen_random_uuid()),
  '23514','unpaid_order_required','commande close non annulable avec une nouvelle clé') FROM cancel_fixture;
SELECT * FROM finish();
ROLLBACK;
