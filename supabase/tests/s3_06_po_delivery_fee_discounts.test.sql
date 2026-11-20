-- S3-06 — Frais de livraison et escomptes sur les bons de commande.
-- Preuve demandée : un bon de 3 lignes avec 30 000 IDR de port répartit
-- exactement 30 000 IDR, sans perte d'arrondi ; le coût moyen en tient
-- compte ; le total du bon égale la facture. En plus : escomptes de ligne et
-- global avec PPN, réceptions partielles qui retombent exactement sur le total,
-- patch du port, refus des montants hors bornes, droits.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(36);

CREATE TEMP TABLE fx(
  supplier uuid,
  p1 uuid, p2 uuid, p3 uuid, p4 uuid, p5 uuid,
  po_a uuid, po_b uuid, po_c uuid,
  b_l1 uuid, b_l2 uuid,
  grn_a jsonb, grn_b1 jsonb, grn_b2 jsonb, grn_b3 jsonb, upd_c jsonb
);

DO $$
DECLARE
  a uuid := gen_random_uuid(); ap uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid();
  po_a uuid; po_b uuid; po_c uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
    VALUES(ap,a,'S306-'||left(ap::text,8),'S3-06 admin','SUPER_ADMIN',public.hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  INSERT INTO public.categories(id,name,slug,category_type)
    VALUES(cat,'S3-06 fixture','s306-'||cat,'raw_material');
  INSERT INTO public.suppliers(id,code,name,payment_terms_days,is_active)
    VALUES(s,'S306-'||left(s::text,8),'S3-06 fixture',30,true);
  -- Stock et coût à zéro : le coût moyen après réception est le coût d'entrée.
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,
    unit,product_type,is_active,track_inventory,deduct_stock) VALUES
    (p1,'S306A-'||left(p1::text,8),'S3-06 P1',cat,1,0,0,'pcs','finished',true,true,true),
    (p2,'S306B-'||left(p2::text,8),'S3-06 P2',cat,1,0,0,'pcs','finished',true,true,true),
    (p3,'S306C-'||left(p3::text,8),'S3-06 P3',cat,1,0,0,'pcs','finished',true,true,true),
    (p4,'S306D-'||left(p4::text,8),'S3-06 P4',cat,1,0,0,'pcs','finished',true,true,true),
    (p5,'S306E-'||left(p5::text,8),'S3-06 P5',cat,1,0,0,'pcs','finished',true,true,true);

  -- Bon A : 3 lignes (100 000 / 100 000 / 100 001), port 30 000, sans PPN.
  -- Un arrondi ligne à ligne donnerait 9 999,97 + 9 999,97 + 10 000,07 = 30 000,01.
  po_a := (public.create_purchase_order_v3(
    p_supplier_id := s,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id',p1,'quantity',10,'unit_cost',10000),
      jsonb_build_object('product_id',p2,'quantity',5,'unit_cost',20000),
      jsonb_build_object('product_id',p3,'quantity',4,'unit_cost',25000.25)),
    p_payment_terms := 'credit', p_vat_rate := 0,
    p_delivery_fee := 30000)->>'po_id')::uuid;

  -- Bon B : escompte de ligne, escompte global, PPN 11 %, port 7 000.
  po_b := (public.create_purchase_order_v3(
    p_supplier_id := s,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id',p4,'quantity',3,'unit_cost',10000,'discount_amount',1000),
      jsonb_build_object('product_id',p5,'quantity',7,'unit_cost',3333.33)),
    p_payment_terms := 'credit', p_vat_rate := 0.11,
    p_discount_amount := 1000, p_delivery_fee := 7000)->>'po_id')::uuid;

  -- Bon C : sert au patch du port.
  po_c := (public.create_purchase_order_v3(
    p_supplier_id := s,
    p_items := jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',1,'unit_cost',50000)),
    p_payment_terms := 'credit', p_vat_rate := 0.11)->>'po_id')::uuid;

  INSERT INTO fx(supplier,p1,p2,p3,p4,p5,po_a,po_b,po_c,b_l1,b_l2) VALUES(
    s,p1,p2,p3,p4,p5,po_a,po_b,po_c,
    (SELECT id FROM public.purchase_order_items WHERE po_id=po_b AND product_id=p4),
    (SELECT id FROM public.purchase_order_items WHERE po_id=po_b AND product_id=p5));
