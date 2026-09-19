-- Vérification transactionnelle : les fixtures et leurs écritures sont annulées.
BEGIN;
SELECT plan(16);
CREATE TEMP TABLE fixture AS SELECT gen_random_uuid() leaf, gen_random_uuid() sub, gen_random_uuid() top;
CREATE TEMP TABLE results (seq serial, result text);
INSERT INTO products(id,sku,name,category_id,retail_price,unit,product_type,is_active,cost_price,target_gross_margin_pct)
SELECT x.id,x.id::text,'Recipe regression fixture',
 (SELECT id FROM categories WHERE slug='ingredient' LIMIT 1),
 1000,'pcs','finished',false,x.cost,50
FROM fixture CROSS JOIN LATERAL (VALUES(leaf,100),(sub,0),(top,0)) x(id,cost);
INSERT INTO recipes(product_id,material_id,quantity,unit) SELECT sub,leaf,2,'pcs' FROM fixture;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=sub),200::numeric,'recipe insert updates cost');
INSERT INTO recipes(product_id,material_id,quantity,unit) SELECT top,sub,3,'pcs' FROM fixture;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=top),600::numeric,'parent initial cost');
UPDATE recipes SET quantity=4 FROM fixture WHERE product_id=sub;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=sub),400::numeric,'edit updates cost');
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=top),1200::numeric,'edit cascades parent');
INSERT INTO results(result) SELECT is((SELECT count(*) FROM recipe_versions,fixture WHERE product_id=top),2::bigint,'one parent snapshot per edit');
UPDATE products SET cost_price=200 FROM fixture WHERE id=leaf;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=top),2400::numeric,'ingredient price cascades');
INSERT INTO results(result) SELECT is((SELECT count(*) FROM margin_alerts,fixture WHERE product_id=top AND acknowledged_at IS NULL),1::bigint,'single open margin alert');
UPDATE products SET retail_price=10000 FROM fixture WHERE id=top;
INSERT INTO results(result) SELECT is((SELECT count(*) FROM margin_alerts,fixture WHERE product_id=top AND acknowledged_at IS NULL),0::bigint,'price recovery closes alert');
UPDATE recipes SET is_active=false FROM fixture WHERE product_id=sub;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=sub),800::numeric,'last line removed preserves existing valuation');
INSERT INTO results(result) SELECT ok(NOT has_function_privilege('anon','public._snapshot_recipe_and_refresh_cost(uuid,text,uuid)','EXECUTE'),'anonymous cannot invoke internal refresh');
INSERT INTO results(result) SELECT ok(NOT has_function_privilege('authenticated','public._refresh_recipe_margin(uuid,numeric)','EXECUTE'),'authenticated cannot invoke internal margins');
INSERT INTO results(result) SELECT is((SELECT count(*) FROM cron.job WHERE jobname IN ('recompute-recipe-costs-daily','recompute-recipe-margins-daily')),0::bigint,'global recalculation jobs removed');
UPDATE products SET unit='kg' FROM fixture WHERE id=leaf;
UPDATE recipes SET is_active=true, unit='g', quantity=500 FROM fixture WHERE product_id=sub;
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=sub),100::numeric,'grams convert to ingredient stock kilograms');
INSERT INTO results(result) SELECT throws_ok(
 $$UPDATE recipes SET unit='kg', quantity=30000 FROM fixture WHERE product_id=sub$$,
 '22003', 'recipe_cost_out_of_range', 'invalid recipe cost rejects the entire edit');
INSERT INTO results(result) SELECT is((SELECT cost_price FROM products,fixture WHERE id=sub),100::numeric,'rejected edit preserves cost');
INSERT INTO results(result) SELECT is((SELECT quantity FROM recipes,fixture WHERE product_id=sub),500::numeric,'rejected edit preserves quantity');
INSERT INTO results(result) SELECT * FROM finish();
SELECT result FROM results ORDER BY seq;
ROLLBACK;
