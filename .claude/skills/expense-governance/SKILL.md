---
name: expense-governance
description: Expense approval workflow expert — thresholds, SOD, multi-step chain, snapshot-at-submit, cash sync. Audit approval integrity AND guide expense governance changes.
pathPatterns:
  - 'apps/backoffice/src/features/expenses/**'
  - 'apps/backoffice/src/features/settings/expense-thresholds/**'
  - 'supabase/migrations/*expense*.sql'
  - 'supabase/tests/*expense*.test.sql'
promptSignals:
  phrases:
    - 'expense'
    - 'approval threshold'
    - 'SOD'
    - 'separation of duties'
    - 'multi-step approval'
    - 'expense approval'
    - 'auto-approve'
    - 'cash expense'
    - 'approval chain'
---

# Expense Governance — The Breakery ERP

Expert on the multi-step expense approval workflow (Session 28). Two use cases:

1. **Audit** the approval flow for SOD violations, snapshot drift, cash-sync gaps, and missing REVOKE pairs.
2. **Guide** future changes (new approval steps, threshold adjustments, RPC bumps, trigger edits).

**`CLAUDE.md` is the source of truth** for project-wide patterns (RPC versioning, REVOKE pairs, PIN header, idempotency). This skill adds expense-governance mental model, verified schema names, and checklists that CLAUDE.md doesn't carry.

## Mental model — snapshot-at-submit

```
SUBMIT                         APPROVE (step N)                CASH SYNC
──────                         ────────────────                ─────────
submit_expense_v2              approve_expense_v2              trigger trg_expenses_sync_cash
  ↓ resolve threshold            ↓ SOD block 1                   ↓ AFTER UPDATE OF status
  ↓ ORDER BY category_id           created_by != caller          ↓ WHEN status='paid' + cash
  ↓   NULLS LAST LIMIT 1         ↓ SOD block 2 (UNIQUE)          ↓ pos_sessions.cash_out_total
  ↓ freeze snapshot JSONB          expense_approvals               += amount + vat_amount
  ↓ → steps=[] → auto-approve   ↓ role gate (step.role_codes)
  ↓ → steps>0  → 'submitted'    ↓ step=final → status='approved'
  ↓ emit JE (auto-approve)       ↓ emit JE via _emit_expense_je
  ↓ audit_logs: expense.auto_approved  audit_logs: expense.approved_step
```

### Schema réel (vérifié contre V3 dev `ikcyvlovptebroadgtvd`)

**`expenses` — 3 colonnes ajoutées S28**
- `required_approval_steps_snapshot JSONB NULL` — copie figée des steps au moment du submit. NULL = expense pré-S28 (fallback 1-step v1).
- `current_approval_step SMALLINT NOT NULL DEFAULT 0` — 0-based counter. Equals `jsonb_array_length(snapshot)` quand approuvé.
- `auto_approved BOOLEAN NOT NULL DEFAULT false` — true si `steps=[]` (montant sous le seuil le plus bas).

**`expense_approval_thresholds`** — configurable per-category
- `category_id UUID NULL` (NULL = default global)
- `amount_min NUMERIC(15,2) NOT NULL DEFAULT 0`, `amount_max NUMERIC(15,2) NOT NULL`
- `steps JSONB NOT NULL` — tableau `[{"role_codes":[...],"label":"..."}]`
- `CONSTRAINT thresholds_amount_range CHECK (amount_max > amount_min)`
- 3 defaults seedés : `[0, 100k)` steps=[] (auto), `[100k, 1M)` 1-step MANAGER, `[1M, 9.9G)` 2-step MANAGER+ADMIN
- Résolution : `category_id NULLS LAST`, `LIMIT 1` — catégorie spécifique gagne sur NULL.

**`expense_approvals`** — append-only audit
- `UNIQUE (expense_id, step)` — une seule approbation par step
- `UNIQUE (expense_id, approver_user_id)` — un même approver ne peut pas faire 2 steps → SOD block 2
- RLS : SELECT uniquement ; INSERT/UPDATE/DELETE revokés pour authenticated/anon/PUBLIC
- Writes via SECURITY DEFINER RPCs uniquement.

