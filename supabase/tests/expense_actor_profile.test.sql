-- supabase/tests/expense_actor_profile.test.sql
-- Audit lot 1, P0 n7/n8 — les huit RPCs de dépenses écrivaient auth.uid() (l'auth id) dans
-- audit_logs.actor_id et journal_entries.created_by, deux colonnes dont la FK cible
-- user_profiles(id). Tout compte créé par le back-office (create_user_v1) a
-- user_profiles.id <> auth_user_id : la première écriture derrière ce chemin levait
-- foreign_key_violation (23503) et faisait rouler en arrière tout le module dépenses
-- (create, submit, approve, reject, pay, set/delete threshold).
--
-- Les suites existantes (expense_governance.test.sql, expenses.test.sql) ne pouvaient PAS
-- voir ce bug : tous leurs fixtures utilisateurs (EMP000/EMP001/EMP003/ADMIN2) ont
-- id = auth_user_id (comptes SEED historiques). Ce fichier construit deux profils au
-- format create_user_v1 réel (id <> auth_user_id, cf.
-- close_shift_v8_closed_by_profile.test.sql:27-40) — un créateur SUPER_ADMIN et un
-- approbateur ADMIN — et exerce les SEPT RPCs versionnées (create_expense_v2,
-- submit_expense_v3, approve_expense_v4, reject_expense_v2, pay_expense_v2,
-- set_expense_threshold_v2, delete_expense_threshold_v2) plus le helper interne
-- _emit_expense_je (appelé en place par submit/approve).
--
-- AVANT la migration de fix (les 7 RPCs ci-dessus n'existent pas encore sous ces noms) :
-- le run RED de ce fichier échoue sur "function ... does not exist" (42883), pas sur
-- 23503 — c'est le RED attendu, pas un défaut de ce test.
-- APRÈS la migration : chaque appel doit lives_ok, et actor_id / created_by doivent
-- porter le user_profiles.id de l'appelant, jamais son auth_user_id.
--
-- Couverture (T1-T10, certains Tn éclatés en sous-assertions Tna/Tnb quand plusieurs
-- vérifications distinctes portent sur le même appel — pattern T14/T18 de
-- expense_governance.test.sql) :
--   T1  : create_expense_v2 par le créateur SUPER_ADMIN → lives_ok (RED attendu : 23503
--         avant fix / "does not exist" avant migration).
--   T2  : audit_logs.actor_id pour action='expense.create' = profil créateur (pas l'auth id).
--   T3a : submit_expense_v3 sur ce même montant (bracket [0,100k) → auto-approve) → lives_ok.
--   T3b : journal_entries.created_by (reference_type='expense') = profil créateur.
--   T4a : submit_expense_v3 (bracket [100k,1M) 1 step) puis approve_expense_v4 par
--         l'approbateur ADMIN → lives_ok.
--   T4b : audit_logs.actor_id pour action='expense.approved_step' = profil approbateur.
--   T4c : journal_entries.created_by (reference_type='expense', 2e dépense) = profil approbateur.
--   T5  : reject_expense_v2 par l'approbateur sur une 3e dépense soumise →
--         audit_logs.actor_id pour action='expense.reject' = profil approbateur.
--   T6a : pay_expense_v2 (dépense credit, 4e dépense) → journal_entries.created_by
--         (reference_type='expense_payment') = profil payeur (approbateur).
--   T6b : audit_logs.actor_id pour action='expense.pay' = profil payeur.
--   T7  : set_expense_threshold_v2 → audit_logs.actor_id pour
--         action='expense_threshold.created' = profil approbateur.
--   T8  : delete_expense_threshold_v2 sur ce même threshold → audit_logs.actor_id pour
--         action='expense_threshold.deleted' = profil approbateur.
--   T9  : les 7 anciennes versions (create_expense_v1, submit_expense_v2,
--         approve_expense_v3, reject_expense_v1, pay_expense_v1, set_expense_threshold_v1,
--         delete_expense_threshold_v1) n'existent plus (versioning monotone).
--   T10 : anon n'a EXECUTE sur aucune des 7 nouvelles versions.
--
-- Run via MCP execute_sql, wrappé BEGIN ... ROLLBACK (aucune trace ne persiste).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================================================
-- Fixtures : deux profils create_user_v1-style (id <> auth_user_id) + 1 catégorie test.
-- ============================================================================

DO $fixture$
DECLARE
  v_creator_auth  UUID := 'a7a70000-0000-0000-0000-0000000000a1';
  v_creator_prof  UUID := 'a7a70000-0000-0000-0000-0000000000b1';  -- deliberately <> auth id
  v_approver_auth UUID := 'a7a70000-0000-0000-0000-0000000000a2';
  v_approver_prof UUID := 'a7a70000-0000-0000-0000-0000000000b2';  -- deliberately <> auth id
  v_cat_account   UUID;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_creator_auth), (v_approver_auth);

  INSERT INTO user_profiles (id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
  VALUES
    (v_creator_prof,  v_creator_auth,  'SUPER_ADMIN', 'ActorProf Creator SA',  'EMP-ACTORPROF-1', TRUE, crypt('123456', gen_salt('bf'))),
    (v_approver_prof, v_approver_auth, 'ADMIN',       'ActorProf Approver AD', 'EMP-ACTORPROF-2', TRUE, crypt('123456', gen_salt('bf')));

  SELECT id INTO v_cat_account FROM accounts WHERE code = '6190' LIMIT 1;

  INSERT INTO expense_categories (id, code, name, account_id)
  VALUES ('a7a70000-0000-0000-0000-0000000000c1', 'T_ACTORPROF_CAT', 'ActorProf Test Cat', v_cat_account);
END $fixture$;

-- Act as the creator (SUPER_ADMIN) for T1-T4's create+submit legs.
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', 'a7a70000-0000-0000-0000-0000000000a1', TRUE); END $$;

-- ============================================================================
-- T4 fixture : 2e dépense, direct INSERT en draft (500k → bracket [100k,1M) 1 step),
-- soumise ici pendant que l'acteur courant est le créateur.
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES (
  'a7a70000-0000-0000-0000-0000000000e2', 'EXP-ACTORPROF-002',
  'a7a70000-0000-0000-0000-0000000000c1', 500000, 0, 'cash',
  'ACTORPROF T4 one-step', CURRENT_DATE,
  'a7a70000-0000-0000-0000-0000000000b1', 'draft'
);

SELECT submit_expense_v3('a7a70000-0000-0000-0000-0000000000e2');

-- ============================================================================
-- T5 fixture : 3e dépense, direct INSERT en draft (500k, même bracket), soumise ici.
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES (
  'a7a70000-0000-0000-0000-0000000000e3', 'EXP-ACTORPROF-003',
  'a7a70000-0000-0000-0000-0000000000c1', 500000, 0, 'cash',
  'ACTORPROF T5 reject', CURRENT_DATE,
  'a7a70000-0000-0000-0000-0000000000b1', 'draft'
);

SELECT submit_expense_v3('a7a70000-0000-0000-0000-0000000000e3');

-- ============================================================================
-- T1 : create_expense_v2 par le créateur — la toute première écriture audit_logs du
-- module (la ligne qui plantait 23503 avant fix / "does not exist" avant migration).
-- ============================================================================

SELECT plan(14);

SELECT lives_ok(
  $$ SELECT create_expense_v2(
       'a7a70000-0000-0000-0000-0000000000c1'::uuid, 50000, 'cash',
       'ACTORPROF T1 create', CURRENT_DATE
     ) $$,
  'T1 : create_expense_v2 by profile.id <> auth_user_id creator lives (P0 regression)'
);

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense.create'
      AND entity_type = 'expense'
      AND entity_id = (SELECT id FROM expenses WHERE description = 'ACTORPROF T1 create')),
  'a7a70000-0000-0000-0000-0000000000b1'::uuid,
  'T2 : audit_logs.actor_id for expense.create = creator profile id (not auth id)'
);

-- T3a/T3b : submit the T1 expense (50k → auto-approve bracket [0,100k)) → JE created_by.

SELECT lives_ok(
  $$ SELECT submit_expense_v3((SELECT id FROM expenses WHERE description = 'ACTORPROF T1 create')) $$,
  'T3a : submit_expense_v3 auto-approve path lives (creator profile.id <> auth_user_id)'
);

SELECT is(
  (SELECT je.created_by FROM journal_entries je
    WHERE je.reference_type = 'expense'
      AND je.reference_id = (SELECT id FROM expenses WHERE description = 'ACTORPROF T1 create')),
  'a7a70000-0000-0000-0000-0000000000b1'::uuid,
  'T3b : journal_entries.created_by (auto-approve JE) = creator profile id'
);

-- T4a/T4b/T4c : switch to the ADMIN approver, final-step approve the 1-step expense.

DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', 'a7a70000-0000-0000-0000-0000000000a2', TRUE); END $$;

SELECT lives_ok(
  $$ SELECT approve_expense_v4('a7a70000-0000-0000-0000-0000000000e2'::uuid, '123456') $$,
  'T4a : approve_expense_v4 by profile.id <> auth_user_id approver lives (P0 regression)'
);

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense.approved_step'
      AND entity_type = 'expense'
      AND entity_id = 'a7a70000-0000-0000-0000-0000000000e2'),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T4b : audit_logs.actor_id for expense.approved_step = approver profile id'
);

