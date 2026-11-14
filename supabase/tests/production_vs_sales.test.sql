-- S3-19 : famille get_production_vs_sales — production enregistrée contre ventes
-- (comptoir et B2B séparés) et pertes APPROUVÉES, par jour, article, catégorie,
-- puis le bilan avec les restes déclarés en fin de journée (bloc « avril »).
--
-- Fenêtre isolée (mars 1997) : aucune donnée de dev n'y vit, les chiffres
-- attendus sont donc exacts et non des deltas. Les fixtures de cette fenêtre
-- sont posées par INSERT direct dans la transaction (produits à coût nul :
-- aucune écriture comptable déclenchée par le ledger) et disparaissent au
-- ROLLBACK. Le bloc « bout en bout » passe, lui, par les VRAIES fonctions de
-- soumission et d'approbation d'une déclaration : il prouve que l'approbation
-- alimente bien les colonnes du ledger que le rapport lit.
--
-- Articles de la fixture : A, C, D (supprimé), E, T (test) en « classic-breads »,
-- B et V (vitrine) en « buns », X en « sfg » (hors périmètre).
-- Jours : J1 = 10 mars, J2 = 11 mars, J3 = 12 mars.
--   A  J1 : fournée 20 (dont quantity_waste 1), fournée 50 ANNULÉE, 15 vendus
--           comptoir, ligne annulée 4, cadeau promo 3, perte approuvée 2,
--           perte en attente 7, perte rejetée 6, perte de ligne annulée 9
--           (ledger waste SANS déclaration approuvée) ; et trois commandes qui
--           ne doivent pas compter : annulée (100), import historique (200),
--           commande contenant un produit de test (400).
--   A  J2 : 6 vendus en B2B, fournée 4 à 23 h 30 locale ; J3 : fournée 5 à 0 h 10.
--   B  J1 : fournée 10, 4 vendus comptoir, perte de vitrine approuvée 1.
--   C  J2 : 2 vendus comptoir, rien de produit (taux d'écoulement nul).
--   D  15 mars : fournée 7 sur un article supprimé — reste visible.
--   X  J1 : fournée 99, 9 vendus, perte approuvée 8 — ne doit paraître nulle part.
--   E, V  aujourd'hui : perte et perte de vitrine déclarées puis approuvées.
-- Bloc « avril » (bilan) : K1 = 1er avril … K4 = 4 avril, articles A et B.
--   K1 : clôture rév. 1 (A 3, B 2) puis rév. 2 corrigée (A 4, B 2).
--   K2 : A fournée 10, 5 vendus comptoir, 2 livrés en B2B NON payé, 50 en B2B
--        non livré ; clôture : A reste 5 avec une perte de clôture de 1
--        approuvée le 3 avril ; B absent de la clôture (reste inconnu).
--   K3 : aucune clôture ; B perte ordinaire de 1 approuvée.
--   K4 : clôture A 0, B 0.
BEGIN;
SELECT set_config('statement_timeout','60s',true);
CREATE TEMP TABLE pvs_results(n serial, result text);
INSERT INTO pvs_results(result) SELECT plan(57);

CREATE TEMP TABLE pvs_ctx AS
SELECT o.id AS owner_id, o.auth_user_id AS owner_uid, s.id AS staff_id, s.auth_user_id AS staff_uid,
  gen_random_uuid() AS session_id, gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS o3,
  gen_random_uuid() AS o4, gen_random_uuid() AS o5, gen_random_uuid() AS o6,
  gen_random_uuid() AS pa, gen_random_uuid() AS pb, gen_random_uuid() AS pc, gen_random_uuid() AS px,
  gen_random_uuid() AS pd, gen_random_uuid() AS pe, gen_random_uuid() AS pv, gen_random_uuid() AS pt,
  gen_random_uuid() AS d1, gen_random_uuid() AS d4, gen_random_uuid() AS d5,
  gen_random_uuid() AS o8, gen_random_uuid() AS o9, gen_random_uuid() AS o10,
  gen_random_uuid() AS dk, gen_random_uuid() AS d7,
  gen_random_uuid() AS k1a, gen_random_uuid() AS k1b, gen_random_uuid() AS k2, gen_random_uuid() AS k4,
  (SELECT id FROM public.categories WHERE slug='classic-breads') AS cat_bread,
  (SELECT id FROM public.categories WHERE slug='buns') AS cat_buns,
  (SELECT id FROM public.categories WHERE slug='sfg') AS cat_sfg,
  (now() AT TIME ZONE (SELECT COALESCE(MAX(timezone),'Asia/Makassar') FROM public.business_config WHERE id=1))::date AS today
FROM (SELECT id,auth_user_id FROM public.user_profiles WHERE role_code='SUPER_ADMIN' AND is_active
        AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1) o,
     (SELECT id,auth_user_id FROM public.user_profiles WHERE role_code<>'SUPER_ADMIN' AND is_active
        AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1) s;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pvs_ctx WHERE cat_bread IS NOT NULL AND cat_buns IS NOT NULL AND cat_sfg IS NOT NULL) THEN
    RAISE EXCEPTION 'missing_owner_staff_or_category_fixture'; END IF;
  IF EXISTS(SELECT 1 FROM public.production_records WHERE production_date BETWEEN '1996-12-01' AND '1997-04-30')
  OR EXISTS(SELECT 1 FROM public.orders WHERE COALESCE(outstanding_at,paid_at,created_at) BETWEEN '1996-12-01' AND '1997-04-30')
  OR EXISTS(SELECT 1 FROM public.orders WHERE b2b_delivered_at BETWEEN '1996-12-01' AND '1997-04-30')
  OR EXISTS(SELECT 1 FROM public.stock_movements WHERE created_at BETWEEN '1996-12-01' AND '1997-04-30')
  OR EXISTS(SELECT 1 FROM public.display_day_closings WHERE business_day BETWEEN '1996-12-01' AND '1997-04-30') THEN
    RAISE EXCEPTION 'production_vs_sales_fixture_window_not_empty'; END IF;
END $$;

