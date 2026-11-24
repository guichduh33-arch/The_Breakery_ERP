-- ADR-047 : équipements achetés et amortissement automatique.
-- Marque « équipement » d'une dépense, approbation (débit au compte d'équipement
-- et fiches du registre), inscription d'un équipement déjà au bilan, dotation
-- mensuelle (idempotente, refus en période fermée, rattrapage à sa date),
-- sortie sous PIN, fiche figée, lectures et droits.
-- Les comptes, dépenses, fiches et écritures de ce test disparaissent avec le
-- ROLLBACK. Les périodes utilisées sont forcées ouvertes dans la transaction.
BEGIN;
\ir helpers/expense_terms.sql
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE fa_results(seq serial, tap text);

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();   -- propriétaire
  ma uuid := gen_random_uuid(); mp uuid := gen_random_uuid();   -- manager sans droits registre
  v_cat uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (oa), (ma);
  INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash) VALUES
    (op, oa, 'SUPER_ADMIN', 'FA owner', 'FA-O-'||left(op::text,8), true, extensions.crypt('246810', extensions.gen_salt('bf'))),
    (mp, ma, 'MANAGER', 'FA manager', 'FA-M-'||left(mp::text,8), true, extensions.crypt('135791', extensions.gen_salt('bf')));
  -- role_permissions est de la DONNÉE : on épingle ce que le test suppose.
  INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason) VALUES
    (op, 'reports.statements.read', true, 'FA coverage'),
    (op, 'accounting.fixed_assets.manage', true, 'FA coverage'),
    (op, 'expenses.create', true, 'FA coverage'),
    (op, 'expenses.approve', true, 'FA coverage'),
    (mp, 'reports.statements.read', false, 'FA coverage'),
    (mp, 'accounting.fixed_assets.manage', false, 'FA coverage'),
    (mp, 'expenses.manage', false, 'FA coverage'),
    (mp, 'expenses.create', true, 'FA coverage')
    ON CONFLICT (user_profile_id, permission_code) DO UPDATE SET is_granted = EXCLUDED.is_granted, expires_at = NULL;
  UPDATE fiscal_periods SET status = 'open'
   WHERE period_start IN ('2026-09-01','2026-10-01','2026-11-01','2027-01-01','2027-02-01','2027-03-01');

  SELECT c.id INTO v_cat FROM expense_categories c JOIN accounts a ON a.id = c.account_id
   WHERE c.is_active AND a.account_class = 6 ORDER BY c.code LIMIT 1;
  PERFORM set_config('fa.cat', v_cat::text, true);
  PERFORM set_config('fa.term', pg_temp.expense_term_fixture(v_cat, 'FA pgTAP equipment')::text, true);
  PERFORM set_config('fa.oa', oa::text, true);
  PERFORM set_config('fa.op', op::text, true);
  PERFORM set_config('fa.ma', ma::text, true);
  PERFORM set_config('fa.mp', mp::text, true);
END
$fixture$;

