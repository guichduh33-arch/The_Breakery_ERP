-- S50 Vague 2a-i · T2 — adjust_b2b_balance_v2 : JE de contrepartie + PIN + perm dédiée
--
-- A : delta>0 (AR augmente) → JE Dr 1132 / Cr 6520 + balance +delta.
-- B : delta<0 (write-off)   → JE Dr 6520 / Cr 1132 + balance +delta (négatif).
-- C : PIN invalide          → invalid_pin (P0003).
-- D : replay idempotent (même p_idempotency_key) → idempotent_replay=true, balance stable.
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Auth simulée via request.jwt.claim.sub (EMP000,
-- SUPER_ADMIN → a b2b.balance.adjust). PIN manager posé transaction-local.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);
UPDATE user_profiles SET pin_hash = hash_pin('112233'), locked_until=NULL, failed_login_attempts=0 WHERE employee_code='EMP000';

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES ('ccc20001-0000-0000-0000-000000000001','T2 B2B Adjust','b2b','PT T2', 10000000, 100000)
ON CONFLICT (id) DO NOTHING;
UPDATE customers SET b2b_current_balance=100000 WHERE id='ccc20001-0000-0000-0000-000000000001';

CREATE TEMP TABLE _r(name text PRIMARY KEY, pass boolean) ON COMMIT DROP;

-- A : +30000 → Dr 1132 / Cr 6520
DO $a$ DECLARE v jsonb; je uuid; dr numeric; cr numeric; BEGIN
  v := adjust_b2b_balance_v2('ccc20001-0000-0000-0000-000000000001', 30000, 'pos adjustment', '112233', gen_random_uuid());
  je := (v->>'je_id')::uuid;
  SELECT l.debit  INTO dr FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=je AND a.code='1132';
  SELECT l.credit INTO cr FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=je AND a.code='6520';
  INSERT INTO _r VALUES ('A', (v->>'balance_after')::numeric=130000 AND dr=30000 AND cr=30000);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('A', false); END $a$;

-- B : -20000 → Dr 6520 / Cr 1132
DO $b$ DECLARE v jsonb; je uuid; cr numeric; dr numeric; BEGIN
  v := adjust_b2b_balance_v2('ccc20001-0000-0000-0000-000000000001', -20000, 'write-off', '112233', gen_random_uuid());
  je := (v->>'je_id')::uuid;
  SELECT l.credit INTO cr FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=je AND a.code='1132';
  SELECT l.debit  INTO dr FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=je AND a.code='6520';
  INSERT INTO _r VALUES ('B', (v->>'balance_after')::numeric=110000 AND cr=20000 AND dr=20000);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('B', false); END $b$;

-- C : PIN invalide → invalid_pin
DO $c$ BEGIN
  PERFORM adjust_b2b_balance_v2('ccc20001-0000-0000-0000-000000000001', 1000, 'bad pin', '0000', gen_random_uuid());
  INSERT INTO _r VALUES ('C', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('C', SQLERRM LIKE '%invalid_pin%'); END $c$;

-- D : replay idempotent
DO $d$ DECLARE v1 jsonb; v2 jsonb; k uuid := gen_random_uuid(); BEGIN
  v1 := adjust_b2b_balance_v2('ccc20001-0000-0000-0000-000000000001', 5000, 'idem', '112233', k);
  v2 := adjust_b2b_balance_v2('ccc20001-0000-0000-0000-000000000001', 5000, 'idem', '112233', k);
  INSERT INTO _r VALUES ('D', (v2->>'idempotent_replay')::boolean AND (v1->>'balance_after')=(v2->>'balance_after'));
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('D', false); END $d$;

SELECT ok((SELECT pass FROM _r WHERE name='A'), 'T2-A: delta>0 → Dr 1132 / Cr 6520 + balance');
SELECT ok((SELECT pass FROM _r WHERE name='B'), 'T2-B: delta<0 → Dr 6520 / Cr 1132 + balance (write-off)');
SELECT ok((SELECT pass FROM _r WHERE name='C'), 'T2-C: PIN invalide → invalid_pin (P0003)');
SELECT ok((SELECT pass FROM _r WHERE name='D'), 'T2-D: replay idempotent (même clé) — balance stable');

SELECT * FROM finish();
ROLLBACK;
