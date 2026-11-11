-- S1-05 — chaîne comptable du stock et coût des ventes.
--
-- Chaque article a un compte de stock (fabriqué -> produits finis, acheté ->
-- matières premières) et tous ses mouvements passent par lui. Événements
-- couverts : vente, annulation, remboursement, production, réception, perte,
-- inventaire, ajustement — puis l'écriture de régularisation du passé.
--
-- Runner : MCP execute_sql (enveloppe BEGIN … ROLLBACK), pas de runner local.
BEGIN;
SELECT plan(34);

CREATE TEMP TABLE _ids(label text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _base(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- Code du compte visé par une clé de mapping.
CREATE FUNCTION pg_temp.code(p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT a.code FROM public.accounts a WHERE a.id = public.resolve_mapping_account(p_key)
$$;
-- Signature « DR compte montant / CR compte montant » de l'écriture d'un mouvement.
CREATE FUNCTION pg_temp.sig(p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(CASE WHEN l.debit > 0 THEN 'DR ' ELSE 'CR ' END || a.code || ' ' || (l.debit + l.credit)::int,
                    ' / ' ORDER BY l.debit DESC)
    FROM public.journal_entries je
    JOIN public.journal_entry_lines l ON l.journal_entry_id = je.id
    JOIN public.accounts a ON a.id = l.account_id
   WHERE je.reference_type = 'stock_movement'
     AND je.reference_id = (SELECT id FROM _ids WHERE label = p_label)
$$;
CREATE FUNCTION pg_temp.expect(p_dr text, p_cr text, p_amount int) RETURNS text LANGUAGE sql AS $$
  SELECT 'DR ' || pg_temp.code(p_dr) || ' ' || p_amount || ' / CR ' || pg_temp.code(p_cr) || ' ' || p_amount
$$;
-- Mouvement direct (pgTAP tourne en superuser, même convention que les autres fichiers).
CREATE FUNCTION pg_temp.mv(p_label text, p_product text, p_type public.movement_type, p_qty numeric,
                           p_cost numeric DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb,
                           p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.stock_movements (product_id, movement_type, quantity, unit, reason, unit_cost,
                                      created_by, reference_type, metadata, created_at)
  VALUES ((SELECT id FROM _ids WHERE label = p_product), p_type, p_qty, 'pcs', 'pgTAP stock chain',
          p_cost, (SELECT id FROM _ids WHERE label = 'profile'), 'admin_action', p_meta, p_at)
  RETURNING id INTO v_id;
  INSERT INTO _ids VALUES (p_label, v_id);
END $$;

-- Relevé à blanc AVANT les fixtures : la régularisation voit toute la base,
-- les assertions portent donc sur des écarts.
-- Si la base porte déjà SA régularisation, on l'efface pour la durée de la
-- transaction : sans cela le relevé à blanc rendrait « déjà posté », sans
-- lignes, et les écarts ci-dessous ne mesureraient plus rien.
UPDATE public.journal_entries SET metadata = metadata - 'kind'
 WHERE reference_type = 'manual' AND metadata->>'kind' = 'stock_chain_catchup';
INSERT INTO _base VALUES ('before', public.post_stock_chain_catchup_v1(true));
SELECT ok((SELECT v ? 'lines' FROM _base WHERE k = 'before'), 'the dry run returns its lines');

DO $fixture$
DECLARE
  v_auth uuid := gen_random_uuid(); v_profile uuid := gen_random_uuid();
  v_cat uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); v_po uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_zero uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES (v_auth);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,is_active)
  VALUES (v_profile,v_auth,'SAC-'||left(v_profile::text,8),'Stock chain fixture','MANAGER',true);
  INSERT INTO public.categories(id,name,slug) VALUES (v_cat,'SAC fixture','sac-'||left(v_cat::text,8));
  INSERT INTO public.products (id, sku, name, category_id, retail_price, unit, cost_price,
    product_type, is_active, current_stock, track_inventory, deduct_stock) VALUES
    (v_raw,  'SAC-RAW-'||left(v_raw::text,6),  'SAC raw',      v_cat, 0, 'pcs', 1000, 'finished', true, 100, true, true),
    (v_fin,  'SAC-FIN-'||left(v_fin::text,6),  'SAC finished', v_cat, 0, 'pcs', 5000, 'finished', true, 100, true, true),
    (v_zero, 'SAC-ZER-'||left(v_zero::text,6), 'SAC zero',     v_cat, 0, 'pcs', 0,    'finished', true, 100, true, true);
  INSERT INTO public.recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_fin, v_raw, 3, 'pcs', true);
  INSERT INTO public.suppliers(id,code,name) VALUES (v_sup,'SAC-'||left(v_sup::text,8),'SAC supplier');
  INSERT INTO public.purchase_orders(id,po_number,supplier_id) VALUES (v_po,'PO-SAC-'||left(v_po::text,8),v_sup);
  INSERT INTO public.fiscal_periods(period_start,period_end,status) VALUES ('2092-06-01','2092-06-30','closed');
  INSERT INTO _ids VALUES ('profile',v_profile),('raw',v_raw),('fin',v_fin),('zero',v_zero),('po',v_po),
    ('order_raw',gen_random_uuid()),('order_fin',gen_random_uuid()),('order_void',gen_random_uuid()),
    ('order_refund',gen_random_uuid());
END $fixture$;

-- Compte de stock d'un article.
SELECT is(public._stock_inventory_mapping_key_v1((SELECT id FROM _ids WHERE label='raw')),
  'INVENTORY_RAW_MATERIAL','an article without a recipe sits in raw materials');
SELECT is(public._stock_inventory_mapping_key_v1((SELECT id FROM _ids WHERE label='fin')),
  'INVENTORY_FINISHED_GOODS','an article with a recipe sits in finished goods');
SELECT ok(NOT has_function_privilege('anon','public._stock_inventory_mapping_key_v1(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._stock_inventory_mapping_key_v1(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.post_stock_chain_catchup_v1(boolean,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.post_stock_chain_catchup_v1(boolean,uuid)','EXECUTE'),
  'the helper and the catch-up are closed to anon and authenticated');
SELECT isnt(pg_temp.code('SALE_COGS'), NULL, 'the cost-of-sales mapping resolves to an active account');

-- Vente : par le helper réel du chemin de caisse.
SELECT public._record_sale_stock_v1((SELECT id FROM _ids WHERE label='raw'), 2,
  (SELECT id FROM _ids WHERE label='order_raw'), (SELECT id FROM _ids WHERE label='profile'), 'pgTAP sale');
INSERT INTO _ids SELECT 'sale_raw', id FROM public.stock_movements
  WHERE reference_id = (SELECT id FROM _ids WHERE label='order_raw') AND movement_type='sale';
SELECT is(pg_temp.sig('sale_raw'), pg_temp.expect('SALE_COGS','INVENTORY_RAW_MATERIAL',2000),
  'sale of a purchased article: DR cost of sales / CR raw materials');

SELECT public._record_sale_stock_v1((SELECT id FROM _ids WHERE label='fin'), 2,
  (SELECT id FROM _ids WHERE label='order_fin'), (SELECT id FROM _ids WHERE label='profile'), 'pgTAP sale');
INSERT INTO _ids SELECT 'sale_fin', id FROM public.stock_movements
  WHERE reference_id = (SELECT id FROM _ids WHERE label='order_fin') AND movement_type='sale';
SELECT is(pg_temp.sig('sale_fin'), pg_temp.expect('SALE_COGS','INVENTORY_FINISHED_GOODS',10000),
  'sale of a produced article: DR cost of sales / CR finished goods');

-- Annulation et remboursement : par le helper réel de restitution.
SELECT public._restore_sale_stock_v1((SELECT id FROM _ids WHERE label='fin'), 1,
  (SELECT id FROM _ids WHERE label='order_void'), (SELECT id FROM _ids WHERE label='profile'), 'pgTAP void');
INSERT INTO _ids SELECT 'void_fin', id FROM public.stock_movements
  WHERE reference_id = (SELECT id FROM _ids WHERE label='order_void') AND movement_type='sale_void';
SELECT is(pg_temp.sig('void_fin'), pg_temp.expect('INVENTORY_FINISHED_GOODS','SALE_COGS',5000),
  'void: DR finished goods / CR cost of sales');

SELECT public._restore_sale_stock_v1((SELECT id FROM _ids WHERE label='raw'), 1,
  (SELECT id FROM _ids WHERE label='order_refund'), (SELECT id FROM _ids WHERE label='profile'), 'pgTAP refund',
  p_reference_type := 'refunds');
INSERT INTO _ids SELECT 'refund_raw', id FROM public.stock_movements
  WHERE reference_id = (SELECT id FROM _ids WHERE label='order_refund') AND movement_type='sale_void';
SELECT is(pg_temp.sig('refund_raw'), pg_temp.expect('INVENTORY_RAW_MATERIAL','SALE_COGS',1000),
  'refund: DR raw materials / CR cost of sales');

-- Production.
SELECT pg_temp.mv('prod_out_raw','raw','production_out',-3,1000);
SELECT is(pg_temp.sig('prod_out_raw'), pg_temp.expect('PRODUCTION_COGS','INVENTORY_RAW_MATERIAL',3000),
  'production consumes a purchased material: CR raw materials');
SELECT pg_temp.mv('prod_in_fin','fin','production_in',1,3000);
SELECT is(pg_temp.sig('prod_in_fin'), pg_temp.expect('INVENTORY_FINISHED_GOODS','PRODUCTION_COGS',3000),
  'production enters the produced article: DR finished goods');
SELECT pg_temp.mv('prod_out_fin','fin','production_out',-1,5000);
SELECT is(pg_temp.sig('prod_out_fin'), pg_temp.expect('PRODUCTION_COGS','INVENTORY_FINISHED_GOODS',5000),
  'production consumes a produced semi-finished: CR finished goods, not raw materials');

-- Perte, inventaire, ajustement.
SELECT pg_temp.mv('waste_raw','raw','waste',-1,1000);
SELECT is(pg_temp.sig('waste_raw'), pg_temp.expect('WASTE_EXPENSE','INVENTORY_RAW_MATERIAL',1000),
  'waste: CR the article account');
SELECT pg_temp.mv('opname_in_fin','fin','opname_in',1,5000);
SELECT is(pg_temp.sig('opname_in_fin'), pg_temp.expect('INVENTORY_FINISHED_GOODS','OPNAME_INCOME',5000),
  'stock count gain: DR the article account');
SELECT pg_temp.mv('opname_out_raw','raw','opname_out',-2,1000);
SELECT is(pg_temp.sig('opname_out_raw'), pg_temp.expect('OPNAME_EXPENSE','INVENTORY_RAW_MATERIAL',2000),
  'stock count loss: CR the article account');
SELECT pg_temp.mv('adj_in_raw','raw','adjustment_in',1,1000);
SELECT is(pg_temp.sig('adj_in_raw'), pg_temp.expect('INVENTORY_RAW_MATERIAL','ADJUSTMENT_INCOME',1000),
  'positive adjustment: DR the article account');
SELECT pg_temp.mv('adj_out_fin','fin','adjustment_out',-1,5000);
SELECT is(pg_temp.sig('adj_out_fin'), pg_temp.expect('ADJUSTMENT_EXPENSE','INVENTORY_FINISHED_GOODS',5000),
  'negative adjustment: CR the article account');

-- Réception.
INSERT INTO public.goods_receipt_notes(id,grn_number,po_id,subtotal,vat_amount,total)
VALUES (gen_random_uuid(),'GRN-SAC-'||left(gen_random_uuid()::text,8),(SELECT id FROM _ids WHERE label='po'),10000,1100,11100);
SELECT is((SELECT string_agg(CASE WHEN l.debit>0 THEN 'DR ' ELSE 'CR ' END||a.code||' '||(l.debit+l.credit)::int,' / ' ORDER BY l.debit DESC)
    FROM public.journal_entries je JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
    JOIN public.accounts a ON a.id=l.account_id
   WHERE je.reference_type='purchase' AND je.reference_id IN
     (SELECT id FROM public.goods_receipt_notes WHERE po_id=(SELECT id FROM _ids WHERE label='po'))),
  pg_temp.expect('INVENTORY_RAW_MATERIAL','PURCHASE_PAYABLE',11100),
  'receipt: DR raw materials for the full cost, PPN folded');

-- Limites et garde-fous.
SELECT pg_temp.mv('sale_zero','zero','sale',-1);
SELECT is(pg_temp.sig('sale_zero'), NULL, 'an article valued at zero emits no entry');
SELECT pg_temp.mv('sale_import','raw','sale',-1,1000,'{"financial_import_run_id":"00000000-0000-0000-0000-000000000000"}');
SELECT is(pg_temp.sig('sale_import'), NULL, 'a sale movement planned by the historical import emits no cost entry');
SELECT throws_ok($q$ SELECT pg_temp.mv('sale_closed','raw','sale',-1,1000,'{}','2092-06-15 12:00+08') $q$,
  'P0004', NULL, 'a sale dated in a closed period is refused');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE reference_type='stock_movement'
    AND reference_id IN (SELECT id FROM _ids)), 12, 'exactly one entry per valued movement');