INSERT INTO public.products(id,sku,name,category_id,retail_price,cost_price,unit,current_stock,is_display_item,is_test,deleted_at)
SELECT pa,'PGTAP-PVS-A','PGTAP PVS A',cat_bread,0,0,'pcs',0,false,false,NULL::timestamptz FROM pvs_ctx UNION ALL
SELECT pb,'PGTAP-PVS-B','PGTAP PVS B',cat_buns,0,0,'pcs',0,false,false,NULL FROM pvs_ctx UNION ALL
SELECT pc,'PGTAP-PVS-C','PGTAP PVS C',cat_bread,0,0,'pcs',0,false,false,NULL FROM pvs_ctx UNION ALL
SELECT px,'PGTAP-PVS-X','PGTAP PVS X',cat_sfg,0,0,'pcs',0,false,false,NULL FROM pvs_ctx UNION ALL
SELECT pd,'PGTAP-PVS-D','PGTAP PVS D',cat_bread,0,0,'pcs',0,false,false,'1997-03-16 00:00:00+08' FROM pvs_ctx UNION ALL
SELECT pe,'PGTAP-PVS-E','PGTAP PVS E',cat_bread,0,0,'pcs',10,false,false,NULL FROM pvs_ctx UNION ALL
SELECT pv,'PGTAP-PVS-V','PGTAP PVS V',cat_buns,0,0,'pcs',10,true,false,NULL FROM pvs_ctx UNION ALL
SELECT pt,'PGTAP-PVS-T','PGTAP PVS T',cat_bread,0,0,'pcs',0,false,true,NULL FROM pvs_ctx;
INSERT INTO public.display_stock(product_id,quantity) SELECT pv,5 FROM pvs_ctx
ON CONFLICT(product_id) DO UPDATE SET quantity=5;

INSERT INTO public.production_records(product_id,production_number,quantity_produced,quantity_waste,
  waste_reason,production_date,reverted_at,reverted_by,reverted_reason)
SELECT pa,'PROD-19970310-9001',20,1,'cosmetic'::public.waste_reason,'1997-03-10 10:00:00+08'::timestamptz,NULL::timestamptz,NULL::uuid,NULL FROM pvs_ctx UNION ALL
SELECT pa,'PROD-19970310-9002',50,0,NULL,'1997-03-10 11:00:00+08','1997-03-10 12:00:00+08',owner_id,'fixture revert' FROM pvs_ctx UNION ALL
-- Même jour UTC, deux jours métier : 23 h 30 puis 0 h 10 heure locale (UTC+8).
SELECT pa,'PROD-19970311-9003',4,0,NULL,'1997-03-11 15:30:00+00',NULL,NULL,NULL FROM pvs_ctx UNION ALL
SELECT pa,'PROD-19970311-9004',5,0,NULL,'1997-03-11 16:10:00+00',NULL,NULL,NULL FROM pvs_ctx UNION ALL
SELECT pb,'PROD-19970310-9005',10,0,NULL,'1997-03-10 10:00:00+08',NULL,NULL,NULL FROM pvs_ctx UNION ALL
SELECT px,'PROD-19970310-9006',99,0,NULL,'1997-03-10 10:00:00+08',NULL,NULL,NULL FROM pvs_ctx UNION ALL
SELECT pd,'PROD-19970315-9007',7,0,NULL,'1997-03-15 10:00:00+08',NULL,NULL,NULL FROM pvs_ctx;

INSERT INTO public.pos_sessions(id,opened_by,opening_cash,opened_at,closed_at,closed_by,status,
  expected_cash,closing_cash,variance_total)
SELECT session_id,owner_id,0,'1997-03-09 00:00:00+08','1997-04-10 00:00:00+08',owner_id,'closed',0,0,0 FROM pvs_ctx;
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,session_id,served_by,b2b_delivered_at)
SELECT o1,'PGTAP-PVS-1','take_out'::order_type,'completed'::order_status,0,0,0,
  '1997-03-10 09:00:00+08'::timestamptz,'1997-03-10 09:05:00+08'::timestamptz,session_id,owner_id,NULL::timestamptz FROM pvs_ctx UNION ALL
SELECT o2,'PGTAP-PVS-2','b2b','completed',0,0,0,'1997-03-11 10:00:00+08','1997-03-11 10:00:00+08',NULL,owner_id,'1997-03-11 10:00:00+08' FROM pvs_ctx UNION ALL
SELECT o3,'PGTAP-PVS-3','dine_in','completed',0,0,0,'1997-03-11 11:00:00+08','1997-03-11 11:05:00+08',session_id,owner_id,NULL FROM pvs_ctx UNION ALL
-- o6 : commande réglée contenant un produit de test — écartée en entier.
SELECT o6,'PGTAP-PVS-6','take_out','completed',0,0,0,'1997-03-10 09:30:00+08','1997-03-10 09:35:00+08',session_id,owner_id,NULL FROM pvs_ctx UNION ALL
-- Bloc avril : o8 comptoir ; o9 B2B livré NON payé ; o10 B2B non livré.
SELECT o8,'PGTAP-PVS-8','take_out','completed',0,0,0,'1997-04-02 09:00:00+08','1997-04-02 09:05:00+08',session_id,owner_id,NULL FROM pvs_ctx UNION ALL
SELECT o9,'PGTAP-PVS-9','b2b','b2b_pending',0,0,0,'1997-04-01 15:00:00+08',NULL,NULL,owner_id,'1997-04-02 08:00:00+08' FROM pvs_ctx UNION ALL
SELECT o10,'PGTAP-PVS-10','b2b','b2b_pending',0,0,0,'1997-04-02 08:00:00+08',NULL,NULL,owner_id,NULL FROM pvs_ctx;
-- o4 : commande annulée ; o5 : import historique.
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,session_id,
  served_by,voided_at,voided_by,void_reason,is_historical_import)
SELECT o4,'PGTAP-PVS-4','take_out'::order_type,'voided'::order_status,0,0,0,'1997-03-10 09:10:00+08'::timestamptz,
  '1997-03-10 09:15:00+08'::timestamptz,session_id,owner_id,'1997-03-10 09:20:00+08'::timestamptz,owner_id,'fixture void',false FROM pvs_ctx UNION ALL
SELECT o5,'PGTAP-PVS-5','take_out','completed',0,0,0,'1997-03-10 09:10:00+08','1997-03-10 09:15:00+08',session_id,
  owner_id,NULL,NULL,NULL,true FROM pvs_ctx;
INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
  is_cancelled,cancelled_at,cancelled_by,cancelled_reason,is_promo_gift)
