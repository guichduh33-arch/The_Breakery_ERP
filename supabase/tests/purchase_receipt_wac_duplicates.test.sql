-- PPN non récupérable capitalisée ; une ligne PO ne contribue qu'une fois au GRN.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(22);
CREATE TEMP TABLE receipt_fixture(
  product uuid, po uuid, line uuid, duplicate_po uuid, duplicate_line uuid,
  first_key uuid, first_result jsonb, second_result jsonb, replay_result jsonb
);
DO $$
DECLARE
  a uuid := gen_random_uuid(); p uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); product uuid := gen_random_uuid();
  po uuid; duplicate_po uuid; line uuid; duplicate_line uuid; k uuid := gen_random_uuid();
  result jsonb; items jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
  VALUES(p,a,'RCPT-'||left(p::text,8),'Receipt fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  INSERT INTO public.categories(id,name,slug,category_type)
  VALUES(c,'Receipt fixture','receipt-'||c,'raw_material');
  INSERT INTO public.suppliers(id,code,name,payment_terms_days,is_active)
  VALUES(s,'RCPT-'||left(s::text,8),'Receipt fixture',30,true);
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,
    unit,product_type,is_active,track_inventory,deduct_stock)
  VALUES(product,'RCPT-'||left(product::text,8),'Receipt fixture',c,200,10,100,
    'pcs','finished',true,true,true);
  items := jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2,
    'unit','box','unit_factor_to_base',10,'unit_cost',1000));
  po := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=items,
    p_payment_terms:='credit',p_vat_rate:=0.11)->>'po_id')::uuid;
  duplicate_po := (public.create_purchase_order_v2(p_supplier_id:=s,p_items:=items,
    p_payment_terms:='credit',p_vat_rate:=0.11)->>'po_id')::uuid;
  UPDATE public.purchase_order_items SET unit_factor_to_base=10 WHERE po_id IN (po,duplicate_po);
  SELECT id INTO STRICT line FROM public.purchase_order_items WHERE po_id=po;
  SELECT id INTO STRICT duplicate_line FROM public.purchase_order_items WHERE po_id=duplicate_po;
  result := public.receive_purchase_order_v5(po,
    jsonb_build_array(jsonb_build_object('po_item_id',line,'received_quantity',1)),k);
  INSERT INTO receipt_fixture VALUES(product,po,line,duplicate_po,duplicate_line,k,result,NULL,NULL);
END $$;

SELECT ok(to_regprocedure('public.receive_purchase_order_v4(uuid,jsonb,uuid)') IS NULL,
  'previous receipt signature is removed');
SELECT ok(NOT has_function_privilege('anon','public.receive_purchase_order_v5(uuid,jsonb,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.receive_purchase_order_v5(uuid,jsonb,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.receive_purchase_order_v5(uuid,jsonb,uuid)','EXECUTE'),
  'receipt keeps its authenticated/service grants and denies inherited anon access');
SELECT is((SELECT first_result->>'status' FROM receipt_fixture),'partial',
  'one of two boxes leaves the PO partial');
SELECT is((SELECT m.quantity FROM public.stock_movements m,receipt_fixture f
  WHERE m.metadata->>'grn_id'=f.first_result->>'grn_id'),10::numeric,
  'receipt quantity is converted from one box to ten base pieces');
SELECT is((SELECT m.unit_cost FROM public.stock_movements m,receipt_fixture f
  WHERE m.metadata->>'grn_id'=f.first_result->>'grn_id'),111::numeric,
  'base unit acquisition cost includes the non-recoverable PPN');
SELECT is((SELECT p.cost_price FROM public.products p,receipt_fixture f WHERE p.id=f.product),105.5::numeric,
  'WAC blends ten pieces at 100 with ten pieces at 111');
SELECT is((SELECT g.vat_amount FROM public.goods_receipt_notes g,receipt_fixture f
  WHERE g.id=(f.first_result->>'grn_id')::uuid),110::numeric,
  'partial GRN keeps the existing PPN allocation');
