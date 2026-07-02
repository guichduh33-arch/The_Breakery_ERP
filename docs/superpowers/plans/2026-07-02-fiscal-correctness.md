# S54 — P1.3 (T6) Fiscal Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **⚠️ Contrainte projet** : toutes les opérations DB (migrations, pgTAP, types) passent par les MCP tools Supabase cloud (`ikcyvlovptebroadgtvd`) **sur le contrôleur** — les subagents ne peuvent pas appeler MCP (ils authorent le SQL, le contrôleur l'applique).

**Goal:** Fermer l'audit T6/C10 — garde fiscale fail-closed, clôture annuelle carry-forward → 3200, exclusion `year_close` des rapports de résultat, vérification (et fix éventuel) du cumul TB v3.

**Architecture:** 4-5 migrations SQL cloud (NAME-block `20260710000077..081`), un nouveau RPC SECURITY DEFINER `close_fiscal_year_v1`, 2 COR in-place de rapports (précédent bugfix `_057`). Aucun changement UI (DEV-S54-01 déféré).

**Tech Stack:** Supabase cloud V3 (MCP `apply_migration`/`execute_sql`), pgTAP (BEGIN…ROLLBACK + temp-table capture), pnpm/turbo pour typecheck/build.

**Spec:** `docs/superpowers/specs/2026-07-02-fiscal-correctness-design.md`

## Global Constraints

- DB cible : cloud V3 `ikcyvlovptebroadgtvd` — jamais Docker/local, jamais `supabase migration repair`.
- pgTAP via `execute_sql` : envelopper `BEGIN … ROLLBACK`, capturer les assertions dans une temp table (le tool ne renvoie que la dernière requête) puis agréger les `not ok`.
- Toute fonction nouvelle : `REVOKE ALL … FROM PUBLIC` + `REVOKE EXECUTE … FROM anon` + `GRANT EXECUTE … TO authenticated` explicites.
- COR in-place autorisé uniquement en bugfix signature-identique (précédents `_057`, `_074`).
- Après tout changement de schéma : `generate_typescript_types` → `packages/supabase/src/types.generated.ts` + commit.
- Commits conventionnels, co-author Claude ; branche `swarm/session-54`.

---

### Task 1: Garde fiscale fail-closed (`20260710000077`)

**Files:**
- Create: `supabase/migrations/20260710000077_fiscal_guard_fail_closed.sql`
- Create: `supabase/tests/fiscal_guard_fail_closed.test.sql`

**Interfaces:**
- Consumes: `check_fiscal_period_open(DATE)` existant (`20260517000002`), `fiscal_periods` seedée jan 2026 → déc 2027.
- Produces: même signature, nouveau comportement — `RAISE 'period_undefined' P0004` quand aucune période ne couvre la date. Les 34 call-sites existants ne changent pas.

- [ ] **Step 1: Red — prouver le fail-open sur le cloud**

Via `execute_sql` :

```sql
BEGIN;
-- Aucune période ne couvre 2031 : la garde doit (aujourd'hui) passer silencieusement
SELECT check_fiscal_period_open('2031-06-15'::date);  -- fail-open : ne lève pas
ROLLBACK;
```

Expected: succès silencieux (bug confirmé).

- [ ] **Step 2: Migration `20260710000077_fiscal_guard_fail_closed.sql`**

```sql
-- S54 P1.3 · T6 — garde fiscale fail-closed
-- check_fiscal_period_open (D12, 20260517000002) RETURNait silencieusement quand
-- aucune fiscal_period ne couvre p_date (« seed-gap-tolerant ») → toute JE datée
-- hors seed passait sans garde (audit T6 : garde fail-open). Fail-closed :
-- period_undefined (P0004, même ERRCODE que period_locked — les call-sites
-- traitent déjà P0004 comme rejet de garde). Le seed N+1 est garanti par
-- close_fiscal_year_v1 (même vague) — pas de bombe à retardement jan 2028.
-- COR in-place : signature inchangée, bugfix de garde (précédent _057).

CREATE OR REPLACE FUNCTION check_fiscal_period_open(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date_required_for_period_check' USING ERRCODE = 'P0002';
  END IF;

  SELECT status INTO v_status
    FROM fiscal_periods
    WHERE p_date BETWEEN period_start AND period_end
    LIMIT 1;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'period_undefined: no fiscal period covers %', p_date
      USING ERRCODE = 'P0004';
  END IF;

  IF v_status IN ('closed','locked') THEN
    RAISE EXCEPTION 'period_locked: date % falls in % period', p_date, v_status
      USING ERRCODE = 'P0004';
  END IF;
END;
$$;

COMMENT ON FUNCTION check_fiscal_period_open(DATE) IS
  'D12 helper, fail-closed depuis S54 (T6). RAISE period_locked (P0004) quand p_date '
  'tombe dans une période closed/locked, period_undefined (P0004) quand aucune période '
  'ne couvre p_date. Appelé depuis chaque RPC/trigger émetteur de JE. Le seed N+1 '
  'passe par close_fiscal_year_v1.';
```

