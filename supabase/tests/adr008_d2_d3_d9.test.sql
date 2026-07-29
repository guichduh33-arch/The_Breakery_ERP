-- supabase/tests/adr008_d2_d3_d9.test.sql
-- ADR-008 D2 + D3 + D9 — migrations 20260729000004 (enum waste_reason + colonne
-- + contrainte) et 20260729000005 (record_production_v5,
-- record_batch_production_v7).
--
-- D2 : la part ratée d'une production n'est plus capitalisée dans le stock de
--      produits finis. Le `production_in` ne porte que le coût de ce qui est
--      réellement produit, et le reste est reclassé par une écriture
--      DR 5210 Waste Expense / CR 5110 Production COGS. Le compte 5110 reste
--      soldé : ce lot déplace une valeur, il n'en crée pas.
-- D3 : `waste_reason` est un enum Postgres, obligatoire dès que
--      `quantity_waste > 0`, refusé côté RPC (waste_reason_required) comme côté
--      table (contrainte production_records_waste_reason_required).
-- D9 : D9.1 idempotence rattrapée sur unique_violation ; D9.3 la RPC nettoie
--      elle-même ses tables temporaires, donc deux appels successifs dans une
--      même transaction ne se marchent plus dessus.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS COUVERT, ET POURQUOI
-- ---------------------------------------------------------------------------
-- La BRANCHE DE COURSE de D9.1 (deux transactions concurrentes portant la même
-- clé d'idempotence, la seconde tombant dans `EXCEPTION WHEN unique_violation`)
-- n'est pas atteignable depuis une suite mono-transactionnelle : le SELECT de
-- tête voit toujours la ligne déjà validée et répond par le chemin rapide.
-- T12 couvre donc le chemin rapide ; la branche de rattrapage reste vérifiée par
-- lecture du corps. Ne pas la re-signaler comme un trou sans un harnais
-- multi-session.
--
-- Coverage matrix :
--   1  D3 : refus RPC sans cause (T1), enregistrement de la cause (T2), refus
--      au niveau de la table elle-même (T8), refus au bord du lot avec la ligne
--      nommée (T9) et valeur d'enum inconnue (T10).
--   2  D2 : valorisation du production_in au prorata (T3), écriture de
--      reclassement DR 5210 / CR 5110 (T4-T5), solde de 5110 (T6), rattachement
--      au mouvement production_in (T7), non-régression sans raté (T11).
--   3  D9 : deux appels successifs sans flush des tables temporaires (T13),
--      replay idempotent (T12).
--   4  droits : anon révoqué / authenticated conservé sur _v5 et _v7,
--      record_production_v4 / record_batch_production_v6 absentes (T14).
--
-- Fixture : mat (matière, kg, coût 1000/kg, 1000 en stock)
--           fin (fini, pcs) <- 0.1 kg de mat par pcs
--   Produire 10 avec 2 ratés consomme 12 x 0.1 = 1.2 kg, soit 1200 de matière.
--   Part ratée = 1200 x 2/12 = 200. Capitalisé = 1000, soit 100 par pièce.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Bootstrap : section + catégorie actives.
-- ---------------------------------------------------------------------------
DO $bootstrap$
DECLARE
  v_section  UUID;
  v_category UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles
                  WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'
                    AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Seed user 00000000-…-001 (EMP000) not found';
  END IF;

  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  IF v_section IS NULL THEN
    RAISE EXCEPTION 'No active section — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.section_id', v_section::text, false);

  SELECT id INTO v_category FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'No active category — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.category_id', v_category::text, false);
END $bootstrap$;

-- ---------------------------------------------------------------------------
-- Fixture. `track_inventory` est déclaré explicitement : sous ADR-016 la valeur
-- par défaut de la colonne changerait la règle de descente et fausserait les
-- attentes en silence.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ids(label text PRIMARY KEY, id uuid) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_cat uuid := current_setting('breakery.category_id')::uuid;
  v_mat uuid := gen_random_uuid();
  v_fin uuid := gen_random_uuid();
  v_nw  uuid := gen_random_uuid();
