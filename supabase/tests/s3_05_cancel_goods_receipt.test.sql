-- S3-05 — Annulation d'une réception (cancel_goods_receipt_v1).
-- Stock, coût moyen et dette reviennent à l'état d'avant réception ; l'écriture
-- est contre-passée et équilibrée ; le statut du bon redescend ; refus de la
-- double annulation, du stock insuffisant, du bon payé au-delà, des appelants
-- sans droit ; rejeu idempotent.
BEGIN;
\ir helpers/pin_session.sql
\ir helpers/payment_invoice.sql
SELECT plan(41);

CREATE TEMP TABLE fx(
  admin_auth uuid, admin_profile uuid, cashier_auth uuid,
  p1 uuid, p2 uuid, p3 uuid, p4 uuid,
  po1 uuid, po2 uuid, po3 uuid, po4 uuid,
  grn1 uuid, grn2a uuid, grn2b uuid, grn3 uuid, grn4 uuid,
  je1 uuid, key1 uuid, cancel1 jsonb, replay1 jsonb, cancel2b jsonb, cancel2a jsonb
);

DO $$
DECLARE
  a uuid := gen_random_uuid(); ap uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); cp uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  po1 uuid; po2 uuid; po3 uuid; po4 uuid; l uuid;
  g1 uuid; g2a uuid; g2b uuid; g3 uuid; g4 uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES(a),(c);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active) VALUES
    (ap,a,'GRNC-'||left(ap::text,8),'GRN cancel admin','SUPER_ADMIN',public.hash_pin('285741'),true),
    (cp,c,'GRNC-'||left(cp::text,8),'GRN cancel cashier','CASHIER',public.hash_pin('396852'),true);
  PERFORM pg_temp.authenticate_pin(a);
  INSERT INTO public.categories(id,name,slug,category_type)
    VALUES(cat,'GRN cancel fixture','grn-cancel-'||cat,'raw_material');
  INSERT INTO public.suppliers(id,code,name,payment_terms_days,is_active)
    VALUES(s,'GRNC-'||left(s::text,8),'GRN cancel fixture',30,true);
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,
    unit,product_type,is_active,track_inventory,deduct_stock) VALUES
    (p1,'GRNC1-'||left(p1::text,8),'GRN cancel P1',cat,500,10,100,'pcs','finished',true,true,true),
    (p2,'GRNC2-'||left(p2::text,8),'GRN cancel P2',cat,500,0,0,'pcs','finished',true,true,true),
    (p3,'GRNC3-'||left(p3::text,8),'GRN cancel P3',cat,500,0,0,'pcs','finished',true,true,true),
    (p4,'GRNC4-'||left(p4::text,8),'GRN cancel P4',cat,500,0,0,'pcs','finished',true,true,true);

  -- Bon 1 : 2 cartons de 10 à 2000 ; on en reçoit un (10 pièces à 200).
  po1 := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=jsonb_build_array(jsonb_build_object(
    'product_id',p1,'quantity',2,'unit','box','unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  po2 := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=jsonb_build_array(jsonb_build_object(
    'product_id',p2,'quantity',2,'unit','box','unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  po3 := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=jsonb_build_array(jsonb_build_object(
    'product_id',p3,'quantity',1,'unit','box','unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  po4 := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=jsonb_build_array(jsonb_build_object(
    'product_id',p4,'quantity',2,'unit','box','unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  UPDATE public.purchase_order_items SET unit_factor_to_base=10 WHERE po_id IN (po1,po2,po3,po4);

  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po1;
  g1 := (public.receive_purchase_order_v7(po1,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po2;
  g2a := (public.receive_purchase_order_v7(po2,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  g2b := (public.receive_purchase_order_v7(po2,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po3;
  g3 := (public.receive_purchase_order_v7(po3,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po4;
  g4 := (public.receive_purchase_order_v7(po4,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;

  -- Bon 3 : le stock a été consommé après réception (fixture directe du cache).
  UPDATE public.products SET current_stock=5 WHERE id=p3;
  -- Bon 4 : 1500 déjà payés sur une réception de 2000.
  PERFORM public._record_po_payment_internal(po4,1500,'transfer','fixture',gen_random_uuid(),ap);

  INSERT INTO fx(admin_auth,admin_profile,cashier_auth,p1,p2,p3,p4,po1,po2,po3,po4,
    grn1,grn2a,grn2b,grn3,grn4,je1,key1)
  VALUES(a,ap,c,p1,p2,p3,p4,po1,po2,po3,po4,g1,g2a,g2b,g3,g4,
    (SELECT id FROM public.journal_entries WHERE reference_type='purchase' AND reference_id=g1),
    gen_random_uuid());
END $$;

-- ─── Droits ──────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.cancel_goods_receipt_v1(uuid,text,uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.cancel_goods_receipt_v1(uuid,text,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.cancel_goods_receipt_v1(uuid,text,uuid)','EXECUTE'),
  'cancel is callable by authenticated only, not anon nor PUBLIC');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
  FROM pg_proc WHERE oid='public.cancel_goods_receipt_v1(uuid,text,uuid)'::regprocedure),
  'cancel is SECURITY DEFINER with a fixed search_path');

SELECT pg_temp.authenticate_pin(cashier_auth) FROM fx;
SELECT throws_ok($q$ SELECT public.cancel_goods_receipt_v1(f.grn1,'wrong receipt',NULL) FROM fx f $q$,
  'P0003','forbidden','a cashier without purchasing.po.cancel is refused');
SELECT set_config('request.jwt.claims','{"role":"anon"}',true), set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($q$ SELECT public.cancel_goods_receipt_v1(f.grn1,'wrong receipt',NULL) FROM fx f $q$,
  'P0001','not_authenticated','an unauthenticated call is refused');
SELECT pg_temp.authenticate_pin(admin_auth) FROM fx;
SELECT throws_ok($q$ SELECT public.cancel_goods_receipt_v1(f.grn1,'  ',NULL) FROM fx f $q$,
  'P0001','reason_required','a blank reason is refused');

-- ─── Bon 1 : partial → pending, stock / WAC / dette d'avant réception ────────
SELECT is((SELECT current_stock FROM public.products p,fx WHERE p.id=fx.p1),20::numeric,
  'before cancel: P1 stock is 10 + 10 received');
SELECT is((SELECT cost_price FROM public.products p,fx WHERE p.id=fx.p1),150::numeric,
  'before cancel: P1 WAC blends 10 at 100 with 10 at 200');

UPDATE fx SET cancel1=public.cancel_goods_receipt_v1(fx.grn1,'Wrong supplier delivery',fx.key1);

SELECT is((SELECT current_stock FROM public.products p,fx WHERE p.id=fx.p1),10::numeric,
  'after cancel: P1 stock is back to 10');
SELECT is((SELECT cost_price FROM public.products p,fx WHERE p.id=fx.p1),100::numeric,
  'after cancel: P1 WAC is back to the pre-receipt 100');
SELECT is((SELECT received_quantity FROM public.purchase_order_items i,fx WHERE i.po_id=fx.po1),0::numeric,
  'PO line received quantity goes back to 0');
SELECT is((SELECT status FROM public.purchase_orders o,fx WHERE o.id=fx.po1),'pending',
  'partial PO with its only receipt cancelled goes back to pending');
SELECT ok((SELECT m.quantity=-10 AND m.unit_cost=200 AND m.supplier_id IS NULL
  AND m.reference_type='purchase_return' AND m.reference_id=fx.grn1
  FROM public.stock_movements m,fx WHERE m.movement_type='purchase_return' AND m.metadata->>'grn_id'=fx.grn1::text),
  'one purchase_return movement withdraws the 10 base pieces at their entry cost');
SELECT is((SELECT count(*)::int FROM public.journal_entries j,fx
  WHERE j.reference_type='stock_movement' AND j.reference_id IN (
    SELECT id FROM public.stock_movements WHERE metadata->>'grn_id'=fx.grn1::text)),0,
  'the stock trigger emits no extra JE for the return movement');
SELECT ok((SELECT j.total_debit=2000 AND j.total_credit=2000 AND j.status='posted'
  AND j.metadata->>'reverses'=fx.je1::text AND j.entry_date=current_date
  FROM public.journal_entries j,fx WHERE j.reference_type='purchase_return' AND j.reference_id=fx.grn1),
  'receipt JE is reversed by a posted purchase_return JE of the same amount, dated today');
SELECT is((SELECT sum(l.debit)-sum(l.credit) FROM public.journal_entry_lines l JOIN public.journal_entries j
  ON j.id=l.journal_entry_id,fx WHERE j.reference_type='purchase_return' AND j.reference_id=fx.grn1),0::numeric,
  'reversal JE lines are balanced');
SELECT is((SELECT count(*)::int FROM (
  SELECT l.account_id, sum(l.debit-l.credit) net FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id, fx
  WHERE j.reference_id=fx.grn1 AND j.reference_type IN ('purchase','purchase_return')
  GROUP BY l.account_id HAVING sum(l.debit-l.credit)<>0) x),0,
  'inventory and supplier payable nets are zero across receipt and reversal');
SELECT is((SELECT sum(l.credit-l.debit) FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id, fx
  WHERE j.reference_id=fx.grn1 AND j.reference_type IN ('purchase','purchase_return')
    AND l.account_id=public.resolve_mapping_account('PURCHASE_PAYABLE')),0::numeric,
  'supplier debt carried by the receipt is back to zero');
SELECT ok((SELECT j.metadata->>'reversed_by'=(fx.cancel1->>'reversal_je_id')
  FROM public.journal_entries j,fx WHERE j.id=fx.je1),
  'original receipt JE points to its reversal');
SELECT ok((SELECT g.cancelled_at IS NOT NULL AND g.cancelled_by=fx.admin_profile
  AND g.cancel_reason='Wrong supplier delivery' AND g.cancel_idempotency_key=fx.key1
  FROM public.goods_receipt_notes g,fx WHERE g.id=fx.grn1),
  'GRN carries cancelled_at, cancelled_by (profile), reason and key');
SELECT ok((SELECT a.actor_id=fx.admin_profile AND a.payload->'po_status'->>'after'='pending'
  FROM public.audit_logs a,fx WHERE a.action='goods_receipt.cancelled' AND a.entity_id=fx.grn1),
  'audit row is written with the profile as actor');

-- ─── Rejeu idempotent et double annulation ───────────────────────────────────
UPDATE fx SET replay1=public.cancel_goods_receipt_v1(fx.grn1,'Wrong supplier delivery',fx.key1);
SELECT ok((SELECT (replay1->>'idempotent_replay')::boolean
  AND replay1->>'reversal_je_id'=cancel1->>'reversal_je_id'
  AND (replay1-'idempotent_replay')=(cancel1-'idempotent_replay') FROM fx),
  'replay with the same key returns the first response');
SELECT is((SELECT count(*)::int FROM public.stock_movements m,fx
  WHERE m.movement_type='purchase_return' AND m.metadata->>'grn_id'=fx.grn1::text),1,
  'replay writes no second return movement');
SELECT is((SELECT count(*)::int FROM public.journal_entries j,fx
  WHERE j.reference_type='purchase_return' AND j.reference_id=fx.grn1),1,
  'replay writes no second reversal JE');
SELECT throws_ok($q$ SELECT public.cancel_goods_receipt_v1(f.grn1,'Second try',gen_random_uuid()) FROM fx f $q$,
  'P0001','grn_already_cancelled','a cancelled GRN cannot be cancelled again');
SELECT throws_ok($q$ SELECT public.cancel_goods_receipt_v1(f.grn2b,'Key reuse',f.key1) FROM fx f $q$,
  'P0001','idempotency_key_conflict','a key already used on another GRN is refused');

-- ─── Bon 2 : received → partial, puis partial → pending (stock restant nul) ──
SELECT is((SELECT status FROM public.purchase_orders o,fx WHERE o.id=fx.po2),'received',
  'before cancel: PO 2 is fully received');
UPDATE fx SET cancel2b=public.cancel_goods_receipt_v1(fx.grn2b,'Duplicate entry',NULL);
SELECT is((SELECT status FROM public.purchase_orders o,fx WHERE o.id=fx.po2),'partial',
  'received PO goes back to partial when one of its two receipts is cancelled');
SELECT ok((SELECT current_stock=10 AND cost_price=200 FROM public.products p,fx WHERE p.id=fx.p2),
  'P2 stock and WAC return to their state after the first receipt');
SELECT ok((SELECT received_date IS NULL AND received_by IS NOT NULL FROM public.purchase_orders o,fx WHERE o.id=fx.po2),
  'a partial PO no longer carries a full-receipt date');
UPDATE fx SET cancel2a=public.cancel_goods_receipt_v1(fx.grn2a,'Duplicate entry',NULL);
SELECT ok((SELECT status='pending' AND received_by IS NULL FROM public.purchase_orders o,fx WHERE o.id=fx.po2),
  'cancelling the last receipt brings the PO back to pending');
SELECT ok((SELECT current_stock=0 AND cost_price=200 FROM public.products p,fx WHERE p.id=fx.p2),
  'zero remaining stock leaves the WAC untouched');

-- ─── Bon 3 : stock insuffisant ────────────────────────────────────────────────
SELECT throws_like($q$ SELECT public.cancel_goods_receipt_v1(f.grn3,'Stock consumed',NULL) FROM fx f $q$,
  'insufficient_stock_to_reverse:%','cancel is refused when current stock is below the received quantity');
SELECT ok((SELECT p.current_stock=5 AND g.cancelled_at IS NULL AND o.status='received'
  FROM public.products p,public.goods_receipt_notes g,public.purchase_orders o,fx
  WHERE p.id=fx.p3 AND g.id=fx.grn3 AND o.id=fx.po3),
  'refused cancel (stock) leaves stock, GRN and PO untouched');

-- ─── Bon 4 : payé au-delà de ce qui resterait reçu ────────────────────────────
SELECT throws_like($q$ SELECT public.cancel_goods_receipt_v1(f.grn4,'Paid already',NULL) FROM fx f $q$,
  'payments_exceed_remaining_receipts:%','cancel is refused when payments exceed the remaining received total');
SELECT ok((SELECT p.current_stock=10 AND g.cancelled_at IS NULL AND o.status='partial'
  AND NOT EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.reference_type='purchase_return' AND j.reference_id=fx.grn4)
  FROM public.products p,public.goods_receipt_notes g,public.purchase_orders o,fx
  WHERE p.id=fx.p4 AND g.id=fx.grn4 AND o.id=fx.po4),
  'refused cancel (payments) leaves stock, GRN, PO and ledger untouched');

-- ─── Bon 5 : réception d'avant la régularisation S1-05 (stock sur 1141) ──────
-- L'écriture d'origine débite le stock général ; la régularisation a depuis
-- déplacé ce net vers le compte de réception courant. La contre-passation
-- doit créditer le compte courant, jamais 1141.
CREATE TEMP TABLE fx5(grn uuid, je uuid, general uuid, current_acct uuid, ap uuid, result jsonb);
DO $$
DECLARE
  f record; p uuid := gen_random_uuid(); po uuid; l uuid; g uuid; j uuid;
  v_general uuid := public.resolve_mapping_account('INVENTORY_GENERAL');
  v_current uuid := public.resolve_mapping_account('INVENTORY_RAW_MATERIAL');
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,
    unit,product_type,is_active,track_inventory,deduct_stock)
  SELECT p,'GRNC5-'||left(p::text,8),'GRN cancel P5',category_id,500,0,0,'pcs','finished',true,true,true
    FROM public.products WHERE id=f.p1;
  po := (public.create_purchase_order_v2(
    p_supplier_id:=(SELECT supplier_id FROM public.purchase_orders WHERE id=f.po1),
    p_items:=jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit','box',
      'unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  UPDATE public.purchase_order_items SET unit_factor_to_base=10 WHERE po_id=po;
  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po;
  g := (public.receive_purchase_order_v7(po,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  SELECT id INTO STRICT j FROM public.journal_entries WHERE reference_type='purchase' AND reference_id=g;
  -- Simulation d'une réception d'avant régularisation : stock débité sur 1141.
  UPDATE public.journal_entry_lines SET account_id=v_general
    WHERE journal_entry_id=j AND account_id=v_current;
  INSERT INTO fx5 VALUES(g,j,v_general,v_current,public.resolve_mapping_account('PURCHASE_PAYABLE'),NULL);
END $$;
SELECT ok(EXISTS (SELECT 1 FROM public.journal_entry_lines l,fx5
  WHERE l.journal_entry_id=fx5.je AND l.account_id=fx5.general AND l.debit=2000),
  'fixture: the pre-catch-up receipt JE debits the general stock account');
UPDATE fx5 SET result=public.cancel_goods_receipt_v1(fx5.grn,'Pre catch-up receipt',NULL);
SELECT ok((SELECT
    COALESCE(SUM(l.credit) FILTER (WHERE l.account_id=fx5.current_acct),0)=2000
    AND NOT bool_or(l.account_id=fx5.general)
    AND COALESCE(SUM(l.debit) FILTER (WHERE l.account_id=fx5.ap),0)=2000
  FROM public.journal_entry_lines l,fx5 WHERE l.journal_entry_id=(fx5.result->>'reversal_je_id')::uuid),
  'reversal credits the current stock account, never 1141, and debits the payable');
SELECT is((SELECT SUM(l.debit)-SUM(l.credit) FROM public.journal_entry_lines l,fx5
  WHERE l.journal_entry_id=(fx5.result->>'reversal_je_id')::uuid),0::numeric,
  'reversal of a pre-catch-up receipt stays balanced');

-- ─── Bon 6 : réception, puis sortie, puis annulation ─────────────────────────
-- 10@100 + 10@200 = 150 ; une perte de 5 sort au WAC mélangé ; le retrait
-- pondéré donnerait 50. Le coût moyen doit rester 150, règle tracée.
CREATE TEMP TABLE fx6(product uuid, grn uuid, result jsonb);
DO $$
DECLARE
  f record; p uuid := gen_random_uuid(); po uuid; l uuid; g uuid;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,
    unit,product_type,is_active,track_inventory,deduct_stock)
  SELECT p,'GRNC6-'||left(p::text,8),'GRN cancel P6',category_id,500,10,100,'pcs','finished',true,true,true
    FROM public.products WHERE id=f.p1;
  po := (public.create_purchase_order_v2(
    p_supplier_id:=(SELECT supplier_id FROM public.purchase_orders WHERE id=f.po1),
    p_items:=jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit','box',
      'unit_factor_to_base',10,'unit_cost',2000)),
    p_payment_terms:='credit',p_vat_rate:=0)->>'po_id')::uuid;
  UPDATE public.purchase_order_items SET unit_factor_to_base=10 WHERE po_id=po;
  SELECT id INTO STRICT l FROM public.purchase_order_items WHERE po_id=po;
  g := (public.receive_purchase_order_v7(po,jsonb_build_array(jsonb_build_object(
    'po_item_id',l,'received_quantity',1)),gen_random_uuid())->>'grn_id')::uuid;
  PERFORM public.record_stock_movement_v2(p_product_id:=p,p_movement_type:='waste',
    p_quantity:=-5,p_reason:='Spoiled after receipt',p_unit:='pcs');
  INSERT INTO fx6 VALUES(p,g,NULL);
END $$;
UPDATE fx6 SET result=public.cancel_goods_receipt_v1(fx6.grn,'Cancel after an exit',NULL);
SELECT is((SELECT current_stock FROM public.products p,fx6 WHERE p.id=fx6.product),5::numeric,
  'receipt then exit then cancel: stock is 10 + 10 − 5 − 10 = 5');
SELECT is((SELECT cost_price FROM public.products p,fx6 WHERE p.id=fx6.product),150::numeric,
  'an exit after the receipt leaves the WAC untouched (150, not 50)');
SELECT ok((SELECT m.metadata->>'wac_rule'='unchanged_intermediate_movements'
  FROM public.stock_movements m,fx6 WHERE m.movement_type='purchase_return' AND m.metadata->>'grn_id'=fx6.grn::text)
  AND (SELECT a.payload->'lines'->0->>'wac_rule'='unchanged_intermediate_movements'
  FROM public.audit_logs a,fx6 WHERE a.action='goods_receipt.cancelled' AND a.entity_id=fx6.grn),
  'unchanged_intermediate_movements is traced on the movement and in the audit payload');

SELECT * FROM finish();
ROLLBACK;