## Critical patterns (toujours vérifier avant de livrer)

1. **Snapshot-at-submit immuable** — `required_approval_steps_snapshot` est figé au moment de `submit_expense_v2`. Un changement de seuil admin n'invalide PAS une expense en cours de chaîne. Ne jamais UPDATE la colonne snapshot sur une expense déjà soumise.

2. **SOD à 2 niveaux** — `approve_expense_v2` bloque :
   - Bloc 1 (ligne) : `v_expense.created_by = v_caller_profile` → P0001 `sod_creator_block`
   - Bloc 2 (DB) : `INSERT INTO expense_approvals` catch `unique_violation` → P0001 `sod_already_approved`
   Ne jamais contourner ces guards (ex. admin-override hardcodé).

3. **PIN via header `x-manager-pin` (S25)** — `approve_expense_v2` est appelée depuis `useApproveExpense` avec PIN en header HTTP, jamais dans le body JSON. Pattern canonique S25 — ne pas revenir en body.

4. **Idempotency sur submit** — `submit_expense_v2(p_expense_id, p_idempotency_key)` : le client génère un UUID via `useRef(crypto.randomUUID())` et le passe. Replay lit `expenses.idempotency_key` → retourne `{ idempotent_replay: true }`. `approve_expense_v2` n'a PAS d'idempotency key (les approvals sont intentionnellement uniques par step).

5. **REVOKE pair S25 canonique** sur chaque RPC — 3 lignes :
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   Migrations dédiées : `_115713`, `_121140`, `_122002`, `_122427`. T18 pgTAP vérifie les 4 RPCs S28.

6. **VAT trap NON-PKP** — `_emit_expense_je` : si `vat_amount > 0`, tente `resolve_mapping_account('EXPENSE_VAT_INPUT')`. Le compte 1151 est désactivé (ADR-003 NON-PKP, S26) → P0002 au runtime. Ne pas ajouter de VAT sur les expenses (vat_amount doit rester 0 en prod NON-PKP) — non-régression S28.

7. **Cash sync non-bloquant** — trigger `trg_expenses_sync_cash` (AFTER UPDATE OF status WHEN paid+cash). Si aucune session ouverte pour `paid_by`, loggue `expense.cash_paid_no_session` dans `audit_logs` et **ne bloque pas** (`RETURN NEW`). Comportement intentionnel — ne jamais convertir ce WARNING en exception.

8. **RPC versioning monotone** — si tu bumpes `submit_expense_v2` → `_v3`, `DROP FUNCTION submit_expense_v2(UUID, UUID)` dans la même migration. Idem pour `approve_expense_v2(UUID)`.

## RPCs S28 (noms exacts vérifiés)

| RPC | Signature | Gate | Idempotency |
|-----|-----------|------|-------------|
| `submit_expense_v2` | `(p_expense_id UUID, p_idempotency_key UUID DEFAULT NULL)` | `expenses.create` ou `expenses.manage` | `p_idempotency_key` arg |
| `approve_expense_v2` | `(p_expense_id UUID)` | `expenses.approve` | Aucune (append-only) |
| `set_expense_threshold_v1` | `(p_threshold_id UUID, p_category_id UUID, p_amount_min NUMERIC, p_amount_max NUMERIC, p_steps JSONB)` | `expenses.thresholds.write` | — |
| `delete_expense_threshold_v1` | `(p_threshold_id UUID)` | `expenses.thresholds.write` | — |
| `_emit_expense_je` | `(p_expense_id UUID)` | interne SECURITY DEFINER | — |

**Permissions seedées** (migration `_123026`) :
- `expenses.thresholds.read` — CASHIER / MANAGER / ADMIN / SUPER_ADMIN
- `expenses.thresholds.write` — ADMIN / SUPER_ADMIN uniquement

## BO — surface map (vérifiée)