-- Brouillon de dépense, créé par le propriétaire.
CREATE FUNCTION pg_temp.fa_draft(p_amount numeric, p_date date, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO expenses (expense_number, description, amount, expense_date, category_id,
                        payment_method, status, created_by, expense_term_id)
  VALUES ('EXP-FA-'||substr(gen_random_uuid()::text,1,8), p_label, p_amount, p_date,
          current_setting('fa.cat')::uuid, 'transfer', 'draft', current_setting('fa.op')::uuid,
          current_setting('fa.term')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Soumission directe à une étape « propriétaire », puis approbation par la RPC.
CREATE FUNCTION pg_temp.fa_approve(p_expense uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE expenses SET status = 'submitted', submitted_at = now(), submitted_by = created_by,
         required_approval_steps_snapshot = '[{"role_codes":["SUPER_ADMIN"],"label":"Owner"}]'::jsonb
   WHERE id = p_expense;
  RETURN approve_expense_v5(p_expense, '246810');
END $$;

CREATE FUNCTION pg_temp.fa_raises(p_sql text, p_state text, p_message text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
-- P0004 (période fermée) est la classe assert_failure : WHEN OTHERS ne la couvre pas.
EXCEPTION WHEN OTHERS OR assert_failure THEN
  RETURN SQLSTATE = p_state AND (p_message IS NULL OR SQLERRM LIKE '%' || p_message || '%');
END $$;

-- =========================================================================
-- Schéma, droits, comptes
-- =========================================================================
INSERT INTO fa_results(tap) SELECT ok(c.relrowsecurity, 'RLS enabled: ' || c.relname)
  FROM pg_class c WHERE c.oid IN ('public.fixed_assets'::regclass, 'public.fixed_asset_depreciations'::regclass);
INSERT INTO fa_results(tap) SELECT ok(EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
    AND p.polname = 'pin_session_required' AND NOT p.polpermissive), 'PIN gate: ' || c.relname)
  FROM pg_class c WHERE c.oid IN ('public.fixed_assets'::regclass, 'public.fixed_asset_depreciations'::regclass);
INSERT INTO fa_results(tap) SELECT ok(NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'), 'No direct client access: ' || c.relname)
  FROM pg_class c WHERE c.oid IN ('public.fixed_assets'::regclass, 'public.fixed_asset_depreciations'::regclass);
INSERT INTO fa_results(tap) SELECT ok(NOT has_function_privilege('anon', p.oid, 'EXECUTE'), 'anon cannot execute ' || p.proname)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('set_expense_equipment_v1','register_existing_fixed_asset_v1','dispose_fixed_asset_v1',
                     'get_fixed_assets_v1','get_fixed_asset_v1','run_fixed_asset_depreciation_v1');
INSERT INTO fa_results(tap) SELECT ok(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'internal: ' || p.proname)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('run_fixed_asset_depreciation_v1','_post_fixed_asset_depreciation_v1','_insert_fixed_asset_v1',
                     '_create_fixed_assets_from_expense_v1','_emit_expense_je');
INSERT INTO fa_results(tap) SELECT ok(EXISTS(SELECT 1 FROM accounts WHERE code = '6970' AND account_class = 6
    AND is_active AND is_postable AND cash_flow_section = 'operating'), 'Loss account 6970 exists (class 6, operating)');
INSERT INTO fa_results(tap) SELECT is((SELECT code FROM accounts WHERE id = resolve_mapping_account(k)), c, 'mapping ' || k)
  FROM (VALUES ('FIXED_ASSET_EQUIPMENT','1600'), ('FIXED_ASSET_PRODUCTION_MACHINE','1610'),
               ('FIXED_ASSET_ACCUMULATED_DEPRECIATION','1690'), ('FIXED_ASSET_DEPRECIATION_EXPENSE','6950'),
               ('FIXED_ASSET_DISPOSAL_GAIN','4950'), ('FIXED_ASSET_DISPOSAL_LOSS','6970')) v(k, c);
INSERT INTO fa_results(tap) SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'fixed-asset-depreciation'
    AND command LIKE '%run_fixed_asset_depreciation_v1()%'), 'Daily depreciation job scheduled');

-- Plan : la somme des dotations égale le coût, dernier mois compris.
INSERT INTO fa_results(tap) SELECT is((SELECT sum(_fixed_asset_month_amount_v1(2000000.01, 48, k)) FROM generate_series(1,48) k),
  2000000.01::numeric, 'Group 1 plan: 48 monthly amounts sum to the cost exactly');
INSERT INTO fa_results(tap) SELECT is((SELECT sum(_fixed_asset_month_amount_v1(28791300, 96, k)) FROM generate_series(1,96) k),
  28791300::numeric, 'Group 2 plan: 96 monthly amounts sum to the cost exactly');
INSERT INTO fa_results(tap) SELECT is(_fixed_asset_month_amount_v1(1000, 48, 49), 0::numeric, 'No amount after the last month');

-- =========================================================================
-- Marque « équipement » et approbation
-- =========================================================================
SELECT pg_temp.authenticate_pin(current_setting('fa.oa')::uuid);
SELECT set_config('fa.e1', pg_temp.fa_draft(5000000, '2026-10-15', 'FA two ovens')::text, true);
SELECT set_config('fa.e2', pg_temp.fa_draft(300000, '2026-10-15', 'FA ordinary')::text, true);

INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('SELECT set_expense_equipment_v1(%L, ''production_machine'', ''group_1'', ''Oven'', 3)', current_setting('fa.e1')),
  '22023', 'fixed_asset_below_threshold'), 'Threshold is per article: 5 000 000 for 3 articles is refused');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('SELECT set_expense_equipment_v1(%L, ''production_machine'', ''group_1'', ''Oven'', 1)', current_setting('fa.e2')),
  '22023', 'fixed_asset_below_threshold'), 'Below 2 000 000 IDR an expense cannot be marked');
