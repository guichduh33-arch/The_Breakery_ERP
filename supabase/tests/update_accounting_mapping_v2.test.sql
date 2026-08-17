-- supabase/tests/update_accounting_mapping_v2.test.sql
--
-- Lot C (audit accounting 2026-08-17) — update_accounting_mapping_v2.
-- Preuve du correctif : v1 exigeait un compte cible actif+postable
-- inconditionnellement, y compris pour DÉSACTIVER un mapping — un mapping
-- pointant déjà vers un compte désactivé (ex. EXPENSE_VAT_INPUT/
-- PURCHASE_VAT_INPUT → 1151 inactif NON-PKP) devenait indésactivable. v2
-- n'exige actif+postable que quand p_is_active = true.
--
-- Fixtures : deux comptes de test insérés en direct (ZTAP9901 actif,
-- ZTAP9902 rendu inactif par UPDATE direct — simule le compte découvert
-- désactivé pendant qu'un mapping le référence encore) + un mapping de test
-- ZTAP_TEST_MAPPING_V2. Toute la fixture vit dans la transaction rollbackée
-- ci-dessous — aucune donnée de prod touchée.
--
-- T1-T3 : désactiver (p_is_active=false) un mapping qui pointe vers un
--         compte inactif RÉUSSIT (pas d'exception), le mapping passe
--         is_active=false, une ligne audit_logs est écrite.
-- T4    : activer (p_is_active=true) ce même mapping vers ce même compte
--         inactif reste refusé (23514 account_inactive) — le trou v1 ne
--         s'est pas rouvert côté activation.
-- T5-T6 : repoint actif→actif (chemin nominal) fonctionne toujours —
--         non-régression.
-- T7    : sans permission (CASHIER) → 42501.
--
-- Style : contexte auth via request.jwt.claims (cf. pb1_dedup_void_refund
-- .test.sql), GUC pass-flag entre DO blocks pour chaîner les assertions
-- (DEV-S25-2.A-03, cf. sale_je_b2b_guard.test.sql).
-- Run : execute_sql MCP sous BEGIN ... ROLLBACK.

BEGIN;
SELECT plan(7);

---------------------------------------------------------------------------
-- Fixture : contexte auth ADMIN/SUPER_ADMIN (accounting.mapping.update)
-- + deux comptes de test + un mapping de test pointant vers le compte
-- qui sera rendu inactif.
---------------------------------------------------------------------------
DO $fixture$
DECLARE v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'accounting.mapping.update') LIMIT 1;

  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: no profile found with accounting.mapping.update permission';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $fixture$;

INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_active, cash_flow_section) VALUES
  ('ZTAP9901', 'pgTAP fixture — active target',   6, 'expense', 'debit', true, true,  'operating'),
  ('ZTAP9902', 'pgTAP fixture — deactivated later', 6, 'expense', 'debit', true, true, 'operating');

-- Rendu inactif APRÈS création — simule un compte qui se fait désactiver
-- (update_account_active) alors qu'un mapping le référence toujours.
UPDATE accounts SET is_active = false WHERE code = 'ZTAP9902';

INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active) VALUES
  ('ZTAP_TEST_MAPPING_V2', 'ZTAP9902', 'pgTAP fixture — do not use outside test', true);

---------------------------------------------------------------------------
-- T1-T3 : désactivation d'un mapping pointant vers un compte inactif.
---------------------------------------------------------------------------
DO $t1$
DECLARE v_ok BOOLEAN := true;
BEGIN
  BEGIN
    PERFORM update_accounting_mapping_v2(
      'ZTAP_TEST_MAPPING_V2', 'ZTAP9902', false,
      'pgtap: deactivate mapping pointing at an already-inactive account'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;
  PERFORM set_config('mapv2.t1_pass', v_ok::text, true);
END $t1$;

SELECT ok(
  current_setting('mapv2.t1_pass')::boolean,
  'T1 — deactivating a mapping toward an inactive account succeeds without exception (Lot C fix)'
);

SELECT is(
  (SELECT is_active FROM accounting_mappings WHERE mapping_key = 'ZTAP_TEST_MAPPING_V2'),
  false,
  'T2 — mapping is now is_active=false'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM audit_logs
     WHERE action = 'accounting.mapping.update'
       AND metadata->>'mapping_key' = 'ZTAP_TEST_MAPPING_V2'
       AND metadata->>'new_is_active' = 'false'
  ),
  'T3 — audit_logs row written for the deactivation (new_is_active=false)'
);

---------------------------------------------------------------------------
-- T4 : activer ce même mapping vers ce même compte (toujours inactif)
-- reste refusé — le gate actif+postable tient toujours quand p_is_active=true.
---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT update_accounting_mapping_v2('ZTAP_TEST_MAPPING_V2', 'ZTAP9902', true, 'pgtap: activation toward inactive account must stay refused') $$,
  '23514',
  'account_inactive: ZTAP9902',
  'T4 — activating toward an inactive account is still refused (23514 account_inactive)'
);

---------------------------------------------------------------------------
-- T5-T6 : repoint actif→actif (chemin nominal) — non-régression.
---------------------------------------------------------------------------
DO $t5$
DECLARE v_ok BOOLEAN := true;
BEGIN
  BEGIN
    PERFORM update_accounting_mapping_v2(
      'ZTAP_TEST_MAPPING_V2', 'ZTAP9901', true,
      'pgtap: repoint to an active postable account (nominal path)'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;
  PERFORM set_config('mapv2.t5_pass', v_ok::text, true);
END $t5$;

SELECT ok(
  current_setting('mapv2.t5_pass')::boolean,
  'T5 — repoint active->active mapping succeeds (non-regression of the nominal path)'
);

SELECT is(
  (SELECT account_code FROM accounting_mappings WHERE mapping_key = 'ZTAP_TEST_MAPPING_V2'),
  'ZTAP9901',
  'T6 — mapping.account_code updated to the new active account'
);

---------------------------------------------------------------------------
-- T7 : sans permission (CASHIER, cf. supabase/seed.sql
-- 00000000-0000-0000-0000-000000000002) -> 42501.
---------------------------------------------------------------------------
DO $t7$
DECLARE v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002"}', true);
  BEGIN
    PERFORM update_accounting_mapping_v2('ZTAP_TEST_MAPPING_V2', 'ZTAP9901', false, 'pgtap: cashier denied');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('mapv2.t7_pass', v_caught::text, true);
END $t7$;

SELECT ok(
  current_setting('mapv2.t7_pass')::boolean,
  'T7 — CASHIER without accounting.mapping.update raises 42501'
);

SELECT * FROM finish();
ROLLBACK;