SELECT o1,pa,'kept',0,15,0,false,NULL::timestamptz,NULL::uuid,NULL,false FROM pvs_ctx UNION ALL
SELECT o1,pa,'cancelled',0,4,0,true,'1997-03-10 09:02:00+08',owner_id,'fixture',false FROM pvs_ctx UNION ALL
SELECT o1,pa,'gift',0,3,0,false,NULL,NULL,NULL,true FROM pvs_ctx UNION ALL
SELECT o1,pb,'kept',0,4,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o1,px,'out of scope',0,9,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o2,pa,'b2b',0,6,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o3,pc,'kept',0,2,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o4,pa,'voided order',0,100,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o5,pa,'historical import',0,200,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o6,pa,'with test product',0,400,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o6,pt,'test product',0,1,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o8,pa,'april counter',0,5,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o9,pa,'april b2b delivered unpaid',0,2,0,false,NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT o10,pa,'april b2b not delivered',0,50,0,false,NULL,NULL,NULL,false FROM pvs_ctx;
INSERT INTO public.production_records(product_id,production_number,quantity_produced,quantity_waste,
  waste_reason,production_date,reverted_at,reverted_by,reverted_reason)
SELECT pa,'PROD-19970402-9008',10,0,NULL::public.waste_reason,'1997-04-02 07:00:00+08'::timestamptz,NULL::timestamptz,NULL::uuid,NULL FROM pvs_ctx;

-- Pertes : trois déclarations approuvées (A, B en vitrine, X), une en attente,
-- une rejetée. Seule l'approbation écrit le ledger ; la perte de ligne annulée
-- écrit aussi un mouvement waste, mais sans déclaration approuvée.
INSERT INTO public.stock_declarations(id,operation,product_id,quantity,baseline_quantity,reason,declared_by,
  declared_at,idempotency_key,status,reviewed_by,reviewed_at,rejection_reason,display_withdrawal_applied)
SELECT d1,'waste',pa,2,0,'fixture approved',staff_id,'1997-03-10 12:00:00+08'::timestamptz,gen_random_uuid(),'approved',owner_id,'1997-03-10 13:00:00+08'::timestamptz,NULL,false FROM pvs_ctx UNION ALL
SELECT gen_random_uuid(),'waste',pa,7,0,'fixture pending',staff_id,'1997-03-10 12:00:00+08',gen_random_uuid(),'pending',NULL,NULL,NULL,false FROM pvs_ctx UNION ALL
SELECT gen_random_uuid(),'waste',pa,6,0,'fixture rejected',staff_id,'1997-03-10 12:00:00+08',gen_random_uuid(),'rejected',owner_id,'1997-03-10 13:00:00+08','fixture no',false FROM pvs_ctx UNION ALL
SELECT d4,'display_waste',pb,1,0,'fixture display',staff_id,'1997-03-10 12:00:00+08',gen_random_uuid(),'approved',owner_id,'1997-03-10 13:00:00+08',NULL,true FROM pvs_ctx UNION ALL
SELECT d5,'waste',px,8,0,'fixture sfg',staff_id,'1997-03-10 12:00:00+08',gen_random_uuid(),'approved',owner_id,'1997-03-10 13:00:00+08',NULL,false FROM pvs_ctx;
INSERT INTO public.stock_movements(product_id,movement_type,quantity,unit,reason,reference_type,reference_id,
  created_by,created_at,idempotency_key)
SELECT pa,'waste'::movement_type,-2,'pcs','fixture approved','stock_declaration',d1,owner_id,'1997-03-10 13:00:00+08'::timestamptz,d1 FROM pvs_ctx UNION ALL
SELECT pb,'waste',-1,'pcs','fixture display','stock_declaration',d4,owner_id,'1997-03-10 13:00:00+08',d4 FROM pvs_ctx UNION ALL
SELECT px,'waste',-8,'pcs','fixture sfg','stock_declaration',d5,owner_id,'1997-03-10 13:00:00+08',d5 FROM pvs_ctx UNION ALL
SELECT pa,'waste',-9,'pcs','fixture order cancel','order_cancel',o1,owner_id,'1997-03-10 13:00:00+08',NULL FROM pvs_ctx;

-- Bloc avril : une perte saisie dans la clôture du 2 (approuvée le 3) et une
-- perte ordinaire de B approuvée le 3 ; puis les clôtures de vitrine.
INSERT INTO public.stock_declarations(id,operation,product_id,quantity,baseline_quantity,reason,declared_by,
  declared_at,idempotency_key,status,reviewed_by,reviewed_at,rejection_reason,display_withdrawal_applied)
SELECT dk,'display_waste',pa,1,0,'fixture closing waste',staff_id,'1997-04-02 20:00:00+08'::timestamptz,gen_random_uuid(),'approved',owner_id,'1997-04-03 09:00:00+08'::timestamptz,NULL,true FROM pvs_ctx UNION ALL
SELECT d7,'waste',pb,1,0,'fixture april waste',staff_id,'1997-04-03 12:00:00+08',gen_random_uuid(),'approved',owner_id,'1997-04-03 13:00:00+08',NULL,false FROM pvs_ctx;
INSERT INTO public.stock_movements(product_id,movement_type,quantity,unit,reason,reference_type,reference_id,
  created_by,created_at,idempotency_key)
SELECT pa,'waste'::movement_type,-1,'pcs','fixture closing waste','stock_declaration',dk,owner_id,'1997-04-03 09:00:00+08'::timestamptz,dk FROM pvs_ctx UNION ALL
SELECT pb,'waste',-1,'pcs','fixture april waste','stock_declaration',d7,owner_id,'1997-04-03 13:00:00+08',d7 FROM pvs_ctx;
INSERT INTO public.display_day_closings(id,business_day,revision,supersedes_id,recorded_by,recorded_at,correction_reason,idempotency_key,request)
SELECT k1a,'1997-04-01'::date,1,NULL::uuid,owner_id,'1997-04-01 21:00:00+08'::timestamptz,NULL,gen_random_uuid(),'{}'::jsonb FROM pvs_ctx UNION ALL
SELECT k1b,'1997-04-01',2,k1a,owner_id,'1997-04-01 22:00:00+08','fixture correction',gen_random_uuid(),'{}' FROM pvs_ctx UNION ALL
SELECT k2,'1997-04-02',1,NULL,owner_id,'1997-04-02 21:00:00+08',NULL,gen_random_uuid(),'{}' FROM pvs_ctx UNION ALL
SELECT k4,'1997-04-04',1,NULL,owner_id,'1997-04-04 21:00:00+08',NULL,gen_random_uuid(),'{}' FROM pvs_ctx;
INSERT INTO public.display_day_closing_items(closing_id,product_id,remaining_qty,waste_qty,waste_reason,reference_basis,expected_qty,waste_declaration_id)
SELECT k1a,pa,3,0,NULL,'display',0,NULL::uuid FROM pvs_ctx UNION ALL
SELECT k1a,pb,2,0,NULL,'display',0,NULL FROM pvs_ctx UNION ALL
SELECT k1b,pa,4,0,NULL,'display',0,NULL FROM pvs_ctx UNION ALL
SELECT k1b,pb,2,0,NULL,'display',0,NULL FROM pvs_ctx UNION ALL
SELECT k2,pa,5,1,'fixture closing waste','display',0,dk FROM pvs_ctx UNION ALL
SELECT k4,pa,0,0,NULL,'display',0,NULL FROM pvs_ctx UNION ALL
SELECT k4,pb,0,0,NULL,'display',0,NULL FROM pvs_ctx;