SELECT set_expense_equipment_v1(current_setting('fa.e1')::uuid, 'production_machine', 'group_1', 'Deck oven', 2);
INSERT INTO fa_results(tap) SELECT is((SELECT asset_type::text || '/' || asset_tax_group || '/' || asset_name || '/' || asset_quantity
  FROM expenses WHERE id = current_setting('fa.e1')::uuid), 'production_machine/group_1/Deck oven/2', 'Draft carries the equipment mark');
INSERT INTO fa_results(tap) SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action = 'expense.equipment_marked'
  AND entity_id = current_setting('fa.e1')::uuid AND actor_id = current_setting('fa.op')::uuid), 'Mark is audited with the profile id');

-- Un autre utilisateur sans expenses.manage ne marque pas la dépense du propriétaire.
SELECT pg_temp.authenticate_pin(current_setting('fa.ma')::uuid);
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('SELECT set_expense_equipment_v1(%L, NULL)', current_setting('fa.e1')), '42501', 'expense_not_owner'),
  'Only the creator (or expenses.manage) can change the mark');
SELECT pg_temp.authenticate_pin(current_setting('fa.oa')::uuid);

SELECT pg_temp.fa_approve(current_setting('fa.e1')::uuid);
SELECT pg_temp.fa_approve(current_setting('fa.e2')::uuid);

INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(a.code || ':' || l.debit::text || ':' || l.credit::text, ',' ORDER BY l.debit DESC)
  FROM expenses e JOIN journal_entry_lines l ON l.journal_entry_id = e.je_id JOIN accounts a ON a.id = l.account_id
  WHERE e.id = current_setting('fa.e1')::uuid),
  '1610:5000000.00:0.00,' || (SELECT code FROM accounts WHERE id = resolve_mapping_account('EXPENSE_BANK_OUT')) || ':0.00:5000000.00',
  'Approval debits the production machinery account, not the category');
INSERT INTO fa_results(tap) SELECT is((SELECT a.id FROM expenses e JOIN journal_entry_lines l ON l.journal_entry_id = e.je_id
  JOIN accounts a ON a.id = l.account_id WHERE e.id = current_setting('fa.e2')::uuid AND l.debit > 0),
  (SELECT account_id FROM expense_categories WHERE id = current_setting('fa.cat')::uuid),
  'An ordinary expense still debits its category account');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM fixed_assets WHERE expense_id = current_setting('fa.e2')::uuid), 0,
  'An ordinary expense creates no fixed asset');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(name || '|' || cost || '|' || in_service_date || '|' || depreciation_start_month
    || '|' || useful_life_months || '|' || monthly_depreciation, ',' ORDER BY expense_unit_index)
  FROM fixed_assets WHERE expense_id = current_setting('fa.e1')::uuid),
  'Deck oven (1/2)|2500000.00|2026-10-15|2026-10-01|48|52083.33,Deck oven (2/2)|2500000.00|2026-10-15|2026-10-01|48|52083.33',
  'Approval creates one register card per article');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM audit_logs a JOIN fixed_assets f ON f.id = a.entity_id
  WHERE a.action = 'fixed_asset.created' AND f.expense_id = current_setting('fa.e1')::uuid
    AND a.actor_id = current_setting('fa.op')::uuid), 2, 'Card creation is audited with the approver profile');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('SELECT set_expense_equipment_v1(%L, NULL)', current_setting('fa.e1')), 'P0001', 'expense_not_draft'),
  'The mark is frozen once the expense leaves draft');