END $$;

-- ---------------------------------------------------------------- Bon A
SELECT is((SELECT delivery_fee FROM public.purchase_orders WHERE id=(SELECT po_a FROM fx)),
  30000.00::numeric, 'A: the delivery fee is stored on the PO');
SELECT is((SELECT total_amount FROM public.purchase_orders WHERE id=(SELECT po_a FROM fx)),
  330001.00::numeric, 'A: PO total = lines 300 001 + fee 30 000 = invoice');
SELECT is((SELECT sum(fee_share) FROM public._po_cost_allocation_v1((SELECT po_a FROM fx))),
  30000.00::numeric, 'A: the fee is split to exactly 30 000.00 across the 3 lines');
SELECT is((SELECT array_agg(fee_share ORDER BY fee_share) FROM public._po_cost_allocation_v1((SELECT po_a FROM fx))),
  ARRAY[9999.97,9999.97,10000.06]::numeric[], 'A: largest-remainder shares, pro rata of line value');
SELECT is((SELECT sum(round(30000 * w / 300001, 2)) FROM unnest(ARRAY[100000,100000,100001]::numeric[]) w),
  30000.01::numeric, 'A: control — naive per-line rounding would lose a cent');
SELECT is((SELECT sum(line_total) FROM public._po_cost_allocation_v1((SELECT po_a FROM fx))),
  (SELECT total_amount FROM public.purchase_orders WHERE id=(SELECT po_a FROM fx)),
  'A: line totals add up to the PO total');

UPDATE fx SET grn_a = public.receive_purchase_order_v8((SELECT po_a FROM fx),
  (SELECT jsonb_agg(jsonb_build_object('po_item_id',id,'received_quantity',quantity))
     FROM public.purchase_order_items WHERE po_id=(SELECT po_a FROM fx)), gen_random_uuid());

SELECT is((SELECT grn_a->>'status' FROM fx), 'received', 'A: full receipt closes the PO');
SELECT is((SELECT total FROM public.goods_receipt_notes WHERE id=(SELECT (grn_a->>'grn_id')::uuid FROM fx)),
  330001.00::numeric, 'A: GRN total equals the PO total (fee included)');
SELECT is((SELECT (metadata->>'delivery_fee_share')::numeric FROM public.goods_receipt_notes
  WHERE id=(SELECT (grn_a->>'grn_id')::uuid FROM fx)), 30000.00::numeric,
  'A: the GRN carries the whole 30 000 fee');
SELECT is((SELECT sum((metadata->>'delivery_fee_share')::numeric) FROM public.stock_movements
  WHERE metadata->>'grn_id' = (SELECT grn_a->>'grn_id' FROM fx)), 30000.00::numeric,
  'A: stock movements carry exactly 30 000 of fee');
SELECT is((SELECT cost_price FROM public.products WHERE id=(SELECT p1 FROM fx)), 11000.00::numeric,
  'A: WAC P1 = (100 000 + 9 999.97) / 10');
SELECT is((SELECT cost_price FROM public.products WHERE id=(SELECT p2 FROM fx)), 21999.99::numeric,
  'A: WAC P2 = (100 000 + 9 999.97) / 5');
SELECT is((SELECT cost_price FROM public.products WHERE id=(SELECT p3 FROM fx)), 27500.27::numeric,
  'A: WAC P3 = (100 001 + 10 000.06) / 4');