-- Six mesures d'un objet, puis leur somme sur un tableau, en texte comparable.
CREATE FUNCTION pg_temp.pvs_m(j jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(trim_scale((j->>k)::numeric)::text,'/' ORDER BY o)
  FROM unnest(ARRAY['produced','sold_counter','sold_b2b','sold_total','wasted','gap']) WITH ORDINALITY x(k,o) $f$;
CREATE FUNCTION pg_temp.pvs_s(a jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(trim_scale(COALESCE((SELECT sum((e->>k)::numeric) FROM jsonb_array_elements(a) e),0))::text,'/' ORDER BY o)
  FROM unnest(ARRAY['produced','sold_counter','sold_b2b','sold_total','wasted','gap']) WITH ORDINALITY x(k,o) $f$;
-- Le bilan d'un objet (reste de la veille / reste du soir / non expliqué),
-- puis sa somme sur un tableau ; « null » marque l'inconnu.
CREATE FUNCTION pg_temp.pvs_b(j jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(COALESCE(trim_scale((j->>k)::numeric)::text,'null'),'/' ORDER BY o)
  FROM unnest(ARRAY['opening','closing','unexplained']) WITH ORDINALITY x(k,o) $f$;
CREATE FUNCTION pg_temp.pvs_bs(a jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(COALESCE(trim_scale(CASE WHEN k='unexplained'
      THEN (SELECT sum((e->>k)::numeric) FROM jsonb_array_elements(a) e)
      ELSE COALESCE((SELECT sum((e->>k)::numeric) FROM jsonb_array_elements(a) e),0) END)::text,'null'),'/' ORDER BY o)
  FROM unnest(ARRAY['opening','closing','unexplained']) WITH ORDINALITY x(k,o) $f$;
-- Prend l'identité d'un compte (NULL = aucune session) pour la suite de la transaction.
CREATE FUNCTION pg_temp.pvs_as(p uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',COALESCE(p::text,''),true);
  PERFORM set_config('request.jwt.claims',CASE WHEN p IS NULL THEN '{}'
    ELSE jsonb_build_object('sub',p,'role','authenticated')::text END,true);
END $f$;

SELECT pg_temp.pvs_as(owner_uid) FROM pvs_ctx;

-- (m) La fonction n'écrit rien : relevé avant le premier appel, relu après les appels de la fenêtre.
CREATE TEMP TABLE pvs_before AS SELECT (SELECT count(*) FROM public.stock_movements) AS sm,
  (SELECT count(*) FROM public.audit_logs) AS al, (SELECT count(*) FROM public.journal_entries) AS je;

CREATE TEMP TABLE pvs_r AS SELECT
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13') AS r,
  public.get_production_vs_sales_v4('1997-03-10','1997-03-10',NULL,pa) AS a1,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',NULL,pa) AS fa,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',cat_buns) AS fbuns,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',cat_bread) AS fbread,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',NULL,px) AS fx,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',cat_sfg) AS fsfg,
  public.get_production_vs_sales_v4('1997-03-09','1997-03-13',NULL,pt) AS ft,
  public.get_production_vs_sales_v4('1997-03-15','1997-03-15') AS sd,
  public.get_production_vs_sales_v4('1996-01-01','1997-03-13') AS clamp,
  public.get_production_vs_sales_v4('1997-04-02','1997-04-04') AS apr,
  public.get_production_vs_sales_v4('1997-04-02','1997-04-04',cat_buns) AS aprbuns
FROM pvs_ctx;

INSERT INTO pvs_results(result) SELECT ok(r ?& ARRAY['period','timezone','generated_at','categories','summary',
  'by_day','by_category','by_product','by_day_product'] AND r->'summary' ? 'sell_through_pct',
  'toutes les clés du contrat sont présentes') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(r->'period',
  jsonb_build_object('start','1997-03-09','end','1997-03-13'),'période servie renvoyée') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(c->>'slug',',' ORDER BY o) FROM jsonb_array_elements(r->'categories') WITH ORDINALITY x(c,o)),
  'bagel,buns,classic-breads,classic-viennoiserie,individual-pastries,others-viennoiserie,savouries,sourdough-breads',
  'categories : les 8 catégories du périmètre, triées par nom, sans sfg') FROM pvs_r;

-- (a) le cas du plan, et ses exclusions (b) (c) (e).
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_m(a1->'summary'),'20/15/0/15/2/3',
  '(a) fournée de 20, 15 vendus comptoir, 2 perdus approuvés : écart 3') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is((a1->'summary'->>'sell_through_pct')::numeric,75.0,
  '(a) taux d''écoulement 75.0') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is((a1->'summary'->>'produced')::numeric,20::numeric,
  '(b) la fournée annulée de 50 ne compte pas') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is((a1->'summary'->>'sold_counter')::numeric,15::numeric,
  '(c) la ligne annulée (4) et le cadeau promo (3) ne comptent pas') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  (a1->'summary'->>'sold_total')::numeric=15 AND (r->'summary'->>'sold_total')::numeric=27
  AND pg_temp.pvs_m(ft->'summary')='0/0/0/0/0/0' AND ft->'by_product'='[]'::jsonb
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_product') e WHERE (e->>'product_id')::uuid=c.pt),
  '(c) commande annulée (100), import historique (200) et commande avec produit de test (400) hors du vendu ; le produit de test n''apparaît pas')
  FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT is((a1->'summary'->>'wasted')::numeric,2::numeric,
  '(e) perte en attente (7), rejetée (6), quantity_waste (1) et waste de ligne annulée (9) exclus') FROM pvs_r;