SELECT set_config('fa.a1', (SELECT id::text FROM fixed_assets WHERE expense_id = current_setting('fa.e1')::uuid AND expense_unit_index = 1), true);
SELECT set_config('fa.a2', (SELECT id::text FROM fixed_assets WHERE expense_id = current_setting('fa.e1')::uuid AND expense_unit_index = 2), true);

-- =========================================================================
-- Inscription de la machine déjà au bilan (chiffres de production)
-- =========================================================================
SELECT set_config('fa.k1', gen_random_uuid()::text, true);
SELECT set_config('fa.m', (register_existing_fixed_asset_v1('FA production machine', 'production_machine', 'group_1',
  '2025-10-01', 28791300, 7197825, '2026-09-30', current_setting('fa.k1')::uuid)->>'asset_id'), true);
INSERT INTO fa_results(tap) SELECT is((register_existing_fixed_asset_v1('FA production machine', 'production_machine', 'group_1',
  '2025-10-01', 28791300, 7197825, '2026-09-30', current_setting('fa.k1')::uuid)->>'asset_id'), current_setting('fa.m'),
  'Registration replays on the same idempotency key');
INSERT INTO fa_results(tap) SELECT is((SELECT depreciation_start_month::text || '|' || monthly_depreciation || '|' || origin
  FROM fixed_assets WHERE id = current_setting('fa.m')::uuid), '2026-10-01|599818.75|opening',
  'Existing machine resumes in October 2026 at 599 818.75 per month');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM journal_entries WHERE reference_id = current_setting('fa.m')::uuid), 0,
  'Registration posts no purchase entry');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  $$SELECT register_existing_fixed_asset_v1('FA x', 'equipment', 'group_1', '2025-10-01', 1000, 0, '2026-09-15', gen_random_uuid())$$,
  '22023', 'fixed_asset_as_of_must_be_month_end'), 'Accumulated depreciation is stated at a month end');

-- =========================================================================
-- Sortie (avant le passage de décembre : novembre est le mois de sortie)
-- =========================================================================
INSERT INTO fa_results(tap) SELECT is((dispose_fixed_asset_v1(current_setting('fa.a2')::uuid, '2026-11-20', 'sale', 2500000,
  resolve_mapping_account('EXPENSE_BANK_OUT'), 'sold', '000000')->>'error'), 'invalid_pin', 'Wrong PIN returns invalid_pin');
INSERT INTO fa_results(tap) SELECT ok((SELECT failed_login_attempts > 0 FROM user_profiles WHERE id = current_setting('fa.op')::uuid),
  'Wrong PIN counts toward the lockout');
UPDATE fiscal_periods SET status = 'closed' WHERE period_start = '2026-01-01' AND status = 'open';
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-01-15', 'scrap', NULL, NULL, NULL, '246810')$$, current_setting('fa.m')),
  'P0004'), 'Disposal in a closed period is refused');

INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-09-15', 'scrap', NULL, NULL, NULL, '246810')$$, current_setting('fa.m')),
  '22023', 'fixed_asset_disposal_before_opening_balance'), 'An opening asset cannot leave inside its opening balance months');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-11-20', 'scrap', 100, NULL, NULL, '246810')$$, current_setting('fa.m')),
  '22023', 'fixed_asset_sale_fields_only_for_sale'), 'Price and proceeds account belong to a sale only');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-11-20', 'sale', 100, %L, NULL, '246810')$$,
    current_setting('fa.m'), resolve_mapping_account('FIXED_ASSET_DEPRECIATION_EXPENSE')),
  '22023', 'fixed_asset_proceeds_account_invalid'), 'Sale proceeds go to a cash or bank account only');
SELECT set_config('fa.sale', dispose_fixed_asset_v1(current_setting('fa.a2')::uuid, '2026-11-20', 'sale', 2500000,
  resolve_mapping_account('EXPENSE_BANK_OUT'), 'Sold to a neighbour', '246810')::text, true);
