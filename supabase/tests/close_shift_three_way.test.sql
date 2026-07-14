-- supabase/tests/close_shift_three_way.test.sql
-- S67 (12 D2.2/D2.3) — close_shift_v6 : comptage 3 volets + grille coupures.
--   T1  : nouveaux args NULL + flag OFF -> comportement v4 (non-régression)
--   T2  : counted qris/card fournis -> persist + variances dans le retour…
--   T2b : … et section reconciliation + denominations dans le snapshot Z
--   T3  : écart QRIS seul (cash équilibré) au-dessus du seuil note sans note
--         -> variance_note_required (P0001)
--   T4  : écart carte seul au-dessus du seuil PIN (note fournie)
--         -> pin_approval_required (P0001)
--   T5  : flag ON sans grille -> denominations_required (P0001)
--   T6  : grille dont le total != counted_cash -> denomination_total_mismatch
--   T7  : clé de coupure inconnue -> invalid_denomination
--   T7b : quantité fractionnaire -> invalid_denomination
--   T7c : payload non-objet (array) -> invalid_denomination
--   T8  : p_counted_qris < 0 -> counted_method_invalid
--   T9  : happy path flag ON, grille valide -> closed + closing_denominations
--   T9b : … et zéro JE non-cash (aucune JE shift_close si variance cash = 0)
--   T10 : replay sur session fermée -> idempotent_replay, gardes (grille
--         comprise, flag ON) court-circuitées
-- Fixture : les 4 seuils business_config sont PINNÉS aux défauts (50k/0.5% ·
-- 200k/2%) et le flag coupures à OFF pour la durée de la transaction — la
-- base dev vivante peut porter d'autres valeurs (rollback final = sans trace).
-- Les 4 sessions appartiennent à des profils "libres" (sans session ouverte,
-- exclusion one_open_session_per_user) ; le caller EMP003 n'a besoin que de
-- shift.close (v5 ne vérifie pas opened_by = caller, miroir v4).
-- Run via MCP execute_sql / runner API-from-file (BEGIN/ROLLBACK inclus).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ===========================================================================
-- Fixtures. Sessions SANS commandes -> expected cash = opening ;
-- expected qris/card = 0.
--  - s1 (opening 500 000) : T1 — compté 500 000, variance 0 partout.
--  - s2 (opening 500 000) : T2 — cash 500 000 + qris 30 000/card 20 000
--    comptés (expected 0 -> variances +30k/+20k < 50k abs, pct skippé) ;
--    pin le persist + le snapshot.
--  - s3 (opening 500 000) : T3/T4 — cash équilibré, écarts non-cash.
--  - s4 (opening 352 000) : T5..T10 — grille (3×100 000 + 1×50 000 + 4×500).
-- ===========================================================================
DO $fixture$
DECLARE
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o4 UUID;
BEGIN
  SELECT auth_user_id, id INTO v_mgr_auth, v_mgr_prof
    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP003 profile not found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);

  -- Seuils pinnés aux défauts + flag OFF (la base dev peut différer).
  UPDATE business_config
     SET shift_variance_threshold_abs = 50000,
         shift_variance_threshold_pct = 0.005,
         shift_variance_pin_threshold_abs = 200000,
         shift_variance_pin_threshold_pct = 0.02,
         shift_denomination_count_enabled = FALSE
   WHERE id = 1;

  -- 4 propriétaires libres (exclusion one_open_session_per_user).
  SELECT up.id INTO v_o1 FROM user_profiles up
   WHERE up.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  SELECT up.id INTO v_o2 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id NOT IN (v_o1)
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  SELECT up.id INTO v_o3 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id NOT IN (v_o1, v_o2)
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  SELECT up.id INTO v_o4 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id NOT IN (v_o1, v_o2, v_o3)
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  IF v_o4 IS NULL THEN RAISE EXCEPTION 'fixture: not enough free profiles'; END IF;

  INSERT INTO pos_sessions (id, opened_by, opening_cash, status) VALUES
    ('67c50001-0000-0000-0000-000000000001', v_o1, 500000, 'open'),
    ('67c50001-0000-0000-0000-000000000002', v_o2, 500000, 'open'),
    ('67c50001-0000-0000-0000-000000000003', v_o3, 500000, 'open'),
    ('67c50001-0000-0000-0000-000000000004', v_o4, 352000, 'open');
END $fixture$;

-- T1 — non-régression : nouveaux args absents, flag OFF, variance 0.
SELECT lives_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000001'::uuid, 500000)$$,
  'T1: v4-shaped call (no new args, flag off) still closes'
);