-- (d) B2B séparé, (g) jour métier.
INSERT INTO pvs_results(result) SELECT is(
  (SELECT pg_temp.pvs_m(e) FROM jsonb_array_elements(r->'by_day_product') e
    WHERE e->>'date'='1997-03-11' AND (e->>'product_id')::uuid=c.pa),'4/0/6/6/0/-2',
  '(d)(g) J2 : 6 en sold_b2b et 0 au comptoir ; la fournée de 23 h 30 reste sur son jour ; écart négatif')
  FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT pg_temp.pvs_m(e) FROM jsonb_array_elements(r->'by_day_product') e
    WHERE e->>'date'='1997-03-12' AND (e->>'product_id')::uuid=c.pa),'5/0/0/0/0/5',
  '(g) la fournée de 0 h 10 passe au jour suivant') FROM pvs_r, pvs_ctx c;

-- (f) hors périmètre.
INSERT INTO pvs_results(result) SELECT ok(
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_product') e WHERE (e->>'product_id')::uuid=c.px)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_day_product') e WHERE (e->>'product_id')::uuid=c.px)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_category') e WHERE (e->>'category_id')::uuid=c.cat_sfg),
  '(f) l''article sfg n''apparaît dans aucune ventilation') FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_m(fx->'summary')='0/0/0/0/0/0' AND fx->'by_product'='[]'::jsonb AND fx->'by_day_product'='[]'::jsonb
  AND pg_temp.pvs_m(fsfg->'summary')='0/0/0/0/0/0' AND fsfg->'by_category'='[]'::jsonb,
  '(f) filtrer sur l''article ou la catégorie sfg rend un résultat vide') FROM pvs_r;

-- Total et ventilations.
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_m(r->'summary'),'39/21/6/27/3/9','summary de la période') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is((r->'summary'->>'sell_through_pct')::numeric,69.2,
  'summary : taux d''écoulement arrondi à une décimale') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'product_name'||'='||pg_temp.pvs_m(e)||'='||COALESCE(e->>'sell_through_pct','null'),' ; ' ORDER BY o)
     FROM jsonb_array_elements(r->'by_product') WITH ORDINALITY x(e,o)),
  'PGTAP PVS A=29/15/6/21/2/6=72.4 ; PGTAP PVS B=10/4/0/4/1/5=40.0 ; PGTAP PVS C=0/2/0/2/0/-2=null',
  'by_product : trié par écart décroissant, taux nul sans production, perte de vitrine approuvée comptée une fois') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'category_name'||'='||pg_temp.pvs_m(e)||'='||COALESCE(e->>'sell_through_pct','null'),' ; ' ORDER BY o)
     FROM jsonb_array_elements(r->'by_category') WITH ORDINALITY x(e,o)),
  'Buns=10/4/0/4/1/5=40.0 ; Classic Breads=29/17/6/23/2/4=79.3','by_category') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  (SELECT bool_and(e ?& ARRAY['product_id','product_name','category_id','category_name']
     AND (e->>'category_id')::uuid IN (c.cat_bread,c.cat_buns)) FROM jsonb_array_elements(r->'by_product') e),
  'by_product porte l''article et sa catégorie') FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_m(sd->'summary')='7/0/0/0/0/7' AND jsonb_array_length(sd->'by_product')=1
  AND (sd->'by_product'->0->>'product_id')::uuid=c.pd AND sd->'by_product'->0->>'product_name'='PGTAP PVS D',
  'un article supprimé (deleted_at) reste dans le rapport : l''historique ne se réécrit pas') FROM pvs_r, pvs_ctx c;

-- (l) tous les jours de la période servie, y compris les jours à zéro.
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'date'||'='||pg_temp.pvs_m(e),' ; ' ORDER BY o)
     FROM jsonb_array_elements(r->'by_day') WITH ORDINALITY x(e,o)),
  '1997-03-09=0/0/0/0/0/0 ; 1997-03-10=30/19/0/19/3/8 ; 1997-03-11=4/2/6/8/0/-4 ; 1997-03-12=5/0/0/0/0/5 ; 1997-03-13=0/0/0/0/0/0',
  '(l) by_day : un élément par jour, trié, jours à zéro compris') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  clamp->'period'=jsonb_build_object('start','1996-12-12','end','1997-03-13')
  AND jsonb_array_length(clamp->'by_day')=92 AND clamp->'by_day'->0->>'date'='1996-12-12'
  AND clamp->'by_day'->91->>'date'='1997-03-13' AND clamp->'summary'=r->'summary',
  '(l) fenêtre bornée à 92 jours : le début est rogné, by_day couvre la période servie') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'date'||':'||right(p.name,1),',' ORDER BY o)
     FROM jsonb_array_elements(r->'by_day_product') WITH ORDINALITY x(e,o)
     JOIN public.products p ON p.id=(e->>'product_id')::uuid),
  '1997-03-10:A,1997-03-10:B,1997-03-11:A,1997-03-11:C,1997-03-12:A',
  'by_day_product : seulement les couples non nuls, triés date puis nom') FROM pvs_r;

-- (i) invariant : chaque ventilation referme le summary, mesure par mesure.
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_s(r->'by_product'),pg_temp.pvs_m(r->'summary'),'(i) somme de by_product = summary') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_s(r->'by_category'),pg_temp.pvs_m(r->'summary'),'(i) somme de by_category = summary') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_s(r->'by_day'),pg_temp.pvs_m(r->'summary'),'(i) somme de by_day = summary') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_s(r->'by_day_product'),pg_temp.pvs_m(r->'summary'),'(i) somme de by_day_product = summary') FROM pvs_r;

-- (h) les filtres restreignent les TROIS sources, et l'invariant tient sous filtre.
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_m(fbuns->'summary'),'10/4/0/4/1/5',
  '(h) filtre catégorie buns : production, ventes et pertes de cette catégorie seulement') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_m(fbread->'summary'),'29/17/6/23/2/4',
  '(h) filtre catégorie classic-breads') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(pg_temp.pvs_m(fa->'summary'),'29/15/6/21/2/6',
  '(h) filtre article A : production, ventes et pertes de cet article seulement') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_s(fa->'by_product')=pg_temp.pvs_m(fa->'summary') AND pg_temp.pvs_s(fa->'by_day')=pg_temp.pvs_m(fa->'summary')
  AND pg_temp.pvs_s(fbuns->'by_category')=pg_temp.pvs_m(fbuns->'summary')
  AND pg_temp.pvs_s(fbuns->'by_day_product')=pg_temp.pvs_m(fbuns->'summary')
  AND jsonb_array_length(fa->'by_product')=1 AND jsonb_array_length(fbuns->'by_category')=1
  AND jsonb_array_length(fbuns->'categories')=8,
  '(h)(i) sous filtre : les sommes se referment et la liste des catégories reste complète') FROM pvs_r;