BEGIN
  INSERT INTO products (
    id, sku, name, category_id, retail_price, unit, cost_price,
    product_type, is_active, current_stock, track_inventory, deduct_stock
  ) VALUES
    (v_mat, 'D2D3-MAT', 'D2D3 Matiere',        v_cat, 0, 'kg',  1000, 'finished', true, 1000, true, true),
    (v_fin, 'D2D3-FIN', 'D2D3 Fini',           v_cat, 0, 'pcs', 0,    'finished', true, 0,    true, true),
    (v_nw,  'D2D3-NW',  'D2D3 Fini Sans Rate', v_cat, 0, 'pcs', 0,    'finished', true, 0,    true, true);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_fin, v_mat, 0.1, 'kg', true),
    (v_nw,  v_mat, 0.1, 'kg', true);

  INSERT INTO _ids VALUES ('mat', v_mat), ('fin', v_fin), ('nw', v_nw);
END $fixture$;

-- ===========================================================================
-- D3 — un raté sans cause est refusé par la RPC.
-- ===========================================================================
DO $chk_d3_refus$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_fin     UUID := (SELECT id FROM _ids WHERE label='fin');
  v_errmsg  TEXT := '';
  v_errcode TEXT := '';
BEGIN
  BEGIN
    PERFORM record_production_v5(
      p_product_id := v_fin, p_quantity_produced := 10,
      p_section_id := v_section, p_batch_number := 'D2D3-NOREASON',
      p_quantity_waste := 2
    );
  EXCEPTION WHEN OTHERS THEN
    v_errmsg  := SQLERRM;
    v_errcode := SQLSTATE;
  END;
  PERFORM set_config('breakery.d3_err', v_errmsg || '|' || v_errcode, false);
END $chk_d3_refus$;

SELECT is(current_setting('breakery.d3_err'), 'waste_reason_required|P0001',
  'T1: ADR-008 D3 — a production declaring waste without a reason raises waste_reason_required (P0001)');

-- ===========================================================================
-- D2 + D3 — production nominale : 10 produits, 2 ratés, cause déclarée.
-- ===========================================================================
DO $chk_d2$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_fin     UUID := (SELECT id FROM _ids WHERE label='fin');
  v_result  JSONB;
  v_prod_id UUID;
BEGIN
  v_result := record_production_v5(
    p_product_id := v_fin, p_quantity_produced := 10,
    p_section_id := v_section, p_batch_number := 'D2D3-OK',
    p_quantity_waste := 2, p_waste_reason := 'mis_baked'
  );
  v_prod_id := (v_result->>'production_id')::uuid;
  PERFORM set_config('breakery.d2_prod_id', v_prod_id::text, false);
  PERFORM set_config('breakery.d2_waste_expense', (v_result->>'waste_expense'), false);
END $chk_d2$;

SELECT is(
  (SELECT waste_reason::text FROM production_records
    WHERE id = current_setting('breakery.d2_prod_id')::uuid),
  'mis_baked',
  'T2: ADR-008 D3 — the declared cause is persisted on production_records.waste_reason'
);

-- 1.2 kg consommés à 1000/kg = 1200 ; part ratée 2/12 = 200 ; reste 1000 pour
-- 10 pièces, soit 100 la pièce.
SELECT is(
  (SELECT unit_cost FROM stock_movements
    WHERE metadata->>'production_id' = current_setting('breakery.d2_prod_id')
      AND movement_type = 'production_in'),
  100::numeric,
  'T3: ADR-008 D2 — production_in is valued at the produced share only (100/pcs, not 120)'
);

SELECT is(current_setting('breakery.d2_waste_expense')::numeric, 200::numeric,
  'T4: ADR-008 D2 — the RPC reports the reclassified waste cost (1200 x 2/12 = 200)');

SELECT is(
  (SELECT MAX(CASE WHEN l.debit  > 0 THEN a.code END)
          || '/' || MAX(CASE WHEN l.credit > 0 THEN a.code END)
          || '/' || MAX(l.debit + l.credit)::numeric(14,2)::text
     FROM journal_entries je
     JOIN journal_entry_lines l ON l.journal_entry_id = je.id
     JOIN accounts a ON a.id = l.account_id
    WHERE je.metadata->>'production_id' = current_setting('breakery.d2_prod_id')
      AND je.metadata->>'movement_type' = 'production_waste'),
  '5210/5110/200.00',
  'T5: ADR-008 D2 — the reclassification posts DR 5210 Waste Expense / CR 5110 Production COGS for 200'
);

-- Le compte 5110 est un compte de passage : ce que les production_out y portent
-- au débit doit ressortir au crédit, entre le production_in et le waste.
SELECT is(
  (SELECT COALESCE(SUM(l.debit - l.credit), 0)
     FROM journal_entries je
     JOIN journal_entry_lines l ON l.journal_entry_id = je.id
     JOIN accounts a ON a.id = l.account_id
    WHERE a.code = '5110'
      AND (je.metadata->>'production_id' = current_setting('breakery.d2_prod_id')
           OR je.reference_id IN (SELECT id FROM stock_movements
                                   WHERE metadata->>'production_id' = current_setting('breakery.d2_prod_id')))),
  0::numeric,
  'T6: ADR-008 D2 — account 5110 nets to zero across the production (nothing created, only reclassified)'
);

