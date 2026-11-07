-- Journal commun, auteurs, pagination, droits et nouveaux émetteurs. DEV, rollback intégral.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE activity_results(seq serial, tap text);
INSERT INTO activity_results(tap) SELECT no_plan();

CREATE FUNCTION pg_temp.test_activity_logs() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid;
  v_auth uuid;
  v_name text;
  v_device uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_template uuid := gen_random_uuid();
  v_product uuid;
  v_order uuid;
  v_item uuid;
  v_count uuid;
  v_customer uuid := gen_random_uuid();
  v_id uuid;
  v_before integer;
  v_cursor text;
BEGIN
  SELECT id, auth_user_id, full_name INTO STRICT v_actor, v_auth, v_name
  FROM user_profiles WHERE role_code = 'SUPER_ADMIN' AND is_active AND deleted_at IS NULL
  ORDER BY (id = auth_user_id) LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_auth);
  INSERT INTO pos_devices(id, device_token, label) VALUES(v_device, gen_random_uuid()::text, 'Audit test device');
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload,created_at)
  SELECT v_actor,'test.activity','activity_test',v_entity,'{"name":"Audit fixture"}',
    '{"before":1,"after":2}', '2026-11-04T12:00:00+08:00' FROM generate_series(1,55);
  INSERT INTO pos_events(client_event_id,event_type,occurred_at,device_id,actor_id,order_id,order_number_snap,payload)
  VALUES(gen_random_uuid(),'item_added','2026-11-04T12:00:00+08:00',v_device,v_actor,v_entity,'TEST-ACTIVITY','{"name":"Coffee"}');
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_action:='test.activity',p_limit:=200)),55,'tous les audits sont consultables');
  RETURN NEXT is((SELECT actor_name FROM get_activity_logs_v3(p_action:='test.activity',p_limit:=1)),v_name,'nom résolu par identifiant de profil');
  RETURN NEXT is((SELECT payload FROM get_activity_logs_v3(p_action:='test.activity',p_limit:=1)),'{"before":1,"after":2}'::jsonb,'diff distinct du contexte');
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_limit:=50)),50,'première page bornée');
  SELECT created_at::text || '|' || id INTO v_cursor FROM get_activity_logs_v3(p_entity_id:=v_entity,p_limit:=50)
  ORDER BY created_at,id LIMIT 1;
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_limit:=50,p_cursor:=v_cursor)),6,'curseur commun sans perte aux timestamps identiques');
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_action:='pos.item_added')),1,'gestes POS visibles avec filtre action');
  RETURN NEXT is((SELECT source FROM get_activity_logs_v3(p_entity_id:=v_entity,p_action:='pos.item_added')),'pos','source client explicitement distincte');
  RETURN NEXT is((SELECT metadata->>'order_number' FROM get_activity_logs_v3(p_entity_id:=v_entity,p_action:='pos.item_added')),'TEST-ACTIVITY','numéro de commande POS conservé');
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_actor_id:=gen_random_uuid())),0,'filtre auteur appliqué');
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_date_end:='2026-11-03')),0,'bornes métier sur les deux sources');
  RETURN NEXT ok(NOT has_function_privilege('anon','public.get_activity_logs_v3(text,integer,uuid,text,text,uuid,text,text)','EXECUTE'),'anon exclu');
  RETURN NEXT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_activity_logs_v3(text,integer,uuid,text,text,uuid,text,text)'::regprocedure),'RLS conservée par SECURITY INVOKER');

  INSERT INTO suppliers(id,code,name) VALUES(v_supplier,'AUDIT-' || v_supplier,'Audit supplier');
  UPDATE suppliers SET name='Audit supplier updated' WHERE id=v_supplier;
  UPDATE suppliers SET updated_at=now() WHERE id=v_supplier;
  UPDATE suppliers SET deleted_at=now() WHERE id=v_supplier;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_supplier),3,'création modification suppression fournisseur, sans bruit timestamp');
  RETURN NEXT ok((SELECT bool_and(actor_id=v_actor) FROM audit_logs WHERE entity_id=v_supplier),'auteur des mutations BO résolu');
  RETURN NEXT is((SELECT payload->'before'->>'name' FROM audit_logs WHERE entity_id=v_supplier AND action='supplier.update'),'Audit supplier','avant/après fournisseur');
  INSERT INTO receipt_templates(id,name,paper_size) VALUES(v_template,'Audit receipt','80mm');
  UPDATE receipt_templates SET footer='Thank you' WHERE id=v_template;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_template),2,'modèles de reçus audités');
  INSERT INTO holidays(name,date,type) VALUES('Audit holiday',current_date,'company') RETURNING id INTO v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_id AND action='holiday.insert'),'jour férié audité');
  INSERT INTO email_templates(code,subject,body_html,body_text) VALUES('audit-' || gen_random_uuid(),'Test','Test','Test') RETURNING id INTO v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_id AND action='email_template.insert'),'modèle email audité');
  INSERT INTO notification_templates(code,channel,body_template) VALUES('audit-' || gen_random_uuid(),'email','Test') RETURNING id INTO v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_id AND action='notification_template.insert'),'modèle notification audité');
  INSERT INTO lan_devices(code,name,device_type) VALUES('audit-' || gen_random_uuid(),'Audit printer','printer') RETURNING id INTO v_id;
  UPDATE lan_devices SET last_heartbeat_at=now() WHERE id=v_id;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id),1,'heartbeat sans bruit audit');
  UPDATE lan_devices SET name='Audit printer updated' WHERE id=v_id;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id),2,'configuration LAN auditée');

  SELECT id INTO STRICT v_product FROM products WHERE deleted_at IS NULL AND product_type='finished' LIMIT 1;
  INSERT INTO promotions(name,slug,type,scope,discount_value) VALUES('Audit promotion','audit-' || gen_random_uuid(), 'percentage','cart',10) RETURNING id INTO v_id;
  UPDATE promotions SET name='Audit promotion updated' WHERE id=v_id;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id),2,'création et modification promotion auditées');
  PERFORM delete_promotion_v1(v_id);
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id AND action='promotion.delete'),1,'suppression promotion sans doublon');
  INSERT INTO margin_alerts(product_id,expected_margin_pct,target_margin_pct,delta_pct,cost_per_unit,selling_price)
  VALUES(v_product,20,30,-10,80,100) RETURNING id INTO v_id;
  UPDATE margin_alerts SET acknowledged_at=now(),acknowledged_by=v_actor WHERE id=v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_id AND action='margin_alert.update'),'acquittement marge audité');
  SELECT id INTO STRICT v_id FROM recipes WHERE deleted_at IS NULL LIMIT 1;
  SELECT count(*)::integer INTO v_before FROM audit_logs WHERE entity_id=v_id AND entity_type='recipe_mode';
  UPDATE recipes SET is_baker_percentage=NOT is_baker_percentage,
    baker_percentage=CASE WHEN is_baker_percentage THEN NULL ELSE 100 END WHERE id=v_id;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id AND entity_type='recipe_mode'),v_before+1,'bascule du mode boulanger auditée');

  PERFORM update_cost_price_v1(v_product,12,'Audit coverage cost correction',gen_random_uuid());
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_product AND action='product.cost_corrected'),'correction coût auditée');
  INSERT INTO inventory_counts(count_number,created_by) VALUES('AUDIT-' || gen_random_uuid(),v_actor) RETURNING id INTO v_count;
  INSERT INTO inventory_count_items(count_id,product_id,unit) VALUES(v_count,v_product,'pcs') RETURNING id INTO v_id;
  UPDATE inventory_count_items SET counted_qty=2 WHERE id=v_id;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_id AND entity_type='opname_item'),2,'ajout et saisie opname audités');
  INSERT INTO customers(id,name) VALUES(v_customer,'Audit customer');
  INSERT INTO customer_store_credit_ledger(customer_id,delta,balance_after,source,reference_id)
  VALUES(v_customer,-10,0,'expiry',gen_random_uuid()) RETURNING id INTO v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_customer AND action='customer.store_credit_expired' AND actor_id IS NULL),'expiration des avoirs attribuée au système');

  -- Exercice réel des transitions cuisine sur une ligne existante, annulé en fin de test.
  SELECT oi.id,oi.order_id INTO STRICT v_item,v_order FROM order_items oi LIMIT 1;
  UPDATE order_items SET prep_started_at=NULL,served_at=NULL WHERE id=v_item;
  SELECT count(*)::integer INTO v_before FROM audit_logs WHERE entity_id=v_item AND action LIKE 'kds.%';
  UPDATE order_items SET prep_started_at=now(),served_at=now(),served_by=v_actor WHERE id=v_item;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_item AND action LIKE 'kds.%'),v_before+2,'préparation et service cuisine audités');
  UPDATE order_items SET prep_started_at=NULL,served_at=NULL WHERE id=v_item;
  RETURN NEXT is((SELECT count(*)::integer FROM audit_logs WHERE entity_id=v_item AND action LIKE 'kds.%'),v_before+2,'rappel sans fausse transition positive');

  INSERT INTO pos_sessions(opened_by,opening_cash,status,closed_at,closed_by,closing_cash)
  VALUES(v_actor,0,'closed',now(),v_actor,0) RETURNING id INTO v_id;
  RETURN NEXT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=v_id AND action='shift.open'),'ouverture caisse tracée côté serveur');
  EXECUTE 'SET LOCAL ROLE authenticated';
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_limit:=200)),56,'administrateur connecté consulte les deux sources sous RLS');
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v3(p_entity_id:=v_entity,p_limit:=200)),0,'session absente sans accès aux traces');
  EXECUTE 'RESET ROLE';
END;
$$;
INSERT INTO activity_results(tap) SELECT * FROM pg_temp.test_activity_logs();
INSERT INTO activity_results(tap) SELECT * FROM finish();
SELECT tap FROM activity_results ORDER BY seq;
ROLLBACK;