SELECT is(
  (SELECT je.created_by FROM journal_entries je
    WHERE je.reference_type = 'expense'
      AND je.reference_id = 'a7a70000-0000-0000-0000-0000000000e2'),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T4c : journal_entries.created_by (approve JE) = approver profile id'
);

-- T5 : reject the 3rd (submitted) expense as the approver.

SELECT reject_expense_v2('a7a70000-0000-0000-0000-0000000000e3', 'ActorProf rejection reason');

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense.reject'
      AND entity_type = 'expense'
      AND entity_id = 'a7a70000-0000-0000-0000-0000000000e3'),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T5 : audit_logs.actor_id for expense.reject = approver profile id'
);

-- T6a/T6b : 4th expense, credit method, created + submitted + paid entirely by the
-- approver (auto-approve bracket, so pay_expense_v2 emits the 2nd JE, credit path).

INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES (
  'a7a70000-0000-0000-0000-0000000000e4', 'EXP-ACTORPROF-004',
  'a7a70000-0000-0000-0000-0000000000c1', 50000, 0, 'credit',
  'ACTORPROF T6 pay', CURRENT_DATE,
  'a7a70000-0000-0000-0000-0000000000b2', 'draft'
);

SELECT submit_expense_v3('a7a70000-0000-0000-0000-0000000000e4');
SELECT pay_expense_v2('a7a70000-0000-0000-0000-0000000000e4', 'transfer');

