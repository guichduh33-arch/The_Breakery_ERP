-- S3-22 : filtres du panier appliqués avant supports, confiance et lift.
-- La référence temporaire ci-dessous est le corps DEV capturé le 2026-11-20.
-- pgtap:exclusive
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\ir helpers/released_report_days.sql
\ir helpers/session.sql
\ir helpers/catalog.sql
CREATE TEMP TABLE basket_tap(seq serial,tap text);
INSERT INTO basket_tap(tap) SELECT plan(23);
SELECT pg_temp.fixture_released_days(current_date-366,current_date);
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';

CREATE OR REPLACE FUNCTION pg_temp.basket_reference(p_date_start date, p_date_end date, p_top_n integer DEFAULT 10)
 RETURNS TABLE(product_id_a uuid, product_a_name text, product_id_b uuid, product_b_name text, co_occurrence_count integer, support_a numeric, support_b numeric, support_pair numeric, confidence numeric, lift numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  filtered_orders AS (
    SELECT o.id
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.recognized_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg))::date
            BETWEEN p_date_start AND p_date_end)
  ),
  total_orders AS (
    SELECT GREATEST(COUNT(*), 1)::DECIMAL AS n FROM filtered_orders
  ),
  order_products AS (
    SELECT DISTINCT
      oi.order_id,
      oi.product_id
    FROM reporting_private.closed_order_items_v1 oi
    JOIN filtered_orders fo ON fo.id = oi.order_id
    WHERE oi.product_id IS NOT NULL
      AND oi.is_cancelled IS NOT TRUE
      AND oi.is_promo_gift IS NOT TRUE
  ),
  product_support AS (
    SELECT
      op.product_id,
      COUNT(DISTINCT op.order_id)::INT AS order_count
    FROM order_products op
    GROUP BY op.product_id
  ),
  pairs AS (
    SELECT
      a.product_id AS product_id_a,
      b.product_id AS product_id_b,
      COUNT(DISTINCT a.order_id)::INT AS co_count
    FROM order_products a
    JOIN order_products b
      ON a.order_id = b.order_id
     AND a.product_id < b.product_id
    GROUP BY a.product_id, b.product_id
  )
  SELECT
    p.product_id_a,
    pa.name AS product_a_name,
    p.product_id_b,
    pb.name AS product_b_name,
    p.co_count AS co_occurrence_count,
    (sa.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_a,
    (sb.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_b,
    (p.co_count    / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_pair,
    CASE
      WHEN sa.order_count = 0 THEN 0::DECIMAL(8,6)
      ELSE (p.co_count::DECIMAL / sa.order_count)::DECIMAL(8,6)
    END AS confidence,
    CASE
      WHEN sa.order_count = 0 OR sb.order_count = 0 THEN 0::DECIMAL(10,4)
      ELSE (
        (p.co_count::DECIMAL * (SELECT n FROM total_orders))
        / NULLIF(sa.order_count::DECIMAL * sb.order_count, 0)
      )::DECIMAL(10,4)
    END AS lift
  FROM pairs p
  JOIN product_support sa ON sa.product_id = p.product_id_a
  JOIN product_support sb ON sb.product_id = p.product_id_b
  JOIN products pa
    ON pa.id = p.product_id_a
   AND pa.deleted_at IS NULL
  JOIN products pb
    ON pb.id = p.product_id_b
   AND pb.deleted_at IS NULL
  ORDER BY lift DESC NULLS LAST, co_occurrence_count DESC
  LIMIT GREATEST(p_top_n, 1);
END;
$function$
;

CREATE TEMP TABLE basket_fixture(day date, a uuid, b uuid, c uuid, d uuid);
INSERT INTO basket_fixture
SELECT day::date, gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
FROM generate_series(current_date-366,current_date-1,interval '1 day') d(day)
WHERE EXISTS (SELECT 1 FROM fiscal_periods fp WHERE day::date BETWEEN fp.period_start AND fp.period_end AND fp.status='open')
AND NOT EXISTS (SELECT 1 FROM orders o WHERE coalesce(o.paid_at,o.created_at)::date=day::date)
ORDER BY day LIMIT 1;
INSERT INTO basket_tap(tap) SELECT is((SELECT count(*) FROM basket_fixture),1::bigint,'Fixture has a day without pre-existing sales');
INSERT INTO products(id,sku,name,category_id,retail_price)
SELECT x.id,'BASKET-'||x.id,x.name,(SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1),10000
FROM basket_fixture f CROSS JOIN LATERAL
(VALUES(f.a,'Basket A'),(f.b,'Basket B'),(f.c,'Cancelled C'),(f.d,'Gift D')) x(id,name);

DO $fixture$
DECLARE f basket_fixture%rowtype; oa uuid; ob uuid; oc uuid; od uuid; sid uuid:='f5430000-0000-4000-a000-000000000001';
BEGIN
 SELECT * INTO STRICT f FROM basket_fixture;
 -- Les UUID de produit fixent le sens A -> B de la confiance.
 IF f.a>f.b THEN
   UPDATE basket_fixture SET a=f.b,b=f.a;
   SELECT * INTO STRICT f FROM basket_fixture;
 END IF;
 INSERT INTO orders(order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,table_number,session_id)
 VALUES ('BASKET-'||gen_random_uuid(),'dine_in','paid',20000,0,20000,f.day+time '12:00',f.day+time '12:00','PGTAP-BASKET-1',sid) RETURNING id INTO oa;
 INSERT INTO orders(order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,table_number,session_id)
 VALUES ('BASKET-'||gen_random_uuid(),'dine_in','completed',20000,0,20000,f.day+time '13:00',f.day+time '13:00','PGTAP-BASKET-1',sid) RETURNING id INTO ob;
 INSERT INTO orders(order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,table_number,session_id)
 VALUES ('BASKET-'||gen_random_uuid(),'take_out','paid',20000,0,20000,f.day+time '14:00',f.day+time '14:00','PGTAP-BASKET-2',sid) RETURNING id INTO oc;
 INSERT INTO orders(order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,table_number,session_id)
 VALUES ('BASKET-'||gen_random_uuid(),'dine_in','paid',10000,0,10000,f.day+time '15:00',f.day+time '15:00','PGTAP-BASKET-1',sid) RETURNING id INTO od;
 INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total)
 VALUES (oa,f.a,'A',10000,1,10000),(oa,f.b,'B',10000,1,10000),
        (ob,f.a,'A',10000,1,10000),(ob,f.a,'A duplicate line',10000,1,10000),
        (oc,f.a,'A',10000,1,10000),(oc,f.b,'B',10000,1,10000),(od,f.b,'B',10000,1,10000);
 INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,is_cancelled,cancelled_at,cancelled_reason,cancelled_by)
 VALUES (oa,f.c,'Cancelled C',10000,1,10000,true,now(),'Fixture cancellation',
         (SELECT id FROM user_profiles WHERE auth_user_id='00000000-0000-0000-0000-000000000001' AND deleted_at IS NULL));
 INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,is_promo_gift)
 VALUES (oa,f.d,'Gift D',0,1,0,true);
 INSERT INTO order_payments(order_id,method,amount,session_id,paid_at)
 VALUES (oa,'cash',10000,sid,f.day+time '12:00'),(oa,'qris',10000,sid,f.day+time '12:00'),
        (ob,'cash',20000,sid,f.day+time '13:00'),(oc,'qris',20000,sid,f.day+time '14:00');