```
apps/backoffice/src/
  features/
    expenses/
      components/        ApprovalTimeline.tsx, ApproveDialog.tsx,
                         ThresholdResolutionBadge.tsx, ExpenseStatusBadge.tsx, …
      hooks/             useExpenseApprovals.ts, useExpenseActions.ts, …
      __tests__/         approval-timeline.smoke, approve-dialog-sod.smoke,
                         expense-thresholds-page.smoke
    settings/
      expense-thresholds/
        ExpenseThresholdsPage.tsx
        ThresholdFormDialog.tsx
        hooks/           useExpenseThresholds.ts, useSetExpenseThreshold.ts,
                         useDeleteExpenseThreshold.ts
```

Hooks S28 : `useExpenseThresholds`, `useSetExpenseThreshold`, `useDeleteExpenseThreshold`, `useExpenseApprovals`, `useSubmitExpense` (v2 + idempotency `useRef`), `useApproveExpense` (v2 + PIN header `x-manager-pin`).

## Audit checklist

### A. Intégrité SOD
- [ ] **Double guard actif** — pour une expense en status `submitted` : `expense_approvals` doit avoir ≤ 1 row par step ; jamais le même `approver_user_id` sur 2 rows. `SELECT expense_id, approver_user_id, COUNT(*) FROM expense_approvals GROUP BY 1,2 HAVING COUNT(*) > 1` → doit être vide.
- [ ] **Creator never approver** — `SELECT e.id FROM expenses e JOIN expense_approvals ea ON ea.expense_id = e.id WHERE e.created_by = ea.approver_user_id` → doit être vide.
- [ ] **Step count cohérent** — `current_approval_step = COUNT(*) FROM expense_approvals WHERE expense_id = ?` pour toute expense non-auto_approved.

### B. Snapshot cohérence
- [ ] **Snapshot figé** — comparer `required_approval_steps_snapshot` avec la résolution actuelle depuis `expense_approval_thresholds` : divergence = changement de seuil post-submit (attendu, pas un bug).
- [ ] **NULL snapshot** uniquement sur rows pré-S28 (`submitted_at < '2026-05-24'`) — NULL post-S28 = submit_expense_v2 non appelé ou bug.
- [ ] **Auto_approved cohérent** — `auto_approved = true` → `jsonb_array_length(required_approval_steps_snapshot) = 0` et `status = 'approved'`.

### C. Cash sync
- [ ] **Trigger attaché** — `SELECT * FROM pg_trigger WHERE tgname = 'trg_expenses_sync_cash'` → 1 row.
- [ ] **Δ cash_out_total** — pour chaque expense paid+cash, `pos_sessions.cash_out_total` a bien été incrémenté de `amount + vat_amount`. Cross-check : `SELECT SUM(e.amount + e.vat_amount) FROM expenses e WHERE e.payment_method='cash' AND e.status='paid' AND e.paid_by = ?` = delta `cash_out_total` de la session correspondante.
- [ ] **No-session log** — expense paid+cash sans session ouverte : `audit_logs WHERE action='expense.cash_paid_no_session'`.

### D. Sécurité
- [ ] **REVOKE pair complet** — T18 pgTAP : `SELECT bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc WHERE proname IN ('submit_expense_v2', 'approve_expense_v2', 'set_expense_threshold_v1', 'delete_expense_threshold_v1')` → true.
- [ ] **Perm gates** — chaque RPC appelle `has_permission(v_caller_uid, 'expenses.<scope>')` avant toute opération.
- [ ] **audit_logs** — chaque mutation produit un row avec `actor_id / action / entity_type / entity_id / metadata`. Actions : `expense.auto_approved`, `expense.submitted`, `expense.approved_step`, `expense_threshold.created`, `expense.cash_paid_no_session`, `expense.cash_synced_to_session`.

## Checklists préventives

### Avant d'ajouter un step dans `expense_approval_thresholds.steps`
- [ ] `role_codes` contient des codes de roles existants dans `roles` (ex. `MANAGER`, `ADMIN`, `SUPER_ADMIN`). Ne pas inventer un code.
- [ ] Le range `[amount_min, amount_max)` ne chevauche pas un existant dans la même catégorie → T9 couvre l'overlap via `set_expense_threshold_v1`.
- [ ] pgTAP coverage : happy path resolution + boundary inclusive.