SELECT ok((SELECT j.total_debit = 330001 AND j.total_credit = 330001 FROM public.journal_entries j
  WHERE j.reference_type='purchase' AND j.reference_id=(SELECT (grn_a->>'grn_id')::uuid FROM fx)),
  'A: the receipt JE debits stock and credits AP for the fee-inclusive total');

-- ---------------------------------------------------------------- Bon B
SELECT is((SELECT subtotal FROM public.purchase_orders WHERE id=(SELECT po_b FROM fx)),
  52333.31::numeric, 'B: subtotal is net of the line discount');
SELECT is((SELECT vat_amount FROM public.purchase_orders WHERE id=(SELECT po_b FROM fx)),
  5646.66::numeric, 'B: VAT applies after the global discount');
SELECT is((SELECT total_amount FROM public.purchase_orders WHERE id=(SELECT po_b FROM fx)),
  (30000 + 23333.31 - 1000 - 1000 + 5646.66 + 7000)::numeric,
  'B: PO total = gross − line discount − global discount + VAT + fee');
SELECT ok((SELECT sum(discount_share)=1000 AND sum(vat_share)=5646.66 AND sum(fee_share)=7000
  FROM public._po_cost_allocation_v1((SELECT po_b FROM fx))),
  'B: global discount, VAT and fee are each split without loss');
SELECT is((SELECT discount_amount FROM public.purchase_order_items WHERE id=(SELECT b_l1 FROM fx)),
  1000.00::numeric, 'B: the line discount is stored on the line');

UPDATE fx SET grn_b1 = public.receive_purchase_order_v8((SELECT po_b FROM fx),
  jsonb_build_array(jsonb_build_object('po_item_id',(SELECT b_l2 FROM fx),'received_quantity',2)), gen_random_uuid());
UPDATE fx SET grn_b2 = public.receive_purchase_order_v8((SELECT po_b FROM fx),
  jsonb_build_array(jsonb_build_object('po_item_id',(SELECT b_l2 FROM fx),'received_quantity',5)), gen_random_uuid());
UPDATE fx SET grn_b3 = public.receive_purchase_order_v8((SELECT po_b FROM fx),
  jsonb_build_array(jsonb_build_object('po_item_id',(SELECT b_l1 FROM fx),'received_quantity',3)), gen_random_uuid());

SELECT is((SELECT grn_b1->>'status' FROM fx), 'partial', 'B: first partial receipt leaves the PO partial');
SELECT is((SELECT sum((metadata->>'line_value')::numeric) FROM public.stock_movements
  WHERE metadata->>'po_item_id' = (SELECT b_l2::text FROM fx) AND movement_type='purchase'),
  (SELECT line_total FROM public._po_cost_allocation_v1((SELECT po_b FROM fx)) WHERE po_item_id=(SELECT b_l2 FROM fx)),
  'B: two partial receipts of a line add up exactly to its share');
SELECT is((SELECT grn_b3->>'status' FROM fx), 'received', 'B: last receipt closes the PO');
SELECT is((SELECT sum(total) FROM public.goods_receipt_notes WHERE po_id=(SELECT po_b FROM fx)),
  (SELECT total_amount FROM public.purchase_orders WHERE id=(SELECT po_b FROM fx)),
  'B: the GRNs add up exactly to the PO total (= invoice)');
SELECT is((SELECT sum(vat_amount) FROM public.goods_receipt_notes WHERE po_id=(SELECT po_b FROM fx)),
  5646.66::numeric, 'B: the GRNs carry the whole VAT');
SELECT is((SELECT sum((metadata->>'delivery_fee_share')::numeric) FROM public.goods_receipt_notes
  WHERE po_id=(SELECT po_b FROM fx)), 7000.00::numeric, 'B: the GRNs carry the whole fee');
SELECT ok((SELECT bool_and(j.total_debit = j.total_credit AND j.total_debit = g.total)
  FROM public.goods_receipt_notes g JOIN public.journal_entries j
    ON j.reference_type='purchase' AND j.reference_id=g.id
  WHERE g.po_id=(SELECT po_b FROM fx)), 'B: every receipt JE is balanced at the GRN total');
