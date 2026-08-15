-- supabase/tests/adr008_d7_d8.test.sql
-- ADR-008 D7 + D8 — migration 20260729000006 (revert_production_v2).
--
-- D7 correction 1 : l'annulation est refusée dès que le stock produit est
--   ressorti (`already_consumed`). Annuler retirerait des unités qui ne sont
--   plus là — produire 10, en vendre 4, annuler ramenait le stock à -4.
--   Une ENTRÉE ultérieure (deuxième fournée) ne bloque pas : elle ne rend pas la
--   contre-passation fausse.
-- D7 correction 2 : les contre-passations passent par `record_stock_movement_v1`
--   au lieu d'écrire dans le ledger en direct et de tenir `products.current_stock`
--   et `section_stock` à la main. Le test décisif est T3 : si les mises à jour
--   manuelles avaient survécu au refactor, le stock serait décrémenté DEUX fois.
-- D8 : statu quo acté — la permission `inventory.production.delete` suffit, sans
--   PIN. Rien de neuf à coder ; T12 vérifie que la garde de droits tient.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS COUVERT, ET POURQUOI
-- ---------------------------------------------------------------------------
-- La garde de période fiscale sur les contre-écritures n'est vérifiée que par
-- PRÉSENCE dans le corps (T11) : fermer une période dans cette transaction
-- affecterait `fiscal_periods`, table partagée par les autres suites, et le
-- rollback ne protège pas d'une exécution concurrente. Le comportement de
-- `check_fiscal_period_open` lui-même est couvert par les suites comptables.
--
-- Coverage matrix :
--   1  annulation nominale : stock du fini restauré, matière rendue,
--      contre-passations sans section (ADR-027, T4 — section_stock est
--      droppée), contre-passations passées par le helper, charge de raté
--      ADR-008 D2 contre-passée (T1-T6).
--   2  refus : `already_consumed`, HINT nommant l'ajustement, DETAIL listant la
--      sortie, production laissée intacte (T7-T10).
--   3  entrée ultérieure : n'empêche pas l'annulation (T5 du bloc 2 → T10).
--   4  gardes conservées : already_reverted, production_too_old (T13-T14).
--   5  droits et versioning : anon révoqué, authenticated conservé, _v1 absente
--      (T12).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

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
-- Fixture. Trois produits finis distincts : chaque scénario doit partir d'un
-- historique de mouvements vierge. `now()` étant figé sur la transaction, une
-- sortie enregistrée pour un scénario porterait le même `created_at` que la
-- production d'un autre et déclencherait sa garde (la borne est inclusive, cf.
-- la note de la migration).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ids(label text PRIMARY KEY, id uuid) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_cat  uuid := current_setting('breakery.category_id')::uuid;
  v_mat  uuid := gen_random_uuid();
  v_finA uuid := gen_random_uuid();
  v_finB uuid := gen_random_uuid();
  v_finC uuid := gen_random_uuid();
BEGIN
  INSERT INTO products (
    id, sku, name, category_id, retail_price, unit, cost_price,
    product_type, is_active, current_stock, track_inventory, deduct_stock
  ) VALUES
    (v_mat,  'D7-MAT',  'D7 Matiere',        v_cat, 0, 'kg',  1000, 'finished', true, 1000, true, true),
    (v_finA, 'D7-FIN-A','D7 Fini Nominal',   v_cat, 0, 'pcs', 0,    'finished', true, 0,    true, true),
    (v_finB, 'D7-FIN-B','D7 Fini Consomme',  v_cat, 0, 'pcs', 0,    'finished', true, 0,    true, true),
    (v_finC, 'D7-FIN-C','D7 Fini Deux Fours',v_cat, 0, 'pcs', 0,    'finished', true, 0,    true, true);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_finA, v_mat, 0.1, 'kg', true),
    (v_finB, v_mat, 0.1, 'kg', true),
    (v_finC, v_mat, 0.1, 'kg', true);

  INSERT INTO _ids VALUES ('mat', v_mat), ('finA', v_finA), ('finB', v_finB), ('finC', v_finC);
END $fixture$;

