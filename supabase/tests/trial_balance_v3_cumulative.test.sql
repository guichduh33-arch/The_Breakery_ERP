-- S50 Vague 2a-i · T3 — get_trial_balance_v3 : soldes cumulatifs as-of (comptes permanents)
--
-- Comptes de test ISOLES (codes 1990/4990/2990, neufs dans la transaction) pour des soldes
-- propres : le projet dev partagé porte déjà des écritures réelles sur les comptes du COA.
--
-- Scénario, période = ['2026-06-01','2026-06-30'] :
--   • 1990 (actif, débit, classe 1) : ouverture Dr 1000 + Dr 500 (avant start) + période Dr 300.
--   • 4990 (revenue, crédit, classe 4) : ouverture Cr 1000 (avant start) + période Cr 300.
--   • 2990 (passif, crédit, classe 2) : ouverture Cr 500 (avant start) ; AUCUN mouvement de période.
--
-- Attendu v3 :
--   T1 1990.balance   = 1800  (cumul as-of end = ouverture 1500 + période 300) — v2 donnait 300.
--   T2 1990.opening   = 1500  (cumul strictement avant start).
--   T3 4990.balance   = 300   (comptes de résultat : net de PÉRIODE seul, pas le cumul 1300).
--   T4 2990.balance   = 500 et total_debit période = 0 (compte permanent à ouverture seule : surface).
--   T5 invariant TB    : mouvements de période globalement équilibrés (balanced=true, delta=0).
--   T6 v2 droppée (bump v2→v3).
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Auth simulée via request.jwt.claim.sub (EMP000,
-- SUPER_ADMIN → a accounting.tb.read). Insertions JE directes (aucun trigger de validation sur
-- journal_entries/journal_entry_lines hormis set_updated_at ; idempotency-uniq non touchée car
-- reference_id=NULL est distinct).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO accounts (code,name,account_class,account_type,balance_type,is_postable,is_active) VALUES
 ('1990','TBV3 Test Cash',1,'asset','debit',true,true),
 ('4990','TBV3 Test Revenue',4,'revenue','credit',true,true),
 ('2990','TBV3 Test Payable',2,'liability','credit',true,true);

INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, created_by)
VALUES ('TBV3-A','2026-05-15','open A','manual',NULL,'posted',(SELECT id FROM user_profiles WHERE employee_code='EMP000'));
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-A'),(SELECT id FROM accounts WHERE code='1990'),1000,0,'x'),
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-A'),(SELECT id FROM accounts WHERE code='4990'),0,1000,'x');

INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, created_by)
VALUES ('TBV3-B','2026-05-20','open B','manual',NULL,'posted',(SELECT id FROM user_profiles WHERE employee_code='EMP000'));
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-B'),(SELECT id FROM accounts WHERE code='1990'),500,0,'x'),
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-B'),(SELECT id FROM accounts WHERE code='2990'),0,500,'x');

INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, created_by)
VALUES ('TBV3-C','2026-06-10','period C','manual',NULL,'posted',(SELECT id FROM user_profiles WHERE employee_code='EMP000'));
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-C'),(SELECT id FROM accounts WHERE code='1990'),300,0,'x'),
 ((SELECT id FROM journal_entries WHERE entry_number='TBV3-C'),(SELECT id FROM accounts WHERE code='4990'),0,300,'x');

CREATE TEMP TABLE _tb ON COMMIT DROP AS
  SELECT get_trial_balance_v3('2026-06-01','2026-06-30') AS j;

CREATE TEMP TABLE _line ON COMMIT DROP AS
  SELECT e->>'code' AS code,
         (e->>'balance')::numeric         AS balance,
         (e->>'opening_balance')::numeric AS opening,
         (e->>'total_debit')::numeric     AS td,
         (e->>'total_credit')::numeric    AS tc
  FROM _tb, jsonb_array_elements((_tb.j)->'lines') e;

SELECT ok((SELECT balance FROM _line WHERE code='1990') = 1800,
  'T1 — 1990 (permanent) balance = cumul as-of end 1800 (ouverture 1500 + periode 300) [v2 aurait donne 300]');
SELECT ok((SELECT opening FROM _line WHERE code='1990') = 1500,
  'T2 — 1990 opening_balance = 1500 (cumul avant start)');
SELECT ok((SELECT balance FROM _line WHERE code='4990') = 300,
  'T3 — 4990 (resultat) balance = net de periode 300 seul (PAS le cumul 1300)');
SELECT ok((SELECT balance FROM _line WHERE code='2990') = 500 AND (SELECT td FROM _line WHERE code='2990')=0,
  'T4 — 2990 (permanent, ouverture seule sans mouvement de periode) apparait avec balance 500');
SELECT ok((SELECT ((j)->>'balanced')::boolean AND ((j)->>'delta')::numeric=0 FROM _tb),
  'T5 — invariant TB : mouvements de periode equilibres globalement (balanced=true, delta=0)');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='get_trial_balance_v2'),
  'T6 — get_trial_balance_v2 droppe (bump v2->v3)');

SELECT * FROM finish();
ROLLBACK;