-- BILAN (bloc avril) : reste de la veille + produit − vendu − pertes − reste du soir.
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'date'||':'||right(p.name,1)||'='||pg_temp.pvs_m(e)||'='||pg_temp.pvs_b(e),' ; ' ORDER BY o)
     FROM jsonb_array_elements(apr->'by_day_product') WITH ORDINALITY x(e,o)
     JOIN public.products p ON p.id=(e->>'product_id')::uuid),
  '1997-04-02:A=10/5/2/7/1/2=4/5/1 ; 1997-04-02:B=0/0/0/0/0/0=2/null/null ; '
  ||'1997-04-03:A=0/0/0/0/0/0=5/null/null ; 1997-04-03:B=0/0/0/0/1/-1=null/null/null',
  'bilan by_day_product : 4 + 10 − 7 − 1 − 5 = 1 ; reste inconnu = null, jamais zéro') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  pg_temp.pvs_m(apr->'summary')||'='||pg_temp.pvs_b(apr->'summary')||'='||(apr->'summary'->>'unknown_cells'),
  '10/5/2/7/2/1=11/5/1=3','bilan summary : restes connus sommés, non expliqué des seules cellules connues, 3 inconnues') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(e->>'date'||'='||pg_temp.pvs_b(e)||'='||(e->>'unknown_cells')||'='||(e->>'has_closing'),' ; ' ORDER BY o)
     FROM jsonb_array_elements(apr->'by_day') WITH ORDINALITY x(e,o)),
  '1997-04-02=6/5/1=1=true ; 1997-04-03=5/0/null=2=false ; 1997-04-04=0/0/null=0=true',
  'bilan by_day : jour sans clôture signalé, non expliqué null quand rien n''est connu') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is((apr->'summary'->>'sold_b2b')::numeric,2::numeric,
  'B2B : livré non payé compté au jour de livraison, non livré (50) exclu') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT (e->>'opening')::numeric FROM jsonb_array_elements(apr->'by_day_product') e
    WHERE e->>'date'='1997-04-02' AND (e->>'product_id')::uuid=c.pa),4::numeric,
  'clôture corrigée : la dernière révision compte (4, pas 3)') FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  (SELECT (e->>'wasted')::numeric FROM jsonb_array_elements(apr->'by_day_product') e
    WHERE e->>'date'='1997-04-02' AND (e->>'product_id')::uuid=c.pa)=1
  AND (SELECT (e->>'wasted')::numeric FROM jsonb_array_elements(apr->'by_day_product') e
    WHERE e->>'date'='1997-04-03' AND (e->>'product_id')::uuid=c.pa)=0,
  'perte saisie à la clôture : comptée au jour de la clôture, pas au jour de son approbation') FROM pvs_r, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(apr->'by_day_product') e WHERE e->>'date'='1997-04-04'),
  'une cellule sans mouvement et à reste nul n''apparaît pas') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_bs(apr->'by_day_product')=pg_temp.pvs_b(apr->'summary')
  AND pg_temp.pvs_bs(apr->'by_product')=pg_temp.pvs_b(apr->'summary')
  AND pg_temp.pvs_bs(apr->'by_category')=pg_temp.pvs_b(apr->'summary')
  AND pg_temp.pvs_bs(apr->'by_day')=pg_temp.pvs_b(apr->'summary')
  AND pg_temp.pvs_s(apr->'by_day_product')=pg_temp.pvs_m(apr->'summary')
  AND pg_temp.pvs_b(aprbuns->'summary')='2/0/null' AND (aprbuns->'summary'->>'unknown_cells')::int=2,
  '(i) bilan : chaque ventilation referme le summary ; le filtre catégorie restreint les restes') FROM pvs_r;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_b(r->'summary')='0/0/null' AND (r->'summary'->>'unknown_cells')::int=jsonb_array_length(r->'by_day_product')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_day') e WHERE (e->>'has_closing')::boolean),
  'sans aucune clôture, le non expliqué est inconnu partout, jamais zéro') FROM pvs_r;

-- (m) aucune écriture.
INSERT INTO pvs_results(result) SELECT ok(
  b.sm=(SELECT count(*) FROM public.stock_movements) AND b.al=(SELECT count(*) FROM public.audit_logs)
  AND b.je=(SELECT count(*) FROM public.journal_entries),
  '(m) lecture seule : stock_movements, audit_logs et journal_entries inchangés') FROM pvs_before b;

-- (k) droits.
INSERT INTO pvs_results(result) SELECT ok(
  has_function_privilege('authenticated','public.get_production_vs_sales_v4(date,date,uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.get_production_vs_sales_v4(date,date,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_production_vs_sales_v4(date,date,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.get_production_vs_sales_v4(date,date,uuid,uuid)','EXECUTE'),
  '(k) authenticated et service_role exécutent, anon et PUBLIC non');
INSERT INTO pvs_results(result) SELECT ok(
  to_regprocedure('public.get_production_vs_sales_v1(date,date,uuid,uuid)') IS NULL
  AND to_regprocedure('public.get_production_vs_sales_v2(date,date,uuid,uuid)') IS NULL,
  'les versions v1 et v2 sont supprimées');

-- Bornes.
INSERT INTO pvs_results(result) SELECT throws_ok(
  $$SELECT public.get_production_vs_sales_v4('1997-03-13','1997-03-09')$$,'22023','invalid_date_range',
  'fin avant début refusée');
INSERT INTO pvs_results(result) SELECT throws_ok(
  $$SELECT public.get_production_vs_sales_v4(NULL,'1997-03-09')$$,'22023','start and end dates are required',
  'dates requises');