SELECT is((SELECT cost_price FROM public.products WHERE id=(SELECT p4 FROM fx)),
  round((SELECT line_total FROM public._po_cost_allocation_v1((SELECT po_b FROM fx))
    WHERE po_item_id=(SELECT b_l1 FROM fx)) / 3, 2),
  'B: WAC P4 includes discounts, VAT and fee share');

-- ---------------------------------------------------------------- Patch (bon C)
UPDATE fx SET upd_c = public.update_purchase_order_v2((SELECT po_c FROM fx),
  jsonb_build_object('delivery_fee', 12500));
SELECT is((SELECT total_amount FROM public.purchase_orders WHERE id=(SELECT po_c FROM fx)),
  (50000 + 5500 + 12500)::numeric, 'C: patching only the fee adds it to the total');
SELECT is((SELECT vat_amount FROM public.purchase_orders WHERE id=(SELECT po_c FROM fx)),
  5500.00::numeric, 'C: the fee is not taxed');

-- ---------------------------------------------------------------- Refus
SELECT throws_like($q$ SELECT public.create_purchase_order_v3(
    p_supplier_id := (SELECT supplier FROM fx),
    p_items := jsonb_build_array(jsonb_build_object('product_id',(SELECT p1 FROM fx),
      'quantity',1,'unit_cost',100,'discount_amount',101))) $q$,
  'line_discount_out_of_range%', 'a line discount above the line value is refused');
SELECT throws_like($q$ SELECT public.create_purchase_order_v3(
    p_supplier_id := (SELECT supplier FROM fx),
    p_items := jsonb_build_array(jsonb_build_object('product_id',(SELECT p1 FROM fx),
      'quantity',1,'unit_cost',100)), p_discount_amount := 100.01) $q$,
  'discount_exceeds_subtotal%', 'a global discount above the subtotal is refused');
SELECT throws_ok($q$ SELECT public.create_purchase_order_v3(
    p_supplier_id := (SELECT supplier FROM fx),
    p_items := jsonb_build_array(jsonb_build_object('product_id',(SELECT p1 FROM fx),
      'quantity',1,'unit_cost',100)), p_delivery_fee := -1) $q$,
  'P0001', 'delivery_fee_must_be_non_negative', 'a negative fee is refused');

-- ---------------------------------------------------------------- Droits et versions
SELECT ok(to_regprocedure('public.create_purchase_order_v2(uuid,jsonb,date,date,text,numeric,text,uuid)') IS NULL
  AND to_regprocedure('public.update_purchase_order_v1(uuid,jsonb)') IS NULL
  AND to_regprocedure('public.receive_purchase_order_v7(uuid,jsonb,uuid)') IS NULL,
  'previous versions are dropped');
SELECT ok(NOT has_function_privilege('anon','public.create_purchase_order_v3(uuid,jsonb,date,date,text,numeric,text,uuid,numeric,numeric)','EXECUTE')
  AND NOT has_function_privilege('anon','public.update_purchase_order_v2(uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.receive_purchase_order_v8(uuid,jsonb,uuid)','EXECUTE'),
  'anon cannot execute the new RPCs');
SELECT ok(has_function_privilege('authenticated','public.create_purchase_order_v3(uuid,jsonb,date,date,text,numeric,text,uuid,numeric,numeric)','EXECUTE')
  AND has_function_privilege('authenticated','public.update_purchase_order_v2(uuid,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.receive_purchase_order_v8(uuid,jsonb,uuid)','EXECUTE'),
  'authenticated keeps EXECUTE on the new RPCs');
SELECT ok(NOT has_function_privilege('authenticated','public._po_cost_allocation_v1(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._split_pro_rata_v1(numeric,numeric[])','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._split_pro_rata_v1(numeric,numeric[])','EXECUTE'),
  'the allocation helpers stay internal');

SELECT * FROM finish();
ROLLBACK;
