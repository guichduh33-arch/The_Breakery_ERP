-- Parcours partagé réel : trois profils, droits authenticated, aucune donnée conservée.
BEGIN;
SELECT plan(12);
-- Prix TTC pour un montant de règlement déterministe ; annulé au ROLLBACK.
UPDATE business_config SET tax_inclusive=true;

DO $$
DECLARE
  w user_profiles; c user_profiles; b user_profiles;
  product_id uuid := gen_random_uuid(); session_id uuid; category_id uuid;
BEGIN
  SELECT * INTO STRICT w FROM user_profiles WHERE role_code='waiter'
    AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;
  SELECT * INTO STRICT c FROM user_profiles WHERE role_code='CASHIER'
    AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    AND has_permission(auth_user_id,'payments.process') LIMIT 1;
  SELECT * INTO STRICT b FROM user_profiles WHERE role_code='ADMIN'
    AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;
  SELECT id INTO category_id FROM categories WHERE is_active LIMIT 1;
  INSERT INTO products(id,sku,name,category_id,retail_price,product_type,track_inventory)
    VALUES(product_id,'WAITER-AUDIT-'||product_id,'Waiter integration fixture',category_id,20000,'finished',false);
  SELECT id INTO session_id FROM pos_sessions WHERE opened_by=c.id AND status='open' LIMIT 1;
  IF session_id IS NULL THEN
    INSERT INTO pos_sessions(opened_by,opening_cash,status) VALUES(c.id,0,'open') RETURNING id INTO session_id;
  END IF;
  PERFORM set_config('wa.waiter',w.id::text,true);
  PERFORM set_config('wa.waiter_auth',w.auth_user_id::text,true);
  PERFORM set_config('wa.cashier_auth',c.auth_user_id::text,true);
  PERFORM set_config('wa.bo_auth',b.auth_user_id::text,true);
  PERFORM set_config('wa.session',session_id::text,true);
  PERFORM set_config('wa.product',product_id::text,true);
  PERFORM set_config('wa.key',gen_random_uuid()::text,true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('wa.waiter_auth'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('wa.waiter_auth'),'role','authenticated')::text,true);

SELECT set_config('wa.order',create_tablet_order_v10(
  current_setting('wa.key')::uuid,current_setting('wa.waiter')::uuid,'AUDIT-7','dine_in',
  jsonb_build_array(jsonb_build_object('product_id',current_setting('wa.product'),'quantity',1,'unit_price',1,'modifiers','[]'::jsonb)),
  'Integration note')::text,true);

SELECT is((SELECT waiter_id FROM orders WHERE id=current_setting('wa.order')::uuid),current_setting('wa.waiter')::uuid,'serveur réel attribué à la commande');
SELECT is((SELECT notes FROM orders WHERE id=current_setting('wa.order')::uuid),'Integration note','note cuisine persistée');
SELECT ok((SELECT sent_to_kitchen_at IS NOT NULL FROM orders WHERE id=current_setting('wa.order')::uuid),'commande envoyée en cuisine dès la création');
SELECT is(create_tablet_order_v10(current_setting('wa.key')::uuid,current_setting('wa.waiter')::uuid,'AUDIT-7','dine_in',
  jsonb_build_array(jsonb_build_object('product_id',current_setting('wa.product'),'quantity',1,'unit_price',1,'modifiers','[]'::jsonb))),
  current_setting('wa.order')::uuid,'réponse perdue : même clé, même commande');

SELECT set_config('request.jwt.claim.sub',current_setting('wa.cashier_auth'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('wa.cashier_auth'),'role','authenticated')::text,true);
SELECT is((SELECT count(*)::int FROM orders WHERE id=current_setting('wa.order')::uuid AND created_via='tablet' AND status='pending_payment'),1,'commande visible avec les droits caisse');
SELECT lives_ok(format('SELECT pickup_tablet_order(%L::uuid,%L::uuid)',current_setting('wa.order'),current_setting('wa.session')),'reprise caisse autorisée');
SELECT throws_ok(format('SELECT pickup_tablet_order(%L::uuid,%L::uuid)',current_setting('wa.order'),current_setting('wa.session')),'P0012',NULL,'seconde reprise refusée');

SELECT set_config('request.jwt.claim.sub',current_setting('wa.waiter_auth'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('wa.waiter_auth'),'role','authenticated')::text,true);
SELECT lives_ok(format($q$SELECT create_tablet_order_v10(gen_random_uuid(),%L::uuid,'AUDIT-7','dine_in',
  jsonb_build_array(jsonb_build_object('product_id',%L,'quantity',1,'unit_price',1,'modifiers','[]'::jsonb)),NULL,%L::uuid)$q$,
  current_setting('wa.waiter'),current_setting('wa.product'),current_setting('wa.order')),'ajout après reprise accepté');

SELECT set_config('request.jwt.claim.sub',current_setting('wa.cashier_auth'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('wa.cashier_auth'),'role','authenticated')::text,true);
SELECT is((SELECT count(*)::int FROM order_items WHERE order_id=current_setting('wa.order')::uuid),2,'caisse voit les deux tournées');
SELECT lives_ok(format($q$SELECT pay_existing_order_v20(p_order_id:=%L::uuid,p_idempotency_key:=gen_random_uuid(),
 p_payments:=jsonb_build_array(jsonb_build_object('method','cash','amount',(SELECT sum(line_total) FROM order_items WHERE order_id=%L::uuid),
 'cash_received',(SELECT sum(line_total) FROM order_items WHERE order_id=%L::uuid))))$q$,
 current_setting('wa.order'),current_setting('wa.order'),current_setting('wa.order')),'paiement autorisé en caisse');

SELECT set_config('request.jwt.claim.sub',current_setting('wa.bo_auth'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('wa.bo_auth'),'role','authenticated')::text,true);
SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_orders_list_v4(
  (current_date-1)::text,(current_date+1)::text,'{}'::jsonb,200)->'lines') row
  WHERE row->>'id'=current_setting('wa.order')),'commande accessible par la RPC de liste du back-office');
SELECT ok((SELECT o.status='paid' AND o.total=(SELECT sum(amount) FROM order_payments WHERE order_id=o.id)
  AND (SELECT count(*) FROM order_items WHERE order_id=o.id)=2
  FROM orders o WHERE o.id=current_setting('wa.order')::uuid),'détail BO : même commande, deux lignes et paiement égal au total');

SELECT * FROM finish();
ROLLBACK;
