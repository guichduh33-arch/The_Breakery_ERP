# Session 26 — INDEX (Comptable Cockpit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 1 stream serial Wave 1 (DB+EF+UI tightly coupled — UI dépend des RPCs/EF) → Wave 2 tests → Wave 3 closeout.

**Goal :** Débloquer l'audit comptable externe et l'usage quotidien du comptable. Livrer 4 pages BO `/accounting/{trial-balance, general-ledger, ar-aging, journal-entries}` CSV-only + 1 EF wrapper `create-manual-je` (PIN-en-header pattern S25) + 3 RPCs (`get_trial_balance_v1`, `get_general_ledger_v1`, `create_manual_je_v1`) + doc rebase `04-modules/10-accounting-double-entry.md` Partie II. Closes TASK-10-011 (UI viewer partie) + gaps audit 10-1/2/3/4.

**Architecture :** Wave 0 (spec/INDEX/branch) serial → Wave 1 serial DB+EF+UI (couplage fort, UI dépend des RPCs/EF) → Wave 2 tests (pgTAP + Vitest live + BO smoke) → Wave 3 closeout. Cloud-only via Supabase MCP — no Docker. Pattern S25 PIN-en-header HTTP + idempotency 2-flavors + split REVOKE migration pair canonique.

**Tech Stack :** Postgres `manual_je_idempotency_keys` table dédiée (PK = idempotency_key), `get_trial_balance_v1` agrégation CTE, `get_general_ledger_v1` cursor pagination via window functions, `create_manual_je_v1` SECURITY DEFINER avec perm+fiscal gate (PIN gate côté EF), EF Deno `create-manual-je` lit `x-manager-pin` header + réutilise `_shared/idempotency.ts` livré S25, hooks BO React Query (`useInfiniteQuery` pour GL), Dialog Radix-backed pour manual JE form, CSV helper RFC 4180 UTF-8 BOM minimal. Tests : pgTAP via MCP, Vitest live RPC+EF, BO Testing Library.

**Date :** 2026-05-20
**Branch :** `swarm/session-26` (off `b8814ef` post-S25 merge sur master)
**Spec :** [`../specs/2026-05-19-session-26-spec.md`](../specs/2026-05-19-session-26-spec.md)
**Migration block réservé :** `20260603000010..030` (6 planifiées, 14 slots libres pour correctives)
**Multi-session plan parent :** [`./2026-05-19-S24-to-S30-plan.md`](./2026-05-19-S24-to-S30-plan.md) §3 S26

---

## 1. Goal global

| # | Item | Phase | Estim |
|---|------|-------|-------|
| 1 | Pre-flight DB+EF introspection (helpers PIN, audit_logs schema, view_ar_aging columns, _shared/idempotency.ts) | 1.A | XS ~15min |
| 2 | Migration `_010` perm seed `accounting.je.manual` + role grants | 1.A | XS ~10min |
| 3 | Migration `_020` RPC `get_trial_balance_v1` (agrégation CTE) | 1.A | S ~30min |
| 4 | Migration `_021` RPC `get_general_ledger_v1` (cursor pagination + running_balance) | 1.A | M ~1h |
| 5 | Migration `_022` table `manual_je_idempotency_keys` + RLS + REVOKE | 1.A | XS ~15min |
| 6 | Migration `_023` RPC `create_manual_je_v1` (perm + fiscal gate + idempotency + audit) | 1.A | M ~1h |
| 7 | Migration `_024` REVOKE pair canonique S25 (REVOKE+ALTER DEFAULT PRIVILEGES) | 1.A | XS ~10min |
| 8 | EF `create-manual-je/index.ts` (PIN-en-header + idempotency + RPC call) | 1.A | M ~1h |
| 9 | CSV helper `packages/utils/src/csv.ts` (si absent) | 1.A | XS ~15min |
| 10 | 5 hooks BO (`useTrialBalance`, `useGeneralLedger`, `useArAging`, `useJournalEntries`, `useManualJe`) | 1.A | M ~1h |
| 11 | 4 pages BO (`TrialBalancePage`, `GeneralLedgerPage`, `ArAgingPage`, `JournalEntriesPage`) + routes + sidebar | 1.A | L ~2h |
| 12 | `ManualJournalEntryDialog` + `ManagerPinDialog` (réuse ou nouveau) | 1.A | M ~1h |
| 13 | Types regen MCP + typecheck | 1.A | XS ~15min |
| 14 | pgTAP `accounting_cockpit.test.sql` (10 cas T1-T10) | 2.A | M ~1h |
| 15 | Vitest live `accounting-cockpit.test.ts` (8 scénarios TS1-TS8) | 2.A | L ~1.5h |
| 16 | BO smoke (5 cas : 4 pages + ManualJournalEntryDialog) | 2.A | M ~1h |
| 17 | Closeout (status notes, roadmap, CLAUDE.md, doc rebase `04-modules/10`, INDEX §10, PR) | 3.A | M ~1.5h |

**Total :** ~14h serial (~1.5-2j wall-time avec breaks et debugging).

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ + INDEX (this file) + branche `swarm/session-26` ✓
        │
        ▼
Wave 1 — Phase 1.A (1 stream serial — DB+EF+UI couplage fort)
  · Sub-phase 1.A.0 — Pre-flight DB+EF introspection
  · Sub-phase 1.A.1 — Migration _010 perm seed
  · Sub-phase 1.A.2 — Migrations _020 / _021 read RPCs
  · Sub-phase 1.A.3 — Migration _022 idempotency table
  · Sub-phase 1.A.4 — Migrations _023 / _024 manual JE RPC + REVOKE pair
  · Sub-phase 1.A.5 — EF `create-manual-je`
  · Sub-phase 1.A.6 — CSV helper (packages/utils)
  · Sub-phase 1.A.7 — 5 hooks BO
  · Sub-phase 1.A.8 — 4 pages BO + routes + sidebar
  · Sub-phase 1.A.9 — ManualJournalEntryDialog + PIN dialog
  · Sub-phase 1.A.10 — Types regen MCP
        │
        ▼
Wave 2 — Phase 2.A : tests (1 stream serial)
  · Sub-phase 2.A.1 — pgTAP 10 cas
  · Sub-phase 2.A.2 — Vitest live 8 scénarios
  · Sub-phase 2.A.3 — BO smoke 5 cas
        │
        ▼
Wave 3 — Phase 3.A : closeout
  · Quality gates final (typecheck + build + tests)
  · Status notes 10-accounting-double-entry
  · Roadmap globale §Sessions + §Indicateurs
  · CLAUDE.md current session + Critical patterns block enrichi
  · Doc rebase `docs/reference/04-modules/10-accounting-double-entry.md` Partie II
  · INDEX §10 deviations
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-19, 9 sections + 9 décisions D1-D9 + 7 risques R1-R7. Post-S25 patterns intégrés (PIN-en-header, idempotency 2-flavors, REVOKE pair canonique).
- [x] Branche `swarm/session-26` créée off `b8814ef` (post-S25 merge sur master).
- [x] Spec committé (`40c4e83`).
- [ ] INDEX (this file) committé.

**Complexity :** S (~30min). **Suggested executor :** lead.

---

## 4. Wave 1 — Phase 1.A : DB + EF + UI (1 stream serial)

**Module(s) :** 10-accounting-double-entry.
**Migration sub-block :** `20260603000010..024`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-a`.

### Sub-phase 1.A.0 — Pre-flight empirical checks (15min)

Avant d'écrire la moindre migration ou EF, exécuter via MCP `execute_sql` sur `ikcyvlovptebroadgtvd` :

```sql
-- 1) Verify accounts table + is_postable column + account_type_enum values
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='accounts'
  ORDER BY ordinal_position;
SELECT enumlabel FROM pg_enum
  WHERE enumtypid = 'public.account_type_enum'::regtype
  ORDER BY enumsortorder;

-- 2) Verify journal_entries + journal_entry_lines schema
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('journal_entries','journal_entry_lines')
  ORDER BY table_name, ordinal_position;

-- 3) Verify audit_logs schema (columns user_id, action, entity_type, entity_id, payload)
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='audit_logs'
  ORDER BY ordinal_position;

-- 4) Verify view_ar_aging exists (S24) + exposed columns
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='view_ar_aging'
  ORDER BY ordinal_position;

-- 5) Check helper functions exist + signatures
SELECT proname, pg_get_function_identity_arguments(oid) AS args, prorettype::regtype
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname IN (
      'has_permission',
      'verify_manager_pin_v1',
      'check_fiscal_period_open',
      'next_journal_entry_number'
    )
  ORDER BY proname;

-- 6) Check permissions table schema (for _010 perm seed)
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='permissions'
  ORDER BY ordinal_position;
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='role_permissions'
  ORDER BY ordinal_position;

-- 7) Verify accounting.je.manual perm does NOT yet exist
SELECT code FROM permissions WHERE code = 'accounting.je.manual';

-- 8) Verify last applied migration to confirm clean baseline
SELECT version FROM supabase_migrations.schema_migrations
  ORDER BY version DESC LIMIT 5;

-- 9) Check ALTER DEFAULT PRIVILEGES baseline (S20+S25 patterns)
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
  FROM pg_default_acl
  WHERE defaclnamespace = 'public'::regnamespace;
```

Sur le filesystem (pas DB) :

```bash
# 10) Verify _shared/idempotency.ts helper exists (S25 deliverable)
test -f supabase/functions/_shared/idempotency.ts && echo "PRESENT" || echo "MISSING"

# 11) Verify any existing _shared auth helper
ls -la supabase/functions/_shared/

# 12) Verify existing PIN-related EF (refund-order post-S25 for reference)
test -f supabase/functions/refund-order/index.ts && echo "PRESENT"
grep -n "x-manager-pin" supabase/functions/refund-order/index.ts

# 13) Verify packages/utils CSV helper (decide reuse vs new)
ls packages/utils/src/