END $fixture$;

CREATE FUNCTION pg_temp.basket_probe(p_f jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $probe$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.product_id_a,r.product_id_b),'[]'::jsonb)
 FROM basket_fixture f CROSS JOIN LATERAL get_basket_analysis_v7(f.day,f.day,100,p_f) r
$probe$;

INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe(),(
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.product_id_a,r.product_id_b),'[]'::jsonb)
 FROM basket_fixture f CROSS JOIN LATERAL pg_temp.basket_reference(f.day,f.day,100) r
),'No filters preserve every reference value');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{}'),pg_temp.basket_probe(),'Empty filters preserve values');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"order_type":null,"payment_method":"","table_number":""}'),pg_temp.basket_probe(),'Null and empty keys preserve values');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"unknown":"x"}'),pg_temp.basket_probe(),'Unknown keys preserve values');
INSERT INTO basket_tap(tap) SELECT is(jsonb_array_length(pg_temp.basket_probe()),1,'Cancelled and gift products produce no pairs');
INSERT INTO basket_tap(tap) SELECT is((pg_temp.basket_probe()->0->>'co_occurrence_count')::integer,2,'Duplicate lines count only one basket');
INSERT INTO basket_tap(tap) SELECT is((pg_temp.basket_probe()->0->>'support_pair')::numeric,0.5::numeric,'Unfiltered denominator includes all four baskets');
INSERT INTO basket_tap(tap) SELECT ok(
 (pg_temp.basket_probe('{"order_type":"dine_in"}')->0->>'co_occurrence_count')::integer=1
 AND (pg_temp.basket_probe('{"order_type":"dine_in"}')->0->>'support_a')::numeric=0.666667
 AND (pg_temp.basket_probe('{"order_type":"dine_in"}')->0->>'support_pair')::numeric=0.333333
 AND (pg_temp.basket_probe('{"order_type":"dine_in"}')->0->>'confidence')::numeric=0.5
 AND (pg_temp.basket_probe('{"order_type":"dine_in"}')->0->>'lift')::numeric=0.75,
 'Order type restricts pairs and every denominator');
