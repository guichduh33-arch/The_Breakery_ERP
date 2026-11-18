-- S1-08, paquets 2 et 3 (ADR-039) : les lectures du stock et des états
-- financiers se délèguent par permission. Les comptes, dérogations et lignes
-- de ce test disparaissent avec le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
\ir helpers/released_report_days.sql
SELECT no_plan();
-- Les journées lues sont clôturées : la confidentialité de la journée en cours
-- (hors périmètre d'ADR-039) ne se mêle pas aux refus testés ici.
SELECT pg_temp.fixture_released_days(current_date-366,current_date);
CREATE TEMP TABLE s18_results(seq serial,tap text);
CREATE TEMP TABLE s18_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@s108-reads.invalid' FROM s18_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'S108R-'||id,'S1-08 reads fixture','invalid-test-hash',role_code,true FROM s18_actors;
-- Le délégué : toutes les permissions, sauf les deux vues sous test, refusées par
-- dérogation. Une dérogation l'emporte sur le rôle : le test ne dépend pas de la
-- matrice vivante (en dev, ADMIN et MANAGER détiennent reports.inventory.read).
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,p.code NOT IN('reports.inventory.read','reports.statements.read'),'S1-08 reads coverage'
 FROM s18_actors a CROSS JOIN public.permissions p WHERE a.role_code='CASHIER'
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=EXCLUDED.is_granted,expires_at=NULL;
-- Le propriétaire du test détient les deux permissions, quelle que soit la matrice vivante.
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
 SELECT 'SUPER_ADMIN',c,true FROM unnest(ARRAY['reports.inventory.read','reports.statements.read']) c
 ON CONFLICT(role_code,permission_code) DO UPDATE SET is_granted=true;

-- Une recette connue : le détail de recette masque le stock sans la permission.
CREATE TEMP TABLE s18_ids AS SELECT gen_random_uuid() material_id,gen_random_uuid() finished_id;
INSERT INTO public.products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit)
 SELECT material_id,'S108R-M-'||material_id,'S1-08 material',(SELECT id FROM public.categories LIMIT 1),0,100,7,'pcs' FROM s18_ids
 UNION ALL
 SELECT finished_id,'S108R-F-'||finished_id,'S1-08 finished',(SELECT id FROM public.categories LIMIT 1),1000,0,0,'pcs' FROM s18_ids;
INSERT INTO public.recipes(product_id,material_id,quantity,unit)
 SELECT finished_id,material_id,2,'pcs' FROM s18_ids;

-- L'échantillon : trois lectures du stock, trois des états financiers.
CREATE TEMP TABLE s18_calls(name text,kind text,sql text);
INSERT INTO s18_calls VALUES
 ('get_stock_levels_v7','stock','SELECT count(*) FROM public.get_stock_levels_v7()'),
 ('get_stock_movements_v7','stock','SELECT public.get_stock_movements_v7((current_date-7)::text,current_date::text)'),
 ('get_general_ledger_v5 on 1141','stock',
  'SELECT public.get_general_ledger_v5((SELECT id FROM public.accounts WHERE code=''1141''),current_date-30,current_date)'),
 ('get_balance_sheet_v6','statements','SELECT public.get_balance_sheet_v6(current_date)'),
 ('get_profit_loss_v5','statements','SELECT public.get_profit_loss_v5(current_date-30,current_date)'),
 ('get_pb1_report_v7','statements','SELECT public.get_pb1_report_v7(1,2000)');
GRANT ALL ON s18_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE s18_results_seq_seq TO authenticated;
GRANT SELECT ON s18_actors,s18_ids,s18_calls TO authenticated;

-- Refus attendu selon la famille : stock (P0003) ou états financiers (42501).
CREATE FUNCTION pg_temp.s18_denied(p_kind text,p_sql text,p_label text) RETURNS text
LANGUAGE sql AS $$
 SELECT CASE p_kind
  WHEN 'stock' THEN throws_ok(p_sql,'P0003','stock_visibility_required',p_label)
  ELSE throws_ok(p_sql,'42501','financial_statements_required',p_label) END $$;
GRANT EXECUTE ON FUNCTION pg_temp.s18_denied(text,text,text) TO authenticated;
CREATE FUNCTION pg_temp.s18_recipe_stock() RETURNS numeric LANGUAGE sql AS $$
 SELECT current_stock FROM public.recipe_bom_full_v6((SELECT finished_id FROM s18_ids))
 WHERE material_id=(SELECT material_id FROM s18_ids) $$;
GRANT EXECUTE ON FUNCTION pg_temp.s18_recipe_stock() TO authenticated;

-- 1. Délégué sans les deux permissions : chaque lecture est refusée avec son message.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s18_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO s18_results(tap) SELECT pg_temp.s18_denied(kind,sql,'Delegate without permissions denied: '||name) FROM s18_calls;
INSERT INTO s18_results(tap) SELECT is(pg_temp.s18_recipe_stock(),NULL::numeric,
 'recipe_bom_full_v6 masks current stock without reports.inventory.read');
INSERT INTO s18_results(tap) SELECT lives_ok(
 'SELECT public.get_general_ledger_v5((SELECT id FROM public.accounts WHERE code=''1110''),current_date-30,current_date)',
 'get_general_ledger_v5 keeps non-stock accounts open without reports.inventory.read');