# 14) Verify BO accounting feature folder layout
ls apps/backoffice/src/features/accounting/ 2>/dev/null || echo "NEW FOLDER"
ls apps/backoffice/src/pages/accounting/ 2>/dev/null || echo "NEW FOLDER"
```

**Decisions selon résultats :**
- Si `verify_manager_pin_v1(uuid,text)` n'existe PAS → décider Option A (créer SQL helper en `_023b`) vs Option B (bcrypt côté EF, `~15 lignes Deno`). Préférence Option B (réutilise pattern S25 refund-order).
- Si `audit_logs` n'a pas de colonne `entity_type` → mettre la valeur dans `payload.entity_type` à la place (déjà documenté dans spec §4.1.5).
- Si `view_ar_aging` colonnes diffèrent du spec (cf. spec §4.3.2 ArAgingPage) → adapter le composant.
- Si dernière migration appliquée n'est pas dans le block `20260602000xxx` (S25) → vérifier que `_010` ne collisionne pas.
- Si `_shared/idempotency.ts` est MISSING → S25 incomplet, STOP + alerter lead.
- Si `accounting.je.manual` existe déjà dans `permissions` → STOP + alerter lead.

Rapport synthèse à conserver dans le 1er commit Wave 1.

- [ ] **Step 1** — Exécuter les 9 requêtes via MCP `execute_sql`.
- [ ] **Step 2** — Exécuter les 5 checks filesystem (10-14) via Bash/Glob.
- [ ] **Step 3** — Documenter les findings dans `docs/workplan/refs/2026-05-20-session-26-preflight.md`.
- [ ] **Step 4** — Commit : `docs(workplan): session 26 — phase 1.A.0 — pre-flight DB+EF introspection`.

---

### Sub-phase 1.A.1 — Migration `_010` perm seed (10min)

**Fichier :**
- Apply via MCP : `20260603000010_seed_accounting_je_manual_perm` (name kwarg, snake_case).

**Steps :**

- [ ] **Step 1** — Apply migration via `mcp__plugin_supabase_supabase__apply_migration` avec :

```sql
INSERT INTO permissions (code, description, category)
VALUES ('accounting.je.manual', 'Create manual journal entries (OD)', 'accounting')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'accounting.je.manual'
  FROM (VALUES ('MANAGER'),('ADMIN'),('SUPER_ADMIN')) AS r(code)
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

- [ ] **Step 2** — Vérifier via `execute_sql` :

```sql
SELECT code, category FROM permissions WHERE code = 'accounting.je.manual';
SELECT role_code FROM role_permissions WHERE permission_code = 'accounting.je.manual' ORDER BY role_code;
```

Expected : 1 row pour le perm, 3 rows (MANAGER, ADMIN, SUPER_ADMIN) pour les grants.

- [ ] **Step 3** — Commit : `feat(db): session 26 — phase 1.A.1 — seed accounting.je.manual perm + role grants`.

---

### Sub-phase 1.A.2 — Migrations `_020` / `_021` read RPCs (1h30)

**Fichiers :**
- Apply via MCP : `20260603000020_create_get_trial_balance_v1`
- Apply via MCP : `20260603000021_create_get_general_ledger_v1`

**Steps :**

- [ ] **Step 1** — Apply `_020` :

```sql
CREATE OR REPLACE FUNCTION get_trial_balance_v1(
  p_start DATE,
  p_end   DATE
) RETURNS TABLE (
  account_code  TEXT,
  account_name  TEXT,
  account_type  TEXT,
  debit_total   NUMERIC,
  credit_total  NUMERIC,
  balance       NUMERIC
)
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT
    a.code AS account_code,
    a.name AS account_name,
    a.account_type::TEXT AS account_type,
    COALESCE(SUM(jel.debit), 0)  AS debit_total,
    COALESCE(SUM(jel.credit), 0) AS credit_total,
    COALESCE(SUM(jel.debit) - SUM(jel.credit), 0) AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.status = 'posted'
    AND je.posted_at::DATE BETWEEN p_start AND p_end
  WHERE a.is_postable = true
  GROUP BY a.id, a.code, a.name, a.account_type
  HAVING COALESCE(SUM(jel.debit), 0) <> 0
      OR COALESCE(SUM(jel.credit), 0) <> 0
  ORDER BY a.code;
$$;

REVOKE ALL ON FUNCTION get_trial_balance_v1 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_trial_balance_v1 TO authenticated;

COMMENT ON FUNCTION get_trial_balance_v1 IS
  'S26 — Trial Balance aggregation for a date range. SECURITY INVOKER, RLS-aware via journal_entry_lines RLS.';
```

- [ ] **Step 2** — Smoke test `_020` via `execute_sql` :

```sql
SELECT * FROM get_trial_balance_v1(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE) LIMIT 5;
-- Expected : 0+ rows, no error
SELECT SUM(debit_total) AS total_dr, SUM(credit_total) AS total_cr
  FROM get_trial_balance_v1(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE);
-- Expected : total_dr = total_cr (or both 0 if no JE in range)
```

- [ ] **Step 3** — Apply `_021` :

```sql
CREATE OR REPLACE FUNCTION get_general_ledger_v1(
  p_account_id        UUID,
  p_start             DATE,
  p_end               DATE,
  p_after_posted_at   TIMESTAMPTZ DEFAULT NULL,
  p_after_je_id       UUID DEFAULT NULL,
  p_limit             INT DEFAULT 100
) RETURNS TABLE (
  je_id            UUID,
  je_number        TEXT,
  posted_at        TIMESTAMPTZ,
  description      TEXT,
  reference_type   TEXT,
  reference_id     UUID,
  debit            NUMERIC,
  credit           NUMERIC,
  running_balance  NUMERIC,
  next_cursor      JSONB
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_opening_balance NUMERIC;
  v_account_type    account_type_enum;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit_out_of_range' USING ERRCODE = '22023';
  END IF;

  SELECT account_type INTO v_account_type
    FROM accounts WHERE id = p_account_id AND is_postable = true;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'account_not_found_or_not_postable' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
    INTO v_opening_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.posted_at::DATE < p_start;

  RETURN QUERY
  WITH lines AS (
    SELECT
      je.id          AS je_id,
      je.je_number,
      je.posted_at,
      je.description,
      je.reference_type::TEXT,
      je.reference_id,
      jel.debit,
      jel.credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.posted_at::DATE BETWEEN p_start AND p_end
      AND (
        p_after_posted_at IS NULL
        OR (je.posted_at, je.id) < (p_after_posted_at, p_after_je_id)
      )
    ORDER BY je.posted_at DESC, je.id DESC
    LIMIT p_limit + 1
  ),
  numbered AS (
    SELECT
      l.*,
      ROW_NUMBER() OVER (ORDER BY l.posted_at DESC, l.je_id DESC) AS rn,
      COUNT(*) OVER () AS total_fetched
    FROM lines l
  )
  SELECT
    n.je_id,
    n.je_number,
    n.posted_at,
    n.description,
    n.reference_type,
    n.reference_id,
    n.debit,
    n.credit,
    v_opening_balance + SUM(n.debit - n.credit) OVER (
      ORDER BY n.posted_at ASC, n.je_id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_balance,
    CASE
      WHEN n.rn = p_limit AND n.total_fetched > p_limit THEN
        jsonb_build_object('posted_at', n.posted_at, 'je_id', n.je_id)
      ELSE NULL
    END AS next_cursor
  FROM numbered n
  WHERE n.rn <= p_limit;
END $$;

REVOKE ALL ON FUNCTION get_general_ledger_v1 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_general_ledger_v1 TO authenticated;

COMMENT ON FUNCTION get_general_ledger_v1 IS
  'S26 — General Ledger drilldown with cursor pagination. Opening balance computed pre-range, running_balance accumulates within range.';
```

- [ ] **Step 4** — Smoke test `_021` via `execute_sql` (pick any postable account from `_020` output) :

```sql
WITH picked AS (
  SELECT id FROM accounts WHERE is_postable = true LIMIT 1
)
SELECT je_number, debit, credit, running_balance, next_cursor
  FROM get_general_ledger_v1(
    (SELECT id FROM picked),
    CURRENT_DATE - INTERVAL '60 days',
    CURRENT_DATE,
    NULL, NULL, 10
  );
```

Expected : 0+ rows, running_balance monotone, `next_cursor` non-null si >10 lignes.

- [ ] **Step 5** — Commit : `feat(db): session 26 — phase 1.A.2 — RPCs get_trial_balance_v1 + get_general_ledger_v1`.

---

### Sub-phase 1.A.3 — Migration `_022` idempotency table (15min)

**Fichier :** Apply via MCP : `20260603000022_create_manual_je_idempotency_keys_table`.

- [ ] **Step 1** — Apply migration :

```sql
CREATE TABLE manual_je_idempotency_keys (
  idempotency_key UUID PRIMARY KEY,
  je_id           UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX manual_je_idempotency_keys_je_id_idx
  ON manual_je_idempotency_keys(je_id);

ALTER TABLE manual_je_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE manual_je_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE manual_je_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE manual_je_idempotency_keys TO authenticated;

CREATE POLICY manual_je_idempotency_keys_select_auth
  ON manual_je_idempotency_keys FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE manual_je_idempotency_keys IS
  'S26 — idempotency ledger for create_manual_je_v1 RPC. Inserts only via SECURITY DEFINER function.';
```

- [ ] **Step 2** — Verify via `execute_sql` :

```sql
SELECT relrowsecurity FROM pg_class WHERE relname='manual_je_idempotency_keys';
-- Expected : t (RLS enabled)
SELECT polname, cmd FROM pg_policies WHERE tablename='manual_je_idempotency_keys';
-- Expected : 1 row, polname='manual_je_idempotency_keys_select_auth', cmd='SELECT'
```

- [ ] **Step 3** — Commit : `feat(db): session 26 — phase 1.A.3 — manual_je_idempotency_keys table + RLS`.

---

### Sub-phase 1.A.4 — Migrations `_023` / `_024` manual JE RPC + REVOKE pair (1h15)

**Fichiers :**
- Apply via MCP : `20260603000023_create_manual_je_v1`
- Apply via MCP : `20260603000024_revoke_anon_create_manual_je_v1`

- [ ] **Step 1** — Apply `_023` :

