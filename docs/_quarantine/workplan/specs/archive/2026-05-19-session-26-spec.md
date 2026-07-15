# Session 26 — Spec : Comptable Cockpit (read-side)

**Date :** 2026-05-19
**Branch :** `swarm/session-26` (off master post-S25 merge)
**Source de la décision :** plan multi-sessions [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §3 S26, recadré lors du brainstorming 2026-05-19 (Q1 scope + Q2 garde-fou JE).
**INDEX :** [`../plans/2026-05-19-session-26-INDEX.md`](../plans/2026-05-19-session-26-INDEX.md) (à rédiger Wave 0.1)
**Migration block réservé :** `20260603000010..030` (6 migrations planifiées : `_010` perm + `_020/_021` RPCs read + `_022` table idempotency + `_023` RPC manual JE + `_024` REVOKE pair canonique S25 ; reste 14 slots libres pour corrections).

---

## 1. Goal

Débloquer l'audit comptable externe et l'usage quotidien du comptable en livrant 4 pages BO de cockpit comptable + 1 chemin de saisie manuelle d'OD (opération diverse) gardé par 2 couches : EF `create-manual-je` (PIN manager en header HTTP, pattern S25) → RPC `create_manual_je_v1` (perm RBAC + fiscal period guard + audit_logs).

L'audit S23 §2 a relevé un déséquilibre cardinal sur le module 10 : la doc référence cite 11 pages BO, le code en livre 1 seule (`MappingsPage` S13). Conséquences :

- **Pas de trial balance** : audit externe impossible (l'auditeur veut une balance synthétique par compte sur une période).
- **Pas de general ledger** : impossible de drilldown sur un compte donné depuis le BO ; le comptable ouvre psql pour chaque vérif.
- **AR aging dashboard partiel** : `view_ar_aging` livré S24 mais sans page comptable dédiée (la page BO actuelle est dans le dashboard B2B, pas dans `/accounting/*`).
- **Journal entries opaques** : aucun viewer BO des JE générés par les triggers S13. Le comptable ne peut pas valider que les triggers produisent les bons comptes.
- **Saisie manuelle d'OD impossible hors SQL** : pour les rectifs (frais bancaires, écritures de régularisation, OD de clôture), le comptable doit ouvrir psql. Risque de saisie sans audit trail.

S26 ferme **5 gaps** :

1. Page `/accounting/trial-balance` consommant un nouveau RPC `get_trial_balance_v1(p_start, p_end)`.
2. Page `/accounting/general-ledger` consommant un nouveau RPC `get_general_ledger_v1` paginé cursor-based.
3. Page `/accounting/ar-aging` consommant la vue `view_ar_aging` (livrée S24).
4. Page `/accounting/journal-entries` viewer + saisie manuelle via nouveau EF `create-manual-je` (PIN en header HTTP, pattern S25) qui appelle un nouveau RPC `create_manual_je_v1` SECURITY DEFINER (perm + fiscal guard).
5. Rebase doc référence `04-modules/10-accounting-double-entry.md` Partie II (chemins réels V3 post-S26).

**Closes** : TASK-10-011 (UI partie viewer — le lock fiscal-periods reste TODO), gaps audit 10-1 (trial balance absent), 10-2 (general ledger absent), 10-3 (JE viewer absent), 10-4 (manual OD via SQL uniquement).

**Hors scope (out-of-scope explicite — décisions ratifiées brainstorming 2026-05-19) :**

- **Page `/accounting/vat-management`** : reportée S30 Decision Sprint car bloquée par le statut PKP The Breakery (RPC `calculate_vat_payable_v1` livré S13 sans consumer reste sans consumer une session de plus).
- **Export PDF** : reporté S29 Reports Export + Z-Report PDF qui prévoit déjà l'EF générique `generate-pdf`. S26 livre CSV-only sur les 4 pages. Pas de double travail PDF.
- **Fiscal-periods UI (TASK-10-011 lock action)** : la table `fiscal_periods` existe (S13 `20260517000002`) et le guard `check_fiscal_period_open()` est utilisé par les triggers, mais l'UI BO pour locker/clore reste TODO. S26 consomme le guard côté `create_manual_je_v1` mais n'ajoute pas la page de gestion. Reporté S30 month-close.
- **Audit trail JE modifications avant/après (TASK-10-013)** : reste TODO. S26 trace seulement la création via `audit_logs` standard, pas un journal_entries_audit_log dédié.
- **Bank reconciliation auto-matching (TASK-10-009)** : reste TODO post-S30.
- **Void/edit d'une JE manuelle après posting** : pas de UI de modification. Pour rectifier, le comptable post une JE compensating (convention comptable standard : pas d'édition d'écriture posted).

---

## 2. Décisions clés (D1-D8)

| ID | Décision | Rationale |
|----|----------|-----------|
| **D1** | **Scope trim** : 4 pages CSV-only (pas VAT, pas PDF). Lever le risque de scope creep et la duplication PDF avec S29. | User a tranché lors du brainstorming (Q1 option "Trim PDF + différer VAT"). VAT page muette tant que PKP non confirmé. PDF dédoublé avec EF générique S29 = waste. |
| **D2** | **Triple-gate sur la saisie manuelle JE** : perm RBAC `accounting.je.manual` (côté RPC) + PIN manager (côté EF wrapper, en header `x-manager-pin`) + audit_logs `action='accounting.je.manual.create'` (côté RPC). | User a tranché lors du brainstorming (Q2 option "Perm + PIN"). Pattern S25 refund-order : perm nécessaire mais insuffisante (session ADMIN compromise), PIN rajoute une friction au write critique, audit_logs assure la piste. Pas de four-eyes car ralentit les rectifs urgentes. |
| **D3** | **RPCs pour agrégats**, hooks BO pour shape. `get_trial_balance_v1` agrège SUM côté Postgres. `get_general_ledger_v1` paginate cursor-based. Pas de logique métier dans le client. | Pattern S13 accounting + S24 view_b2b_invoices : la DB est la SOURCE pour les agrégats financiers. Transfert payload énorme si on retournait les lignes brutes pour TB (50k+ lignes/mois compte 1110 Cash). |
| **D4** | **Cursor-based pagination** sur `(posted_at DESC, je_id DESC)` pour `get_general_ledger_v1`. Args RPC `p_after_posted_at TIMESTAMPTZ` + `p_after_je_id UUID` + `p_limit INT DEFAULT 100`. Retourne `next_cursor JSONB`. | Stable même si JE arrivent pendant le scroll, perf O(log n) avec index existant. Coût RPC : +10 lignes vs offset+limit. Pattern KDS realtime S13. |
| **D5** | **`create_manual_je_v1` SECURITY DEFINER + idempotency** via table dédiée `manual_je_idempotency_keys` (pattern S25 `tablet_order_idempotency_keys`). Pas de colonne `idempotency_key` sur `journal_entries`. | Isolation des keys, REVOKE plus simple, purge indépendante future. |
| **D6** | **EF wrapper `create-manual-je`** : reçoit le PIN via header HTTP `x-manager-pin` (jamais body — pattern S25 verrouillé en CLAUDE.md ligne 54), vérifie le PIN via service-role check sur `user_profiles.pin_hash`, propage `x-idempotency-key` au RPC en arg `p_idempotency_key` (helper `_shared/idempotency.ts` livré S25), puis appelle `create_manual_je_v1` SANS PIN arg. RPC garde seulement perm gate + fiscal guard + audit_logs. | Le PIN dans body PostgREST = anti-pattern S25 (access logs, pgaudit). EF wrapper isole la couche secret. Helper `_shared/idempotency.ts` réutilise le rodage S25 sur `refund-order`. Bénéfice transverse : si S30+ ajoute d'autres mutations comptables sensibles, le pattern est posé. |
| **D7** | **Pas de void/edit UI pour les JE manuelles**. Toute rectif = nouvelle JE compensating. | Convention comptable standard (SAK EMKM section 5.2 immutabilité posted). Évite d'avoir à concevoir un workflow d'édition avec full audit trail (déféré TASK-10-013). |
| **D8** | **Doc rebase inclus en S26**, pas en S30. Effort S (~1h) avec chemins réels frais en mémoire. | Évite de rebaser 4-page-additions dans 2-3 semaines (3-4h). Le doc reste stale moins longtemps. |
| **D9** | **Split REVOKE migration** : `_023` crée la RPC pure, `_024` applique REVOKE/GRANT + `ALTER DEFAULT PRIVILEGES` (pattern S25 `_012`+`_013` pair). | CLAUDE.md ligne 53 défense-en-profondeur : pair canonique de migrations. Facilite rollback indépendant et code review. |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 0 — Phase 0.1 : spec + INDEX + branch                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 1 — Phase 1.A : DB + EF + UI (1 stream serial)                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Sub-phase 1.A.0 — Pre-flight DB+EF introspection (MCP+FS)    │   │
│  │ Sub-phase 1.A.1 — Migrations _010 / _020 / _021 / _022 / _023│   │
│  │                    / _024 (REVOKE+ALTER pair S25 canonical)  │   │
│  │ Sub-phase 1.A.2 — EF wrapper create-manual-je (PIN en header)│   │
│  │ Sub-phase 1.A.3 — Hooks BO (5 hooks)                         │   │
│  │ Sub-phase 1.A.4 — Pages BO (4 pages) + routes + sidebar      │   │
│  │ Sub-phase 1.A.5 — CSV export helper (audit packages/utils)   │   │
│  │ Sub-phase 1.A.6 — ManualJournalEntryDialog (fetch EF)        │   │
│  │ Sub-phase 1.A.7 — Types regen MCP                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                     ▼ sync gate (Wave 1 DONE)                       │
│                                                                     │
│  Wave 2 — Phase 2.A : tests                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ pgTAP accounting_cockpit.test.sql (T1-T10)                   │   │
│  │ Vitest live functions/accounting-cockpit.test.ts (TS1-TS6)   │   │
│  │ BO smoke (5 cas)                                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                     ▼ sync gate (Wave 2 DONE)                       │
│                                                                     │
│  Wave 3 — Phase 3.A : closeout                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Quality gates (typecheck + build + test)                     │   │
│  │ Status notes 10-accounting-double-entry (TASK-10-011 PARTIAL)│   │
│  │ Roadmap globale §Sessions + §Indicateurs                     │   │
│  │ CLAUDE.md : bump current session + Critical patterns block   │   │
│  │ Doc rebase 04-modules/10-accounting-double-entry.md Partie II│   │
│  │ INDEX §10 deviations (post-execution)                        │   │
│  │ Commit closeout + push + PR                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Topologie** : 1 stream serial (Wave 1 entièrement séquentielle : UI dépend des RPCs, pas de parallélisme utile à 1.5j wall-time).

---

## 4. Détails techniques

### 4.1 — Couche DB (6 migrations)

#### 4.1.1 — `20260603000010_seed_accounting_je_manual_perm.sql` (NEW perm)

```sql
INSERT INTO permissions (code, description, category)
VALUES ('accounting.je.manual', 'Create manual journal entries (OD)', 'accounting')
ON CONFLICT (code) DO NOTHING;

-- Grant to MANAGER, ADMIN, SUPER_ADMIN (NOT cashier, NOT waiter)
INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'accounting.je.manual'
  FROM (VALUES ('MANAGER'),('ADMIN'),('SUPER_ADMIN')) AS r(code)
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMENT ON COLUMN permissions.code IS
  'Seeded codes include accounting.je.manual (S26) — gate for create_manual_je_v1 RPC.';
```

**Pré-requis Wave 1.A.0** : vérifier le schéma exact de `permissions` (colonnes `code`, `description`, `category`) et `role_permissions` (colonnes `role_code`, `permission_code`). Si divergence, adapter le INSERT.

#### 4.1.2 — `20260603000020_create_get_trial_balance_v1.sql` (NEW RPC)

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

**Note** : `account_type::TEXT` cast pour stabilité ABI (l'enum `account_type_enum` peut évoluer).

#### 4.1.3 — `20260603000021_create_get_general_ledger_v1.sql` (NEW RPC)

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

  -- Opening balance = sum of all postings BEFORE p_start
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
    LIMIT p_limit + 1  -- fetch one extra to detect next page
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
    -- running balance computed DESC then reversed visually by client (see hook)
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

**Note** : la sémantique running_balance dans la fenêtre `UNBOUNDED PRECEDING` est cohérente uniquement pour la page courante. Le client doit afficher les lignes en ordre ASC (plus ancien → plus récent) pour que la lecture du running balance fasse sens. La pagination DESC sert la perf (page 1 = JE les plus récents).

#### 4.1.4 — `20260603000022_create_manual_je_idempotency_keys_table.sql` (NEW table)

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

#### 4.1.5 — `20260603000023_create_manual_je_v1.sql` (NEW RPC, perm+fiscal gate)

**Important** : la RPC ne valide PAS le PIN. Le PIN est vérifié côté EF wrapper `create-manual-je` (§4.2) en header HTTP `x-manager-pin`. La RPC reste accessible directement à un caller `authenticated` qui aurait la perm `accounting.je.manual` — c'est une décision assumée : la perm seule suffit à autoriser la RPC ; le PIN ajoute une friction au flow standard (BO) mais n'est pas un gate RPC. Tout caller direct (CLI, autre EF future) qui veut bypasser le PIN doit avoir explicitement la perm RBAC + le service-role n'est pas concerné.

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
  -- Gate 1 : auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Gate 2 : RBAC perm
  IF NOT has_permission(v_user_id, 'accounting.je.manual') THEN
    RAISE EXCEPTION 'Permission denied: accounting.je.manual' USING ERRCODE = 'P0003';
  END IF;

  -- Gate 3 : fiscal period guard
  IF NOT check_fiscal_period_open(p_posting_date) THEN
    RAISE EXCEPTION 'period_locked' USING ERRCODE = 'P0004';
  END IF;

  -- Idempotent replay check FIRST
  IF p_idempotency_key IS NOT NULL THEN
    SELECT je_id INTO v_existing_je
      FROM manual_je_idempotency_keys
      WHERE idempotency_key = p_idempotency_key;
    IF v_existing_je IS NOT NULL THEN
      RETURN v_existing_je;
    END IF;
  END IF;

  -- Validate lines
  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'unbalanced_je: at least 2 lines required' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NULL OR length(p_description) < 5 OR length(p_description) > 500 THEN
    RAISE EXCEPTION 'description_invalid' USING ERRCODE = '22023';
  END IF;

  -- Sum + per-line validation
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::UUID;
    -- account exists + postable
    PERFORM 1 FROM accounts
      WHERE id = v_account_id AND is_postable = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'non_postable_account: %', v_account_id USING ERRCODE = '22023';
    END IF;
    -- XOR debit/credit
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

  -- Allocate JE number + INSERT header
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

  -- INSERT lines
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

  -- Persist idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO manual_je_idempotency_keys (idempotency_key, je_id)
      VALUES (p_idempotency_key, v_je_id);
  END IF;

  -- Audit log (does NOT include any PIN material — PIN is verified upstream by EF)
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
    -- Race condition on idempotency_key — re-read
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

**Note REVOKE/GRANT** : volontairement omis ici — gérés dans la migration pair `_024` qui suit (canonical S25 pattern, voir §4.1.6).

#### 4.1.6 — `20260603000024_revoke_anon_create_manual_je_v1.sql` (NEW pair S25 canonical)

```sql
-- Pattern S25 defense-in-depth pair (mirror of S25 migrations 20260602000012 + 20260602000013).
-- Splitting REVOKE from CREATE simplifies rollback and PR review.

REVOKE ALL ON FUNCTION create_manual_je_v1 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION create_manual_je_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_manual_je_v1 FROM anon;
GRANT EXECUTE ON FUNCTION create_manual_je_v1 TO authenticated;

-- Future-proof : the project-wide ALTER DEFAULT PRIVILEGES is already in place since S25
-- migration 20260602000013. This block is idempotent — calling it again is a no-op,
-- but we include it here to make this migration self-contained for rollback testing.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMENT ON FUNCTION create_manual_je_v1 IS
  'S26 — manual OD entry. Gates: perm accounting.je.manual + check_fiscal_period_open. PIN gate handled upstream by EF create-manual-je (x-manager-pin header). Idempotent via manual_je_idempotency_keys. REVOKE pair-migrated in _024.';
```

**Pré-requis Wave 1.A.0** : confirmer existence et signature de :
- `has_permission(uuid, text) → boolean` (S13 RBAC)
- Helper PIN — préférence pour vérification **côté EF** via service-role + lecture `user_profiles.pin_hash` + bcrypt compare. Si un helper SQL `verify_manager_pin_v1(uuid, text) → boolean` existe (module 01 / S19 PIN strength work), l'EF peut l'appeler via RPC. Sinon, l'EF implémente la compare directement (~15 lignes Deno + import bcrypt). Wave 1.A.0 décide.
- `check_fiscal_period_open(date) → boolean` (S13)
- `next_journal_entry_number() → text` (S13)
- Colonne `audit_logs.payload jsonb` (présente depuis S19 `20260523000019_audit_logs_add_payload.sql`)
- Colonnes complètes de `audit_logs` : confirmer `user_id`, `action`, `entity_type`, `entity_id`, `payload` (le INSERT de `_023` cible ces 5 colonnes — si `entity_type` n'existe pas, mettre la valeur dans `payload.entity_type` à la place).
- Enum `account_type_enum` valeurs : `asset / liability / equity / revenue / expense` (utilisé pour le group-by Trial Balance).
- Vue `view_ar_aging` colonnes exposées (S24) : confirmer noms `customer_name / customer_code / current / bucket_31_60 / bucket_61_90 / bucket_90_plus / total_outstanding` — sinon adapter `ArAgingPage` colonnes.
- **Helper EF** `supabase/functions/_shared/idempotency.ts` (livré S25) : confirmer présence de `getIdempotencyKey(req, opts?)` + `MissingIdempotencyKeyError` + `InvalidIdempotencyKeyError`. Réutilisé tel quel par l'EF `create-manual-je`.
- **Auth EF pattern** `supabase/functions/_shared/auth.ts` (ou équivalent) : vérifier le helper standard d'extraction du JWT user + service-role client (pattern utilisé par `refund-order` post-S25). Si absent, le créer.

### 4.2 — Couche EF — `create-manual-je`

**Path** : `supabase/functions/create-manual-je/index.ts` (NEW).
**Méthode** : `POST`.
**Headers** :
- `Authorization: Bearer <user JWT>` (extrait par le pattern standard EF auth).
- `x-manager-pin: <6-digit PIN>` (REQUIRED — pattern S25 hard cutover).
- `x-idempotency-key: <UUID v4>` (OPTIONAL — passé tel quel au RPC en arg).
- `Content-Type: application/json`.

**Body** :
```json
{
  "posting_date": "YYYY-MM-DD",
  "description": "string 5-500 chars",
  "lines": [
    { "account_id": "uuid", "debit": "number", "credit": "number", "line_description": "string?" },
    ...
  ]
}
```

**Réponses** :
- `200 { je_id: "uuid", idempotent_replay: false | true }` — succès (replay détecté si le RPC a retourné un je_id préexistant via la table d'idempotency).
- `400 missing_manager_pin` — header `x-manager-pin` absent.
- `400 invalid_idempotency_key` — header `x-idempotency-key` présent mais pas un UUID v4.
- `400 description_invalid` / `unbalanced_je` / `non_postable_account` / `line_xor_violation` — validation côté RPC remontée.
- `401 pin_invalid` — PIN ne correspond pas au hash stocké pour le user.
- `403 permission_denied` — perm `accounting.je.manual` manquante.
- `409 period_locked` — fiscal period fermée.
- `500 internal_error` — toute autre exception (logged).

**Pseudo-code** :

```ts
import { getIdempotencyKey, MissingIdempotencyKeyError, InvalidIdempotencyKeyError }
  from '../_shared/idempotency.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  // 1. Extract user JWT (pattern shared/auth)
  const userClient = getUserClient(req);  // throws 401 if no JWT
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonError(401, 'unauthorized');

  // 2. Read x-manager-pin header (HARD requirement — pattern S25 hard cutover)
  const pin = req.headers.get('x-manager-pin');
  if (!pin) return jsonError(400, 'missing_manager_pin');

  // 3. Verify PIN via service-role (reads user_profiles.pin_hash + bcrypt compare)
  //    OR via SQL helper verify_manager_pin_v1 if it exists (Wave 1.A.0 decides)
  const pinOk = await verifyManagerPin(user.id, pin);  // shared helper
  if (!pinOk) return jsonError(401, 'pin_invalid');

  // 4. Read optional x-idempotency-key (S25 helper)
  let idempotencyKey: string | null;
  try {
    idempotencyKey = getIdempotencyKey(req);
  } catch (e) {
    if (e instanceof InvalidIdempotencyKeyError) return jsonError(400, 'invalid_idempotency_key');
    throw e;
  }

  // 5. Read body
  const body = await req.json();
  if (!body.posting_date || !body.description || !Array.isArray(body.lines)) {
    return jsonError(400, 'invalid_payload');
  }

  // 6. Call RPC (user-context, RLS via perm gate inside RPC)
  const { data: jeId, error } = await userClient.rpc('create_manual_je_v1', {
    p_posting_date:    body.posting_date,
    p_description:     body.description,
    p_lines:           body.lines,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    // Map Postgres exceptions to HTTP status
    if (error.code === 'P0003') return jsonError(403, 'permission_denied');
    if (error.code === 'P0004') return jsonError(409, 'period_locked');
    if (error.code === '22023') return jsonError(400, error.message);
    return jsonError(500, 'internal_error');
  }

  // 7. Detect replay : if jeId existed before this request, idempotency table has older row
  const isReplay = idempotencyKey
    ? await isIdempotentReplay(userClient, idempotencyKey, /* now */ new Date())
    : false;

  return jsonOk({ je_id: jeId, idempotent_replay: isReplay });
});
```

**PIN verification helper** : `verifyManagerPin(userId, pin)` (Wave 1.A.0 décide entre :
- Option A : SQL helper `verify_manager_pin_v1(uuid, text)` si déjà existant côté DB (S19 ?).
- Option B : Deno-side compare via `import { compare } from 'https://deno.land/x/bcrypt'` + service-role `SELECT pin_hash FROM user_profiles WHERE id = $1`. ~15 lignes.

**Audit côté EF** : si replay, l'EF log dans `audit_logs` un row `action='accounting.je.manual.replay'` avec `entity_id=jeId` + `payload={idempotency_key, user_id}` (pattern S25 `refund.replay`).

**Pas de rate-limiting spécifique en S26** : le rate-limit durable S19 s'applique déjà sur les EFs auth (`auth-verify-pin`). Sur `create-manual-je`, le throttling implicite est la perm RBAC + le PIN — un attaquant ne peut pas brute-forcer le PIN car (a) il faut déjà être authentifié, (b) perm RBAC requise. Si volume futur d'abus → ajouter `checkRateLimitDurable(user_id, 'manual-je', 10/min)` en post-S30.

### 4.3 — Couche UI/BO

#### 4.3.1 — Routes + sidebar

`apps/backoffice/src/router/routes.tsx` : ajout de 4 routes lazy-loaded sous `/accounting/*` :

```tsx
// pseudo-code, pattern S13 BO router
{ path: 'accounting/trial-balance',  element: <TrialBalancePage /> },
{ path: 'accounting/general-ledger', element: <GeneralLedgerPage /> },
{ path: 'accounting/ar-aging',       element: <ArAgingPage /> },
{ path: 'accounting/journal-entries', element: <JournalEntriesPage /> },
```

Toutes les routes wrappées par `<PermissionGate require="reports.financial.read">`.

`apps/backoffice/src/layouts/Sidebar.tsx` : section "Comptabilité" déjà existante (avec MappingsPage S13) — ajout de 4 items dans le même groupe, ordonnés : Trial Balance / General Ledger / Journal Entries / AR Aging / Mappings.

#### 4.3.2 — Pages BO

**`TrialBalancePage.tsx`**
- `DateRangePicker` (default = current month, `dayjs().startOf('month')` à `dayjs().endOf('month')`).
- Table groupée par `account_type` (asset / liability / equity / revenue / expense), totaux par groupe + grand total.
- Invariant visible : "Balanced ✓" si `sum(debit) === sum(credit)`, sinon alerte rouge.
- Bouton "Export CSV" → fichier `Trial_Balance_YYYY-MM-DD_to_YYYY-MM-DD.csv`.

**`GeneralLedgerPage.tsx`**
- `AccountCombobox` (combobox sur `accounts` where `is_postable=true`, fetch via existing hook `useAccounts` ou nouveau).
- `DateRangePicker` (default = current month).
- Liste virtualisée via `useInfiniteQuery` + cursor RPC. Pas de scroll virtualization lib si la fenêtre tient en ~500 lignes ; sinon `react-virtual`.
- Colonnes : `posted_at` / `je_number` / `description` / `debit` / `credit` / `running_balance`.
- Bouton "Export CSV" → tous les enregistrements de la période actuelle (loop cursor jusqu'à `next_cursor=null`).

**`ArAgingPage.tsx`**
- Pas de picker. Lecture directe de `view_ar_aging` (S24) via `supabase.from('view_ar_aging').select(...)`.
- Colonnes : `customer_name` / `customer_code` / `current` / `bucket_31_60` / `bucket_61_90` / `bucket_90_plus` / `total_outstanding`.
- Filter input pour recherche customer (client-side).
- Lien sur chaque customer → `/customers/:id` (CustomerDetailPage existante).
- Bouton "Export CSV".

**`JournalEntriesPage.tsx`**
- `DateRangePicker` (default = last 7 days).
- Filtres : `reference_type` multi-select (sale / purchase / expense / manual / shift_close / ...), `status` (posted / voided).
- Table paginée (offset+limit acceptable ici car la table sera typiquement filtrée → < 500 lignes).
- Bouton "+ Nouvelle OD" visible uniquement si perm `accounting.je.manual` détectée côté hook (`usePermission`).
- Au clic → ouvre `ManualJournalEntryDialog`.
- Bouton "Export CSV".

#### 4.3.3 — Hooks BO

`apps/backoffice/src/features/accounting/hooks/` :

- **`useTrialBalance(start: string, end: string)`** : `useQuery` sur `supabase.rpc('get_trial_balance_v1', {p_start: start, p_end: end})`. Group by `account_type` côté client. Retourne `{ rows, groupedByType, totals, isBalanced }`.

- **`useGeneralLedger(accountId: string, start, end)`** : `useInfiniteQuery`. `pageParam` = `next_cursor` (JSONB). `getNextPageParam` returns `page.next_cursor ?? undefined`. Retourne `{ pages, hasNextPage, fetchNextPage, allRows }`.

- **`useArAging()`** : `useQuery` sur `supabase.from('view_ar_aging').select('*').order('total_outstanding', { ascending: false })`. Filtres clients-side.

- **`useJournalEntries(filters)`** : `useQuery` sur `supabase.from('journal_entries').select('*, journal_entry_lines(*)').match(filters)`. Pas de RPC nouvelle (lecture directe RLS-protégée).

- **`useManualJe()`** : `useMutation` sur EF `create-manual-je` via `fetch()` raw (pattern S25 `useRefundOrder`). Body = `{ posting_date, description, lines }`. Headers = `{ Authorization, 'x-manager-pin': pin, 'x-idempotency-key': uuid?, 'Content-Type': 'application/json' }`. `onSuccess` invalide `useJournalEntries` + toast (avec mention "Replay détecté" si `idempotent_replay: true`). PIN et `idempotency_key` injectés par `ManualJournalEntryDialog` depuis ses `useRef`.

#### 4.3.4 — `ManualJournalEntryDialog`

`apps/backoffice/src/features/accounting/components/ManualJournalEntryDialog.tsx`.

Form fields :
- `posting_date` : DatePicker, default today, max today + 0 jours (pas de futur).
- `description` : Textarea, 5-500 chars, required.
- `lines` : array dynamique de `{ account_id: UUID, debit: number, credit: number, line_description?: string }`. Minimum 2 lignes (boutons "+ Add line" et "Remove" par ligne, "Remove" désactivé si lines.length=2).
- Validation live : `sum(debit) === sum(credit)` + `debit XOR credit` par ligne. Badge "Balanced ✓ / Unbalanced ✗" sticky.
- Submit ouvre `ManagerPinDialog` (PIN modal) :
  - Si dialog existant en BO réutilisable → reuse.
  - Sinon, créer minimal : input 6-digit PIN. À la confirmation, le PIN est passé en argument de `useManualJe().mutate({ ..., managerPin: pin })`. Le hook envoie le PIN via header `x-manager-pin` (jamais stocké dans le body JSON — pattern S25).

UUID idempotency : `const idempotencyKey = useRef<string>(crypto.randomUUID()).current` au mount. Survit aux re-renders et aux retry après échec réseau. Reset via `key` prop sur le Dialog (forced remount on close).

Lifecycle : PIN saisi → conserved dans `useState` local au PIN dialog SEULEMENT. Jamais propagé à un state global / Redux / React Query cache. `onSuccess` du mutation invalide la PIN state (set to empty string).

Erreurs serveur (EF) mappées en français :
- HTTP 403 `permission_denied` → "Vous n'avez pas la permission de saisir des écritures manuelles."
- HTTP 401 `pin_invalid` → "PIN manager incorrect."
- HTTP 400 `missing_manager_pin` → "PIN manager requis (header manquant)."  *(défensif — UI devrait toujours envoyer le PIN, signal d'un bug)*
- HTTP 400 `invalid_idempotency_key` → "Clé d'idempotency invalide (bug client, à reporter)."
- HTTP 409 `period_locked` → "La période fiscale est verrouillée pour cette date."
- HTTP 400 `unbalanced_je: ...` → "Écriture déséquilibrée : débit ≠ crédit."
- HTTP 400 `non_postable_account: ...` → "Compte non-postable sélectionné."
- HTTP 400 `line_xor_violation` → "Une ligne ne peut avoir débit ET crédit."
- HTTP 400 `description_invalid` → "Description requise (5-500 caractères)."

#### 4.3.5 — CSV export helper

Wave 1.A.0 audit `packages/utils/src/` : si helper CSV existant, réutiliser. Sinon créer `packages/utils/src/csv.ts` :

```ts
export function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.map(escape).join(';'),  // ; for FR/ID Excel locale
    ...rows.map(r => r.map(escape).join(';')),
  ].join('\n');
  const bom = '﻿';  // UTF-8 BOM for Excel (escape, not literal char, to keep file ASCII-safe)
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Pas de dépendance externe.

### 4.4 — Types regen

Wave 1.A.7 : appel `mcp__plugin_supabase_supabase__generate_typescript_types` → écriture `packages/supabase/src/types.generated.ts` → commit dédié `chore(types): session 26 — phase 1.A.7 — regen post accounting cockpit migrations`.

---

## 5. Tests (Wave 2)

### 5.1 — pgTAP `supabase/tests/accounting_cockpit.test.sql` (NEW, plan(10))

Tests RPC niveau DB (PIN gate testé séparément côté EF Vitest — voir §5.2).

| # | Test | Assertion |
|---|------|-----------|
| T1 | `get_trial_balance_v1` happy path | Lignes retournées + invariant `SUM(debit) = SUM(credit)` |
| T2 | `get_trial_balance_v1` période sans JE | Retourne empty set, pas d'erreur |
| T3 | `get_general_ledger_v1` page 1 sur compte avec >100 lignes | `next_cursor` non-null, `running_balance` cohérent avec opening |
| T4 | `get_general_ledger_v1` page 2 via cursor | Pas de chevauchement avec page 1 (assertion ON join) |
| T5 | `create_manual_je_v1` happy path | JE créé, audit_log row présent avec `action='accounting.je.manual.create'`, idempotency key stockée, `payload.source='create-manual-je-ef'` |
| T6 | `create_manual_je_v1` lignes unbalanced | `RAISES_OK 22023 unbalanced_je`, transaction rollback complet (`SELECT COUNT(*) FROM journal_entries` inchangé) |
| T7 | `create_manual_je_v1` perm manquante (rôle CASHIER) | `RAISES_OK P0003 permission_denied` |
| T8 | `create_manual_je_v1` signature : pas de paramètre `p_manager_pin` | `has_function_privilege` + `pg_get_function_identity_arguments` confirme la signature sans PIN (anti-régression vs version triple-gate initiale) |
| T9 | `create_manual_je_v1` replay même idempotency_key | Retourne même `je_id`, `COUNT(journal_entries WHERE reference_type='manual')` inchangé |
| T10 | `create_manual_je_v1` période fiscale lockée | `RAISES_OK P0004 period_locked` |

Bootstrap pgTAP : 1 user_profile MANAGER (avec perm `accounting.je.manual` accordée) + 1 user_profile CASHIER + plan comptable minimal seedé + 2-3 JE posted pour T1-T4.

### 5.2 — Vitest live `supabase/tests/functions/accounting-cockpit.test.ts` (NEW, ~8 scénarios)

Tests EF + read-RPCs combinés (PIN gate testé exclusivement ici car le helper bcrypt et le header lifecycle sont côté EF).

| # | Scénario | Assertion |
|---|----------|-----------|
| TS1 | `get_trial_balance_v1` via supabase-js client (rôle authenticated MANAGER) | Shape OK + invariant balance |
| TS2 | `get_general_ledger_v1` 3 pages via cursor | Chain cohérente, `running_balance` monotone (selon `account_type`) |
| TS3 | EF `create-manual-je` happy path : POST avec `x-manager-pin` valide + `x-idempotency-key` UUID | 200 `{ je_id, idempotent_replay: false }` + `audit_logs` query confirme entry + `manual_je_idempotency_keys` populée |
| TS4 | EF `create-manual-je` retry même `x-idempotency-key` | 200 `{ je_id: <même>, idempotent_replay: true }`, `COUNT(journal_entries)` inchangé, `audit_logs` contient un row supplémentaire `action='accounting.je.manual.replay'` |
| TS5 | EF `create-manual-je` rôle CASHIER (auth OK mais sans perm RBAC) | 403 `permission_denied` |
| TS6 | EF `create-manual-je` PIN invalide (`x-manager-pin: 999999`) | 401 `pin_invalid`, aucune JE créée |
| TS7 | EF `create-manual-je` **sans** `x-manager-pin` header (hard cutover vérif S25 pattern) | 400 `missing_manager_pin` |
| TS8 | `view_ar_aging` consommable via `from()` | Buckets `current/31-60/61-90/90+` cohérents (smoke S24) |

`afterAll` : DELETE des `audit_logs`, `journal_entry_lines`, `journal_entries`, `manual_je_idempotency_keys` créés pour le test (pattern S22/S24/S25). Variables d'env requises : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (pour bootstrap users), `SUPABASE_ANON_KEY` (pour appels EF en mode authenticated user).

### 5.3 — BO smoke (~5 cas)

`apps/backoffice/src/features/accounting/__tests__/` :

- `TrialBalancePage.smoke.test.tsx` : rend table + DateRangePicker. CSV button disabled si `rows.length === 0`.
- `GeneralLedgerPage.smoke.test.tsx` : AccountPicker change → `useGeneralLedger` re-fetched avec nouveau `accountId`.
- `ArAgingPage.smoke.test.tsx` : rend `view_ar_aging` mocked + buckets affichés + lien customer cliquable.
- `JournalEntriesPage.smoke.test.tsx` : bouton "+ Nouvelle OD" caché si perm `accounting.je.manual` absente du mock `usePermission`.
- `ManualJournalEntryDialog.smoke.test.tsx` : balance check live (sum debit≠sum credit → submit disabled). Submit valide → mock `fetch` reçoit POST sur `/functions/v1/create-manual-je` avec headers `x-manager-pin: 123456` + `x-idempotency-key: <UUID v4>`. Body JSON contient `lines` + `posting_date` + `description` mais **PAS** de champ `manager_pin` (assertion explicite anti-régression S25 pattern).

### 5.4 — Quality gates Wave 2 finale

- `pnpm typecheck` global green.
- `pnpm build` global green.
- pgTAP 10/10.
- Vitest live 8/8.
- BO smoke 5/5.

---

## 6. Risques + mitigations (R1-R7)

| ID | Risque | Probabilité | Mitigation |
|----|--------|-------------|------------|
| **R1** | `get_general_ledger_v1` running_balance avec window function + opening fetch séparé → cohérence cassée si JE inséré pendant pagination | M | RPC retourne snapshot timestamp implicite (la query est atomique au call). Si JE inséré entre 2 pages, page 2 commence après cursor → cohérent. Documenté dans le comment SQL. |
| **R2** | `create_manual_je_v1` autorise n'importe quelle combinaison de comptes → risque erreur métier (DR Cash / CR Revenue pour rectif client = faux) | M | Pas de mitigation technique automatique. Audit_logs trace la saisie + payload complet → piste audit pour expert-comptable. Comptable responsable de la cohérence métier. |
| **R3** | Helper PIN incertain — `verify_manager_pin_v1` SQL n'existe peut-être pas, ou EF helper bcrypt est à inventer | M | Wave 1.A.0 introspection obligatoire : check `pg_proc` pour helpers PIN existants + grep `supabase/functions/_shared/` pour pattern auth. Si rien : implémenter bcrypt compare dans l'EF (~15 lignes, dep `bcrypt` Deno déjà transitivement présente via `auth-verify-pin` EF). Documenter le choix en Wave 1.A.2. |
| **R4** | `view_ar_aging` S24 buckets calculés sur `CURRENT_DATE - orders.created_at` → si commande créée mais facture émise plus tard, aging biaisé | L | Pré-existant S24, hors scope S26. Note ajoutée dans doc rebase Partie II §AR Aging "limitation pré-S26, voir S24 deviation log". |
| **R5** | CSV export sans helper packages/utils existant → décision Wave 1.A.5 entre lib externe ou implémentation minimale | L | Implémentation minimale ~30 lignes (RFC 4180 + UTF-8 BOM + séparateur `;` pour Excel FR/ID locale). Pas de dep ajoutée. |
| **R6** | `audit_logs.payload` peut contenir des PINs si dev oublie de filtrer (R copy-paste accidentel) | L | Dans `create_manual_je_v1`, le payload audit n'inclut JAMAIS le PIN (la RPC ne le reçoit même plus en arg post-S26 A1 refactor). Comment SQL explicite "PIN is verified upstream in EF, never reaches this function". |
| **R7** | EF `create-manual-je` est un nouveau path mutateur non couvert par le rate-limit durable S19 (seuls `auth-verify-pin`, `kiosk-issue-jwt`, `refund-order`, `void-order`, `cancel-item` sont câblés) | L | Le rate-limiting implicite (perm RBAC + PIN par requête) couvre le besoin court-terme. À ajouter en post-S30 si volume d'abus observé. Note ajoutée dans backlog 25-security `add rate-limit to create-manual-je EF`. |

---

## 7. Definition of Done (DoD)

### Wave 1 (DB + EF + UI)

- [ ] 6 migrations `_010 / _020 / _021 / _022 / _023 / _024` apply_migration via MCP sur `ikcyvlovptebroadgtvd` sans erreur.
- [ ] `mcp__plugin_supabase_supabase__list_migrations` confirme les 6 versions présentes.
- [ ] Perm `accounting.je.manual` seedée + accordée à MANAGER/ADMIN/SUPER_ADMIN.
- [ ] RPC `get_trial_balance_v1` callable via supabase-js (read-only, SECURITY INVOKER).
- [ ] RPC `get_general_ledger_v1` callable + pagination cursor fonctionnelle.
- [ ] RPC `create_manual_je_v1` callable + perm gate + fiscal guard testés manuel happy path. Signature SANS `p_manager_pin` (vérifié pgTAP T8).
- [ ] EF `create-manual-je` déployée sur V3 dev (`supabase functions deploy create-manual-je`), endpoint répond 200 sur happy path via curl/Postman.
- [ ] 4 pages BO créées + routes + sidebar entries.
- [ ] 5 hooks BO + ManualJournalEntryDialog + ManagerPinDialog (reused or new). `useManualJe` mutation via `fetch()` raw avec headers (pas `supabase.rpc()`).
- [ ] CSV helper en place.
- [ ] Types regen MCP committed dans `packages/supabase/src/types.generated.ts`.

### Wave 2 (tests)

- [ ] pgTAP 10/10 passes via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] Vitest live 8/8 passes : `cd supabase/tests && npx vitest run functions/accounting-cockpit`. Variables env exportées (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).
- [ ] BO smoke 5/5 passes : `pnpm --filter @breakery/backoffice test accounting`.
- [ ] `pnpm typecheck` global green.
- [ ] `pnpm build` global green.

### Wave 3 (closeout)

- [ ] Status notes datées 2026-05-XX sur `10-accounting-double-entry.md` : TASK-10-011 PARTIAL (viewer/JE/AR/TB/GL DONE, lock fiscal-periods UI TOUJOURS TODO).
- [ ] Roadmap globale §Sessions ligne S26 + §Indicateurs (4 nouvelles lignes : trial-balance UI / GL UI / AR aging UI / manual JE entry).
- [ ] CLAUDE.md : current session pointer bump S25 → S26 + Critical pattern enrichi : (a) confirmer pattern S25 PIN-en-header appliqué à `create-manual-je` EF (nouvel exemple canonical) ; (b) noter le pattern "split REVOKE migration pair" (`_023`+`_024`) comme template récurrent.
- [ ] **Doc rebase** `docs/reference/04-modules/10-accounting-double-entry.md` Partie II : remplacer la liste aspirational "11 pages" par la liste réelle V3 (5 pages : MappingsPage S13 + 4 nouvelles S26 + status note "S26 update: 4 pages cockpit livrées + 1 EF `create-manual-je` + 3 RPCs (`get_trial_balance_v1`, `get_general_ledger_v1`, `create_manual_je_v1`). VAT page reportée S30, PDF reporté S29").
- [ ] INDEX §10 deviations finalisé.
- [ ] PR créée vers master, mergée par le user.

---

## 8. Liens

- Plan multi-sessions parent : [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §3 S26
- Roadmap globale : [`../backlog-by-module/00-roadmap-globale.md`](../backlog-by-module/00-roadmap-globale.md)
- Backlog module concerné : [`../backlog-by-module/10-accounting-double-entry.md`](../backlog-by-module/10-accounting-double-entry.md)
- Spec S24 (view_ar_aging livré) : [`./2026-05-19-session-24-spec.md`](./2026-05-19-session-24-spec.md)
- Spec S25 (pattern idempotency + PIN-en-header) : [`./2026-05-19-session-25-spec.md`](./2026-05-19-session-25-spec.md)
- Pattern S20 REVOKE defense-in-depth : `supabase/migrations/20260524000020..031`
- Pattern S13 accounting (resolve_mapping_account + check_fiscal_period_open) : `supabase/migrations/20260517000010` + `20260517000002`
- Conventions code : [`../../../CLAUDE.md`](../../../CLAUDE.md)

---

## 9. Out-of-scope confirmé (déféré post-S26)

- **Page `/accounting/vat-management`** : reportée S30 (bloquée business PKP).
- **Export PDF** : reporté S29 (EF générique `generate-pdf` planifié).
- **Fiscal-periods UI (lock/close action)** : reporté S30 month-close. Le guard SQL existe déjà depuis S13.
- **Audit trail JE modifications avant/après (TASK-10-013)** : reste TODO post-S30. S26 trace création via `audit_logs` standard.
- **Bank reconciliation auto-matching (TASK-10-009)** : reste TODO post-S30.
- **Void/edit d'une JE manuelle après posting** : pas de UI de modification. Pour rectifier, le comptable post une JE compensating (convention SAK EMKM 5.2 immutabilité posted).
- **Account hierarchy display** (grouped postable accounts under their parent GROUP) : Trial Balance affiche flat avec group-by `account_type`, pas la hiérarchie complète. Future polish.