INSERT INTO fa_results(tap) SELECT is((current_setting('fa.sale')::jsonb->>'accumulated_depreciation')::numeric, 52083.33::numeric,
  'Disposal first posts the finished months (October), not the disposal month');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(a.code || ':' || l.debit || ':' || l.credit, ',' ORDER BY a.code)
  FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = (current_setting('fa.sale')::jsonb->>'journal_entry_id')::uuid),
  (SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY[
     (SELECT code FROM accounts WHERE id = resolve_mapping_account('EXPENSE_BANK_OUT')) || ':2500000.00:0.00',
     '1610:0.00:2500000.00', '1690:52083.33:0.00', '4950:0.00:52083.33']) x),
  'Sale clears cost and accumulated depreciation; the gain goes to 4950');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM fixed_asset_depreciations
  WHERE asset_id = current_setting('fa.a2')::uuid AND period_month >= '2026-11-01'), 0, 'The disposal month gets no depreciation');

SELECT set_config('fa.scrap', dispose_fixed_asset_v1(current_setting('fa.a1')::uuid, '2026-11-20', 'breakage', NULL, NULL,
  'Dropped', '246810')::text, true);
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(a.code || ':' || l.debit || ':' || l.credit, ',' ORDER BY a.code)
  FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = (current_setting('fa.scrap')::jsonb->>'journal_entry_id')::uuid),
  '1610:0.00:2500000.00,1690:52083.33:0.00,6970:2447916.67:0.00', 'Breakage books the net book value as a loss on 6970');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-11-20', 'scrap', NULL, NULL, NULL, '246810')$$, current_setting('fa.a1')),
  'P0001', 'fixed_asset_already_disposed'), 'A disposed asset cannot be disposed twice');
INSERT INTO fa_results(tap) SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action = 'fixed_asset.disposed'
  AND entity_id = current_setting('fa.a1')::uuid AND actor_id = current_setting('fa.op')::uuid), 'Disposal is audited');

SELECT pg_temp.authenticate_pin(current_setting('fa.ma')::uuid);
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format($$SELECT dispose_fixed_asset_v1(%L, '2026-11-20', 'scrap', NULL, NULL, NULL, '135791')$$, current_setting('fa.m')),
  '42501'), 'Disposal requires accounting.fixed_assets.manage');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises('SELECT get_fixed_assets_v1()', '42501'),
  'The register is read with reports.statements.read only');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  $$SELECT register_existing_fixed_asset_v1('FA y', 'equipment', 'group_1', '2025-10-01', 1000, 0, '2026-09-30', gen_random_uuid())$$,
  '42501'), 'Registration requires accounting.fixed_assets.manage');
SELECT pg_temp.authenticate_pin(current_setting('fa.oa')::uuid);

-- =========================================================================
-- Passage automatique de décembre : octobre et novembre de la machine
-- =========================================================================
SELECT run_fixed_asset_depreciation_v1('2026-12-05');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(period_month || '|' || entry_date || '|' || month_index || '|' || amount || '|' || status, ','
  ORDER BY period_month) FROM fixed_asset_depreciations WHERE asset_id = current_setting('fa.m')::uuid),
  '2026-10-01|2026-10-31|13|599818.75|posted,2026-11-01|2026-11-30|14|599818.75|posted',
  'Machine: October and November posted at month end, months 13 and 14');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(a.code || ':' || l.debit || ':' || l.credit, ',' ORDER BY a.code)
  FROM fixed_asset_depreciations d JOIN journal_entry_lines l ON l.journal_entry_id = d.journal_entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE d.asset_id = current_setting('fa.m')::uuid AND d.period_month = '2026-10-01'),
  '1690:0.00:599818.75,6950:599818.75:0.00', 'Depreciation entry: DR 6950 / CR 1690');
