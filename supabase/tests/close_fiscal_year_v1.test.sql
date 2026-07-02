-- S54 P1.3 (T6) — close_fiscal_year_v1 : clôture annuelle carry-forward → 3200
-- (migrations 20260710000079 permission + 20260710000080 contrainte+RPC).
--
-- Fixtures isolées dans des années futures (2094 zéro-activité / 2096 perte+dédup /
-- 2098 profit) pour ne capter aucune donnée réelle du projet dev partagé. Orders en
-- 'draft' (pas de trigger JE), triggers USER désactivés sur refunds (pattern
-- pb1_dedup_void_refund). Auth simulée via request.jwt.claim.sub (EMP000 SUPER_ADMIN,
-- PIN forcé 424242 dans la transaction).
-- Run : execute_sql MCP sous BEGIN ... ROLLBACK (capture temp-table).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(19);

-- ==== Fixtures ====
UPDATE user_profiles SET pin_hash = extensions.crypt('424242', extensions.gen_salt('bf'))
 WHERE employee_code='EMP000';
SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO accounts (code,name,account_class,account_type,balance_type,is_postable,is_active) VALUES
 ('4991','CFY Test Revenue',4,'revenue','credit',true,true),
 ('6991','CFY Test Expense',6,'expense','debit',true,true),
 ('1992','CFY Counter',1,'asset','debit',true,true);