### Avant de bumper `submit_expense_v2` → `_v3`
- [ ] `DROP FUNCTION submit_expense_v2(UUID, UUID)` dans la même migration.
- [ ] Caller `useSubmitExpense` migré vers `_v3` (grep `submit_expense_v2`).
- [ ] REVOKE pair sur `_v3`.
- [ ] Idempotency arg préservé (ne pas retirer `p_idempotency_key`).
- [ ] pgTAP : auto-approve + 1-step + 2-step + replay idempotent.

### Avant de bumper `approve_expense_v2` → `_v3`
- [ ] SOD guards préservés (les 2 blocs).
- [ ] PIN via header `x-manager-pin` conservé côté UI — ne pas migrer en body.
- [ ] `DROP FUNCTION approve_expense_v2(UUID)` dans la même migration.
- [ ] pgTAP : perm 42501 + creator block P0001 + UNIQUE already-approved P0001 + final step → status=approved.

### Avant de modifier le trigger `trg_expenses_sync_cash`
- [ ] Le comportement no-block (RETURN NEW sans session) est intentionnel — ne jamais le convertir en RAISE EXCEPTION.
- [ ] Regtest T12 + T13 via pgTAP MCP `execute_sql` BEGIN/ROLLBACK.

## Sources de vérité (pointeurs)

```
Migrations (chronologique, S28)
  supabase/migrations/20260524111854_create_expense_approval_thresholds_table.sql
  supabase/migrations/20260524112621_create_expense_approvals_table.sql
  supabase/migrations/20260524113023_alter_expenses_add_approval_snapshot_columns.sql
  supabase/migrations/20260524113353_seed_expense_approval_thresholds_defaults.sql
  supabase/migrations/20260524114442_bump_submit_expense_v2_rpc.sql
  supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql
  supabase/migrations/20260524115713_revoke_anon_submit_expense_v2.sql
  supabase/migrations/20260524120104_bump_approve_expense_v2_rpc.sql
  supabase/migrations/20260524121140_revoke_anon_approve_expense_v2.sql
  supabase/migrations/20260524121337_create_set_expense_threshold_v1_rpc.sql
  supabase/migrations/20260524122002_revoke_anon_set_expense_threshold_v1.sql
  supabase/migrations/20260524122136_create_delete_expense_threshold_v1_rpc.sql
  supabase/migrations/20260524122427_revoke_anon_delete_expense_threshold_v1.sql
  supabase/migrations/20260524122632_create_sync_cash_expense_trigger.sql
  supabase/migrations/20260524123026_seed_perms_expenses_thresholds.sql

Tests (vérité comportementale)
  supabase/tests/expense_governance.test.sql    # T1-T18 PASS (pgTAP via MCP)
  supabase/tests/expenses.test.sql              # suite de base pré-S28

BO (surface UI)
  apps/backoffice/src/features/expenses/
  apps/backoffice/src/features/settings/expense-thresholds/

Patterns canon
  CLAUDE.md §S28 reference                      # source de vérité
  CLAUDE.md §Critical patterns — PIN header S25, idempotency 2-flavors, REVOKE pair
```

## Verification before claiming a fix is complete

```bash
# Type-check (rapide, run first)
pnpm typecheck

# BO smoke tests
pnpm --filter @breakery/app-backoffice test expenses

# pgTAP (via MCP execute_sql, BEGIN/ROLLBACK envelope)
# Fichier : supabase/tests/expense_governance.test.sql — 18 cas T1-T18
```

Baseline pré-existante : ~24 échecs BO env-gated (`VITE_SUPABASE_URL Required`, DEV-S25-2.A-02) — ne pas confondre avec régression.

## When to escalate

- Relax d'une contrainte SOD (UNIQUE `expense_approvals` ou `created_by` guard) → flag systématique, brise l'invariant d'audit.
- Ajout d'un `payment_method` cash-like qui doit aussi déclencher le trigger cash-sync → étendre le WHEN du trigger dans une migration dédiée.
- Activation de VAT input (si The Breakery devient PKP) → `_emit_expense_je` doit être réécrit, compte 1151 réactivé, ADR-003 mis à jour.
- Override admin d'une approval chain en cours → scope déféré, pas d'implémentation existante.