INSERT INTO fa_results(tap) SELECT is((SELECT reference_type || '|' || (metadata->>'movement_type') FROM journal_entries j
  JOIN fixed_asset_depreciations d ON d.journal_entry_id = j.id
  WHERE d.asset_id = current_setting('fa.m')::uuid AND d.period_month = '2026-11-01'),
  'fixed_asset_depreciation|2026-11', 'Depreciation entry carries its month as idempotency key');
INSERT INTO fa_results(tap) SELECT is((run_fixed_asset_depreciation_v1('2026-12-06')->>'posted')::int, 0,
  'A second pass posts nothing: one depreciation per asset and month');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM fixed_asset_depreciations
  WHERE asset_id IN (current_setting('fa.a1')::uuid, current_setting('fa.a2')::uuid) AND period_month >= '2026-11-01'), 0,
  'Disposed assets get nothing from the monthly pass');

INSERT INTO fa_results(tap) SELECT is((SELECT (r->>'accumulated_depreciation') || '|' || (r->>'net_book_value') || '|' || (r->>'months_posted')
  FROM jsonb_array_elements(get_fixed_assets_v1()) r WHERE r->>'id' = current_setting('fa.m')),
  '8397462.50|20393837.50|2', 'Register reads cost, accumulated depreciation and net book value');
INSERT INTO fa_results(tap) SELECT is(jsonb_array_length(get_fixed_asset_v1(current_setting('fa.m')::uuid)->'depreciations'), 2,
  'Asset detail lists its depreciation months');

-- =========================================================================
-- Période fermée : refus signalé, jamais reporté, rattrapé à sa date
-- =========================================================================
SELECT set_config('fa.e3', pg_temp.fa_draft(9600000, '2027-01-10', 'FA freezer')::text, true);
SELECT set_expense_equipment_v1(current_setting('fa.e3')::uuid, 'equipment', 'group_2', 'Blast freezer', 1);
SELECT pg_temp.fa_approve(current_setting('fa.e3')::uuid);
SELECT set_config('fa.a3', (SELECT id::text FROM fixed_assets WHERE expense_id = current_setting('fa.e3')::uuid), true);
INSERT INTO fa_results(tap) SELECT is((SELECT a.code FROM fixed_assets f JOIN accounts a ON a.id = f.asset_account_id
  WHERE f.id = current_setting('fa.a3')::uuid), '1600', 'Equipment type goes to 1600');

UPDATE fiscal_periods SET status = 'closed' WHERE period_start = '2027-02-01';
SELECT run_fixed_asset_depreciation_v1('2027-04-03');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(period_month || '|' || amount || '|' || status, ',' ORDER BY period_month)
  FROM fixed_asset_depreciations WHERE asset_id = current_setting('fa.a3')::uuid),
  '2027-01-01|100000.00|posted,2027-02-01|100000.00|refused,2027-03-01|100000.00|posted',
  'Closed February is refused; January and March are posted');
SELECT run_fixed_asset_depreciation_v1('2027-04-04');
INSERT INTO fa_results(tap) SELECT is((SELECT attempts FROM fixed_asset_depreciations
  WHERE asset_id = current_setting('fa.a3')::uuid AND period_month = '2027-02-01'), 2, 'Each pass retries the refused month');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM audit_logs WHERE action = 'fixed_asset.depreciation_refused'
  AND entity_id = current_setting('fa.a3')::uuid), 1, 'The refusal is signalled once');
INSERT INTO fa_results(tap) SELECT is((SELECT (r->>'refused_months')::int FROM jsonb_array_elements(get_fixed_assets_v1()) r
  WHERE r->>'id' = current_setting('fa.a3')), 1, 'The register shows the refused month');

UPDATE fiscal_periods SET status = 'open' WHERE period_start = '2027-02-01';
SELECT run_fixed_asset_depreciation_v1('2027-04-05');
INSERT INTO fa_results(tap) SELECT is((SELECT d.status || '|' || j.entry_date || '|' || d.amount FROM fixed_asset_depreciations d
  JOIN journal_entries j ON j.id = d.journal_entry_id
  WHERE d.asset_id = current_setting('fa.a3')::uuid AND d.period_month = '2027-02-01'),
  'posted|2027-02-28|100000.00', 'Reopened February catches up at its own date');