SELECT is((SELECT g.total FROM public.goods_receipt_notes g,receipt_fixture f
  WHERE g.id=(f.first_result->>'grn_id')::uuid),1110::numeric,
  'partial GRN total remains subtotal plus PPN');
SELECT ok((SELECT j.total_debit=1110 AND j.total_credit=1110 FROM public.journal_entries j,receipt_fixture f
  WHERE j.reference_type='purchase' AND j.reference_id=(f.first_result->>'grn_id')::uuid),
  'existing reception JE remains balanced and includes PPN');
SELECT is((SELECT count(*)::int FROM public.purchase_payments pp,receipt_fixture f
  WHERE pp.purchase_order_id=f.po),0,'credit receipt creates no automatic payment');
UPDATE receipt_fixture f SET replay_result=public.receive_purchase_order_v5(f.po,
  jsonb_build_array(jsonb_build_object('po_item_id',f.line,'received_quantity',1)),f.first_key);
SELECT ok((SELECT replay_result->>'grn_id'=first_result->>'grn_id'
  AND (replay_result->>'idempotent_replay')::boolean FROM receipt_fixture),
  'lost response replay returns the original GRN');
SELECT is((SELECT count(*)::int FROM public.stock_movements m,receipt_fixture f
  WHERE m.metadata->>'grn_id'=f.first_result->>'grn_id'),1,'replay creates no second stock movement');

UPDATE receipt_fixture f SET second_result=public.receive_purchase_order_v5(f.po,
  jsonb_build_array(jsonb_build_object('po_item_id',f.line,'received_quantity',1)),gen_random_uuid());
SELECT is((SELECT second_result->>'status' FROM receipt_fixture),'received',
  'second box completes the PO');
SELECT is((SELECT p.current_stock FROM public.products p,receipt_fixture f WHERE p.id=f.product),30::numeric,
  'two partial receipts add exactly twenty base pieces');
SELECT is((SELECT p.cost_price FROM public.products p,receipt_fixture f WHERE p.id=f.product),107.33::numeric,
  'final WAC preserves the existing two-decimal rounding');
SELECT is((SELECT sum(g.total) FROM public.goods_receipt_notes g,receipt_fixture f WHERE g.po_id=f.po),
  2220::numeric,'partial GRNs retain the original full PO total');

SELECT throws_ok($q$ SELECT public.receive_purchase_order_v5(f.duplicate_po,
  jsonb_build_array(jsonb_build_object('po_item_id',f.duplicate_line,'received_quantity',1),
    jsonb_build_object('po_item_id',upper(f.duplicate_line::text),'received_quantity',1)),gen_random_uuid())
  FROM receipt_fixture f $q$,'P0001','duplicate_po_item','duplicate UUID lines are refused with an idempotency key');
SELECT throws_ok($q$ SELECT public.receive_purchase_order_v5(f.duplicate_po,
  jsonb_build_array(jsonb_build_object('po_item_id',f.duplicate_line,'received_quantity',1),
    jsonb_build_object('po_item_id',f.duplicate_line,'received_quantity',1)),NULL)
  FROM receipt_fixture f $q$,'P0001','duplicate_po_item','duplicate lines are refused without an idempotency key');
SELECT is((SELECT i.received_quantity FROM public.purchase_order_items i,receipt_fixture f
  WHERE i.id=f.duplicate_line),0::numeric,'duplicate refusal retains the PO received quantity');
SELECT is((SELECT p.current_stock FROM public.products p,receipt_fixture f WHERE p.id=f.product),30::numeric,
  'duplicate refusal creates no stock change');
SELECT is((SELECT count(*)::int FROM public.goods_receipt_notes g,receipt_fixture f WHERE g.po_id=f.duplicate_po),
  0,'duplicate refusal creates no GRN');
SELECT is((SELECT count(*)::int FROM public.audit_logs a,receipt_fixture f
  WHERE a.entity_id=f.duplicate_po AND a.action='purchase_order.received'),0,
  'duplicate refusal creates no reception success audit');
SELECT * FROM finish();
ROLLBACK;