```sql
CREATE OR REPLACE FUNCTION create_manual_je_v1(
  p_posting_date     DATE,
  p_description      TEXT,
  p_lines            JSONB,
  p_idempotency_key  UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_existing_je    UUID;
  v_je_id          UUID;
  v_je_number      TEXT;
  v_sum_debit      NUMERIC := 0;
  v_sum_credit     NUMERIC := 0;
  v_line           JSONB;
  v_account_id     UUID;
  v_audit_payload  JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'accounting.je.manual') THEN
    RAISE EXCEPTION 'Permission denied: accounting.je.manual' USING ERRCODE = 'P0003';
  END IF;

  IF NOT check_fiscal_period_open(p_posting_date) THEN
    RAISE EXCEPTION 'period_locked' USING ERRCODE = 'P0004';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT je_id INTO v_existing_je
      FROM manual_je_idempotency_keys
      WHERE idempotency_key = p_idempotency_key;
    IF v_existing_je IS NOT NULL THEN
      RETURN v_existing_je;
    END IF;
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'unbalanced_je: at least 2 lines required' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NULL OR length(p_description) < 5 OR length(p_description) > 500 THEN
    RAISE EXCEPTION 'description_invalid' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::UUID;
    PERFORM 1 FROM accounts
      WHERE id = v_account_id AND is_postable = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'non_postable_account: %', v_account_id USING ERRCODE = '22023';
    END IF;
    IF (COALESCE((v_line->>'debit')::NUMERIC, 0) > 0
        AND COALESCE((v_line->>'credit')::NUMERIC, 0) > 0) THEN
      RAISE EXCEPTION 'line_xor_violation' USING ERRCODE = '22023';
    END IF;
    v_sum_debit  := v_sum_debit  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_sum_credit := v_sum_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'unbalanced_je: debit=% credit=%', v_sum_debit, v_sum_credit
      USING ERRCODE = '22023';
  END IF;
  IF v_sum_debit = 0 THEN
    RAISE EXCEPTION 'unbalanced_je: zero amounts' USING ERRCODE = '22023';
  END IF;

  v_je_number := next_journal_entry_number();
  INSERT INTO journal_entries (
    je_number, posted_at, status, description, reference_type, reference_id, metadata
  ) VALUES (
    v_je_number,
    (p_posting_date || ' 12:00:00')::TIMESTAMPTZ,
    'posted',
    p_description,
    'manual',
    NULL,
    jsonb_build_object('created_by', v_user_id, 'pin_verified', true)
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, debit, credit, line_description
  )
  SELECT
    v_je_id,
    (line->>'account_id')::UUID,
    COALESCE((line->>'debit')::NUMERIC, 0),
    COALESCE((line->>'credit')::NUMERIC, 0),
    line->>'line_description'
  FROM jsonb_array_elements(p_lines) AS line;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO manual_je_idempotency_keys (idempotency_key, je_id)
      VALUES (p_idempotency_key, v_je_id);
  END IF;

  v_audit_payload := jsonb_build_object(
    'je_id', v_je_id,
    'je_number', v_je_number,
    'posting_date', p_posting_date,
    'description', p_description,
    'lines', p_lines,
    'total_debit', v_sum_debit,
    'total_credit', v_sum_credit,
    'source', 'create-manual-je-ef'
  );

  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'accounting.je.manual.create', 'journal_entries', v_je_id, v_audit_payload);

  RETURN v_je_id;
EXCEPTION
  WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT je_id INTO v_existing_je
        FROM manual_je_idempotency_keys
        WHERE idempotency_key = p_idempotency_key;
      IF v_existing_je IS NOT NULL THEN
        RETURN v_existing_je;
      END IF;
    END IF;
    RAISE;
END $$;

COMMENT ON FUNCTION create_manual_je_v1 IS
  'S26 — manual OD entry. Gates: perm accounting.je.manual + check_fiscal_period_open. PIN gate handled upstream by EF create-manual-je (x-manager-pin header). Idempotent via manual_je_idempotency_keys.';
```

**Important** : ne PAS inclure REVOKE/GRANT/ALTER DEFAULT PRIVILEGES dans `_023`. Tous gérés dans `_024` pair.

- [ ] **Step 2** — Apply `_024` (REVOKE pair canonique S25, mirror migrations `_012`+`_013`) :

```sql
REVOKE ALL ON FUNCTION create_manual_je_v1 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION create_manual_je_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_manual_je_v1 FROM anon;
GRANT EXECUTE ON FUNCTION create_manual_je_v1 TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMENT ON FUNCTION create_manual_je_v1 IS
  'S26 — manual OD entry. Gates: perm accounting.je.manual + check_fiscal_period_open. PIN gate handled upstream by EF create-manual-je (x-manager-pin header). Idempotent via manual_je_idempotency_keys. REVOKE pair-migrated in _024.';
```

- [ ] **Step 3** — Verify REVOKE applied via `execute_sql` :

```sql
SELECT pg_get_function_identity_arguments(oid) AS args,
       has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
  FROM pg_proc
  WHERE proname='create_manual_je_v1' AND pronamespace='public'::regnamespace;
```

Expected : `anon_exec = false`, `auth_exec = true`, args = `p_posting_date date, p_description text, p_lines jsonb, p_idempotency_key uuid` (no `p_manager_pin`).

- [ ] **Step 4** — Commit : `feat(db): session 26 — phase 1.A.4 — create_manual_je_v1 RPC + REVOKE pair canonical S25`.

---

### Sub-phase 1.A.5 — EF `create-manual-je` (1h)

**Fichier :**
- Create: `supabase/functions/create-manual-je/index.ts`

- [ ] **Step 1** — Pre-flight (déjà fait en 1.A.0) : décider helper PIN :
  - **Option A** (préféré si dispo) : appeler `verify_manager_pin_v1(uid, pin)` via RPC service-role.
  - **Option B** : bcrypt compare en Deno (`import { compare } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'`), lit `user_profiles.pin_hash` via service-role.

  Documenter le choix en commentaire en tête de l'EF.

- [ ] **Step 2** — Créer `supabase/functions/create-manual-je/index.ts` avec ce contenu (assume Option B comme fallback ; adapter si Option A dispo) :

```ts
// supabase/functions/create-manual-je/index.ts
// S26 — Manual JE entry EF wrapper. PIN-en-header pattern S25.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  getIdempotencyKey,
  InvalidIdempotencyKeyError,
  MissingIdempotencyKeyError,
} from '../_shared/idempotency.ts';
import { compare } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manager-pin, x-idempotency-key',
};

type JeLine = {
  account_id: string;
  debit?: number | string;
  credit?: number | string;
  line_description?: string;
};

type Payload = {
  posting_date: string;
  description: string;
  lines: JeLine[];
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin
    .from('user_profiles')
    .select('pin_hash')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data?.pin_hash) return false;
  try {
    return await compare(pin, data.pin_hash);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userResult } = await userClient.auth.getUser();
  const user = userResult?.user;
  if (!user) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const pin = req.headers.get('x-manager-pin');
  if (!pin) {
    return jsonResponse(400, { error: 'missing_manager_pin' });
  }

  const pinOk = await verifyPin(user.id, pin);
  if (!pinOk) {
    return jsonResponse(401, { error: 'pin_invalid' });
  }

  let idempotencyKey: string | null;
  try {
    idempotencyKey = getIdempotencyKey(req);
  } catch (e) {
    if (e instanceof InvalidIdempotencyKeyError) {
      return jsonResponse(400, { error: 'invalid_idempotency_key' });
    }
    if (e instanceof MissingIdempotencyKeyError) {
      return jsonResponse(400, { error: 'missing_idempotency_key' });
    }
    throw e;
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  if (!body.posting_date || !body.description || !Array.isArray(body.lines)) {
    return jsonResponse(400, { error: 'invalid_payload' });
  }

  // Check pre-existence for idempotent_replay flag
  let preExisted = false;
  if (idempotencyKey) {
    const { data: existing } = await userClient
      .from('manual_je_idempotency_keys')
      .select('je_id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    preExisted = !!existing?.je_id;
  }

  const { data: jeId, error: rpcError } = await userClient.rpc('create_manual_je_v1', {
    p_posting_date: body.posting_date,
    p_description: body.description,
    p_lines: body.lines,
    p_idempotency_key: idempotencyKey,
  });

  if (rpcError) {
    const msg = rpcError.message ?? '';
    if (rpcError.code === 'P0003' || msg.includes('Permission denied')) {
      return jsonResponse(403, { error: 'permission_denied' });
    }
    if (rpcError.code === 'P0004' || msg.includes('period_locked')) {
      return jsonResponse(409, { error: 'period_locked' });
    }
    if (rpcError.code === '22023') {
      return jsonResponse(400, { error: msg });
    }
    console.error('create_manual_je_v1 unhandled error', rpcError);
    return jsonResponse(500, { error: 'internal_error' });
  }

  if (preExisted) {
    // Audit the replay (pattern S25 refund.replay)
    await userClient.from('audit_logs').insert({
      user_id: user.id,
      action: 'accounting.je.manual.replay',
      entity_type: 'journal_entries',
      entity_id: jeId,
      payload: { idempotency_key: idempotencyKey },
    });
  }

  return jsonResponse(200, { je_id: jeId, idempotent_replay: preExisted });
});
```

- [ ] **Step 3** — Deploy EF :

```bash
supabase functions deploy create-manual-je --project-ref ikcyvlovptebroadgtvd
```

Expected : Deployed successfully.

- [ ] **Step 4** — Smoke test curl manuel (avec un JWT user MANAGER valide en env `TEST_JWT`) :

```bash
curl -i -X POST \
  "https://ikcyvlovptebroadgtvd.supabase.co/functions/v1/create-manual-je" \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "x-manager-pin: 123456" \
  -H "x-idempotency-key: $(uuidgen | tr 'A-Z' 'a-z')" \
  -H "Content-Type: application/json" \
  -d '{"posting_date":"2026-05-20","description":"test smoke S26","lines":[{"account_id":"<a-postable-uuid>","debit":1000},{"account_id":"<another-postable-uuid>","credit":1000}]}'
```

Expected : `200 {"je_id":"...","idempotent_replay":false}`.

- [ ] **Step 5** — Commit : `feat(edge): session 26 — phase 1.A.5 — EF create-manual-je (PIN-en-header pattern S25)`.

---

### Sub-phase 1.A.6 — CSV helper packages/utils (15min)

**Fichier :**
- Create (si absent en pre-flight) : `packages/utils/src/csv.ts`
- Modify : `packages/utils/src/index.ts` (export)

- [ ] **Step 1** — Vérifier l'existence (pre-flight 1.A.0) : si déjà présent, SKIP cette sub-phase et noter le path dans le rapport.

- [ ] **Step 2** — Créer `packages/utils/src/csv.ts` :

```ts
// CSV export helper — RFC 4180 + UTF-8 BOM + ; separator for FR/ID Excel locale.

export function exportToCsv(
  filename: string,
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): void {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.map(escape).join(';'),
    ...rows.map((r) => r.map(escape).join(';')),
  ].join('\n');
  const bom = '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3** — Exporter dans `packages/utils/src/index.ts` :

```ts
export { exportToCsv } from './csv';
```

- [ ] **Step 4** — Build + typecheck :

```bash
pnpm --filter @breakery/utils build
pnpm typecheck
```

Expected : 0 erreur.

- [ ] **Step 5** — Commit : `feat(utils): session 26 — phase 1.A.6 — csv export helper RFC 4180`.

---

### Sub-phase 1.A.7 — 5 hooks BO (1h)

**Fichiers :**
- Create: `apps/backoffice/src/features/accounting/hooks/useTrialBalance.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useGeneralLedger.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useArAging.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useJournalEntries.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useManualJe.ts`

- [ ] **Step 1** — Créer `useTrialBalance.ts` :

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export type TrialBalanceRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
};

export function useTrialBalance(start: string, end: string) {
  return useQuery({
    queryKey: ['trial-balance', start, end],
    queryFn: async (): Promise<TrialBalanceRow[]> => {
      const { data, error } = await supabase.rpc('get_trial_balance_v1', {
        p_start: start,
        p_end: end,
      });
      if (error) throw error;
      return (data ?? []) as TrialBalanceRow[];
    },
    enabled: !!start && !!end,
  });
}
```