Apply via `apply_migration` (name: `fiscal_guard_fail_closed`).

- [ ] **Step 3: Green — la garde lève désormais**

```sql
BEGIN;
DO $$
BEGIN
  PERFORM check_fiscal_period_open('2031-06-15'::date);
  RAISE EXCEPTION 'guard_did_not_raise';
EXCEPTION WHEN SQLSTATE 'P0004' THEN
  RAISE NOTICE 'ok — period_undefined raised';
END $$;
SELECT check_fiscal_period_open('2026-07-02'::date);  -- période open : passe
ROLLBACK;
```

Expected: notice `ok`, puis succès silencieux sur la date couverte.

- [ ] **Step 4: Suite pgTAP `supabase/tests/fiscal_guard_fail_closed.test.sql`**

```sql
-- S54 P1.3 (T6) — garde fiscale fail-closed
-- Exécution cloud : envelopper BEGIN…ROLLBACK via MCP execute_sql (capture temp-table).
BEGIN;
SELECT plan(4);

-- 1. Date couverte + open → passe
SELECT lives_ok(
  $$SELECT check_fiscal_period_open('2026-07-02'::date)$$,
  'open period passes');

-- 2. Aucune période couvrante → period_undefined P0004
SELECT throws_ok(
  $$SELECT check_fiscal_period_open('2031-06-15'::date)$$,
  'P0004', NULL, 'undefined period fails closed');

-- 3. Période closed → period_locked P0004 (comportement historique préservé)
UPDATE fiscal_periods SET status = 'closed'
 WHERE period_start = '2026-01-01';
SELECT throws_ok(
  $$SELECT check_fiscal_period_open('2026-01-15'::date)$$,
  'P0004', NULL, 'closed period still rejected');

-- 4. NULL → P0002 (inchangé)
SELECT throws_ok(
  $$SELECT check_fiscal_period_open(NULL::date)$$,
  'P0002', NULL, 'null date rejected');

SELECT finish();
ROLLBACK;
```

Run via MCP (assertions capturées) — Expected: 4/4 ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000077_fiscal_guard_fail_closed.sql supabase/tests/fiscal_guard_fail_closed.test.sql
git commit -m "fix(accounting): S54 — check_fiscal_period_open fail-closed (T6, period_undefined P0004)"
```

---

### Task 2: Vérif + fix leak cumul `get_trial_balance_v3` (`20260710000078`, conditionnel)

**Files:**
- Create: `supabase/migrations/20260710000078_fix_trial_balance_v3_cum_leak.sql` (si bug confirmé)
- Modify: `supabase/tests/trial_balance_v3_cumulative.test.sql` (ajout cas leak)

**Interfaces:**
- Consumes: `get_trial_balance_v3(date,date)` (`20260710000061`), gate `accounting.tb.read`.
- Produces: même signature/retour ; le cumul (`balance` classes 1/2/3, `opening_balance`) n'absorbe plus les lignes de JE draft / futures / voids dédupliquées.

- [ ] **Step 1: Red — reproduire le leak sur le cloud**

Via `execute_sql` (session super-admin de test — réutiliser le seeding de `trial_balance_v3_cumulative.test.sql` : profil + `request.jwt.claims`) :

```sql
BEGIN;
-- seed minimal : compte 1010 (cash, classe 1), une JE posted J-10 (100 DR),
-- une JE **draft** J-5 (40 DR), une JE **future** (fin+10j, 25 DR).
-- (reprendre le boilerplate d'insertion accounts/journal_entries/journal_entry_lines
--  de trial_balance_v3_cumulative.test.sql — created_by → user_profiles existant)
-- Attendu si bug : balance du 1010 = 165 (100+40+25) au lieu de 100.
SELECT (l->>'balance')::numeric
  FROM jsonb_array_elements(
    (get_trial_balance_v3(current_date - 7, current_date))->'lines') l
 WHERE l->>'code' = '1010';