SELECT is((SELECT count(*)::int FROM public.journal_entries je
    WHERE je.reference_type='stock_movement' AND je.reference_id IN (SELECT id FROM _ids)
      AND (je.total_debit <> je.total_credit OR je.total_debit <>
           (SELECT sum(debit) FROM public.journal_entry_lines WHERE journal_entry_id=je.id)
        OR je.total_credit <> (SELECT sum(credit) FROM public.journal_entry_lines WHERE journal_entry_id=je.id))),
  0, 'every entry is balanced, header and lines');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines l JOIN public.journal_entries je ON je.id=l.journal_entry_id
    WHERE je.reference_id IN (SELECT id FROM _ids UNION SELECT id FROM public.goods_receipt_notes
                               WHERE po_id=(SELECT id FROM _ids WHERE label='po'))
      AND l.account_id = public.resolve_mapping_account('INVENTORY_GENERAL')),
  0, 'no new stock entry touches the general inventory account');

-- ---------------------------------------------------------------------------
-- Régularisation du passé. On fabrique un « passé » : deux ventes et une
-- annulation sans écriture, une réception et une perte posées sur 1141, une
-- consommation de semi-fini posée sur les matières premières.
-- ---------------------------------------------------------------------------
INSERT INTO _base VALUES ('mid', public.post_stock_chain_catchup_v1(true));
SELECT is(_b.v->'lines', _a.v->'lines', 'movements that already carry an entry add nothing to the catch-up')
  FROM _base _a, _base _b WHERE _a.k='before' AND _b.k='mid';