-- Le rattachement au mouvement production_in n'est pas cosmétique : il porte
-- l'idempotence (index journal_entries_je_idempotency_uniq) et la
-- contre-passation automatique par revert_production_v1.
SELECT is(
  (SELECT sm.movement_type::text
     FROM journal_entries je
     JOIN stock_movements sm ON sm.id = je.reference_id
    WHERE je.metadata->>'production_id' = current_setting('breakery.d2_prod_id')
      AND je.metadata->>'movement_type' = 'production_waste'),
  'production_in',
  'T7: ADR-008 D2 — the waste entry hangs off the production_in movement, so the revert contra-posts it'
);

-- ===========================================================================
-- D3 — la table refuse aussi, indépendamment de la RPC.
-- ===========================================================================
DO $chk_check$
DECLARE
  v_fin     UUID := (SELECT id FROM _ids WHERE label='fin');
  v_errcode TEXT := '';
BEGIN
  BEGIN
    INSERT INTO production_records (
      production_number, product_id, quantity_produced, quantity_waste,
      production_date, materials_consumed, stock_updated, je_posted
    ) VALUES (
      'PROD-20260729-9999', v_fin, 5, 1, now(), FALSE, FALSE, FALSE
    );
  EXCEPTION WHEN OTHERS THEN
    v_errcode := SQLSTATE;
  END;
  PERFORM set_config('breakery.check_err', v_errcode, false);
END $chk_check$;

SELECT is(current_setting('breakery.check_err'), '23514',
  'T8: ADR-008 D3 — production_records_waste_reason_required rejects a waste row with no cause (CHECK 23514)');

-- ===========================================================================
-- D3 côté lot — refus au bord, la ligne fautive est nommée.
-- ===========================================================================
DO $chk_batch$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_fin     UUID := (SELECT id FROM _ids WHERE label='fin');
  v_nw      UUID := (SELECT id FROM _ids WHERE label='nw');
  v_errmsg  TEXT := '';
  v_detail  TEXT := '';
  v_errmsg2 TEXT := '';