ROLLBACK;
```

Expected si bug : 165. Si 100 → **pas de bug**, sauter Steps 2-3, garder le cas de test (Step 4) comme ancre, consigner en déviation « D4 non confirmé ».

- [ ] **Step 2 (si bug): Migration `20260710000078_fix_trial_balance_v3_cum_leak.sql`**

COR in-place du body `_061` avec **une seule modification structurelle** — le join interne parenthésé (les filtres `je` deviennent bloquants pour la ligne `jel`) :

```sql
-- S54 P1.3 · T6 — fix leak cumul TB v3 : le double LEFT JOIN de _061 laissait
-- survivre les lignes jel dont la JE échoue les filtres (draft, datée > end,
-- sale_void dédupliquée) → cum_debit/cum_credit pollués (balance permanents faux).
-- Join interne parenthésé : une ligne jel n'existe que si sa JE passe les filtres.
-- COR in-place (signature/retour inchangés, bugfix — précédent _057).

CREATE OR REPLACE FUNCTION public.get_trial_balance_v3(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- … reprendre le body _061 intégral, en remplaçant uniquement :
--   FROM accounts a
--   LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
--   LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
--     AND je.status IN ('posted','locked')
--     AND je.entry_date <= p_date_end
--     AND NOT (…dédup…)
-- par :
--   FROM accounts a
--   LEFT JOIN (
--     journal_entry_lines jel
--     JOIN journal_entries je ON je.id = jel.journal_entry_id
--       AND je.status IN ('posted','locked')
--       AND je.entry_date <= p_date_end
--       AND NOT (je.reference_type = 'sale_void'
--         AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
--   ) ON jel.account_id = a.id
$function$;
```

(Le fichier final contient le body complet — copié depuis `_061`, pas de « … » dans la migration réelle.)

- [ ] **Step 3 (si bug): Green** — re-run du Step 1, balance 1010 = 100.

- [ ] **Step 4: Ajouter le cas à `trial_balance_v3_cumulative.test.sql`**

3 assertions : JE draft exclue du cumul, JE future exclue, void dédupliquée exclue (mêmes seeds que Step 1, `is(balance, 100::numeric, …)`). Re-run la suite complète via MCP — Expected: 100 % ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000078_fix_trial_balance_v3_cum_leak.sql supabase/tests/trial_balance_v3_cumulative.test.sql
git commit -m "fix(accounting): S54 — TB v3 cumul n'absorbe plus draft/future/void dédupliquées (T6 vérif)"
```

---

### Task 3: `close_fiscal_year_v1` + permission (`20260710000079` + `20260710000080`)

**Files:**
- Create: `supabase/migrations/20260710000079_seed_accounting_year_close_permission.sql`
- Create: `supabase/migrations/20260710000080_create_close_fiscal_year_v1.sql`
- Create: `supabase/tests/close_fiscal_year_v1.test.sql`

**Interfaces:**
- Consumes: `_verify_pin_with_lockout(UUID, TEXT) RETURNS BOOLEAN` (S38), `has_permission(UUID, TEXT)`, `next_journal_entry_number(DATE)`, compte `3200` (seed `_019`), filtre canonique dédup.
- Produces: `close_fiscal_year_v1(p_fiscal_year INT, p_manager_pin TEXT) RETURNS JSONB` — `{fiscal_year, je_id, entry_number, net_result, line_count, retained_earnings_account, periods_seeded_next_year}` ; JE `reference_type='year_close'` datée 31/12 ; permission `accounting.year.close`.

- [ ] **Step 1: Migration `20260710000079` — seed permission**

```sql
-- S54 P1.3 · T6 — permission dédiée clôture annuelle (mirror _026)
INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.year.close', 'accounting', 'year.close',
    'Close a fiscal year: carry-forward P&L to 3200 Retained Earnings (PIN gated)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'accounting.year.close'),
  ('ADMIN',       'accounting.year.close'),
  ('SUPER_ADMIN', 'accounting.year.close')
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

- [ ] **Step 2: Vérifier les contraintes ledger avant d'écrire le RPC**

Lire `20260709000011_harden_ledger_refund_je_balance_and_appendonly.sql` : confirmer que le pattern « INSERT header (totaux précalculés) puis INSERT lines » de `create_manual_je_v1` reste valide (triggers d'équilibre/append-only). Confirmer aussi `audit_log.subject_id` nullable (cas `je_id NULL`). Ajuster le Step 3 si un trigger impose un autre ordre.

- [ ] **Step 3: Migration `20260710000080_create_close_fiscal_year_v1.sql`**

```sql
-- S54 P1.3 · T6 — clôture annuelle : carry-forward P&L (classes 4/5/6) → 3200.
-- JE 'year_close' datée 31/12 (insérée SANS check_fiscal_period_open — écriture
-- de clôture dans une période fermée par design). Seed 12 périodes N+1 (garantit
-- le fail-closed _077 sans bombe à retardement). 3300 CYE non touché (dérivé live,
-- retombe à 0 une fois les 4/5/6 zérotés — intention du seed _019 respectée).

CREATE OR REPLACE FUNCTION public.close_fiscal_year_v1(
  p_fiscal_year INT,
  p_manager_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile    UUID;
  v_start      DATE;
  v_end        DATE;
  v_cnt        INT;
  v_not_closed INT;
  v_re_id      UUID;
  v_line_cnt   INT;
  v_dr_total   NUMERIC(14,2);
  v_cr_total   NUMERIC(14,2);
  v_net        NUMERIC(14,2);
  v_je_id      UUID;
  v_entry_no   TEXT;
  v_seeded     INT := 0;
BEGIN
  IF p_fiscal_year IS NULL OR p_fiscal_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'fiscal_year_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'accounting.year.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  v_start := make_date(p_fiscal_year, 1, 1);
  v_end   := make_date(p_fiscal_year, 12, 31);

  -- Préconditions : 12 périodes toutes closed/locked (FOR UPDATE sérialise)
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status NOT IN ('closed','locked'))
    INTO v_cnt, v_not_closed
    FROM (SELECT status FROM fiscal_periods
            WHERE period_start >= v_start AND period_end <= v_end
            FOR UPDATE) p;
  IF v_cnt < 12 THEN
    RAISE EXCEPTION 'fiscal_year_periods_missing: % of 12 seeded for %', v_cnt, p_fiscal_year
      USING ERRCODE = 'P0002';
  END IF;
  IF v_not_closed > 0 THEN
    RAISE EXCEPTION 'fiscal_year_periods_open: % period(s) of % not closed/locked',
      v_not_closed, p_fiscal_year USING ERRCODE = 'P0003';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'year_close'
                AND entry_date = v_end
                AND status IN ('posted','locked')) THEN
    RAISE EXCEPTION 'year_already_closed: %', p_fiscal_year USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_re_id FROM accounts WHERE code = '3200' AND is_active;
  IF v_re_id IS NULL THEN
    RAISE EXCEPTION 'retained_earnings_account_missing: 3200' USING ERRCODE = 'P0002';
  END IF;

  -- Agrégat P&L de l'exercice (dédup canonique sale_void+refund)
  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN net_credit > 0 THEN net_credit END), 0),
         COALESCE(SUM(CASE WHEN net_credit < 0 THEN -net_credit END), 0),
         COALESCE(SUM(net_credit), 0)
    INTO v_line_cnt, v_dr_total, v_cr_total, v_net
    FROM (
      SELECT (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0)))::NUMERIC(14,2) AS net_credit
        FROM accounts a
        JOIN journal_entry_lines jel ON jel.account_id = a.id
        JOIN journal_entries je      ON je.id = jel.journal_entry_id
       WHERE a.account_class IN (4,5,6)
         AND je.status IN ('posted','locked')
         AND je.entry_date BETWEEN v_start AND v_end
         AND je.reference_type IS DISTINCT FROM 'year_close'
         AND NOT (je.reference_type = 'sale_void'
                  AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
       GROUP BY a.id
      HAVING (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0))) <> 0
    ) nets;

  IF v_line_cnt > 0 THEN
    v_entry_no := next_journal_entry_number(v_end);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, v_end,
      'Year-end close ' || p_fiscal_year || ' — P&L carry-forward to 3200 Retained Earnings',
      'year_close', NULL, 'posted',
      v_dr_total + CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
      v_cr_total + CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
      v_profile
    ) RETURNING id INTO v_je_id;

    -- Lignes de zérotage 4/5/6 (même agrégat que ci-dessus)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, nets.account_id,
           CASE WHEN nets.net_credit > 0 THEN nets.net_credit ELSE 0 END,
           CASE WHEN nets.net_credit < 0 THEN -nets.net_credit ELSE 0 END,
           'Year-end close ' || p_fiscal_year
      FROM (
        SELECT a.id AS account_id,
               (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0)))::NUMERIC(14,2) AS net_credit
          FROM accounts a
          JOIN journal_entry_lines jel ON jel.account_id = a.id
          JOIN journal_entries je      ON je.id = jel.journal_entry_id
         WHERE a.account_class IN (4,5,6)
           AND je.status IN ('posted','locked')
           AND je.entry_date BETWEEN v_start AND v_end
           AND je.reference_type IS DISTINCT FROM 'year_close'
           AND je.id <> v_je_id
           AND NOT (je.reference_type = 'sale_void'
                    AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
         GROUP BY a.id
        HAVING (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0))) <> 0
      ) nets;

    IF v_net <> 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_re_id,
              CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
              CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
              'Net result ' || p_fiscal_year || ' → Retained Earnings');
    END IF;
  END IF;

  -- Seed N+1 (rend le fail-closed _077 sûr dans la durée)
  INSERT INTO fiscal_periods (period_start, period_end, status, notes)
  SELECT date_trunc('month', d)::DATE,
         (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
         'open',
         'Seeded by close_fiscal_year_v1(' || p_fiscal_year || ')'
    FROM generate_series(make_date(p_fiscal_year + 1, 1, 1),
                         make_date(p_fiscal_year + 1, 12, 1),
                         INTERVAL '1 month') AS d
  ON CONFLICT (period_end) DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'accounting.year.closed', 'journal_entries', v_je_id,
    jsonb_build_object(
      'fiscal_year',  p_fiscal_year,
      'net_result',   v_net,
      'line_count',   v_line_cnt,
      'entry_number', v_entry_no,
      'periods_seeded_next_year', v_seeded
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'fiscal_year',  p_fiscal_year,
    'je_id',        v_je_id,
    'entry_number', v_entry_no,
    'net_result',   v_net,
    'line_count',   v_line_cnt,
    'retained_earnings_account', '3200',
    'periods_seeded_next_year',  v_seeded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) IS
  'S54 T6 : clôture annuelle. Préconditions 12 périodes closed/locked (FOR UPDATE) + '
  'pas de year_close existante. JE year_close 31/12 zérotant classes 4/5/6 (dédup '
  'canonique) avec contrepartie 3200. Seed 12 périodes N+1. Gate accounting.year.close '
  '+ _verify_pin_with_lockout. Audit accounting.year.closed.';
```

`v_net <> 0` s'entend au centime : les NUMERIC(14,2) agrégés sont exacts, pas de tolérance nécessaire.

- [ ] **Step 4: Suite pgTAP `supabase/tests/close_fiscal_year_v1.test.sql`**

Cas (seeding : profil SUPER_ADMIN + `request.jwt.claims`, année de test **2026** avec les 12 périodes forcées `closed`, JEs de vente/charge synthétiques `posted`) :

1. `throws_ok` P0003 sans permission (profil CASHIER).
2. `throws_ok` P0003 `fiscal_year_periods_open` quand ≥1 période open.
3. Happy path profit : revenus 4xxx 1000 CR, charges 6xxx 400 DR → `net_result = 600` ; JE `year_close` équilibrée (`total_debit = total_credit`) ; ligne 3200 CR 600 ; nets 4/5/6 post-clôture = 0 (re-somme directe SQL) ; 12 périodes 2027 présentes (déjà seedées → `periods_seeded_next_year = 0`, vérifier ≥ existence).
4. Replay → `throws_ok` P0003 `year_already_closed`.
5. Cas perte (charges > revenus) → ligne 3200 DR.
6. Cas zéro activité (année sans JE 4/5/6 — utiliser 2027 périodes closed) → `je_id NULL`, pas de JE créée.
7. Dédup : une JE `sale_void` avec refund existant sur le même order est exclue du net.

Run via MCP — Expected: 100 % ok. Apply migrations Steps 1+3 avant (name: `seed_accounting_year_close_permission`, `create_close_fiscal_year_v1`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000079_seed_accounting_year_close_permission.sql supabase/migrations/20260710000080_create_close_fiscal_year_v1.sql supabase/tests/close_fiscal_year_v1.test.sql
git commit -m "feat(accounting): S54 — close_fiscal_year_v1, carry-forward P&L → 3200 (T6)"
```

---

### Task 4: Exclusion `year_close` des rapports de résultat (`20260710000081`)

**Files:**
- Create: `supabase/migrations/20260710000081_exclude_year_close_from_pl_tb.sql`
- Modify: `supabase/tests/close_fiscal_year_v1.test.sql` (assertions rapports post-clôture)

**Interfaces:**
- Consumes: `get_profit_loss_v2(date,date,uuid)` (`_052`), `get_trial_balance_v3` (body Task 2), JE `year_close` (Task 3).
- Produces: mêmes signatures/retours. P&L exclut `year_close` (WHERE). TB : colonnes de **période** (`total_debit`/`total_credit` par ligne + totaux/invariant) excluent `year_close` **toutes classes** (la JE entière — préserve Σ débit = Σ crédit) ; `opening_balance` et cumul l'incluent (3200 porte le report, 4/5/6 rouvrent à 0).

- [ ] **Step 1: Red — prouver la distorsion post-clôture**

Sur une année de test clôturée (state Task 3) : `get_profit_loss_v2('2026-12-01','2026-12-31')` → revenue.total lit 0 (distordu par la JE de clôture). Idem TB décembre : `total_debit` gonflé par la JE de clôture.

- [ ] **Step 2: Migration `20260710000081_exclude_year_close_from_pl_tb.sql`**

Deux COR in-place :

1. **P&L v2** — body `_052` intégral avec, dans le WHERE du CTE `agg` :

```sql
       AND je.reference_type IS DISTINCT FROM 'year_close'
```

2. **TB v3** — body Task 2 (ou `_061` si Task 2 sans migration) avec, dans les DEUX sommes de période uniquement :

```sql
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS per_debit,
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS per_credit,
```

(`open_*` et `cum_*` inchangés — ils DOIVENT inclure `year_close`.)

En-tête de migration : commentaire expliquant D3 (spec §2). Mise à jour des `COMMENT ON FUNCTION`.

- [ ] **Step 3: Green + assertions rapports**

Ajouter à `close_fiscal_year_v1.test.sql` :
- P&L décembre post-clôture = P&L décembre pré-clôture (revenue.total inchangé).
- TB année N+1 : `opening_balance` de 3200 = net_result N ; comptes 4/5/6 absents ou balance 0.
- TB décembre N : `balanced = true`.
- `get_balance_sheet_v2('31/12/N')` : équilibré post-clôture (assets = liabilities+equity) — si KO, lire le body BS v2 et traiter en déviation numérotée.

Re-run suite complète via MCP — Expected: 100 % ok.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000081_exclude_year_close_from_pl_tb.sql supabase/tests/close_fiscal_year_v1.test.sql
git commit -m "fix(reports): S54 — P&L/TB excluent la JE year_close des colonnes de période (T6)"
```

---

### Task 5: Closeout — ancres, types, INDEX, PR

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen)
- Create: `docs/workplan/plans/2026-07-02-session-54-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan : P1.3 → Merged (latest))