DELETE FROM public.journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM public.journal_entries
  WHERE reference_type='stock_movement' AND reference_id IN (SELECT id FROM _ids WHERE label IN ('sale_raw','sale_fin','void_fin')));
DELETE FROM public.journal_entries WHERE reference_type='stock_movement'
  AND reference_id IN (SELECT id FROM _ids WHERE label IN ('sale_raw','sale_fin','void_fin'));
UPDATE public.journal_entry_lines l SET account_id = public.resolve_mapping_account('INVENTORY_GENERAL')
  FROM public.journal_entries je
 WHERE je.id = l.journal_entry_id AND l.debit > 0 AND je.reference_type='purchase'
   AND je.reference_id IN (SELECT id FROM public.goods_receipt_notes WHERE po_id=(SELECT id FROM _ids WHERE label='po'));
UPDATE public.journal_entry_lines l SET account_id = public.resolve_mapping_account('INVENTORY_GENERAL')
  FROM public.journal_entries je
 WHERE je.id = l.journal_entry_id AND l.credit > 0 AND je.reference_type='stock_movement'
   AND je.reference_id = (SELECT id FROM _ids WHERE label='waste_raw');
UPDATE public.journal_entry_lines l SET account_id = public.resolve_mapping_account('INVENTORY_RAW_MATERIAL')
  FROM public.journal_entries je
 WHERE je.id = l.journal_entry_id AND l.credit > 0 AND je.reference_type='stock_movement'
   AND je.reference_id = (SELECT id FROM _ids WHERE label='prod_out_fin');

