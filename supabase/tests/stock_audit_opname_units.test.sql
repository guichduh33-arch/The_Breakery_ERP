-- Régressions : revue figée, notes effaçables, bornes de saisie, unités et signes.
BEGIN;
SELECT plan(18);

CREATE FUNCTION pg_temp.stock_audit() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_uid uuid;
  v_count uuid;
  v_item uuid;
  v_product uuid := gen_random_uuid();
  v_kg uuid := gen_random_uuid();
  v_json jsonb;
BEGIN
  SELECT auth_user_id INTO STRICT v_uid FROM user_profiles WHERE employee_code = 'EMP000';
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  INSERT INTO products (id, sku, name, category_id, retail_price, unit, track_inventory, cost_price)
    VALUES (v_product, 'AUDIT-' || v_product::text, 'Audit stock pcs', (SELECT id FROM categories LIMIT 1), 1000, 'pcs', true, 0),
           (v_kg, 'AUDIT-' || v_kg::text, 'Audit stock kg', (SELECT id FROM categories LIMIT 1), 1000, 'kg', true, 0);

  v_count := (create_opname_v2('Audit stock') ->> 'count_id')::uuid;
  RETURN NEXT throws_ok(format('SELECT validate_opname_v2(%L)', v_count), 'P0001', 'empty_count', 'Inventaire vide refusé');
  v_item := (add_opname_item_v2(v_count, v_product) ->> 'item_id')::uuid;
  RETURN NEXT throws_ok(format('SELECT validate_opname_v2(%L)', v_count), 'P0001', 'missing_counts', 'Ligne non comptée refusée');
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, -1)', v_item), 'P0001', 'counted_qty_invalid', 'Négatif refusé');
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, 1.0001)', v_item), 'P0001', 'counted_qty_invalid', 'Précision excédentaire refusée');
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, %L::numeric)', v_item, 'NaN'), 'P0001', 'counted_qty_invalid', 'NaN refusé');
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, 10000000)', v_item), 'P0001', 'counted_qty_invalid', 'Dépassement de capacité refusé');
  PERFORM set_opname_count_v2(v_item, 1.375, 'Original note');
  RETURN NEXT is((SELECT counted_qty FROM inventory_count_items WHERE id = v_item), 1.375::numeric, 'Trois décimales conservées');
  PERFORM set_opname_count_v2(v_item, 0, '');
  RETURN NEXT ok((SELECT counted_qty = 0 AND notes IS NULL FROM inventory_count_items WHERE id = v_item), 'Zéro explicite et suppression de note enregistrés');
  PERFORM validate_opname_v2(v_count);
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, 4)', v_item), 'P0001', 'set_count_not_allowed_in_status', 'Écriture après révélation refusée');
  RETURN NEXT is((SELECT counted_qty FROM inventory_count_items WHERE id = v_item), 0::numeric, 'Refus sans modification du comptage');

  PERFORM record_incoming_stock_v2(p_product_id := v_product, p_quantity := 10, p_reason := 'Audit incoming', p_idempotency_key := gen_random_uuid());
  PERFORM record_incoming_stock_v2(p_product_id := v_kg, p_quantity := 2.5, p_reason := 'Audit incoming', p_idempotency_key := gen_random_uuid());
  PERFORM adjust_stock_v2(v_product, 12, 'Audit positive', gen_random_uuid());
  PERFORM adjust_stock_v2(v_product, 11, 'Audit negative', gen_random_uuid());
  v_json := get_movement_aggregates_v3(p_product_id := v_product, p_movement_type := 'adjustment');
  RETURN NEXT is(jsonb_array_length(v_json), 2, 'Ajustements positifs et négatifs séparés');
  RETURN NEXT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(v_json) r WHERE r->>'unit' = 'pcs' AND (r->>'direction')::int = 1 AND (r->>'qty_total')::numeric = 2), 'Entrée classée par signe');
  RETURN NEXT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(v_json) r WHERE (r->>'direction')::int = -1 AND (r->>'qty_total')::numeric = 1), 'Sortie classée par signe');
  v_json := get_movement_aggregates_v3(p_product_id := v_kg);
  RETURN NEXT ok(jsonb_array_length(v_json) = 1 AND v_json->0->>'unit' = 'kg' AND (v_json->0->>'qty_total')::numeric = 2.5, 'Quantité conservée dans son unité');
  RETURN NEXT is(get_movement_aggregates_v3(p_product_id := v_kg, p_date_end := now()), '[]'::jsonb, 'Borne de fin exclusive');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN NEXT throws_ok(format('SELECT set_opname_count_v2(%L, 0)', v_item), 'P0003', 'forbidden', 'Comptage sans permission refusé');
  RETURN NEXT throws_ok(format('SELECT validate_opname_v2(%L)', v_count), 'P0003', 'forbidden', 'Validation sans permission refusée');
  RETURN NEXT throws_ok('SELECT get_movement_aggregates_v3()', 'P0003', 'forbidden', 'Agrégats sans permission refusés');
END;
$$;
CREATE TEMP TABLE audit_results (seq serial, tap text);
INSERT INTO audit_results(tap) SELECT * FROM pg_temp.stock_audit();
INSERT INTO audit_results(tap) SELECT * FROM finish();
SELECT tap FROM audit_results ORDER BY seq;
ROLLBACK;
