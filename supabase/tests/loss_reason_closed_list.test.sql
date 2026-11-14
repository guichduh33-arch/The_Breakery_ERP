-- S1-18 — le motif d'une perte de stock ou de vitrine vient d'une liste fermée.
-- Un motif hors liste est refusé ; `other` exige une note ; un ajustement ne
-- porte pas de motif de perte. Le comptage de vitrine du jour est couvert par
-- `antifraud_display_day.test.sql`. Transaction annulée.
BEGIN;
SELECT plan(24);

CREATE TEMP TABLE _ids AS
SELECT gen_random_uuid() AS stk, gen_random_uuid() AS dsp,
       (SELECT id FROM categories LIMIT 1) AS cat,
       (SELECT auth_user_id FROM user_profiles WHERE role_code = 'SUPER_ADMIN' AND is_active
          AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1) AS owner_uid,
       gen_random_uuid() AS k1, gen_random_uuid() AS k2;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT stk, 'S118-STK-' || left(stk::text, 8), 's1-18 stock', cat, 1000, 10, 'pcs', true, false FROM _ids;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT dsp, 'S118-DSP-' || left(dsp::text, 8), 's1-18 display', cat, 1000, 10, 'pcs', true, true FROM _ids;
INSERT INTO display_stock (product_id, quantity) SELECT dsp, 10 FROM _ids
  ON CONFLICT (product_id) DO UPDATE SET quantity = 10;

SELECT set_config('request.jwt.claim.sub', owner_uid::text, true),
       set_config('request.jwt.claims', jsonb_build_object('sub', owner_uid, 'role', 'authenticated')::text, true)
  FROM _ids;

-- Schéma.
SELECT enum_has_labels('public', 'waste_reason',
  ARRAY['mis_baked','poor_proofing','cosmetic','demo','recipe_test','tasting','expired','leftover','damaged','other'],
  'la liste fermée porte les dix motifs');
SELECT col_type_is('public', 'stock_declarations', 'waste_reason', 'waste_reason',
  'la déclaration de stock porte le motif');
SELECT col_type_is('public', 'display_day_closing_items', 'waste_reason_code', 'waste_reason',
  'la ligne de comptage de vitrine porte le motif');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'public' AND p.proname IN ('waste_stock_v4','waste_display_stock_v4',
                     'submit_stock_declaration_v2','submit_display_day_closing_v1'))
               OR (n.nspname = 'stock_private' AND p.proname = 'submit_day_waste_v1')), 0,
  'les versions à texte libre sont retirées');

-- Droits.
SELECT ok(NOT has_function_privilege('anon', 'public.waste_stock_v5(uuid,numeric,public.waste_reason,text,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.waste_display_stock_v5(uuid,numeric,public.waste_reason,text,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.submit_stock_declaration_v3(text,uuid,numeric,text,uuid,public.waste_reason)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.submit_display_day_closing_v2(date,jsonb,uuid)', 'EXECUTE'),
  'anon n''exécute aucune des quatre fonctions');
SELECT ok(has_function_privilege('authenticated', 'public.waste_stock_v5(uuid,numeric,public.waste_reason,text,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.waste_display_stock_v5(uuid,numeric,public.waste_reason,text,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.submit_display_day_closing_v2(date,jsonb,uuid)', 'EXECUTE'),
  'un compte connecté exécute les fonctions de perte');