- [ ] **Step 1: Re-run ancres pgTAP via MCP** — `trial_balance_v3_cumulative`, `pb1_dedup_void_refund`, `accounting`, `reports_pnl_bs_cf`, `financial_rpc_perm_gates`, + les 2 nouvelles suites. Expected: 100 % ok (consigner les comptes N/N).
- [ ] **Step 2: Regen types** — `generate_typescript_types` → `packages/supabase/src/types.generated.ts` (diff attendu : + `close_fiscal_year_v1`).
- [ ] **Step 3: `pnpm typecheck && pnpm build`** — Expected: pass (aucun call-site UI changé).
- [ ] **Step 4: INDEX S54 + bump CLAUDE.md** — mirror format S53 (objectif, décisions/déviations, migrations, tests N/N, suite : DEV-S54-01 UI clôture + DEV-S52-03 toujours déféré).
- [ ] **Step 5: Commit + PR**

```bash
git add packages/supabase/src/types.generated.ts docs/workplan/plans/2026-07-02-session-54-INDEX.md CLAUDE.md
git commit -m "docs(workplan): S54 closeout — P1.3 (T6) fiscal correctness, INDEX + CLAUDE.md bump"
gh pr create --title "feat(accounting): S54 — P1.3 fiscal correctness (T6/C10): garde fail-closed + clôture annuelle → 3200" --body "…(résumé, migrations _077.._081, tests)…"
```