BEGIN
  BEGIN
    PERFORM record_batch_production_v7(
      jsonb_build_object('section_id', v_section),
      jsonb_build_array(
        jsonb_build_object('product_id', v_nw,  'quantity_produced', 1),
        jsonb_build_object('product_id', v_fin, 'quantity_produced', 1, 'quantity_waste', 1)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_errmsg := SQLERRM;
  END;
  PERFORM set_config('breakery.batch_err', v_errmsg, false);
  PERFORM set_config('breakery.batch_detail', v_detail, false);

  BEGIN
    PERFORM record_batch_production_v7(
      jsonb_build_object('section_id', v_section),
      jsonb_build_array(
        jsonb_build_object('product_id', v_fin, 'quantity_produced', 1,
                           'quantity_waste', 1, 'waste_reason', 'burnt_to_a_crisp')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_errmsg2 := SQLERRM;
  END;
  PERFORM set_config('breakery.batch_err2', v_errmsg2, false);
END $chk_batch$;

SELECT is(
  current_setting('breakery.batch_err') || ' / ' || left(current_setting('breakery.batch_detail'), 7),
  'waste_reason_required / Item #2',
  'T9: ADR-008 D3 — the batch is refused as soon as one line declares waste without a cause, and the DETAIL names that line'
);

SELECT is(current_setting('breakery.batch_err2'), 'invalid_waste_reason',
  'T10: ADR-008 D3 — a value outside the waste_reason enum is refused with a named error, not a raw cast failure');

-- ===========================================================================
-- D2 — non-régression : sans raté, rien ne change.
-- ===========================================================================
DO $chk_nowaste$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_nw      UUID := (SELECT id FROM _ids WHERE label='nw');
  v_result  JSONB;
BEGIN
  v_result := record_production_v5(
    p_product_id := v_nw, p_quantity_produced := 10,
    p_section_id := v_section, p_batch_number := 'D2D3-NOWASTE'
  );
  PERFORM set_config('breakery.nw_prod_id', (v_result->>'production_id'), false);
END $chk_nowaste$;

SELECT is(
  (SELECT COUNT(*) FROM journal_entries
     WHERE metadata->>'production_id' = current_setting('breakery.nw_prod_id')
       AND metadata->>'movement_type' = 'production_waste')::text
  || '/' ||
  (SELECT unit_cost FROM stock_movements
     WHERE metadata->>'production_id' = current_setting('breakery.nw_prod_id')
       AND movement_type = 'production_in')::numeric(14,2)::text,
  '0/100.00',
  'T11: ADR-008 D2 — a production without waste emits no reclassification and still capitalises the full material cost'
);

-- ===========================================================================
-- D9.1 — le replay renvoie la première exécution, sans rien réécrire.
-- ===========================================================================
DO $chk_idem$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_nw      UUID := (SELECT id FROM _ids WHERE label='nw');
  v_key     UUID := gen_random_uuid();
  v_first   JSONB;
  v_replay  JSONB;
BEGIN
  v_first  := record_production_v5(
    p_product_id := v_nw, p_quantity_produced := 1,
    p_section_id := v_section, p_idempotency_key := v_key
  );
  v_replay := record_production_v5(
    p_product_id := v_nw, p_quantity_produced := 1,
    p_section_id := v_section, p_idempotency_key := v_key
  );
  PERFORM set_config('breakery.idem',
    ((v_first->>'production_id') = (v_replay->>'production_id'))::text
      || '|' || (v_replay->>'idempotent_replay'), false);
END $chk_idem$;

SELECT is(current_setting('breakery.idem'), 'true|true',
  'T12: ADR-008 D9.1 — replaying an idempotency key returns the first execution instead of producing twice');

-- ===========================================================================
-- D9.3 — la RPC nettoie ses tables temporaires : deux appels successifs dans la
-- même transaction, sans flush manuel entre les deux.
-- ===========================================================================
DO $chk_temp$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_nw      UUID := (SELECT id FROM _ids WHERE label='nw');
  v_errmsg  TEXT := 'none';
BEGIN
  BEGIN
    PERFORM record_production_v5(p_product_id := v_nw, p_quantity_produced := 1, p_section_id := v_section);
    PERFORM record_production_v5(p_product_id := v_nw, p_quantity_produced := 1, p_section_id := v_section);
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;
  PERFORM set_config('breakery.temp_err', v_errmsg, false);
END $chk_temp$;

SELECT is(current_setting('breakery.temp_err'), 'none',
  'T13: ADR-008 D9.3 — two successive productions in one transaction no longer collide on the internal temp tables');

-- ===========================================================================
-- Droits et versioning monotone.
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_production_v5(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_batch_production_v7(jsonb, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.record_production_v5(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_batch_production_v7(jsonb, jsonb)', 'EXECUTE')
  AND to_regprocedure('public.record_production_v4(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean)') IS NULL
  AND to_regprocedure('public.record_batch_production_v6(jsonb, jsonb)') IS NULL,
  'T14: anon revoked / authenticated retained on _v5 and _v7, and the superseded _v4 and _v6 are gone from pg_proc'
);

-- ===========================================================================
-- D2 x D7 — l'annulation d'une production doit aussi défaire la charge de raté.
-- C'est l'intérêt du rattachement au mouvement production_in : la boucle de
-- contre-passation de revert_production_v1 ramasse l'écriture sans avoir été
-- modifiée (ADR-008 D7 reste gelé tant que l'arbitrage D-19 n'est pas rendu).
-- ===========================================================================
DO $chk_revert$
DECLARE
  v_errmsg TEXT := 'none';
BEGIN
  BEGIN
    PERFORM revert_production_v1(
      current_setting('breakery.d2_prod_id')::uuid,
      'ADR-008 D2 test — revert must undo the waste expense'
    );
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;
  PERFORM set_config('breakery.revert_err', v_errmsg, false);
END $chk_revert$;

SELECT is(
  current_setting('breakery.revert_err') || '|' || (
    SELECT COALESCE(SUM(l.debit - l.credit), 0)
      FROM journal_entries je
      JOIN journal_entry_lines l ON l.journal_entry_id = je.id
      JOIN accounts a ON a.id = l.account_id
     WHERE a.code = '5210'
       AND (je.metadata->>'production_id' = current_setting('breakery.d2_prod_id')
            OR (je.reference_type = 'production'
                AND je.reference_id = current_setting('breakery.d2_prod_id')::uuid))
  )::numeric(14,2)::text,
  'none|0.00',
  'T15: reverting the production contra-posts the waste expense too — account 5210 is back to zero'
);

SELECT * FROM finish();

ROLLBACK;