-- BOUT EN BOUT : une perte et une perte de vitrine passent par les vraies
-- fonctions (soumission par un non-propriétaire, approbation par le
-- propriétaire — l'approbateur doit différer du déclarant ; aucune des deux
-- n'exige de PIN). Le mouvement naît à l'instant de l'approbation : le jour
-- observé est donc le jour métier courant, filtré sur l'article de la fixture.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT staff_id,p.code,true,'Transactional declaration fixture' FROM pvs_ctx
CROSS JOIN (VALUES('inventory.waste'),('display.manage')) p(code)
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
SELECT pg_temp.pvs_as(staff_uid) FROM pvs_ctx;
CREATE TEMP TABLE pvs_decl AS SELECT
  (public.submit_stock_declaration_v3('waste',pe,3,'pgtap e2e waste',gen_random_uuid(),'other')->>'declaration_id')::uuid AS dw,
  (public.submit_stock_declaration_v3('display_waste',pv,2,'pgtap e2e display waste',gen_random_uuid(),'other')->>'declaration_id')::uuid AS dd
FROM pvs_ctx;
SELECT pg_temp.pvs_as(owner_uid) FROM pvs_ctx;
CREATE TEMP TABLE pvs_pending AS SELECT
  public.get_production_vs_sales_v4(today,today,NULL,pe) AS w,
  public.get_production_vs_sales_v4(today,today,NULL,pv) AS d FROM pvs_ctx;
INSERT INTO pvs_results(result) SELECT ok(
  (p.w->'summary'->>'wasted')::numeric=0 AND (p.d->'summary'->>'wasted')::numeric=0
  AND (SELECT count(*) FROM public.stock_declarations s WHERE s.id IN (x.dw,x.dd) AND s.status='pending')=2
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.product_id IN (c.pe,c.pv)),
  'bout en bout : déclarées mais non approuvées, les deux pertes valent zéro et le ledger est vide')
  FROM pvs_pending p, pvs_decl x, pvs_ctx c;
CREATE TEMP TABLE pvs_approved AS SELECT public.approve_stock_declaration_v4(dw) AS w,
  public.approve_stock_declaration_v4(dd) AS d FROM pvs_decl;
CREATE TEMP TABLE pvs_after AS SELECT
  public.get_production_vs_sales_v4(today,today,NULL,pe) AS w,
  public.get_production_vs_sales_v4(today,today,NULL,pv) AS d FROM pvs_ctx;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(m.movement_type||'|'||m.reference_type||'|'||(m.reference_id=x.dw)||'|'||trim_scale(m.quantity)||'|'||m.unit,',')
     FROM public.stock_movements m WHERE m.product_id=c.pe),
  'waste|stock_declaration|true|-3|pcs',
  'bout en bout : l''approbation écrit exactement un mouvement waste, reference_type stock_declaration, reference_id = la déclaration')
  FROM pvs_decl x, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_m(a.w->'summary')='0/0/0/0/3/-3' AND jsonb_array_length(a.w->'by_day')=1
  AND a.w->'by_day'->0->>'date'=c.today::text AND (a.w->'by_day'->0->>'wasted')::numeric=3,
  'bout en bout : la perte approuvée est comptée dans wasted, le jour métier de l''approbation') FROM pvs_after a, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(m.movement_type||'|'||m.reference_type||'|'||(m.reference_id=x.dd)||'|'||trim_scale(m.quantity)||'|'||m.unit,',')
     FROM public.stock_movements m WHERE m.product_id=c.pv),
  'waste|stock_declaration|true|-2|pcs',
  'bout en bout vitrine : un seul mouvement waste du ledger pour la perte de vitrine approuvée')
  FROM pvs_decl x, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_m(a.d->'summary')='0/0/0/0/2/-2' AND a.d->'by_day'->0->>'date'=c.today::text
  AND (SELECT count(*) FROM public.display_movements dm WHERE dm.product_id=c.pv AND dm.movement_type='waste')=1,
  'bout en bout vitrine : comptée une seule fois (le retrait de vitrine n''est pas relu)') FROM pvs_after a, pvs_ctx c;

-- Articles servis en combo (décision de Mamat, 2026-11-11). Jour isolé : le
-- 7 avril. Un combo est UNE ligne (ici portée par X, hors périmètre) dont les
-- articles vivent dans combo_components.
--   A : fournée 10 ; 2 vendus en ligne propre ; combo ×3 au comptoir avec A×2
--       (6) ; combo ×1 en B2B livré avec A×2 (2).
--   B et C : le même combo comptoir porte B×1 (3) et C sans quantité (×1 → 3).
--   Ne comptent pas : X composant (hors périmètre), un identifiant mal formé,
--   un combo annulé (×5), un combo cadeau promo (×7), des composants qui ne
--   sont pas un tableau (×9).
CREATE TEMP TABLE pvs_combo AS SELECT gen_random_uuid() AS oc, gen_random_uuid() AS ob;
INSERT INTO public.production_records(product_id,production_number,quantity_produced,quantity_waste,
  waste_reason,production_date,reverted_at,reverted_by,reverted_reason)
SELECT pa,'PROD-19970407-9009',10,0,NULL::public.waste_reason,'1997-04-07 07:00:00+08'::timestamptz,NULL::timestamptz,NULL::uuid,NULL FROM pvs_ctx;
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,session_id,served_by,b2b_delivered_at)
SELECT oc,'PGTAP-PVS-C1','take_out'::order_type,'completed'::order_status,0,0,0,
  '1997-04-07 09:00:00+08'::timestamptz,'1997-04-07 09:05:00+08'::timestamptz,session_id,owner_id,NULL::timestamptz FROM pvs_ctx, pvs_combo UNION ALL
SELECT ob,'PGTAP-PVS-C2','b2b','b2b_pending',0,0,0,'1997-04-06 15:00:00+08',NULL,NULL,owner_id,'1997-04-07 08:00:00+08' FROM pvs_ctx, pvs_combo;
INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
  is_cancelled,cancelled_at,cancelled_by,cancelled_reason,is_promo_gift,combo_components)
SELECT oc,pa,'own line',0,2,0,false,NULL::timestamptz,NULL::uuid,NULL,false,NULL::jsonb FROM pvs_ctx, pvs_combo UNION ALL
SELECT oc,px,'combo',0,3,0,false,NULL,NULL,NULL,false,jsonb_build_array(
    jsonb_build_object('product_id',pa,'name','A','quantity',2,'modifiers','[]'::jsonb),
    jsonb_build_object('product_id',pb,'name','B','quantity',1,'modifiers','[]'::jsonb),
    jsonb_build_object('product_id',pc,'name','C'),
    jsonb_build_object('product_id',px,'name','X','quantity',1),
    jsonb_build_object('product_id','not-a-uuid','name','broken','quantity',4)) FROM pvs_ctx, pvs_combo UNION ALL