INSERT INTO fa_results(tap) SELECT is((SELECT sum(amount) FROM fixed_asset_depreciations
  WHERE asset_id = current_setting('fa.a3')::uuid AND status = 'posted'), 300000.00::numeric,
  'No month absorbed another month');

-- =========================================================================
-- Démarquage d'un brouillon
-- =========================================================================
SELECT set_config('fa.e5', pg_temp.fa_draft(3000000, '2026-11-05', 'FA unmark')::text, true);
SELECT set_expense_equipment_v1(current_setting('fa.e5')::uuid, 'equipment', 'group_1', 'Mixer', 1);
SELECT set_expense_equipment_v1(current_setting('fa.e5')::uuid, NULL);
INSERT INTO fa_results(tap) SELECT ok((SELECT asset_type IS NULL AND asset_quantity IS NULL FROM expenses
  WHERE id = current_setting('fa.e5')::uuid) AND EXISTS(SELECT 1 FROM audit_logs WHERE action = 'expense.equipment_unmarked'
  AND entity_id = current_setting('fa.e5')::uuid), 'A draft can be unmarked, and the unmark is audited');

-- =========================================================================
-- Mois refusé, puis sortie, puis réouverture : rien ne se poste après la sortie
-- =========================================================================
SELECT set_config('fa.e4', pg_temp.fa_draft(2400000, '2026-09-10', 'FA scale')::text, true);
SELECT set_expense_equipment_v1(current_setting('fa.e4')::uuid, 'equipment', 'group_1', 'Scale', 1);
SELECT pg_temp.fa_approve(current_setting('fa.e4')::uuid);
SELECT set_config('fa.a4', (SELECT id::text FROM fixed_assets WHERE expense_id = current_setting('fa.e4')::uuid), true);
UPDATE fiscal_periods SET status = 'closed' WHERE period_start = '2026-10-01';
SELECT run_fixed_asset_depreciation_v1('2026-11-02');
SELECT set_config('fa.scale', dispose_fixed_asset_v1(current_setting('fa.a4')::uuid, '2026-11-20', 'scrap', NULL, NULL,
  NULL, '246810')::text, true);
INSERT INTO fa_results(tap) SELECT is((current_setting('fa.scale')::jsonb->>'accumulated_depreciation') || '|'
  || (current_setting('fa.scale')::jsonb->>'refused_months_unposted'), '50000.00|1',
  'Disposal settles the accumulated depreciation as it is and reports the refused month');
UPDATE fiscal_periods SET status = 'open' WHERE period_start = '2026-10-01';
SELECT run_fixed_asset_depreciation_v1('2026-12-07');
INSERT INTO fa_results(tap) SELECT is((SELECT string_agg(period_month || '|' || status, ',' ORDER BY period_month)
  FROM fixed_asset_depreciations WHERE asset_id = current_setting('fa.a4')::uuid),
  '2026-09-01|posted,2026-10-01|refused', 'A refused month is never posted after the disposal');
INSERT INTO fa_results(tap) SELECT is((SELECT count(*)::int FROM journal_entries
  WHERE reference_type = 'fixed_asset_depreciation' AND reference_id = current_setting('fa.a4')::uuid), 1,
  'Only the September depreciation entry exists for the disposed asset');

-- =========================================================================
-- Fiche figée, dotation passée immuable
-- =========================================================================
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('UPDATE fixed_assets SET cost = cost + 1 WHERE id = %L', current_setting('fa.m')), '22023', 'fixed_asset_frozen'),
  'A card with a posted depreciation keeps its cost');
INSERT INTO fa_results(tap) SELECT ok(pg_temp.fa_raises(
  format('UPDATE fixed_asset_depreciations SET amount = 1 WHERE asset_id = %L AND status = ''posted''', current_setting('fa.m')),
  '42501', 'fixed_asset_depreciation_posted_immutable'), 'A posted depreciation cannot be edited');

SELECT tap FROM fa_results ORDER BY seq;
SELECT * FROM finish();
ROLLBACK;