INSERT INTO _base VALUES ('after', public.post_stock_chain_catchup_v1(true));
CREATE FUNCTION pg_temp.delta(p_field text) RETURNS numeric LANGUAGE sql AS $$
  SELECT (a.v->>p_field)::numeric - (b.v->>p_field)::numeric FROM _base a, _base b WHERE a.k='after' AND b.k='before'
$$;
-- Net par compte de l'écriture à blanc, écart avant/après.
CREATE FUNCTION pg_temp.line_delta(p_key text) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE((SELECT (x->>'debit')::numeric - (x->>'credit')::numeric
                     FROM _base a, jsonb_array_elements(a.v->'lines') x
                    WHERE a.k='after' AND x->>'account' = pg_temp.code(p_key)), 0)
       - COALESCE((SELECT (x->>'debit')::numeric - (x->>'credit')::numeric
                     FROM _base b, jsonb_array_elements(b.v->'lines') x
                    WHERE b.k='before' AND x->>'account' = pg_temp.code(p_key)), 0)
$$;
-- Coût des ventes attendu : 2 000 + 10 000 − 5 000.
SELECT is(pg_temp.delta('cogs_recognised'), 7000::numeric, 'the catch-up recognises the cost of sales left without an entry, voids deducted');
SELECT is(pg_temp.delta('sale_movements'), 4::numeric, 'four movements without an entry are seen, the zero-cost one included');
SELECT is(pg_temp.delta('purchases_reclassified'), 11100::numeric, 'the past receipt leaves the general account for raw materials');
SELECT is(pg_temp.line_delta('SALE_COGS'), 7000::numeric, 'net cost-of-sales line');
-- 1141 : − réception 11 100, + perte 1 000 (elle y était créditée).
SELECT is(pg_temp.line_delta('INVENTORY_GENERAL'), -10100::numeric, 'net general-inventory line');
-- 1142 : + réception 11 100, − vente 2 000, − perte 1 000, + semi-fini 5 000.
SELECT is(pg_temp.line_delta('INVENTORY_RAW_MATERIAL'), 13100::numeric, 'net raw-materials line');
-- 1143 : − vente 10 000, + annulation 5 000, − semi-fini 5 000.
SELECT is(pg_temp.line_delta('INVENTORY_FINISHED_GOODS'), -10000::numeric, 'net finished-goods line');