- [ ] **Step 2** — Créer `useGeneralLedger.ts` :

```ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export type GeneralLedgerRow = {
  je_id: string;
  je_number: string;
  posted_at: string;
  description: string;
  reference_type: string;
  reference_id: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  next_cursor: { posted_at: string; je_id: string } | null;
};

type Cursor = { posted_at: string; je_id: string } | null;

export function useGeneralLedger(accountId: string | null, start: string, end: string) {
  return useInfiniteQuery({
    queryKey: ['general-ledger', accountId, start, end],
    initialPageParam: null as Cursor,
    enabled: !!accountId && !!start && !!end,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_general_ledger_v1', {
        p_account_id: accountId!,
        p_start: start,
        p_end: end,
        p_after_posted_at: pageParam?.posted_at ?? null,
        p_after_je_id: pageParam?.je_id ?? null,
        p_limit: 100,
      });
      if (error) throw error;
      const rows = (data ?? []) as GeneralLedgerRow[];
      const lastRow = rows[rows.length - 1];
      const nextCursor = lastRow?.next_cursor ?? null;
      return { rows, nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
```

- [ ] **Step 3** — Créer `useArAging.ts` :

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export type ArAgingRow = {
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  current: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total_outstanding: number;
};

export function useArAging() {
  return useQuery({
    queryKey: ['ar-aging'],
    queryFn: async (): Promise<ArAgingRow[]> => {
      const { data, error } = await supabase
        .from('view_ar_aging')
        .select('*')
        .order('total_outstanding', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ArAgingRow[];
    },
  });
}
```

**Note** : si pre-flight a montré des noms de colonnes différents pour `view_ar_aging` (S24 deliverable), adapter le type `ArAgingRow` ici.

- [ ] **Step 4** — Créer `useJournalEntries.ts` :

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export type JournalEntryFilters = {
  start: string;
  end: string;
  referenceTypes?: string[];
  status?: 'posted' | 'voided';
};

export type JournalEntryRow = {
  id: string;
  je_number: string;
  posted_at: string;
  description: string | null;
  reference_type: string;
  reference_id: string | null;
  status: string;
  journal_entry_lines: Array<{
    id: string;
    account_id: string;
    debit: number;
    credit: number;
    line_description: string | null;
  }>;
};

export function useJournalEntries(filters: JournalEntryFilters) {
  return useQuery({
    queryKey: ['journal-entries', filters],
    queryFn: async (): Promise<JournalEntryRow[]> => {
      let q = supabase
        .from('journal_entries')
        .select('id, je_number, posted_at, description, reference_type, reference_id, status, journal_entry_lines(id, account_id, debit, credit, line_description)')
        .gte('posted_at', filters.start)
        .lte('posted_at', filters.end + 'T23:59:59.999Z')
        .order('posted_at', { ascending: false })
        .limit(500);
      if (filters.referenceTypes && filters.referenceTypes.length > 0) {
        q = q.in('reference_type', filters.referenceTypes);
      }
      if (filters.status) {
        q = q.eq('status', filters.status);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as JournalEntryRow[];
    },
    enabled: !!filters.start && !!filters.end,
  });
}
```

- [ ] **Step 5** — Créer `useManualJe.ts` :

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

type Line = {
  account_id: string;
  debit?: number;
  credit?: number;
  line_description?: string;
};

type Args = {
  postingDate: string;
  description: string;
  lines: Line[];
  managerPin: string;
  idempotencyKey: string;
};

type Result = { je_id: string; idempotent_replay: boolean };

export function useManualJe() {
  const qc = useQueryClient();
  return useMutation<Result, Error, Args>({
    mutationFn: async ({ postingDate, description, lines, managerPin, idempotencyKey }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('unauthenticated');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/create-manual-je`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-manager-pin': managerPin,
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          posting_date: postingDate,
          description,
          lines,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `http_${res.status}`);
      }
      return json as Result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
      qc.invalidateQueries({ queryKey: ['general-ledger'] });
    },
  });
}
```

- [ ] **Step 6** — Typecheck :

```bash
pnpm --filter @breakery/backoffice typecheck
```

Expected : 0 erreur.

- [ ] **Step 7** — Commit : `feat(backoffice): session 26 — phase 1.A.7 — 5 accounting hooks (trial balance, GL, AR aging, JE, manual JE)`.

---

### Sub-phase 1.A.8 — 4 pages BO + routes + sidebar (2h)

**Fichiers :**
- Create: `apps/backoffice/src/pages/accounting/TrialBalancePage.tsx`
- Create: `apps/backoffice/src/pages/accounting/GeneralLedgerPage.tsx`
- Create: `apps/backoffice/src/pages/accounting/ArAgingPage.tsx`
- Create: `apps/backoffice/src/pages/accounting/JournalEntriesPage.tsx`
- Modify: `apps/backoffice/src/router/routes.tsx` (4 routes)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (4 sidebar entries)

- [ ] **Step 1** — Créer `TrialBalancePage.tsx` :

```tsx
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useTrialBalance, type TrialBalanceRow } from '../../features/accounting/hooks/useTrialBalance';
import { exportToCsv } from '@breakery/utils';
import { DateRangePicker } from '../../components/DateRangePicker';
import { Button } from '@breakery/ui';

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'Actifs',
  liability: 'Passifs',
  equity: 'Capitaux propres',
  revenue: 'Produits',
  expense: 'Charges',
};

export default function TrialBalancePage() {
  const [start, setStart] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [end, setEnd] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
  const { data: rows = [], isLoading } = useTrialBalance(start, end);

  const grouped = useMemo(() => {
    const map = new Map<string, TrialBalanceRow[]>();
    for (const r of rows) {
      const list = map.get(r.account_type) ?? [];
      list.push(r);
      map.set(r.account_type, list);
    }
    return map;
  }, [rows]);

  const totals = useMemo(() => {
    const totalDr = rows.reduce((s, r) => s + Number(r.debit_total), 0);
    const totalCr = rows.reduce((s, r) => s + Number(r.credit_total), 0);
    return { totalDr, totalCr, isBalanced: Math.abs(totalDr - totalCr) < 0.01 };
  }, [rows]);

  const handleCsv = () => {
    exportToCsv(
      `Trial_Balance_${start}_to_${end}.csv`,
      ['Code', 'Compte', 'Type', 'Débit', 'Crédit', 'Solde'],
      rows.map((r) => [r.account_code, r.account_name, r.account_type, r.debit_total, r.credit_total, r.balance]),
    );
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Balance générale</h1>
        <div className="flex items-center gap-3">
          <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          <Button onClick={handleCsv} disabled={rows.length === 0}>Export CSV</Button>
        </div>
      </header>
      <div className="rounded border px-4 py-2">
        {totals.isBalanced ? (
          <span className="text-green-700">Balance ✓ ({totals.totalDr.toLocaleString('fr-FR')} = {totals.totalCr.toLocaleString('fr-FR')})</span>
        ) : (
          <span className="text-red-700">Balance ✗ (DR {totals.totalDr.toLocaleString('fr-FR')} ≠ CR {totals.totalCr.toLocaleString('fr-FR')})</span>
        )}
      </div>
      {isLoading && <p>Chargement…</p>}
      {!isLoading && rows.length === 0 && <p className="text-gray-500">Aucune écriture sur cette période.</p>}
      {Array.from(grouped.entries()).map(([type, list]) => {
        const groupDr = list.reduce((s, r) => s + Number(r.debit_total), 0);
        const groupCr = list.reduce((s, r) => s + Number(r.credit_total), 0);
        return (
          <section key={type}>
            <h2 className="text-lg font-medium mt-4">{ACCOUNT_TYPE_LABELS[type] ?? type}</h2>
            <table className="w-full mt-2 text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left">Code</th>
                  <th className="text-left">Compte</th>
                  <th className="text-right">Débit</th>
                  <th className="text-right">Crédit</th>
                  <th className="text-right">Solde</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.account_code} className="border-b">
                    <td>{r.account_code}</td>
                    <td>{r.account_name}</td>
                    <td className="text-right">{Number(r.debit_total).toLocaleString('fr-FR')}</td>
                    <td className="text-right">{Number(r.credit_total).toLocaleString('fr-FR')}</td>
                    <td className="text-right">{Number(r.balance).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={2}>Total {ACCOUNT_TYPE_LABELS[type] ?? type}</td>
                  <td className="text-right">{groupDr.toLocaleString('fr-FR')}</td>
                  <td className="text-right">{groupCr.toLocaleString('fr-FR')}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2** — Créer `GeneralLedgerPage.tsx` :

```tsx
import { useState } from 'react';
import dayjs from 'dayjs';
import { useGeneralLedger } from '../../features/accounting/hooks/useGeneralLedger';
import { exportToCsv } from '@breakery/utils';
import { DateRangePicker } from '../../components/DateRangePicker';
import { Button } from '@breakery/ui';
import { AccountCombobox } from '../../features/accounting/components/AccountCombobox';

export default function GeneralLedgerPage() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [start, setStart] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [end, setEnd] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
  const query = useGeneralLedger(accountId, start, end);

  const allRows = (query.data?.pages ?? []).flatMap((p) => p.rows);

  const handleCsv = () => {
    exportToCsv(
      `General_Ledger_${accountId}_${start}_to_${end}.csv`,
      ['Date', 'N° JE', 'Description', 'Type', 'Débit', 'Crédit', 'Solde'],
      allRows.map((r) => [r.posted_at, r.je_number, r.description, r.reference_type, r.debit, r.credit, r.running_balance]),
    );
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Grand livre</h1>
        <div className="flex items-center gap-3">
          <AccountCombobox value={accountId} onChange={setAccountId} />
          <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          <Button onClick={handleCsv} disabled={allRows.length === 0}>Export CSV</Button>
        </div>
      </header>
      {!accountId && <p className="text-gray-500">Sélectionnez un compte pour afficher le grand livre.</p>}
      {query.isLoading && <p>Chargement…</p>}
      {accountId && !query.isLoading && allRows.length === 0 && (
        <p className="text-gray-500">Aucune écriture sur ce compte pour cette période.</p>
      )}
      {allRows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left">Date</th>
              <th className="text-left">N° JE</th>
              <th className="text-left">Description</th>
              <th className="text-left">Type</th>
              <th className="text-right">Débit</th>
              <th className="text-right">Crédit</th>
              <th className="text-right">Solde</th>
            </tr>
          </thead>
          <tbody>
            {allRows.slice().reverse().map((r) => (
              <tr key={r.je_id} className="border-b">
                <td>{dayjs(r.posted_at).format('YYYY-MM-DD')}</td>
                <td>{r.je_number}</td>
                <td>{r.description}</td>
                <td>{r.reference_type}</td>
                <td className="text-right">{Number(r.debit).toLocaleString('fr-FR')}</td>
                <td className="text-right">{Number(r.credit).toLocaleString('fr-FR')}</td>
                <td className="text-right">{Number(r.running_balance).toLocaleString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {query.hasNextPage && (
        <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
```

**Note** : `AccountCombobox` est un composant simple (combobox sur `accounts where is_postable=true`). À créer dans `apps/backoffice/src/features/accounting/components/AccountCombobox.tsx` — ~30 lignes (Radix `Combobox` + supabase query). Si déjà existant ailleurs dans le BO (audit Wave 1.A.0), réutiliser.

- [ ] **Step 3** — Créer `ArAgingPage.tsx` :

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useArAging } from '../../features/accounting/hooks/useArAging';
import { exportToCsv } from '@breakery/utils';
import { Button, Input } from '@breakery/ui';

export default function ArAgingPage() {
  const { data: rows = [], isLoading } = useArAging();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return rows;
    const lc = filter.toLowerCase();
    return rows.filter(
      (r) => r.customer_name.toLowerCase().includes(lc) || (r.customer_code ?? '').toLowerCase().includes(lc),
    );
  }, [rows, filter]);

  const totals = useMemo(() => ({
    current: filtered.reduce((s, r) => s + Number(r.current), 0),
    b31_60: filtered.reduce((s, r) => s + Number(r.bucket_31_60), 0),
    b61_90: filtered.reduce((s, r) => s + Number(r.bucket_61_90), 0),
    b90: filtered.reduce((s, r) => s + Number(r.bucket_90_plus), 0),
    total: filtered.reduce((s, r) => s + Number(r.total_outstanding), 0),
  }), [filtered]);

  const handleCsv = () => {
    exportToCsv(
      `AR_Aging_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Client', 'Code', 'Courant', '31-60j', '61-90j', '90+j', 'Total dû'],
      filtered.map((r) => [r.customer_name, r.customer_code, r.current, r.bucket_31_60, r.bucket_61_90, r.bucket_90_plus, r.total_outstanding]),
    );
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Balance âgée clients (AR)</h1>
        <div className="flex items-center gap-3">
          <Input placeholder="Rechercher un client…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button onClick={handleCsv} disabled={filtered.length === 0}>Export CSV</Button>
        </div>
      </header>
      {isLoading && <p>Chargement…</p>}
      {!isLoading && filtered.length === 0 && <p className="text-gray-500">Aucun client avec créance ouverte.</p>}
      {filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left">Client</th>
              <th className="text-right">Courant</th>
              <th className="text-right">31-60j</th>
              <th className="text-right">61-90j</th>
              <th className="text-right">90+j</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.customer_id} className="border-b">
                <td><Link to={`/customers/${r.customer_id}`} className="text-blue-700 hover:underline">{r.customer_name}</Link></td>
                <td className="text-right">{Number(r.current).toLocaleString('fr-FR')}</td>
                <td className="text-right">{Number(r.bucket_31_60).toLocaleString('fr-FR')}</td>
                <td className="text-right">{Number(r.bucket_61_90).toLocaleString('fr-FR')}</td>
                <td className="text-right">{Number(r.bucket_90_plus).toLocaleString('fr-FR')}</td>
                <td className="text-right font-semibold">{Number(r.total_outstanding).toLocaleString('fr-FR')}</td>
              </tr>
            ))}
            <tr className="font-semibold border-t-2">
              <td>Total</td>
              <td className="text-right">{totals.current.toLocaleString('fr-FR')}</td>
              <td className="text-right">{totals.b31_60.toLocaleString('fr-FR')}</td>
              <td className="text-right">{totals.b61_90.toLocaleString('fr-FR')}</td>
              <td className="text-right">{totals.b90.toLocaleString('fr-FR')}</td>
              <td className="text-right">{totals.total.toLocaleString('fr-FR')}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4** — Créer `JournalEntriesPage.tsx` :

```tsx
import { useState } from 'react';
import dayjs from 'dayjs';
import { useJournalEntries } from '../../features/accounting/hooks/useJournalEntries';
import { usePermission } from '../../hooks/usePermission';
import { exportToCsv } from '@breakery/utils';
import { Button } from '@breakery/ui';
import { DateRangePicker } from '../../components/DateRangePicker';
import { ManualJournalEntryDialog } from '../../features/accounting/components/ManualJournalEntryDialog';

export default function JournalEntriesPage() {
  const [start, setStart] = useState(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
  const [end, setEnd] = useState(dayjs().format('YYYY-MM-DD'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: rows = [], isLoading } = useJournalEntries({ start, end });
  const canManualJe = usePermission('accounting.je.manual');

  const handleCsv = () => {
    const flatRows: (string | number | null)[][] = [];
    for (const je of rows) {
      for (const line of je.journal_entry_lines) {
        flatRows.push([
          dayjs(je.posted_at).format('YYYY-MM-DD'),
          je.je_number,
          je.description,
          je.reference_type,
          je.status,
          line.account_id,
          line.debit,
          line.credit,
        ]);
      }
    }
    exportToCsv(
      `Journal_Entries_${start}_to_${end}.csv`,
      ['Date', 'N° JE', 'Description', 'Type', 'Statut', 'Compte ID', 'Débit', 'Crédit'],
      flatRows,
    );
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal des écritures</h1>
        <div className="flex items-center gap-3">
          <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          <Button onClick={handleCsv} disabled={rows.length === 0}>Export CSV</Button>
          {canManualJe && (
            <Button onClick={() => setDialogOpen(true)} variant="primary">+ Nouvelle OD</Button>
          )}
        </div>
      </header>
      {isLoading && <p>Chargement…</p>}
      {!isLoading && rows.length === 0 && <p className="text-gray-500">Aucune écriture sur cette période.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left">Date</th>
              <th className="text-left">N° JE</th>
              <th className="text-left">Description</th>
              <th className="text-left">Type</th>
              <th className="text-left">Statut</th>
              <th className="text-right">Total débit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((je) => {
              const totalDr = je.journal_entry_lines.reduce((s, l) => s + Number(l.debit), 0);
              return (
                <tr key={je.id} className="border-b">
                  <td>{dayjs(je.posted_at).format('YYYY-MM-DD')}</td>
                  <td>{je.je_number}</td>
                  <td>{je.description}</td>
                  <td>{je.reference_type}</td>
                  <td>{je.status}</td>
                  <td className="text-right">{totalDr.toLocaleString('fr-FR')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {dialogOpen && (
        <ManualJournalEntryDialog
          key={`manual-je-${dialogOpen}`}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5** — Modifier `apps/backoffice/src/router/routes.tsx` : ajouter 4 routes lazy-loaded sous `/accounting/*` (lazy import, perm gate `reports.financial.read`). Suivre le pattern S13 BO router (lire le fichier d'abord — exact structure dépend du projet).

- [ ] **Step 6** — Modifier `apps/backoffice/src/layouts/Sidebar.tsx` : section "Comptabilité" — ajouter 4 entries. Suivre le pattern existant (MappingsPage S13 est déjà dans cette section).

- [ ] **Step 7** — Typecheck + build :

```bash
pnpm --filter @breakery/backoffice typecheck
pnpm --filter @breakery/backoffice build
```

Expected : 0 erreur.

- [ ] **Step 8** — Commit : `feat(backoffice): session 26 — phase 1.A.8 — 4 accounting pages (trial balance, GL, AR aging, JE) + routes + sidebar`.

---

### Sub-phase 1.A.9 — ManualJournalEntryDialog + PIN dialog (1h)

**Fichiers :**
- Create: `apps/backoffice/src/features/accounting/components/ManualJournalEntryDialog.tsx`
- Create (si absent) : `apps/backoffice/src/features/accounting/components/ManagerPinDialog.tsx`
- Create: `apps/backoffice/src/features/accounting/components/AccountCombobox.tsx` (si absent)

- [ ] **Step 1** — Pre-flight : audit BO pour un `ManagerPinDialog` existant. Si présent ailleurs (par exemple module loyalty admin, ou refund flow), le réutiliser. Sinon créer minimal :

```tsx
// ManagerPinDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Input, Button } from '@breakery/ui';

export function ManagerPinDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (pin: string) => void | Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (pin.length < 4 || pin.length > 8) return;
    setBusy(true);
    try {
      await onConfirm(pin);
    } finally {
      setBusy(false);
      setPin('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>PIN manager requis</DialogTitle></DialogHeader>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••••"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={busy || pin.length < 4}>Confirmer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2** — Créer `AccountCombobox.tsx` (si absent) :

```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@breakery/supabase';
import { Combobox } from '@breakery/ui'; // assume project Combobox primitive

type Account = { id: string; code: string; name: string };

export function AccountCombobox({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'postable'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, code, name')
        .eq('is_postable', true)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });
  const filtered = query
    ? accounts.filter((a) => a.code.includes(query) || a.name.toLowerCase().includes(query.toLowerCase()))
    : accounts;
  return (
    <Combobox
      value={value}
      onValueChange={onChange}
      items={filtered.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))}
      onQueryChange={setQuery}
      placeholder="Choisir un compte…"
    />
  );
}
```

**Note** : si le projet n'a pas de `Combobox` primitive en `@breakery/ui`, fallback sur un `<select>` natif filtré côté client — adapter en Wave 1.A.9.

- [ ] **Step 3** — Créer `ManualJournalEntryDialog.tsx` :

```tsx
import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Input, Textarea, Button,
} from '@breakery/ui';
import { useManualJe } from '../hooks/useManualJe';
import { AccountCombobox } from './AccountCombobox';
import { ManagerPinDialog } from './ManagerPinDialog';

type Line = {
  id: string;
  account_id: string;
  debit: string;
  credit: string;
  line_description?: string;
};

function emptyLine(): Line {
  return { id: crypto.randomUUID(), account_id: '', debit: '', credit: '', line_description: '' };
}

const ERROR_MAP: Record<string, string> = {
  permission_denied: "Vous n'avez pas la permission de saisir des écritures manuelles.",
  pin_invalid: 'PIN manager incorrect.',
  missing_manager_pin: 'PIN manager requis (header manquant).',
  invalid_idempotency_key: "Clé d'idempotency invalide (bug client, à reporter).",
  period_locked: 'La période fiscale est verrouillée pour cette date.',
  description_invalid: 'Description requise (5-500 caractères).',
  line_xor_violation: 'Une ligne ne peut avoir débit ET crédit.',
};

function mapError(code: string): string {
  if (code.startsWith('unbalanced_je')) return 'Écriture déséquilibrée : débit ≠ crédit.';
  if (code.startsWith('non_postable_account')) return 'Compte non-postable sélectionné.';
  return ERROR_MAP[code] ?? `Erreur : ${code}`;
}

export function ManualJournalEntryDialog({ onClose }: { onClose: () => void }) {
  const [postingDate, setPostingDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [pinOpen, setPinOpen] = useState(false);
  const idempotencyKey = useRef<string>(crypto.randomUUID()).current;
  const mutation = useManualJe();

  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr, cr, balanced: Math.abs(dr - cr) < 0.01 && dr > 0 };
  }, [lines]);

  const canSubmit = totals.balanced && description.length >= 5 && lines.every((l) => l.account_id && ((Number(l.debit) > 0) !== (Number(l.credit) > 0)));

  const updateLine = (id: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    setPinOpen(true);
  };

  const handlePinConfirm = async (pin: string) => {
    try {
      const result = await mutation.mutateAsync({
        postingDate,
        description,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || undefined,
          credit: Number(l.credit) || undefined,
          line_description: l.line_description,
        })),
        managerPin: pin,
        idempotencyKey,
      });
      toast.success(result.idempotent_replay ? 'OD déjà enregistrée (replay détecté).' : 'OD enregistrée.');
      setPinOpen(false);
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown_error';
      toast.error(mapError(msg));
      setPinOpen(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Nouvelle écriture manuelle (OD)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Date :
                <Input
                  type="date"
                  value={postingDate}
                  max={dayjs().format('YYYY-MM-DD')}
                  onChange={(e) => setPostingDate(e.target.value)}
                />
              </label>
              <div className="flex items-end justify-end">
                <span className={totals.balanced ? 'text-green-700' : 'text-red-700'}>
                  {totals.balanced
                    ? `Balanced ✓ (${totals.dr.toLocaleString('fr-FR')})`
                    : `Unbalanced ✗ (DR ${totals.dr.toLocaleString('fr-FR')} / CR ${totals.cr.toLocaleString('fr-FR')})`}
                </span>
              </div>
            </div>
            <Textarea
              placeholder="Description (5-500 caractères)…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <AccountCombobox
                      value={line.account_id}
                      onChange={(id) => updateLine(line.id, { account_id: id ?? '' })}
                    />
                  </div>
                  <Input
                    className="col-span-2"
                    type="number"
                    inputMode="decimal"
                    placeholder="Débit"
                    value={line.debit}
                    onChange={(e) => updateLine(line.id, { debit: e.target.value, credit: '' })}
                  />
                  <Input
                    className="col-span-2"
                    type="number"
                    inputMode="decimal"
                    placeholder="Crédit"
                    value={line.credit}
                    onChange={(e) => updateLine(line.id, { credit: e.target.value, debit: '' })}
                  />
                  <Input
                    className="col-span-3"
                    placeholder="Libellé ligne (opt.)"
                    value={line.line_description ?? ''}
                    onChange={(e) => updateLine(line.id, { line_description: e.target.value })}
                  />
                  <Button
                    className="col-span-1"
                    variant="ghost"
                    onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                    disabled={lines.length <= 2}
                  >×</Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                + Ajouter une ligne
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || mutation.isPending}>
              Enregistrer (PIN requis)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onConfirm={handlePinConfirm}
      />
    </>
  );
}
```

- [ ] **Step 4** — Typecheck + build :

```bash
pnpm --filter @breakery/backoffice typecheck
pnpm --filter @breakery/backoffice build
```

Expected : 0 erreur.

- [ ] **Step 5** — Commit : `feat(backoffice): session 26 — phase 1.A.9 — ManualJournalEntryDialog + PIN dialog + AccountCombobox`.

---

### Sub-phase 1.A.10 — Types regen MCP (15min)

- [ ] **Step 1** — Appel `mcp__plugin_supabase_supabase__generate_typescript_types` avec `project_id='ikcyvlovptebroadgtvd'`.

- [ ] **Step 2** — Écrire le résultat dans `packages/supabase/src/types.generated.ts` (remplacer le fichier entier).

- [ ] **Step 3** — Vérifier que les nouveaux types sont présents :

```bash
grep -E "get_trial_balance_v1|get_general_ledger_v1|create_manual_je_v1|manual_je_idempotency_keys" packages/supabase/src/types.generated.ts | head
```

Expected : au moins 4 occurrences.

- [ ] **Step 4** — Final typecheck global :

```bash
pnpm typecheck
```

Expected : 0 erreur.

- [ ] **Step 5** — Commit : `chore(types): session 26 — phase 1.A.10 — regen post accounting cockpit migrations`.

---

## 5. Wave 2 — Phase 2.A : tests (1 stream serial)

**Executor :** 1 subagent `tester` sonnet, name `stream-test`.

### Sub-phase 2.A.1 — pgTAP 10 cas (1h)

**Fichier :**
- Create: `supabase/tests/accounting_cockpit.test.sql`

- [ ] **Step 1** — Créer le fichier pgTAP. Bootstrap des fixtures puis 10 tests :

```sql
BEGIN;
SELECT plan(10);

-- Bootstrap fixtures
DO $$
DECLARE v_mgr_id UUID; v_cashier_id UUID; v_acc_cash UUID; v_acc_rev UUID;
BEGIN
  -- Pick existing roles + permission (seedés en _010)
  -- Create test users
  INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-1111-1111-111111111111', 'mgr-s26@test.local')
    ON CONFLICT DO NOTHING;
  INSERT INTO auth.users (id, email)
    VALUES ('22222222-2222-2222-2222-222222222222', 'cashier-s26@test.local')
    ON CONFLICT DO NOTHING;
  INSERT INTO user_profiles (id, role_code, pin_hash, full_name)
    VALUES (
      '11111111-1111-1111-1111-111111111111', 'MANAGER',
      '$2a$10$abcdefghijklmnopqrstuv',  -- placeholder, real bcrypt('123456') ideally
      'Test Manager S26'
    ) ON CONFLICT (id) DO UPDATE SET role_code = 'MANAGER';
  INSERT INTO user_profiles (id, role_code, pin_hash, full_name)
    VALUES (
      '22222222-2222-2222-2222-222222222222', 'CASHIER',
      '$2a$10$xxxxxxxxxxxxxxxxxxxxx',
      'Test Cashier S26'
    ) ON CONFLICT (id) DO UPDATE SET role_code = 'CASHIER';
END $$;

-- Pick 2 postable accounts from real seeded plan
DO $$
DECLARE v_acc1 UUID; v_acc2 UUID;
BEGIN
  SELECT id INTO v_acc1 FROM accounts WHERE is_postable=true AND code='1110' LIMIT 1;
  SELECT id INTO v_acc2 FROM accounts WHERE is_postable=true AND code='4111' LIMIT 1;
  -- store in a temp table for reuse
  CREATE TEMP TABLE IF NOT EXISTS _test_accounts (k TEXT PRIMARY KEY, v UUID);
  INSERT INTO _test_accounts(k,v) VALUES ('cash', v_acc1), ('rev', v_acc2)
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END $$;

-- Helper to run as a specific user
CREATE OR REPLACE FUNCTION _set_jwt(user_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ============================================================================
-- T1 : get_trial_balance_v1 happy path
-- ============================================================================
SELECT _set_jwt('11111111-1111-1111-1111-111111111111');
SELECT lives_ok(
  $$SELECT * FROM get_trial_balance_v1(CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE)$$,
  'T1 — get_trial_balance_v1 callable as MANAGER'
);

-- ============================================================================
-- T2 : get_trial_balance_v1 empty period
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::INT FROM get_trial_balance_v1('1900-01-01'::DATE, '1900-12-31'::DATE)),
  0,
  'T2 — empty period returns 0 rows, no error'
);

-- ============================================================================
-- T3 : get_general_ledger_v1 page 1 (cash account)
-- ============================================================================
SELECT lives_ok(
  format(
    $$SELECT * FROM get_general_ledger_v1(%L::UUID, %L::DATE, %L::DATE, NULL, NULL, 10)$$,
    (SELECT v FROM _test_accounts WHERE k='cash'),
    CURRENT_DATE - INTERVAL '90 days',
    CURRENT_DATE
  ),
  'T3 — get_general_ledger_v1 callable on a real postable account'
);

-- ============================================================================
-- T4 : get_general_ledger_v1 page 2 via cursor — assertions de non-chevauchement
-- (skipped in BEGIN/ROLLBACK envelope if not enough rows ; use SKIP)
-- ============================================================================
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM journal_entry_lines
    WHERE account_id = (SELECT v FROM _test_accounts WHERE k='cash');
  IF v_count <= 10 THEN
    PERFORM skip('T4 — skipped, not enough JE lines for pagination test', 1);
  ELSE
    PERFORM ok(TRUE, 'T4 — pagination feasible (placeholder ; full assertion in Vitest live)');
  END IF;
END $$;

-- ============================================================================
-- T5 : create_manual_je_v1 happy path
-- ============================================================================
DO $$
DECLARE v_je_id UUID;
BEGIN
  PERFORM _set_jwt('11111111-1111-1111-1111-111111111111');
  v_je_id := create_manual_je_v1(
    CURRENT_DATE,
    'Test JE S26 — happy path',
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='cash'),'debit', 1000),
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='rev'), 'credit', 1000)
    ),
    NULL
  );
  PERFORM ok(v_je_id IS NOT NULL, 'T5a — create_manual_je_v1 returns je_id');
  PERFORM ok(
    EXISTS (
      SELECT 1 FROM audit_logs WHERE entity_id = v_je_id AND action = 'accounting.je.manual.create'
    ),
    'T5b — audit_logs row created'
  );
END $$;

-- ============================================================================
-- T6 : unbalanced_je
-- ============================================================================
SELECT _set_jwt('11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  format(
    $$SELECT create_manual_je_v1(CURRENT_DATE, 'Unbalanced',
      jsonb_build_array(
        jsonb_build_object('account_id', %L::UUID,'debit', 1000),
        jsonb_build_object('account_id', %L::UUID, 'credit', 500)
      ), NULL)$$,
    (SELECT v FROM _test_accounts WHERE k='cash'),
    (SELECT v FROM _test_accounts WHERE k='rev')
  ),
  '22023',
  NULL,
  'T6 — unbalanced JE raises 22023'
);

-- ============================================================================
-- T7 : permission denied (CASHIER role)
-- ============================================================================
SELECT _set_jwt('22222222-2222-2222-2222-222222222222');
SELECT throws_ok(
  format(
    $$SELECT create_manual_je_v1(CURRENT_DATE, 'Cashier attempt',
      jsonb_build_array(
        jsonb_build_object('account_id', %L::UUID,'debit', 100),
        jsonb_build_object('account_id', %L::UUID, 'credit', 100)
      ), NULL)$$,
    (SELECT v FROM _test_accounts WHERE k='cash'),
    (SELECT v FROM _test_accounts WHERE k='rev')
  ),
  'P0003',
  NULL,
  'T7 — CASHIER without perm raises P0003'
);

-- ============================================================================
-- T8 : create_manual_je_v1 signature has NO p_manager_pin (anti-régression)
-- ============================================================================
SELECT is(
  (SELECT pg_get_function_identity_arguments(oid)
     FROM pg_proc WHERE proname='create_manual_je_v1' AND pronamespace='public'::regnamespace),
  'p_posting_date date, p_description text, p_lines jsonb, p_idempotency_key uuid DEFAULT NULL::uuid',
  'T8 — signature has NO p_manager_pin (anti-régression S26 A1 refactor)'
);

-- ============================================================================
-- T9 : idempotency replay same idempotency_key
-- ============================================================================
DO $$
DECLARE v_key UUID := gen_random_uuid(); v_je1 UUID; v_je2 UUID;
BEGIN
  PERFORM _set_jwt('11111111-1111-1111-1111-111111111111');
  v_je1 := create_manual_je_v1(
    CURRENT_DATE, 'Idempotency test',
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='cash'),'debit', 50),
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='rev'), 'credit', 50)
    ),
    v_key
  );
  v_je2 := create_manual_je_v1(
    CURRENT_DATE, 'Idempotency test',
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='cash'),'debit', 50),
      jsonb_build_object('account_id', (SELECT v FROM _test_accounts WHERE k='rev'), 'credit', 50)
    ),
    v_key
  );
  PERFORM is(v_je1, v_je2, 'T9 — replay returns same je_id');
END $$;

-- ============================================================================
-- T10 : fiscal period locked
-- ============================================================================
-- Assumes a locked period in past (S13 seed). If none locked, force-lock one in transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fiscal_periods WHERE is_locked = true LIMIT 1) THEN
    UPDATE fiscal_periods SET is_locked = true
      WHERE period_start = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')::DATE;
  END IF;
END $$;
SELECT _set_jwt('11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  format(
    $$SELECT create_manual_je_v1(
      (SELECT period_start FROM fiscal_periods WHERE is_locked = true ORDER BY period_start LIMIT 1),
      'Locked period attempt',
      jsonb_build_array(
        jsonb_build_object('account_id', %L::UUID,'debit', 10),
        jsonb_build_object('account_id', %L::UUID, 'credit', 10)
      ), NULL)$$,
    (SELECT v FROM _test_accounts WHERE k='cash'),
    (SELECT v FROM _test_accounts WHERE k='rev')
  ),
  'P0004',
  NULL,
  'T10 — locked period raises P0004 period_locked'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2** — Exécuter via MCP `execute_sql` (le contenu du fichier doit être passé tel quel).

Expected : `Result: 10 rows. 0 failed.`

- [ ] **Step 3** — Si certains tests échouent (par ex. seeds COA différents) : ajuster les codes comptes utilisés (`1110` / `4111`) selon le résultat pre-flight 1.A.0. Re-run.

- [ ] **Step 4** — Commit : `test(db): session 26 — phase 2.A.1 — pgTAP accounting cockpit (10 cas)`.

---

### Sub-phase 2.A.2 — Vitest live 8 scénarios (1h30)

**Fichier :**
- Create: `supabase/tests/functions/accounting-cockpit.test.ts`

- [ ] **Step 1** — Pre-flight : vérifier env vars dispo (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`). Si absentes, documenter dans le commit et marquer skip.

- [ ] **Step 2** — Créer le fichier Vitest avec les 8 scénarios TS1-TS8 (cf. spec §5.2 pour la liste détaillée). Pattern S24/S25 : importer `createClient` de supabase-js, bootstrap users via service-role (manager+cashier), exécuter les scénarios via JWTs spécifiques, `afterAll` cleanup. Skeleton :

```ts
// supabase/tests/functions/accounting-cockpit.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY!;

const HAS_ENV = !!SUPABASE_URL && !!SERVICE_ROLE_KEY && !!ANON_KEY;
const describeIf = HAS_ENV ? describe : describe.skip;

describeIf('S26 — accounting cockpit', () => {
  let admin: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let cashAccountId: string;
  let revAccountId: string;
  const createdJeIds: string[] = [];
  const createdIdempotencyKeys: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // bootstrap users via signIn or pre-existing test users (cf. S25 pattern)
    // ...

    // pick 2 postable accounts
    const { data: accs } = await admin.from('accounts').select('id, code').eq('is_postable', true).in('code', ['1110', '4111']);
    cashAccountId = accs!.find((a) => a.code === '1110')!.id;
    revAccountId = accs!.find((a) => a.code === '4111')!.id;
  });

  afterAll(async () => {
    if (createdJeIds.length > 0) {
      await admin.from('audit_logs').delete().in('entity_id', createdJeIds);
      await admin.from('manual_je_idempotency_keys').delete().in('je_id', createdJeIds);
      await admin.from('journal_entry_lines').delete().in('journal_entry_id', createdJeIds);
      await admin.from('journal_entries').delete().in('id', createdJeIds);
    }
  });

  it('TS1 — get_trial_balance_v1 callable via authenticated MANAGER', async () => {
    const { data, error } = await managerClient.rpc('get_trial_balance_v1', {
      p_start: '2026-01-01',
      p_end: '2026-12-31',
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      const totalDr = data.reduce((s: number, r: any) => s + Number(r.debit_total), 0);
      const totalCr = data.reduce((s: number, r: any) => s + Number(r.credit_total), 0);
      expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.01);
    }
  });

  it('TS2 — get_general_ledger_v1 cursor chain', async () => {
    const { data: page1 } = await managerClient.rpc('get_general_ledger_v1', {
      p_account_id: cashAccountId,
      p_start: '2026-01-01',
      p_end: '2026-12-31',
      p_after_posted_at: null,
      p_after_je_id: null,
      p_limit: 5,
    });
    expect(page1).toBeDefined();
    // Further page 2 if cursor present...
  });

  it('TS3 — EF create-manual-je happy path with idempotency key', async () => {
    const idempotencyKey = crypto.randomUUID();
    createdIdempotencyKeys.push(idempotencyKey);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-manual-je`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(await managerClient.auth.getSession()).data.session!.access_token}`,
        'x-manager-pin': '123456', // test PIN
        'x-idempotency-key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        posting_date: new Date().toISOString().slice(0, 10),
        description: 'TS3 happy path',
        lines: [
          { account_id: cashAccountId, debit: 1000 },
          { account_id: revAccountId, credit: 1000 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.je_id).toBeDefined();
    expect(body.idempotent_replay).toBe(false);
    createdJeIds.push(body.je_id);
  });

  it('TS4 — EF create-manual-je retry same idempotency_key', async () => {
    // Reuse last idempotency key from TS3
    const key = createdIdempotencyKeys[createdIdempotencyKeys.length - 1];
    // Same body as TS3, expect idempotent_replay=true
    // ...
    // Assert audit_logs contains a row with action='accounting.je.manual.replay'
  });

  it('TS5 — EF create-manual-je CASHIER (no perm) returns 403', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-manual-je`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(await cashierClient.auth.getSession()).data.session!.access_token}`,
        'x-manager-pin': '999999', // any
        'x-idempotency-key': crypto.randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        posting_date: new Date().toISOString().slice(0, 10),
        description: 'TS5 cashier attempt',
        lines: [
          { account_id: cashAccountId, debit: 10 },
          { account_id: revAccountId, credit: 10 },
        ],
      }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('TS6 — EF create-manual-je invalid PIN returns 401', async () => {
    // Same as TS3 but with wrong PIN
    // ...
  });

  it('TS7 — EF create-manual-je missing x-manager-pin header returns 400', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-manual-je`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(await managerClient.auth.getSession()).data.session!.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        posting_date: new Date().toISOString().slice(0, 10),
        description: 'TS7 missing pin header',
        lines: [
          { account_id: cashAccountId, debit: 10 },
          { account_id: revAccountId, credit: 10 },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_manager_pin');
  });

  it('TS8 — view_ar_aging consommable via from()', async () => {
    const { data, error } = await managerClient.from('view_ar_aging').select('*').limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
```

- [ ] **Step 3** — Run :

```bash
cd supabase/tests
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npx vitest run functions/accounting-cockpit
```

Expected : 8/8 PASS.

- [ ] **Step 4** — Commit : `test(supabase): session 26 — phase 2.A.2 — Vitest live accounting cockpit (8 scénarios)`.

---

### Sub-phase 2.A.3 — BO smoke 5 cas (1h)

**Fichiers :**
- Create: `apps/backoffice/src/features/accounting/__tests__/TrialBalancePage.smoke.test.tsx`
- Create: `apps/backoffice/src/features/accounting/__tests__/GeneralLedgerPage.smoke.test.tsx`
- Create: `apps/backoffice/src/features/accounting/__tests__/ArAgingPage.smoke.test.tsx`
- Create: `apps/backoffice/src/features/accounting/__tests__/JournalEntriesPage.smoke.test.tsx`
- Create: `apps/backoffice/src/features/accounting/__tests__/ManualJournalEntryDialog.smoke.test.tsx`

- [ ] **Step 1** — Pour chaque page, smoke test minimal (mock supabase, mock hooks via MSW ou jest mock). Pattern S24 `b2b-foundation.smoke.test.tsx` à reproduire :

```tsx
// TrialBalancePage.smoke.test.tsx — sketch
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrialBalancePage from '../../../pages/accounting/TrialBalancePage';

vi.mock('../hooks/useTrialBalance', () => ({
  useTrialBalance: () => ({
    data: [
      { account_code: '1110', account_name: 'Cash', account_type: 'asset', debit_total: 1000, credit_total: 0, balance: 1000 },
      { account_code: '4111', account_name: 'POS Revenue', account_type: 'revenue', debit_total: 0, credit_total: 1000, balance: -1000 },
    ],
    isLoading: false,
  }),
}));

describe('TrialBalancePage smoke', () => {
  it('renders rows + balance badge', () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><TrialBalancePage /></QueryClientProvider>);
    expect(screen.getByText(/Balance générale/)).toBeInTheDocument();
    expect(screen.getByText(/Balance ✓/)).toBeInTheDocument();
    expect(screen.getByText('1110')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });
});
```

Répliquer pour les 4 autres pages (cf. spec §5.3 pour les assertions de chaque).

**ManualJournalEntryDialog.smoke.test.tsx — assertion critique** :

```tsx
it('Submit envoie x-manager-pin en header, JAMAIS dans body', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ je_id: 'fake', idempotent_replay: false }) });
  global.fetch = fetchMock;
  // ... render dialog, fill form, submit, enter PIN
  const fetchCall = fetchMock.mock.calls[0];
  const [url, opts] = fetchCall;
  expect(opts.headers['x-manager-pin']).toBe('123456');
  expect(opts.headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  const body = JSON.parse(opts.body);
  expect(body.manager_pin).toBeUndefined();
  expect(body.lines).toBeDefined();
});
```

- [ ] **Step 2** — Run :

```bash
pnpm --filter @breakery/backoffice test accounting
```

Expected : 5/5 PASS.

- [ ] **Step 3** — Quality gates final :

```bash
pnpm typecheck
pnpm build
```

Expected : 0 erreur.

- [ ] **Step 4** — Commit : `test(backoffice): session 26 — phase 2.A.3 — BO smoke 5 cas (accounting pages + manual JE dialog)`.

---

## 6. Wave 3 — Phase 3.A : closeout

**Executor :** lead inline (pas de subagent).

### Sub-phase 3.A.1 — Status notes + roadmap update (30min)

- [ ] **Step 1** — Append status note dans `docs/workplan/backlog-by-module/10-accounting-double-entry.md` au-dessus du contenu existant :

```markdown
## S26 update (2026-MM-DD) — Comptable Cockpit

Session 26 livre le viewer-side du module 10 :

- **4 pages BO** : `/accounting/trial-balance` (RPC `get_trial_balance_v1`), `/accounting/general-ledger` (RPC `get_general_ledger_v1` cursor-paginated), `/accounting/ar-aging` (view S24 `view_ar_aging`), `/accounting/journal-entries` (viewer + saisie OD via EF wrapper).
- **3 RPCs read** : `get_trial_balance_v1(p_start, p_end)`, `get_general_ledger_v1(p_account_id, p_start, p_end, ...)`, `create_manual_je_v1(p_posting_date, p_description, p_lines, p_idempotency_key)`.
- **1 EF wrapper** : `create-manual-je` qui lit `x-manager-pin` header (pattern S25), vérifie le PIN, propage `x-idempotency-key` au RPC.
- **6 migrations** : block `20260603000010..024` (perm seed + 3 RPCs + idempotency table + REVOKE pair canonique S25).
- **TASK-10-011** : PARTIAL → PARTIAL (KPI + viewer parties DONE ; lock fiscal-periods action UI toujours TODO, reporté S30 month-close).

Reference plan : [`../plans/2026-05-19-session-26-INDEX.md`](../plans/2026-05-19-session-26-INDEX.md).
```

Remplacer `MM-DD` par la date effective de la closeout.

- [ ] **Step 2** — Append ligne dans `docs/workplan/backlog-by-module/00-roadmap-globale.md` table "Sessions complétées" :

```markdown
| S26 | 2026-MM-DD | swarm/session-26 | Comptable Cockpit : 4 pages BO read-side (trial balance, general ledger, AR aging, journal entries) + 1 EF wrapper create-manual-je (PIN-en-header S25) + 3 RPCs. 6 migrations `20260603000010..024`. Tests : 10 pgTAP + 8 Vitest live + 5 BO smoke. Closes TASK-10-011 (UI viewer partie) + gaps 10-1/2/3/4. |
```

Ajouter 4 lignes dans la table "Indicateurs de santé" :

```markdown
| Trial balance page BO | enabled | DONE S26 (`/accounting/trial-balance` + RPC `get_trial_balance_v1`) |
| General ledger page BO + cursor pagination | enabled | DONE S26 (`/accounting/general-ledger` + RPC `get_general_ledger_v1`) |
| AR aging page BO (consume view S24) | enabled | DONE S26 (`/accounting/ar-aging`) |
| Manual JE entry via EF wrapper (PIN-en-header S25 pattern) | enabled | DONE S26 (`create-manual-je` EF + RPC `create_manual_je_v1`) |
```

- [ ] **Step 3** — Commit : `docs(workplan): session 26 — phase 3.A.1 — status notes + roadmap update`.

---

### Sub-phase 3.A.2 — CLAUDE.md update (15min)

- [ ] **Step 1** — Lire `CLAUDE.md` et :
  - Renommer `**Current session:** Session 25` → `**Session 25 reference:**` (descend dans l'historique).
  - Ajouter une nouvelle ligne `**Current session:** Session 26 — Comptable Cockpit ✓ ready to merge swarm/session-26 (~N commits, 3 waves, 6 migrations, INDEX: ..., Spec: ...). [résumé détaillé]`.
  - Ajouter dans la section "Critical patterns" un bullet sur le `create_manual_je_v1` triple-couche EF+perm+fiscal + un bullet sur la migration pair `_023`+`_024` comme template récurrent.

- [ ] **Step 2** — Commit : `docs(claude): session 26 — phase 3.A.2 — bump current session + critical patterns enrichi`.

---

### Sub-phase 3.A.3 — Doc rebase `04-modules/10-accounting-double-entry.md` Partie II (30min)

- [ ] **Step 1** — Lire `docs/reference/04-modules/10-accounting-double-entry.md`. Identifier la section "Partie II" (chemins UI). Si elle liste "11 pages aspirational" :
  - Remplacer par la liste réelle V3 (5 pages comptabilité : MappingsPage S13 + 4 nouvelles S26).
  - Ajouter status note "S26 update: 4 pages cockpit livrées + 1 EF + 3 RPCs. VAT page reportée S30 (PKP), PDF reporté S29 (EF générique), fiscal-periods UI lock reporté S30 (month-close)."

- [ ] **Step 2** — Commit : `docs(reference): session 26 — phase 3.A.3 — rebase 04-modules/10 Partie II (paths réels post-S26)`.

---

### Sub-phase 3.A.4 — INDEX §10 deviations + final closeout (30min)

- [ ] **Step 1** — Ajouter une §10 dans CE fichier INDEX listant toutes les déviations rencontrées pendant l'exécution (format S25/S24) :
  - DEV-S26-1.A.0-XX : findings pre-flight notables.
  - DEV-S26-1.A.5-XX : choix Option A vs Option B PIN helper.
  - DEV-S26-X.X-XX : tout écart au spec rencontré.

Voir §10 ci-dessous (placeholder).

- [ ] **Step 2** — Final quality gates :

```bash
pnpm typecheck && pnpm build && pnpm test
```

Expected : tout vert.

- [ ] **Step 3** — Commit : `docs(workplan): session 26 — phase 3.A.4 — closeout (INDEX §10 deviations + final quality gates)`.

- [ ] **Step 4** — Push + PR :

```bash
git push -u origin swarm/session-26
gh pr create --title "session 26 — Comptable Cockpit (4 pages BO read-side + create-manual-je EF + 3 RPCs)" --body "$(cat <<'EOF'
## Summary
- 4 pages BO : `/accounting/{trial-balance, general-ledger, ar-aging, journal-entries}` (CSV-only)
- 1 EF wrapper : `create-manual-je` (PIN-en-header HTTP, pattern S25)
- 3 RPCs : `get_trial_balance_v1`, `get_general_ledger_v1`, `create_manual_je_v1`
- 6 migrations block `20260603000010..024` (perm seed + RPCs + idempotency table + REVOKE pair canonique S25)
- Closes TASK-10-011 (UI viewer partie) + gaps audit 10-1/2/3/4

## Test plan
- [ ] Manual smoke : `/accounting/trial-balance` charge, balance ✓
- [ ] Manual smoke : `/accounting/general-ledger` cursor pagination fonctionne
- [ ] Manual smoke : `/accounting/ar-aging` consume view_ar_aging S24
- [ ] Manual smoke : `/accounting/journal-entries` + "+ Nouvelle OD" → PIN → JE créée
- [ ] pgTAP 10/10
- [ ] Vitest live 8/8
- [ ] BO smoke 5/5
- [ ] typecheck + build green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 7. Definition of Done (DoD global)

### Wave 1 (DB + EF + UI)

- [ ] 6 migrations `_010 / _020 / _021 / _022 / _023 / _024` apply_migration via MCP.
- [ ] `mcp__plugin_supabase_supabase__list_migrations` confirme.
- [ ] Perm `accounting.je.manual` seedée + 3 role grants.
- [ ] 3 RPCs créées + signatures correctes + REVOKE pair appliqué.
- [ ] EF `create-manual-je` déployée sur `ikcyvlovptebroadgtvd`.
- [ ] 4 pages BO + 5 hooks + 1 dialog + 1 PIN dialog + AccountCombobox.
- [ ] CSV helper en place.
- [ ] Types regen MCP committé.

### Wave 2 (tests)

- [ ] pgTAP 10/10 PASS.
- [ ] Vitest live 8/8 PASS.
- [ ] BO smoke 5/5 PASS.
- [ ] `pnpm typecheck` global green.
- [ ] `pnpm build` global green.

### Wave 3 (closeout)

- [ ] Status notes datées sur `10-accounting-double-entry.md`.
- [ ] Roadmap globale §Sessions + 4 lignes §Indicateurs.
- [ ] CLAUDE.md current session bump + Critical patterns enrichi.
- [ ] Doc rebase `docs/reference/04-modules/10-accounting-double-entry.md` Partie II.
- [ ] INDEX §10 deviations finalisé.
- [ ] PR créée, mergée par le user.

---

## 8. PR description draft

Cf. Sub-phase 3.A.4 Step 4 ci-dessus.

---

## 9. Liens

- Spec : [`../specs/2026-05-19-session-26-spec.md`](../specs/2026-05-19-session-26-spec.md)
- Plan multi-sessions parent : [`./2026-05-19-S24-to-S30-plan.md`](./2026-05-19-S24-to-S30-plan.md) §3 S26
- Roadmap globale : [`../backlog-by-module/00-roadmap-globale.md`](../backlog-by-module/00-roadmap-globale.md)
- Backlog module 10 : [`../backlog-by-module/10-accounting-double-entry.md`](../backlog-by-module/10-accounting-double-entry.md)
- Spec S24 (view_ar_aging livré) : [`../specs/2026-05-19-session-24-spec.md`](../specs/2026-05-19-session-24-spec.md)
- Spec/INDEX S25 (patterns PIN-en-header + idempotency 2-flavors + REVOKE pair canonique) : [`../specs/2026-05-19-session-25-spec.md`](../specs/2026-05-19-session-25-spec.md) + [`./2026-05-19-session-25-INDEX.md`](./2026-05-19-session-25-INDEX.md)
- Conventions code : [`../../../CLAUDE.md`](../../../CLAUDE.md)

---

## 10. Déviations rencontrées en exécution

> Section à compléter pendant l'exécution. Format S22/S24/S25.

| ID | Sub-phase | Description | Sévérité | Action |
|----|-----------|-------------|----------|--------|
| _(à compléter)_ | | | | |

---

## 11. Backlog post-S26 (issus de cette session)

> Section à compléter post-execution si des items non-bloquants émergent.

- _(placeholder)_