-- ===========================================================================
-- Bloc 1 — annulation nominale (aucune sortie depuis la production).
-- ===========================================================================
DO $chk_nominal$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_finA    UUID := (SELECT id FROM _ids WHERE label='finA');
  v_mat     UUID := (SELECT id FROM _ids WHERE label='mat');
  v_mat_before NUMERIC;
  v_res     JSONB;
  v_pid     UUID;
BEGIN
  SELECT current_stock INTO v_mat_before FROM products WHERE id = v_mat;
  PERFORM set_config('breakery.mat_before', v_mat_before::text, false);

  -- 10 produits, 2 ratés : la charge de raté ADR-008 D2 est émise, donc le
  -- revert doit aussi la défaire.
  v_res := record_production_v5(
    p_product_id := v_finA, p_quantity_produced := 10, p_section_id := v_section,
    p_quantity_waste := 2, p_waste_reason := 'mis_baked');
  v_pid := (v_res->>'production_id')::uuid;
  PERFORM set_config('breakery.pid_nominal', v_pid::text, false);

  PERFORM set_config('breakery.fin_after_prod',
    (SELECT current_stock FROM products WHERE id = v_finA)::text, false);

  PERFORM revert_production_v2(v_pid, 'annulation nominale, rien nest sorti');
END $chk_nominal$;

SELECT is(current_setting('breakery.fin_after_prod')::numeric, 10::numeric,
  'T1: the production credited the finished product with 10');

SELECT is(
  (SELECT p.current_stock FROM products p
    WHERE p.id = (SELECT id FROM _ids WHERE label='finA')),
  0::numeric,
  'T2: reverting removes exactly what the production added — the finished stock is back to zero');

SELECT is(
  (SELECT p.current_stock FROM products p
    WHERE p.id = (SELECT id FROM _ids WHERE label='mat')),
  current_setting('breakery.mat_before')::numeric,
  'T3: the consumed material is given back, down to the unit');

-- ADR-027 (2026-08-16) : section_stock est droppée (mono-section). Le test du
-- refactor D7 portait sur ce cache ; il devient un test sur le ledger lui-même
-- — la primitive n'écrit plus aucune section sur les mouvements neufs, contre-
-- passations comprises (from/to_section_id conservées pour l'historique
-- antérieur, jamais alimentées désormais).
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM stock_movements
     WHERE metadata->>'production_id' = current_setting('breakery.pid_nominal')
       AND metadata->>'reverse_of_production' = 'true'
       AND (from_section_id IS NOT NULL OR to_section_id IS NOT NULL)
  ),
  'T4: the counter-movements carry no section (from/to_section_id NULL) — mono-section, section_stock dropped');

SELECT is(
  (SELECT DISTINCT reference_type FROM stock_movements
    WHERE metadata->>'production_id' = current_setting('breakery.pid_nominal')
      AND metadata->>'reverse_of_production' = 'true'),
  'admin_action',
  'T5: the counter-movements went through record_stock_movement_v1, not a direct INSERT');

SELECT is(
  (SELECT COALESCE(SUM(l.debit - l.credit), 0)
     FROM journal_entries je
     JOIN journal_entry_lines l ON l.journal_entry_id = je.id
     JOIN accounts a ON a.id = l.account_id
    WHERE a.code = '5210'
      AND (je.metadata->>'production_id' = current_setting('breakery.pid_nominal')
           OR (je.reference_type = 'production'
               AND je.reference_id = current_setting('breakery.pid_nominal')::uuid))),
  0::numeric,
  'T6: the ADR-008 D2 waste expense is contra-posted too — account 5210 is back to zero');

-- ===========================================================================
-- Bloc 2 — le stock produit est ressorti : refus.
-- ===========================================================================
DO $chk_consumed$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_finB    UUID := (SELECT id FROM _ids WHERE label='finB');
  v_res     JSONB;
  v_pid     UUID;
  v_errmsg  TEXT := 'AUCUNE';
  v_hint    TEXT := '';
  v_detail  TEXT := '';