RESET ROLE;

-- 2. Délégation du stock seule : le stock s'ouvre, les états restent fermés.
UPDATE public.user_permission_overrides SET is_granted=true
 WHERE user_profile_id=(SELECT id FROM s18_actors WHERE role_code='CASHIER') AND permission_code='reports.inventory.read';
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s18_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO s18_results(tap) SELECT lives_ok(sql,'reports.inventory.read opens: '||name) FROM s18_calls WHERE kind='stock';
INSERT INTO s18_results(tap) SELECT pg_temp.s18_denied(kind,sql,'Stock delegation keeps statements closed: '||name)
 FROM s18_calls WHERE kind='statements';
INSERT INTO s18_results(tap) SELECT is(pg_temp.s18_recipe_stock(),7::numeric,
 'recipe_bom_full_v6 shows current stock with reports.inventory.read');
RESET ROLE;

-- 3. Délégation des états seule : les états s'ouvrent, le stock se referme.
UPDATE public.user_permission_overrides SET is_granted=(permission_code='reports.statements.read')
 WHERE user_profile_id=(SELECT id FROM s18_actors WHERE role_code='CASHIER')
  AND permission_code IN('reports.inventory.read','reports.statements.read');
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s18_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO s18_results(tap) SELECT lives_ok(sql,'reports.statements.read opens: '||name) FROM s18_calls WHERE kind='statements';
INSERT INTO s18_results(tap) SELECT pg_temp.s18_denied(kind,sql,'Statements delegation keeps stock closed: '||name)
 FROM s18_calls WHERE kind='stock';
-- Le journal des coffres suit le grand livre : un compte de stock exige aussi la vue du stock.
INSERT INTO s18_results(tap) SELECT pg_temp.s18_denied('stock',
 'SELECT count(*) FROM public.get_cash_wallet_ledger_v5(''1141'',current_date-30,current_date)',
 'get_cash_wallet_ledger_v5 keeps stock accounts closed without reports.inventory.read');
INSERT INTO s18_results(tap) SELECT lives_ok(
 'SELECT count(*) FROM public.get_cash_wallet_ledger_v5(''1110'',current_date-30,current_date)',
 'get_cash_wallet_ledger_v5 opens cash accounts with reports.statements.read');
RESET ROLE;

-- 4. Le propriétaire lit tout.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM s18_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO s18_results(tap) SELECT lives_ok(sql,'Owner reads: '||name) FROM s18_calls;
INSERT INTO s18_results(tap) SELECT is(pg_temp.s18_recipe_stock(),7::numeric,'Owner sees recipe current stock');
RESET ROLE;

-- 5. Les 29 nouvelles versions : aucun droit anon ni PUBLIC, plus de test de rôle
-- propriétaire, sauf le journal des mouvements (confidentialité de la journée).
CREATE TEMP TABLE s18_functions AS SELECT p.oid,p.proname,p.prosrc FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[
  'get_display_stock_activity_v4','get_low_stock_v5','get_movement_aggregates_v6','get_product_analytics_v5',
  'get_product_dashboard_v8','get_production_suggestions_v4','get_production_vs_sales_v5','get_reorder_suggestions_v4',
  'get_stock_config_issues_v5','get_stock_counters_v4','get_stock_levels_v7','get_stock_movement_ledger_v5',
  'get_stock_movements_v7','get_stock_position_v4','get_stock_variance_v6','get_general_ledger_v5',
  'get_dashboard_overview_v8','recipe_bom_full_v6','recipe_direct_cost_v4','search_ingredients_v4',
  'get_dashboard_action_queue_v4','get_balance_sheet_v6','get_cash_flow_v5','get_cash_wallet_ledger_v5',
  'get_profit_loss_v5','get_trial_balance_v6','get_gross_margin_by_product_v6','calculate_pb1_payable_v6',
  'get_pb1_report_v7']);
INSERT INTO s18_results(tap) SELECT is((SELECT count(DISTINCT proname) FROM s18_functions),29::bigint,
 'The 29 new read versions exist');
INSERT INTO s18_results(tap) SELECT is((SELECT string_agg(proname,',' ORDER BY proname) FROM s18_functions
 WHERE has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('public',oid,'EXECUTE')),NULL::text,
 'No new read version is executable by anon or PUBLIC');
INSERT INTO s18_results(tap) SELECT ok((SELECT bool_and(has_function_privilege('authenticated',oid,'EXECUTE')) FROM s18_functions),
 'Every new read version is executable by authenticated');
INSERT INTO s18_results(tap) SELECT is((SELECT string_agg(proname,',' ORDER BY proname) FROM s18_functions
 WHERE prosrc ~ 'assert_stock_owner_v1|is_business_owner_v1'),'get_stock_movement_ledger_v5',
 'Only the movement ledger keeps an owner test (open business day)');
INSERT INTO s18_results(tap) SELECT is((SELECT count(*) FROM s18_functions
 WHERE prosrc ~ 'assert_stock_visible_v1|can_view_stock_v2|assert_statements_visible_v1'),29::bigint,
 'Every new read version goes through a permission-based visibility guard');

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM s18_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
