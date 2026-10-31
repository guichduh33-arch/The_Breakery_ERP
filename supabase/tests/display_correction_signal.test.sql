-- Mesure les vrais signaux catalogue ; aucune différence no-op/delta, aucun signal au rejeu.
BEGIN;
\ir helpers/display_loss_fixture.sql
CREATE TEMP TABLE signal_snapshots(name text PRIMARY KEY,updates bigint,revision uuid);
CREATE FUNCTION pg_temp.capture_catalog_signal(p_name text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO signal_snapshots SELECT p_name,n_tup_upd,
 (SELECT revision FROM ui_invalidation_topics WHERE topic='catalog')
 FROM pg_stat_xact_user_tables WHERE relid='public.ui_invalidation_topics'::regclass
$$;
DELETE FROM display_stock WHERE product_id IN(SELECT id FROM loss_products WHERE kind IN('missing','loss_first'));
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='cashier'));
SELECT pg_temp.capture_catalog_signal('before');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'changed',adjust_display_stock_v5(id,8,'Signal changed count',key) FROM loss_products WHERE kind='main';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('changed');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'noop',adjust_display_stock_v5(id,8,'Signal identical count',gen_random_uuid()) FROM loss_products WHERE kind='main';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('noop');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'inserted',adjust_display_stock_v5(id,5,'Signal missing shelf',key) FROM loss_products WHERE kind='missing';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('inserted');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'inserted_zero',adjust_display_stock_v5(id,0,'Signal missing zero shelf',key) FROM loss_products WHERE kind='loss_first';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('inserted_zero');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'replay',adjust_display_stock_v5(id,8,'Signal changed count',key) FROM loss_products WHERE kind='main';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('replay');
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'zero_replay',adjust_display_stock_v5(id,0,'Signal missing zero shelf',key) FROM loss_products WHERE kind='loss_first';
RESET ROLE;
SELECT pg_temp.capture_catalog_signal('zero_replay');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM signal_snapshots),7::bigint,'Every signal measurement exists');
INSERT INTO loss_results(tap) SELECT ok((SELECT updates FROM signal_snapshots WHERE name='changed')>(SELECT updates FROM signal_snapshots WHERE name='before'),'Fresh changed count emits catalogue invalidation');
INSERT INTO loss_results(tap) SELECT is((SELECT updates FROM signal_snapshots WHERE name='noop')-(SELECT updates FROM signal_snapshots WHERE name='changed'),(SELECT updates FROM signal_snapshots WHERE name='changed')-(SELECT updates FROM signal_snapshots WHERE name='before'),'Existing-row no-op emits exactly as many signals as changed count');
INSERT INTO loss_results(tap) SELECT is((SELECT updates FROM signal_snapshots WHERE name='inserted')-(SELECT updates FROM signal_snapshots WHERE name='noop'),(SELECT updates FROM signal_snapshots WHERE name='changed')-(SELECT updates FROM signal_snapshots WHERE name='before'),'Missing-row correction has the same signal count');
INSERT INTO loss_results(tap) SELECT is((SELECT updates FROM signal_snapshots WHERE name='inserted_zero')-(SELECT updates FROM signal_snapshots WHERE name='inserted'),(SELECT updates FROM signal_snapshots WHERE name='changed')-(SELECT updates FROM signal_snapshots WHERE name='before'),'Missing-row zero no-op has the same signal count');
INSERT INTO loss_results(tap) SELECT isnt((SELECT revision FROM signal_snapshots WHERE name='noop'),(SELECT revision FROM signal_snapshots WHERE name='changed'),'No-op changes publicly observable revision');
INSERT INTO loss_results(tap) SELECT is((SELECT updates FROM signal_snapshots WHERE name='replay'),(SELECT updates FROM signal_snapshots WHERE name='inserted_zero'),'Changed-count replay emits no catalogue signal');
INSERT INTO loss_results(tap) SELECT is((SELECT revision FROM signal_snapshots WHERE name='replay'),(SELECT revision FROM signal_snapshots WHERE name='inserted_zero'),'Replay leaves observable revision unchanged');
INSERT INTO loss_results(tap) SELECT is((SELECT updates FROM signal_snapshots WHERE name='zero_replay'),(SELECT updates FROM signal_snapshots WHERE name='replay'),'Zero-count replay emits no catalogue signal');
INSERT INTO loss_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='loss_first')),0::numeric,'Missing zero shelf is materialized');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM display_movements WHERE product_id=(SELECT id FROM loss_products WHERE kind='loss_first')),0::bigint,'Zero count creates no fake movement');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM display_movements WHERE product_id=(SELECT id FROM loss_products WHERE kind='main')),1::bigint,'Existing no-op and replay add no ledger entries');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM stock_movements WHERE product_id IN(SELECT id FROM loss_products)),0::bigint,'Signal uniformity creates no global stock movements');
INSERT INTO loss_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM loss_payload WHERE value ?| ARRAY['noop','delta','previous_qty','display_movement_id']),'Every hidden response omits equality signals');
INSERT INTO loss_results(tap) SELECT is((SELECT value->>'effect_id' FROM loss_payload WHERE name='replay'),(SELECT value->>'effect_id' FROM loss_payload WHERE name='changed'),'Changed-count replay retains opaque effect ID');
INSERT INTO loss_results(tap) SELECT is((SELECT value->>'effect_id' FROM loss_payload WHERE name='zero_replay'),(SELECT value->>'effect_id' FROM loss_payload WHERE name='inserted_zero'),'Zero-count replay retains opaque effect ID');
INSERT INTO loss_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,jsonb_agg(tap ORDER BY seq) lines FROM loss_results;
ROLLBACK;