INSERT INTO basket_tap(tap) SELECT ok(
 (pg_temp.basket_probe('{"payment_method":"cash"}')->0->>'co_occurrence_count')::integer=1
 AND (pg_temp.basket_probe('{"payment_method":"cash"}')->0->>'support_a')::numeric=1
 AND (pg_temp.basket_probe('{"payment_method":"cash"}')->0->>'support_b')::numeric=0.5
 AND (pg_temp.basket_probe('{"payment_method":"cash"}')->0->>'confidence')::numeric=0.5
 AND (pg_temp.basket_probe('{"payment_method":"cash"}')->0->>'lift')::numeric=1,
 'Cash selects whole baskets and excludes the basket without payment');
INSERT INTO basket_tap(tap) SELECT ok(
 (pg_temp.basket_probe('{"payment_method":"qris"}')->0->>'co_occurrence_count')::integer=2
 AND (pg_temp.basket_probe('{"payment_method":"qris"}')->0->>'support_pair')::numeric=1
 AND (pg_temp.basket_probe('{"payment_method":"qris"}')->0->>'lift')::numeric=1,
 'Split payment does not duplicate baskets or alter denominators');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"table_number":"PGTAP-BASKET-1"}'),pg_temp.basket_probe('{"order_type":"dine_in"}'),'Table filter selects the exact cohort');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"table_number":"PGTAP-BASKET"}'),'[]'::jsonb,'Table match is exact, not a prefix');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"order_type":"dine_in","payment_method":"cash","table_number":"PGTAP-BASKET-1"}'),pg_temp.basket_probe('{"payment_method":"cash"}'),'Three filters intersect');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"order_type":"take_out","payment_method":"cash"}'),'[]'::jsonb,'Disjoint filters return no pair');
INSERT INTO basket_tap(tap) SELECT is(pg_temp.basket_probe('{"payment_method":"unknown"}'),'[]'::jsonb,'Unknown payment cannot broaden scope');
INSERT INTO basket_tap(tap) SELECT is((SELECT count(*) FROM basket_fixture f CROSS JOIN LATERAL get_basket_analysis_v7(f.day,f.day,1)),1::bigint,'Top N still limits pairs');
INSERT INTO basket_tap(tap) SELECT ok(has_function_privilege('authenticated','public.get_basket_analysis_v7(date,date,integer,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.get_basket_analysis_v7(date,date,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_basket_analysis_v7(date,date,integer,jsonb)','EXECUTE'),'Execution grants remain authenticated/service_role only');
INSERT INTO basket_tap(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.oid='public.get_basket_analysis_v7(date,date,integer,jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC has no execute grant');
INSERT INTO basket_tap(tap) SELECT ok(to_regprocedure('public.get_basket_analysis_v6(date,date,integer)') IS NULL,'Superseded function is removed');

-- Refus explicite, indépendant de la matrice de rôles de DEV.
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT id,'reports.sales.read',false,'Transactional basket deny fixture' FROM user_profiles
WHERE auth_user_id='00000000-0000-0000-0000-000000000002' AND deleted_at IS NULL
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
INSERT INTO basket_tap(tap) SELECT throws_ok($$SELECT get_basket_analysis_v7(day,day,10,'{"order_type":"dine_in"}') FROM basket_fixture$$,'42501','permission denied: reports.sales.read required','Missing permission still refuses filtered queries');

-- Une journée future n'est jamais visible au non-propriétaire, même sans résultat.
INSERT INTO basket_tap(tap) SELECT throws_ok($$SELECT get_basket_analysis_v7(current_date+1,current_date+1,10,'{"table_number":"absent"}')$$,'P0003','business_day_not_closed','Filters cannot bypass day confidentiality');
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL "request.jwt.claims" = '{}';
INSERT INTO basket_tap(tap) SELECT throws_ok($$SELECT get_basket_analysis_v7(current_date,current_date,10)$$,'P0003','forbidden','No identity remains forbidden');
INSERT INTO basket_tap(tap) SELECT * FROM finish();
SELECT tap FROM basket_tap ORDER BY seq;
ROLLBACK;
