-- =========================================================================
-- T26 — une cle rejouee avec un autre motif est refusee ; le mouvement reste intact.
-- =========================================================================
DO $t26$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key   UUID := '00000000-0000-0000-0000-000000000a26'::uuid;
  v_r1    JSONB;
  v_r2    JSONB;
  v_row_count INT;
  v_stored_reason TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
  DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM stock_declarations WHERE idempotency_key=v_key);

  SELECT pg_temp.approved_adjustment(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 13, 'T26 original reason', v_key
  ) INTO v_r1;
  BEGIN
    PERFORM pg_temp.approved_adjustment(
      '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 13, 'T26 DIFFERENT reason on replay', v_key
    );
    v_r2 := '{"conflict": false}'::jsonb;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_r2 := jsonb_build_object('conflict', SQLERRM = 'idempotency_conflict');
  END;
  SELECT COUNT(*) INTO v_row_count FROM stock_movements WHERE reference_id IN (SELECT id FROM stock_declarations WHERE idempotency_key=v_key);
  SELECT reason INTO v_stored_reason FROM stock_movements WHERE reference_id IN (SELECT id FROM stock_declarations WHERE idempotency_key=v_key);

  PERFORM set_config('breakery.t26_pass',
    CASE WHEN
      (v_r2->>'conflict')::boolean = true
      AND v_row_count = 1
      AND v_stored_reason = 'T26 original reason'
    THEN 'true' ELSE 'false' END, false);
END $t26$;
SELECT ok(current_setting('breakery.t26_pass')::boolean,
  'T26: adjust_stock_v5 rejects key reuse with a different reason (original movement unchanged)');

-- =========================================================================
-- T27 — waste_stock with short reason (< 3 chars) -> reason_required
-- =========================================================================
DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
  UPDATE products SET current_stock = 20
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT pg_temp.approved_waste(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 1.000, 'ab'
     ) $$,
  NULL,
  'reason_required',
  'T27: waste_stock rejects reason shorter than 3 chars with reason_required'
);

-- =========================================================================
-- T28 — waste_stock qty > current_stock -> insufficient_stock P0002
-- Uses PGTAP-PROD-LOW (stock=5) to keep PGTAP-PROD-1 state independent.
-- =========================================================================
DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
  UPDATE products SET current_stock = 5
    WHERE id = '99999999-aaaa-bbbb-cccc-333333333333'::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT pg_temp.approved_waste(
       '99999999-aaaa-bbbb-cccc-333333333333'::uuid, 100.000, 'T28 over-waste'
     ) $$,
  'P0002',
  'insufficient_stock',
  'T28: waste_stock rejects qty > current_stock with insufficient_stock (distinct product)'
);

-- =========================================================================
-- ADR-027 : T29-T40 (create/receive/cancel_internal_transfer_v1, RLS sur
-- internal_transfers, permission gate inventory.transfer.*) supprimés —
-- feature transferts + tables section_stock/internal_transfers/transfer_items
-- droppées. Numéros laissés vacants (voir note d'en-tête).
-- =========================================================================

-- =========================================================================
-- T41 — ADR-024 déc. 4 : parité compteurs / lignes, panier par panier.
-- C'est LE garde-fou de la décision 1 : les règles de sélection du catalogue
-- vivent dans deux fonctions, et une règle ajoutée à l'une sans l'autre ferait
-- annoncer un nombre que la liste contredit. Ce test refuse la fusion.
-- =========================================================================
DO $t41$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  c RECORD;
  v_all BIGINT; v_low BIGINT; v_zero BIGINT; v_neg BIGINT; v_untracked BIGINT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  SELECT * INTO c FROM get_stock_counters_v3(NULL, NULL);

  SELECT COUNT(*) INTO v_all       FROM get_stock_levels_v6(NULL, NULL, 'all',       100000, 0);
  SELECT COUNT(*) INTO v_low       FROM get_stock_levels_v6(NULL, NULL, 'low',       100000, 0);
  SELECT COUNT(*) INTO v_zero      FROM get_stock_levels_v6(NULL, NULL, 'zero',      100000, 0);
  SELECT COUNT(*) INTO v_neg       FROM get_stock_levels_v6(NULL, NULL, 'negative',  100000, 0);
  SELECT COUNT(*) INTO v_untracked FROM get_stock_levels_v6(NULL, NULL, 'untracked', 100000, 0);

  PERFORM set_config('breakery.t41_pass',
    (c.total_count     = v_all
     AND c.low_count       = v_low
     AND c.zero_count      = v_zero
     AND c.negative_count  = v_neg
     AND c.untracked_count = v_untracked)::text, false);
END $t41$;
SELECT ok(current_setting('breakery.t41_pass')::boolean,
  'T41: get_stock_counters_v3 equals the row count of get_stock_levels_v6 for every bucket');

-- =========================================================================
-- T42 — ADR-021 déc. 6 : toute garde ajoutée porte son test NÉGATIF. La
-- fonction de compteurs est neuve ; prouver qu'elle répond ne suffit pas, il
-- faut prouver qu'elle refuse.
-- =========================================================================
DO $t42$
DECLARE
  v_cashier UUID;
  v_blocked BOOLEAN := false;
BEGIN
  SELECT auth_user_id INTO v_cashier FROM user_profiles WHERE employee_code = 'EMP001';
  PERFORM pg_temp.set_jwt_uid(v_cashier);
  BEGIN
    PERFORM * FROM get_stock_counters_v3(NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := (SQLSTATE = 'P0003' AND SQLERRM = 'stock_visibility_owner_required');
  END;
  PERFORM set_config('breakery.t42_pass', v_blocked::text, false);
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
END $t42$;
SELECT ok(current_setting('breakery.t42_pass')::boolean,
  'T42: CASHIER without inventory.read receives stock_visibility_owner_required (P0003) from get_stock_counters_v3');

-- ---------------------------------------------------------------------------
SELECT * FROM finish();