-- T2 — volets comptés sous seuils.
DO $t2$
DECLARE v_res JSONB;
BEGIN
  v_res := close_shift_v6('67c50001-0000-0000-0000-000000000002'::uuid, 500000,
                          NULL, NULL, NULL, NULL, 30000, 20000, NULL);
  -- NUMERIC(14,2) sérialise 30000.00 — comparer en numeric, pas en texte.
  PERFORM set_config('s67.t2',
    ((v_res ->> 'variance_qris')::numeric = 30000 AND (v_res ->> 'variance_card')::numeric = 20000)::text, false);
END $t2$;
SELECT ok(current_setting('s67.t2')::boolean,
  'T2: counted qris/card -> per-volet variances in the return envelope');

SELECT is(
  (SELECT (ps.counted_qris = 30000 AND ps.counted_card = 20000
           AND (zr.snapshot #>> '{reconciliation,qris,variance}')::numeric = 30000
           AND (zr.snapshot #>> '{reconciliation,card,counted}')::numeric = 20000
           AND zr.snapshot ? 'denominations')
     FROM pos_sessions ps
     JOIN z_reports zr ON zr.shift_id = ps.id
    WHERE ps.id = '67c50001-0000-0000-0000-000000000002'),
  TRUE,
  'T2b: counted persisted on pos_sessions and frozen in snapshot.reconciliation'
);

-- T3 — écart QRIS seul >= 50 000 (abs), cash équilibré, PAS de note.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000003'::uuid, 500000,
                          NULL, NULL, NULL, NULL, 60000, NULL, NULL)$$,
  'P0001', 'variance_note_required',
  'T3: QRIS-only variance above note threshold without a note -> variance_note_required'
);

-- T4 — écart carte seul >= 200 000 (abs), note fournie, pas d'approbateur.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000003'::uuid, 500000,
                          'terminal settlement missing a batch', NULL, NULL, NULL, NULL, 250000, NULL)$$,
  'P0001', 'pin_approval_required',
  'T4: card-only variance above PIN threshold -> pin_approval_required'
);

-- Flag ON pour T5..T10 (rollback final = sans trace).
UPDATE business_config SET shift_denomination_count_enabled = TRUE WHERE id = 1;

-- T5 — flag ON sans grille.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000)$$,
  'P0001', 'denominations_required',
  'T5: flag on without a grid -> denominations_required'
);

-- T6 — total de grille != counted_cash.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3, "50000": 1}'::jsonb)$$,
  'P0001', 'denomination_total_mismatch',
  'T6: grid total 350000 != counted 352000 -> denomination_total_mismatch'
);

-- T7 — coupure inconnue.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"75000": 4, "50000": 1, "500": 4}'::jsonb)$$,
  'P0001', 'invalid_denomination',
  'T7: unknown denomination 75000 -> invalid_denomination'
);

-- T7b — quantité fractionnaire.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3.5, "2000": 1}'::jsonb)$$,
  'P0001', 'invalid_denomination',
  'T7b: fractional quantity -> invalid_denomination'
);

-- T7c — payload non-objet.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '[100000, 50000]'::jsonb)$$,
  'P0001', 'invalid_denomination',
  'T7c: non-object grid payload -> invalid_denomination'
);

-- T8 — comptage négatif.
SELECT throws_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, -1, NULL, NULL)$$,
  'P0001', 'counted_method_invalid',
  'T8: negative counted qris -> counted_method_invalid'
);

-- T9 — happy path grille valide (352 000 = 3×100k + 1×50k + 4×500).
SELECT lives_ok(
  $$SELECT close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3, "50000": 1, "500": 4}'::jsonb)$$,
  'T9: flag on with a valid grid -> close succeeds'
);

SELECT is(
  (SELECT (status::text = 'closed'
           AND closing_denominations = '{"100000": 3, "50000": 1, "500": 4}'::jsonb)
     FROM pos_sessions WHERE id = '67c50001-0000-0000-0000-000000000004'),
  TRUE,
  'T9a: closing_denominations persisted'
);

-- T9b — zéro JE : variance cash = 0 sur s2/s4, et l'écart qris/card de s2 ne
-- produit jamais d'écriture.
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
    WHERE reference_type = 'shift_close'
      AND reference_id IN ('67c50001-0000-0000-0000-000000000002',
                           '67c50001-0000-0000-0000-000000000004')),
  0,
  'T9b: no shift_close JE for zero-cash-variance sessions (non-cash variances never emit one)'
);

-- T10 — replay flag ON : sort avant toutes les gardes (grille comprise).
DO $t10$
DECLARE v_res JSONB; v_caught BOOLEAN := false;
BEGIN
  BEGIN
    v_res := close_shift_v6('67c50001-0000-0000-0000-000000000004'::uuid, 352000);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  PERFORM set_config('s67.t10',
    (NOT v_caught AND v_res ->> 'idempotent_replay' = 'true')::text, false);
END $t10$;
SELECT ok(current_setting('s67.t10')::boolean,
  'T10: replay on closed session bypasses every guard incl. denominations_required');

SELECT * FROM finish();
ROLLBACK;