-- Périodes : 2094 + 2096 closed ; 2098 closed sauf décembre (open, refermé après T3)
INSERT INTO fiscal_periods (period_start, period_end, status, notes)
SELECT date_trunc('month', d)::DATE,
       (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
       'closed', 'CFY test'
FROM generate_series('2094-01-01'::date,'2094-12-01'::date,'1 month') d
UNION ALL
SELECT date_trunc('month', d)::DATE,
       (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
       'closed', 'CFY test'
FROM generate_series('2096-01-01'::date,'2096-12-01'::date,'1 month') d
UNION ALL
SELECT date_trunc('month', d)::DATE,
       (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
       CASE WHEN date_trunc('month', d)::DATE = '2098-12-01' THEN 'open' ELSE 'closed' END,
       'CFY test'
FROM generate_series('2098-01-01'::date,'2098-12-01'::date,'1 month') d
ON CONFLICT (period_end) DO NOTHING;

-- 2098 : revenu 1000, charge 400 → profit 600
INSERT INTO journal_entries (id, entry_number, entry_date, status, total_debit, total_credit, reference_type, reference_id, created_by) VALUES
 ('cf980001-0000-0000-0000-000000000001','CFY98-JE1','2098-03-10','posted',1000,1000,'manual',NULL,(SELECT id FROM user_profiles WHERE employee_code='EMP000')),
 ('cf980002-0000-0000-0000-000000000002','CFY98-JE2','2098-06-10','posted',400,400,'manual',NULL,(SELECT id FROM user_profiles WHERE employee_code='EMP000'));
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
 ('cf980001-0000-0000-0000-000000000001',(SELECT id FROM accounts WHERE code='1992'),1000,0,'x'),
 ('cf980001-0000-0000-0000-000000000001',(SELECT id FROM accounts WHERE code='4991'),0,1000,'x'),
 ('cf980002-0000-0000-0000-000000000002',(SELECT id FROM accounts WHERE code='6991'),400,0,'x'),
 ('cf980002-0000-0000-0000-000000000002',(SELECT id FROM accounts WHERE code='1992'),0,400,'x');

-- 2096 : charge 500 + triple sale/void/refund 200 sur 4991 (dédup → 4991 net 0) → perte 500
ALTER TABLE refunds DISABLE TRIGGER USER;
INSERT INTO orders (id, order_number, order_type, status, session_id, subtotal, tax_amount, total, created_via,
  loyalty_points_earned, loyalty_points_redeemed, loyalty_redemption_amount, discount_amount,
  promotion_total, is_held, is_historical_import)
VALUES ('cf960001-0000-0000-0000-00000000000a','CFY96-O1','take_out','draft','40991f2d-38cd-4886-9ac0-56b0cbbaede7',200,0,200,'pos',0,0,0,0,0,false,false);
INSERT INTO journal_entries (id, entry_number, entry_date, status, total_debit, total_credit, reference_type, reference_id, created_by) VALUES
 ('cf960001-0000-0000-0000-000000000001','CFY96-JE1','2096-02-10','posted',500,500,'manual',NULL,(SELECT id FROM user_profiles WHERE employee_code='EMP000')),
 ('cf960002-0000-0000-0000-000000000002','CFY96-JE2','2096-03-10','posted',200,200,'sale','cf960001-0000-0000-0000-00000000000a',(SELECT id FROM user_profiles WHERE employee_code='EMP000')),
 ('cf960003-0000-0000-0000-000000000003','CFY96-JE3','2096-03-11','posted',200,200,'sale_void','cf960001-0000-0000-0000-00000000000a',(SELECT id FROM user_profiles WHERE employee_code='EMP000')),
 ('cf960004-0000-0000-0000-000000000004','CFY96-JE4','2096-03-12','posted',200,200,'sale_refund','cf960001-0000-0000-0000-00000000000a',(SELECT id FROM user_profiles WHERE employee_code='EMP000'));
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
 ('cf960001-0000-0000-0000-000000000001',(SELECT id FROM accounts WHERE code='6991'),500,0,'x'),
 ('cf960001-0000-0000-0000-000000000001',(SELECT id FROM accounts WHERE code='1992'),0,500,'x'),
 ('cf960002-0000-0000-0000-000000000002',(SELECT id FROM accounts WHERE code='1992'),200,0,'x'),
 ('cf960002-0000-0000-0000-000000000002',(SELECT id FROM accounts WHERE code='4991'),0,200,'x'),
 ('cf960003-0000-0000-0000-000000000003',(SELECT id FROM accounts WHERE code='4991'),200,0,'x'),
 ('cf960003-0000-0000-0000-000000000003',(SELECT id FROM accounts WHERE code='1992'),0,200,'x'),
 ('cf960004-0000-0000-0000-000000000004',(SELECT id FROM accounts WHERE code='4991'),200,0,'x'),
 ('cf960004-0000-0000-0000-000000000004',(SELECT id FROM accounts WHERE code='1992'),0,200,'x');
INSERT INTO refunds (id, refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void) VALUES
 (gen_random_uuid(),'CFY96-RF1','cf960001-0000-0000-0000-00000000000a','40991f2d-38cd-4886-9ac0-56b0cbbaede7',200,0,'test',
  (SELECT id FROM user_profiles WHERE employee_code='EMP000'),(SELECT id FROM user_profiles WHERE employee_code='EMP000'),true);

-- ==== T1 : profil sans permission → P0003 (jwt bascule le temps de l'appel) ====
SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles
    WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL
      AND NOT has_permission(auth_user_id, 'accounting.year.close') LIMIT 1), true);
SELECT throws_ok($$SELECT close_fiscal_year_v1(2098, '424242')$$, 'P0003', NULL,
  'T1 — permission accounting.year.close requise');
SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

-- ==== T2 : année sans périodes → P0002 ====
SELECT throws_ok($$SELECT close_fiscal_year_v1(2092, '424242')$$, 'P0002', NULL,
  'T2 — annee sans periodes seedees rejetee (fiscal_year_periods_missing)');

-- ==== T3 : décembre 2098 open → P0003 ====
SELECT throws_ok($$SELECT close_fiscal_year_v1(2098, '424242')$$, 'P0003', NULL,
  'T3 — periode encore open rejetee (fiscal_year_periods_open)');

-- ==== T4 : PIN invalide → P0003 ====
UPDATE fiscal_periods SET status='closed' WHERE period_start='2098-12-01';
SELECT throws_ok($$SELECT close_fiscal_year_v1(2098, '999999')$$, 'P0003', NULL,
  'T4 — PIN invalide rejete (via _verify_pin_with_lockout)');

-- ==== T5-T9 : happy path profit 2098 ====
CREATE TEMP TABLE _r98 ON COMMIT DROP AS
  SELECT close_fiscal_year_v1(2098, '424242') AS j;

SELECT ok((SELECT (j->>'net_result')::numeric = 600 AND (j->>'line_count')::int = 2 FROM _r98),
  'T5 — profit : net_result 600, 2 lignes P&L');
SELECT ok((SELECT je.total_debit = je.total_credit AND je.total_debit = 1000
     FROM journal_entries je WHERE je.id = (SELECT (j->>'je_id')::uuid FROM _r98)),
  'T6 — JE year_close equilibree (1000/1000 : Dr 4991 1000 ; Cr 6991 400 + Cr 3200 600)');
SELECT ok((SELECT l.credit = 600 AND l.debit = 0 FROM journal_entry_lines l
    WHERE l.journal_entry_id = (SELECT (j->>'je_id')::uuid FROM _r98)
      AND l.account_id = (SELECT id FROM accounts WHERE code='3200')),
  'T7 — profit credite 3200 (CR 600)');
SELECT ok((SELECT COALESCE(SUM(jel.credit)-SUM(jel.debit),0) = 0
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id=jel.journal_entry_id
     JOIN accounts a ON a.id=jel.account_id
    WHERE a.code IN ('4991','6991')
      AND je.entry_date BETWEEN '2098-01-01' AND '2098-12-31'
      AND je.status='posted'),
  'T8 — nets 4/5/6 de l''exercice zerotes (fenetre 2098, year_close incluse)');
SELECT ok((SELECT (SELECT (j->>'periods_seeded_next_year')::int FROM _r98) = 12
      AND (SELECT COUNT(*) FROM fiscal_periods
            WHERE period_start >= '2099-01-01' AND period_end <= '2099-12-31'
              AND status='open') = 12),
  'T9 — 12 periodes 2099 seedees open (fail-closed _077 sans bombe a retardement)');

-- ==== T10 : replay → year_already_closed ====
SELECT throws_ok($$SELECT close_fiscal_year_v1(2098, '424242')$$, 'P0003', NULL,
  'T10 — replay rejete (year_already_closed)');

-- ==== T11-T12 : perte + dédup 2096 ====
CREATE TEMP TABLE _r96 ON COMMIT DROP AS
  SELECT close_fiscal_year_v1(2096, '424242') AS j;
SELECT ok((SELECT (j->>'net_result')::numeric = -500 FROM _r96),
  'T11 — perte 500 : sale_void dedupliquee (sinon -700), net_result -500');
SELECT ok((SELECT l.debit = 500 AND l.credit = 0 FROM journal_entry_lines l
    WHERE l.journal_entry_id = (SELECT (j->>'je_id')::uuid FROM _r96)
      AND l.account_id = (SELECT id FROM accounts WHERE code='3200')),
  'T12 — perte debite 3200 (DR 500)');

-- ==== T13 : zéro activité 2094 → je_id null, pas de JE ====
CREATE TEMP TABLE _r94 ON COMMIT DROP AS
  SELECT close_fiscal_year_v1(2094, '424242') AS j;
SELECT ok((SELECT (j->'je_id') = 'null'::jsonb
      AND NOT EXISTS (SELECT 1 FROM journal_entries
                       WHERE reference_type='year_close' AND entry_date='2094-12-31')
     FROM _r94),
  'T13 — annee sans activite P&L : aucune JE emise (je_id null)');

-- ==== T14 : audit rows ====
SELECT ok((SELECT COUNT(*) = 3 FROM audit_log WHERE action='accounting.year.closed'
    AND (payload->>'fiscal_year')::int IN (2094,2096,2098)),
  'T14 — 1 row audit accounting.year.closed par cloture');

-- ==== T15 : ACL defense-in-depth ====
SELECT ok(NOT has_function_privilege('anon','public.close_fiscal_year_v1(int,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.close_fiscal_year_v1(int,text)','EXECUTE'),
  'T15 — anon sans EXECUTE, authenticated avec');

-- ==== T16-T19 : rapports post-clôture (migration _081 — exclusion year_close) ====
SELECT ok((SELECT (get_profit_loss_v2('2098-01-01','2098-12-31')->>'net_profit')::numeric = 600),
  'T16 — P&L exercice 2098 post-cloture lit toujours 600 (year_close exclue)');
SELECT ok((SELECT (j->>'total_debit')::numeric = 0 AND (j->>'balanced')::boolean
     FROM (SELECT get_trial_balance_v3('2098-12-01','2098-12-31') AS j) s),
  'T17 — TB decembre 2098 : colonnes de periode non gonflees par la JE de cloture (0, balanced)');
-- 3200 cumule les DEUX clôtures de la suite : +600 (profit 2098) − 500 (perte 2096) = 100
SELECT ok((SELECT (e->>'balance')::numeric = 100 AND (e->>'opening_balance')::numeric = 100
     FROM jsonb_array_elements((get_trial_balance_v3('2099-01-01','2099-01-31'))->'lines') e
    WHERE e->>'code'='3200')
  AND NOT EXISTS (SELECT 1
     FROM jsonb_array_elements((get_trial_balance_v3('2099-01-01','2099-01-31'))->'lines') e
    WHERE e->>'code' IN ('4991','6991')),
  'T18 — TB 2099 : 3200 porte le report cumule 100 (600-500), 4991/6991 rouvrent a 0');
SELECT ok((SELECT (l->>'balance')::numeric = 100
     FROM jsonb_array_elements((get_balance_sheet_v2('2098-12-31'))->'lines') l
    WHERE l->>'code'='3200'),
  'T19 — BS 31/12/2098 : 3200 Retained Earnings = 100 (CYE YTD retombe a 0, aucun changement BS requis)');

SELECT * FROM finish();
ROLLBACK;