SELECT ok(NOT has_function_privilege('authenticated', 'stock_private.submit_day_waste_v2(uuid,numeric,text,uuid,public.waste_reason)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'stock_private.submit_day_waste_v2(uuid,numeric,text,uuid,public.waste_reason)', 'EXECUTE'),
  'le helper privé du comptage reste fermé');

-- Perte de stock : motif de la liste, sans note.
SELECT lives_ok(
  format($q$SELECT waste_stock_v5(%L::uuid, 1, 'expired', NULL, %L::uuid)$q$, (SELECT stk FROM _ids), (SELECT k1 FROM _ids)),
  'perte de stock avec un motif de la liste : acceptée');
SELECT is((SELECT waste_reason::text || '|' || reason FROM stock_declarations WHERE idempotency_key = (SELECT k1 FROM _ids)),
  'expired|expired', 'sans note, le texte reprend le motif');

-- Perte de stock : motif et note.
SELECT lives_ok(
  format($q$SELECT waste_stock_v5(%L::uuid, 1, 'damaged', '  Fell on the floor ', gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  'perte de stock avec motif et note : acceptée');
SELECT is((SELECT count(*)::int FROM stock_declarations WHERE product_id = (SELECT stk FROM _ids)
            AND waste_reason = 'damaged' AND reason = 'Fell on the floor'), 1,
  'avec note, le texte garde la note et le motif reste lisible');

-- Refus.
SELECT throws_ok(
  format($q$SELECT waste_stock_v5(%L::uuid, 1, 'Spoiled', NULL, gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  '22P02', NULL, 'perte de stock : un motif hors liste est refusé');
SELECT throws_ok(
  format($q$SELECT waste_display_stock_v5(%L::uuid, 1, 'Spoiled', NULL, gen_random_uuid())$q$, (SELECT dsp FROM _ids)),
  '22P02', NULL, 'perte de vitrine : un motif hors liste est refusé');
SELECT throws_ok(
  format($q$SELECT waste_stock_v5(%L::uuid, 1, 'other', NULL, gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  'P0001', 'reason_required', 'le motif other exige une note');
SELECT throws_ok(
  format($q$SELECT waste_stock_v5(%L::uuid, 1, 'other', ' ab ', gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  'P0001', 'reason_required', 'une note de moins de trois caractères est refusée');
SELECT throws_ok(
  format($q$SELECT submit_stock_declaration_v3('waste', %L::uuid, 1, 'free text only', gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  '22023', 'waste_reason_required', 'une perte sans motif est refusée');
SELECT throws_ok(
  format($q$SELECT submit_stock_declaration_v3('adjust', %L::uuid, 4, 'recount', gen_random_uuid(), 'expired')$q$, (SELECT stk FROM _ids)),
  '22023', 'waste_reason_not_allowed', 'un ajustement ne porte pas de motif de perte');
SELECT throws_ok(
  format($q$INSERT INTO stock_declarations(operation, product_id, quantity, baseline_quantity, reason, waste_reason, declared_by, idempotency_key)
            SELECT 'adjust', %L::uuid, 1, 1, 'direct insert', 'expired', id, gen_random_uuid()
              FROM user_profiles WHERE auth_user_id = %L::uuid$q$, (SELECT stk FROM _ids), (SELECT owner_uid FROM _ids)),
  '23514', NULL, 'la contrainte refuse un motif de perte sur un ajustement');

-- L'ajustement garde son contrat.
SELECT lives_ok(
  format($q$SELECT adjust_stock_v4(%L::uuid, 8, 'recount after audit', gen_random_uuid())$q$, (SELECT stk FROM _ids)),
  'ajustement de stock : inchangé');
SELECT is((SELECT count(*)::int FROM stock_declarations WHERE product_id = (SELECT stk FROM _ids)
            AND operation = 'adjust' AND waste_reason IS NULL), 1,
  'un ajustement n''a pas de motif de perte');

-- Perte de vitrine.
SELECT lives_ok(
  format($q$SELECT waste_display_stock_v5(%L::uuid, 2, 'leftover', NULL, %L::uuid)$q$, (SELECT dsp FROM _ids), (SELECT k2 FROM _ids)),
  'perte de vitrine avec un motif de la liste : acceptée');
SELECT is((SELECT d.waste_reason::text || '|' || m.reason || '|' || s.quantity::int
             FROM stock_declarations d
             JOIN display_movements m ON m.reference_id = d.id
             JOIN display_stock s ON s.product_id = d.product_id
            WHERE d.idempotency_key = (SELECT k2 FROM _ids)),
  'leftover|leftover|8', 'perte de vitrine : motif enregistré, mouvement écrit, vitrine retirée');

-- Idempotence : le motif fait partie de l'intention.
SELECT is((waste_display_stock_v5((SELECT dsp FROM _ids), 2, 'leftover', NULL, (SELECT k2 FROM _ids)) ->> 'idempotent_replay')::boolean,
  true, 'même clé, même demande : rejeu');
SELECT throws_ok(
  format($q$SELECT waste_display_stock_v5(%L::uuid, 2, 'damaged', NULL, %L::uuid)$q$, (SELECT dsp FROM _ids), (SELECT k2 FROM _ids)),
  '22023', 'idempotency_conflict', 'même clé, autre motif : conflit');

SELECT * FROM finish();
ROLLBACK;