SELECT oc,px,'combo cancelled',0,5,0,true,'1997-04-07 09:02:00+08',owner_id,'fixture',false,
  jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1)) FROM pvs_ctx, pvs_combo UNION ALL
SELECT oc,px,'combo gift',0,7,0,false,NULL,NULL,NULL,true,
  jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1)) FROM pvs_ctx, pvs_combo UNION ALL
SELECT oc,px,'combo not an array',0,9,0,false,NULL,NULL,NULL,false,
  jsonb_build_object('product_id',pa,'quantity',1) FROM pvs_ctx, pvs_combo UNION ALL
SELECT ob,px,'b2b combo',0,1,0,false,NULL,NULL,NULL,false,
  jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2)) FROM pvs_ctx, pvs_combo;

SELECT pg_temp.pvs_as(owner_uid) FROM pvs_ctx;
CREATE TEMP TABLE pvs_cr AS SELECT public.get_production_vs_sales_v4('1997-04-07','1997-04-07') AS r;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT pg_temp.pvs_m(e)||'|'||trim_scale((e->>'sold_in_combo')::numeric)::text
     FROM jsonb_array_elements(x.r->'by_product') e WHERE (e->>'product_id')::uuid=c.pa),
  '10/8/2/10/0/0|8',
  'combo : A compte sa ligne propre (2), le combo comptoir (3×2) et le combo B2B livré (1×2) ; annulé, cadeau et non-tableau écartés')
  FROM pvs_cr x, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT is(
  (SELECT string_agg(trim_scale((e->>'sold_counter')::numeric)::text||'/'||trim_scale((e->>'sold_in_combo')::numeric)::text,
                     ',' ORDER BY e->>'product_name')
     FROM jsonb_array_elements(x.r->'by_product') e WHERE (e->>'product_id')::uuid IN (c.pb,c.pc))
  ||'|'||(SELECT count(*) FROM jsonb_array_elements(x.r->'by_product') e WHERE (e->>'product_id')::uuid=c.px)::text,
  '3/3,3/3|0',
  'combo : B (×1) et C (quantité absente = 1) comptent 3 chacun ; le composant hors périmètre et l''identifiant mal formé ne comptent pas')
  FROM pvs_cr x, pvs_ctx c;
INSERT INTO pvs_results(result) SELECT is(
  pg_temp.pvs_m(x.r->'summary')
  ||'|'||trim_scale((x.r->'summary'->>'sold_in_combo')::numeric)::text
  ||'|'||trim_scale((x.r->'by_day'->0->>'sold_in_combo')::numeric)::text
  ||'|'||trim_scale((SELECT sum((e->>'sold_in_combo')::numeric) FROM jsonb_array_elements(x.r->'by_category') e))::text
  ||'|'||trim_scale((SELECT sum((e->>'sold_in_combo')::numeric) FROM jsonb_array_elements(x.r->'by_product') e))::text
  ||'|'||trim_scale((SELECT sum((e->>'sold_in_combo')::numeric) FROM jsonb_array_elements(x.r->'by_day_product') e))::text,
  '10/14/2/16/0/-6|14|14|14|14|14',
  'combo : sold_in_combo est compris dans sold_total et se referme aux cinq niveaux') FROM pvs_cr x;
INSERT INTO pvs_results(result) SELECT ok(
  (r->'summary'->>'sold_in_combo')::numeric=0
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_day') e WHERE (e->>'sold_in_combo')::numeric<>0)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'by_product') e WHERE NOT e ? 'sold_in_combo'),
  'combo : sans combo dans la fenêtre, sold_in_combo vaut 0 et les autres chiffres sont ceux d''avant') FROM pvs_r;

-- Une catégorie du périmètre supprimée sort du rapport, avec ses articles.
UPDATE public.categories SET deleted_at=now() WHERE slug='buns';
INSERT INTO pvs_results(result) SELECT ok(
  pg_temp.pvs_m(x.r->'summary')='29/17/6/23/2/4' AND jsonb_array_length(x.r->'categories')=7
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x.r->'categories') e WHERE e->>'slug'='buns')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x.r->'by_category') e WHERE (e->>'category_id')::uuid=c.cat_buns)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x.r->'by_product') e WHERE (e->>'product_id')::uuid=c.pb),
  'une catégorie du périmètre supprimée sort du rapport : liste, ventilations et total')
  FROM (SELECT public.get_production_vs_sales_v4('1997-03-09','1997-03-13') AS r) x, pvs_ctx c;

-- (j) garde, reproduite de l'état de stock réservé au propriétaire : un
-- non-propriétaire et une absence de session sont arrêtés par l'assertion
-- propriétaire (P0003) AVANT la permission, même s'il détient la permission ;
-- 42501 est le refus d'un propriétaire privé de reports.inventory.read.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT staff_id,'reports.inventory.read',true,'Transactional report grant fixture' FROM pvs_ctx
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
SELECT pg_temp.pvs_as(staff_uid) FROM pvs_ctx;
INSERT INTO pvs_results(result) SELECT throws_ok(
  $$SELECT public.get_production_vs_sales_v4('1997-03-09','1997-03-13')$$,'P0003','stock_visibility_owner_required',
  '(j) non-propriétaire refusé, même avec la permission de rapport');
SELECT pg_temp.pvs_as(NULL);
INSERT INTO pvs_results(result) SELECT throws_ok(
  $$SELECT public.get_production_vs_sales_v4('1997-03-09','1997-03-13')$$,'P0003','stock_visibility_owner_required',
  '(j) absence de session refusée');
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT owner_id,'reports.inventory.read',false,'Transactional report deny fixture' FROM pvs_ctx
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;
SELECT pg_temp.pvs_as(owner_uid) FROM pvs_ctx;
INSERT INTO pvs_results(result) SELECT throws_ok(
  $$SELECT public.get_production_vs_sales_v4('1997-03-09','1997-03-13')$$,'42501',
  'permission denied: reports.inventory.read required','(j) propriétaire sans reports.inventory.read : 42501');

INSERT INTO pvs_results(result) SELECT * FROM finish();
SELECT result FROM pvs_results ORDER BY n;
ROLLBACK;