SELECT is(
  (SELECT je.created_by FROM journal_entries je
    WHERE je.reference_type = 'expense_payment'
      AND je.reference_id = 'a7a70000-0000-0000-0000-0000000000e4'),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T6a : journal_entries.created_by (payment JE) = payer profile id'
);

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense.pay'
      AND entity_type = 'expense'
      AND entity_id = 'a7a70000-0000-0000-0000-0000000000e4'),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T6b : audit_logs.actor_id for expense.pay = payer profile id'
);

-- T7 : set_expense_threshold_v2 by the approver (ADMIN has expenses.thresholds.write).

SELECT set_expense_threshold_v2(
  NULL, 'a7a70000-0000-0000-0000-0000000000c1'::uuid, 5000000, 6000000,
  '[{"role_codes":["ADMIN","SUPER_ADMIN"],"label":"ActorProf test step"}]'::jsonb
);

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense_threshold.created'
      AND entity_type = 'expense_approval_thresholds'
      AND (metadata->>'category_id')::uuid = 'a7a70000-0000-0000-0000-0000000000c1'::uuid),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T7 : audit_logs.actor_id for expense_threshold.created = approver profile id'
);

-- T8 : delete_expense_threshold_v2 on the threshold just created above.

DO $$
DECLARE v_tid UUID;
BEGIN
  SELECT id INTO v_tid FROM expense_approval_thresholds
   WHERE category_id = 'a7a70000-0000-0000-0000-0000000000c1'::uuid LIMIT 1;
  IF v_tid IS NULL THEN RAISE EXCEPTION 'T8: ActorProf threshold not found'; END IF;
  PERFORM delete_expense_threshold_v2(v_tid);
  PERFORM set_config('test.actorprof_tid', v_tid::text, false);
END $$;

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE action = 'expense_threshold.deleted'
      AND entity_type = 'expense_approval_thresholds'
      AND entity_id = current_setting('test.actorprof_tid')::uuid),
  'a7a70000-0000-0000-0000-0000000000b2'::uuid,
  'T8 : audit_logs.actor_id for expense_threshold.deleted = approver profile id'
);

-- T9 : the 7 pre-fix versions no longer exist (monotonic RPC versioning).

SELECT is(
  (SELECT COUNT(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'create_expense_v1', 'submit_expense_v2', 'approve_expense_v3',
      'reject_expense_v1', 'pay_expense_v1',
      'set_expense_threshold_v1', 'delete_expense_threshold_v1'
    )),
  0,
  'T9 : all 7 pre-actor-profile-fix RPC versions dropped'
);

-- T10 : anon has EXECUTE on none of the 7 new versions.

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN (
     'create_expense_v2', 'submit_expense_v3', 'approve_expense_v4',
     'reject_expense_v2', 'pay_expense_v2',
     'set_expense_threshold_v2', 'delete_expense_threshold_v2'
   )),
  true,
  'T10 : anon REVOKEd on all 7 new actor-profile-fix RPC versions'
);

SELECT * FROM finish();

ROLLBACK;