-- Passage réel : une écriture équilibrée, tracée, et un second passage refusé.
INSERT INTO _base VALUES ('real', public.post_stock_chain_catchup_v1(false, (SELECT id FROM _ids WHERE label='profile')));
SELECT ok((SELECT (r.v->>'posted')::boolean
     AND je.total_debit = je.total_credit AND je.total_debit = (r.v->>'total_debit')::numeric
     AND je.total_debit = (SELECT sum(debit) FROM public.journal_entry_lines WHERE journal_entry_id=je.id)
     AND je.total_credit = (SELECT sum(credit) FROM public.journal_entry_lines WHERE journal_entry_id=je.id)
     AND je.metadata->>'kind' = 'stock_chain_catchup'
     AND EXISTS (SELECT 1 FROM public.audit_logs al WHERE al.action='accounting.stock_chain.catchup_posted'
                  AND al.entity_id = je.id AND al.actor_id = (SELECT id FROM _ids WHERE label='profile'))
   FROM _base r JOIN public.journal_entries je ON je.id = (r.v->>'je_id')::uuid WHERE r.k='real'),
  'the real run posts one balanced, audited entry');
SELECT throws_ok($q$ SELECT public.post_stock_chain_catchup_v1(false) $q$,
  'P0003','stock_chain_catchup_already_posted','a second real run is refused');

SELECT * FROM finish();
ROLLBACK;
