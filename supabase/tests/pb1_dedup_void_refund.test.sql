-- S50 Vague 2a-i · T1 — calculate_pb1_payable_v1 dédup void+refund
-- Prouve que la JE sale_void est exclue du calcul PB1 quand un refund existe pour le
-- même order (sinon double contre-passement de 2110 → PB1 sous-déclaré PEMDA Bali).
-- Fixtures en insert direct, isolés dans des fenêtres de date futures (2099) pour ne pas
-- capter de données réelles. orders en 'draft' (pas de trigger JE de vente) ; triggers
-- USER désactivés sur refunds dans la transaction (sinon fn_create_je_for_refund crée une
-- JE refund auto datée du jour, hors fenêtre) — la contrainte FK order_id reste active.
-- Run : execute_sql MCP sous BEGIN ... ROLLBACK.

BEGIN;
SELECT plan(3);

ALTER TABLE refunds DISABLE TRIGGER USER;

-- 3 orders de test (draft : aucun trigger JE)
INSERT INTO orders (id, order_number, order_type, status, session_id, subtotal, tax_amount, total, created_via,
  loyalty_points_earned, loyalty_points_redeemed, loyalty_redemption_amount, discount_amount,
  promotion_total, is_held, is_historical_import)
VALUES
 ('aaaa0001-0000-0000-0000-000000000001','PB1T-O1','take_out','draft','40991f2d-38cd-4886-9ac0-56b0cbbaede7',7000,0,7000,'pos',0,0,0,0,0,false,false),
 ('aaaa0002-0000-0000-0000-000000000002','PB1T-O2','take_out','draft','40991f2d-38cd-4886-9ac0-56b0cbbaede7',5000,0,5000,'pos',0,0,0,0,0,false,false),
 ('aaaa0003-0000-0000-0000-000000000003','PB1T-O3','take_out','draft','40991f2d-38cd-4886-9ac0-56b0cbbaede7',3000,0,3000,'pos',0,0,0,0,0,false,false);

-- O1 : vente, crédit 2110 = 7000 (fenêtre 2099-01)
INSERT INTO journal_entries (id, entry_number, entry_date, status, total_debit, total_credit, metadata, reference_type, reference_id, created_by) VALUES
 ('bbbb0001-0000-0000-0000-000000000001','PB1T-JE1','2099-01-15','posted',7000,7000,'{}','sale','aaaa0001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004');
INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit) VALUES
 (gen_random_uuid(),'bbbb0001-0000-0000-0000-000000000001','07d638db-baac-4cda-ab75-8515702c26d1',0,7000);

-- O2 : vente 5000 + void 5000 + refund 5000 + ligne refunds (fenêtre 2099-02) → cas du bug
INSERT INTO journal_entries (id, entry_number, entry_date, status, total_debit, total_credit, metadata, reference_type, reference_id, created_by) VALUES
 ('bbbb0002-0000-0000-0000-000000000002','PB1T-JE2','2099-02-15','posted',5000,5000,'{}','sale',       'aaaa0002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004'),
 ('bbbb0003-0000-0000-0000-000000000003','PB1T-JE3','2099-02-16','posted',5000,5000,'{}','sale_void',  'aaaa0002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004'),
 ('bbbb0004-0000-0000-0000-000000000004','PB1T-JE4','2099-02-17','posted',5000,5000,'{}','sale_refund', 'aaaa0002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');
INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit) VALUES
 (gen_random_uuid(),'bbbb0002-0000-0000-0000-000000000002','07d638db-baac-4cda-ab75-8515702c26d1',0,5000),
 (gen_random_uuid(),'bbbb0003-0000-0000-0000-000000000003','07d638db-baac-4cda-ab75-8515702c26d1',5000,0),
 (gen_random_uuid(),'bbbb0004-0000-0000-0000-000000000004','07d638db-baac-4cda-ab75-8515702c26d1',5000,0);
INSERT INTO refunds (id, refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void) VALUES
 (gen_random_uuid(),'PB1T-RF2','aaaa0002-0000-0000-0000-000000000002','40991f2d-38cd-4886-9ac0-56b0cbbaede7',5000,5000,'test full void','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004',true);

-- O3 : vente 3000 + void 3000, AUCUN refund (fenêtre 2099-03) → void doit compter
INSERT INTO journal_entries (id, entry_number, entry_date, status, total_debit, total_credit, metadata, reference_type, reference_id, created_by) VALUES
 ('bbbb0005-0000-0000-0000-000000000005','PB1T-JE5','2099-03-15','posted',3000,3000,'{}','sale',     'aaaa0003-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'),
 ('bbbb0006-0000-0000-0000-000000000006','PB1T-JE6','2099-03-16','posted',3000,3000,'{}','sale_void','aaaa0003-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit) VALUES
 (gen_random_uuid(),'bbbb0005-0000-0000-0000-000000000005','07d638db-baac-4cda-ab75-8515702c26d1',0,3000),
 (gen_random_uuid(),'bbbb0006-0000-0000-0000-000000000006','07d638db-baac-4cda-ab75-8515702c26d1',3000,0);

SELECT is((calculate_pb1_payable_v1('2099-01-01','2099-01-31')->>'pb1_output')::numeric, 7000::numeric,
  'T1 happy path — crédit 2110 sur vente compté intégralement');
SELECT is((calculate_pb1_payable_v1('2099-02-01','2099-02-28')->>'pb1_output')::numeric, 0::numeric,
  'T2 dédup — sale_void exclue car refund existe (sans dédup = -5000)');
SELECT is((calculate_pb1_payable_v1('2099-03-01','2099-03-31')->>'pb1_output')::numeric, 0::numeric,
  'T3 void-only — contre-passement compté quand aucun refund');

SELECT * FROM finish();
ROLLBACK;