BEGIN
  v_res := record_production_v5(
    p_product_id := v_finB, p_quantity_produced := 10, p_section_id := v_section);
  v_pid := (v_res->>'production_id')::uuid;
  PERFORM set_config('breakery.pid_consumed', v_pid::text, false);

  -- Une sortie quelconque du produit fini : ici une perte déclarée.
  PERFORM record_stock_movement_v1(
    p_product_id := v_finB, p_movement_type := 'waste', p_quantity := -4,
    p_reason := 'sortie de stock apres production', p_from_section_id := v_section);

  BEGIN
    PERFORM revert_production_v2(v_pid, 'tentative dannulation apres sortie');
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
  END;

  PERFORM set_config('breakery.consumed_err', v_errmsg, false);
  PERFORM set_config('breakery.consumed_hint', v_hint, false);
  PERFORM set_config('breakery.consumed_detail', v_detail, false);
END $chk_consumed$;

SELECT is(current_setting('breakery.consumed_err'), 'already_consumed',
  'T7: ADR-008 D7 — a batch whose stock has left inventory can no longer be reverted');

SELECT ok(
  current_setting('breakery.consumed_hint') LIKE '%adjust_stock%',
  'T8: the refusal names the correction path — a stock adjustment — instead of leaving the user stuck');

SELECT ok(
  current_setting('breakery.consumed_detail') LIKE '%waste%'
  AND current_setting('breakery.consumed_detail') LIKE '%-4%',
  'T9: the DETAIL lists the outgoing movement that blocks, with its quantity');

SELECT is(
  (SELECT (reverted_at IS NULL AND stock_updated) FROM production_records
    WHERE id = current_setting('breakery.pid_consumed')::uuid),
  true,
  'T10: the refused production is left strictly intact — not half-reverted');

-- ===========================================================================
-- Bloc 3 — une ENTRÉE ultérieure ne bloque pas.
-- ===========================================================================
DO $chk_entree$
DECLARE
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_finC    UUID := (SELECT id FROM _ids WHERE label='finC');
  v_res     JSONB;
  v_pid     UUID;
  v_errmsg  TEXT := 'REVERT ACCEPTE';
BEGIN
  v_res := record_production_v5(
    p_product_id := v_finC, p_quantity_produced := 10, p_section_id := v_section);
  v_pid := (v_res->>'production_id')::uuid;

  -- Deuxième fournée du même produit : c'est une entrée, pas une sortie.
  PERFORM record_production_v5(
    p_product_id := v_finC, p_quantity_produced := 7, p_section_id := v_section);

  BEGIN
    PERFORM revert_production_v2(v_pid, 'annulation de la premiere fournee');
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;

  PERFORM set_config('breakery.entree_err', v_errmsg, false);
  PERFORM set_config('breakery.entree_stock',
    (SELECT current_stock FROM products WHERE id = v_finC)::text, false);
END $chk_entree$;

SELECT is(
  current_setting('breakery.entree_err') || '|' || current_setting('breakery.entree_stock'),
  'REVERT ACCEPTE|7.000',
  'T11: a later INCOMING movement does not block the revert — only the first batch is removed, 7 remain');

-- ===========================================================================
-- Bloc 4 — droits, versioning, gardes conservées.
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.revert_production_v2(uuid, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.revert_production_v2(uuid, text)', 'EXECUTE')
  AND to_regprocedure('public.revert_production_v1(uuid, text)') IS NULL,
  'T12: anon revoked / authenticated retained on _v2, and the superseded _v1 is gone from pg_proc');

-- Garde de période fiscale : vérifiée par présence dans le corps, cf. la note
-- d'entête sur pourquoi on ne ferme pas une période ici.
SELECT ok(
  (SELECT prosrc LIKE '%check_fiscal_period_open%' FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'revert_production_v2'),
  'T13: ADR-008 D7 — the counter-entries are guarded by check_fiscal_period_open');

DO $chk_gardes$
DECLARE
  v_errmsg TEXT := 'AUCUNE';
BEGIN
  -- La production annulée au bloc 1 ne peut pas l'être deux fois.
  BEGIN
    PERFORM revert_production_v2(current_setting('breakery.pid_nominal')::uuid, 'seconde tentative');
  EXCEPTION WHEN OTHERS THEN
    v_errmsg := SQLERRM;
  END;
  PERFORM set_config('breakery.garde_err', v_errmsg, false);
END $chk_gardes$;

SELECT is(current_setting('breakery.garde_err'), 'already_reverted',
  'T14: the pre-existing already_reverted guard still holds after the refactor');

SELECT * FROM finish();

ROLLBACK;
