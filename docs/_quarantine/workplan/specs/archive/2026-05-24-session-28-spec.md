# Session 28 — Expense Governance (Spec)

> **Date** : 2026-05-24
> **Branche cible** : `swarm/session-28`
> **Base** : `master` après merge S27c (`swarm/session-27c`)
> **Effort estimé** : ~1 jour wall-time (M)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-24-session-27c-spec.md`](./2026-05-24-session-27c-spec.md) — S28 enchaîne sur module 11 (Expenses) qui n'a pas été touché depuis S13.
> **Plan multi-sessions** : [`../plans/2026-05-19-S24-to-S30-plan.md`](../../plans/archive/2026-05-19-S24-to-S30-plan.md) §S28

---

## 1. Contexte

Le module 11 (Expenses) a été initialisé en **Session 13 / Phase 3.B** (commit `bdf21aa`, migrations `20260517000120..122`) avec un **workflow flat** : `draft → submitted → approved → paid` (ou `rejected` depuis `submitted`), porté par 5 RPCs (`create/submit/approve/pay/reject_expense_v1` SECURITY DEFINER, perm-gated, audit_logs). 12 `expense_categories` seedées avec FK `accounts.id` (codes 6111-6190 OpEx).

**Gap structurel identifié par l'audit S24-S30 plan §S28** :
- **Aucun seuil d'approbation configurable** : n'importe quel user avec `expenses.approve` peut approuver n'importe quel montant.
- **Pas de séparation des tâches (SOD)** : le créateur d'un expense peut l'approuver lui-même → **risque fraude direct**.
- **Pas de chaîne multi-niveau** : un expense de 5M IDR (~300 €) reçoit la même validation qu'un de 50k IDR.
- **Pas de sync cash → pos_sessions** : un expense payé `payment_method='cash'` ne décrémente pas `pos_sessions.cash_out_total` → divergence comptable en fin de shift (variance gonflée).
- **Pas de page settings** : la nomenclature `expense_categories` n'est manipulable qu'en SQL direct.

**Décision business 2026-05-24** (héritée du plan S24-S30) :
- Auto-approbation autorisée jusqu'à un seuil paramétré (défaut **≤ 100 000 IDR** = ~6 €).
- Approbation manager pour les expenses **entre 100k et 1M IDR** (1 step).
- Approbation chaînée manager + owner pour les expenses **> 1M IDR** (2 steps, approvers distincts).
- Les seuils sont configurables **per category** (NULL = défaut global).

**Hors scope explicite cette session** :
- TASK-11-003 Recurring expenses (loyer, abonnements) — backlog S29+
- TASK-11-004 OCR receipt via claude-proxy — BLOCKED Capacitor
- TASK-11-005 Cost centers (department allocation) — backlog
- TASK-11-006 Per diem / advances pattern — backlog
- Notifications email/in-app aux approvers — backlog (toast UI seulement cette session)
- Reject workflow étendu (reject reste 1-shot v1, pas de retour à `draft`)
- Migration des expenses historiques (les expenses créés avant S28 n'auront pas de snapshot — fallback : workflow v1 préservé pour `required_approval_steps_snapshot IS NULL`)

---

## 2. Architecture data

**Choix structurant** : **fige les règles d'approbation au moment du submit** dans une colonne `expenses.required_approval_steps_snapshot JSONB`. Un changement de seuil admin n'invalide donc pas une expense en cours de chaîne. Pattern emprunté à `complete_order_v9` (snapshot tax_rate) et `recipe_versions.snapshot` (S15+S17).

### 2.1 Schema changes

```sql
-- Migration _010 : table expense_approval_thresholds
CREATE TABLE expense_approval_thresholds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- category_id NULL = applique aux categories qui n'ont pas de row spécifique (defaults)
  category_id  UUID NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  amount_min   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount_min >= 0),
  amount_max   NUMERIC(15,2) NOT NULL CHECK (amount_max > 0),
  -- steps JSONB : array of { role_codes: TEXT[], label: TEXT }
  -- steps = [] → auto-approve (skip workflow, submit déclenche directement JE + status='approved')
  steps        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT thresholds_amount_range CHECK (amount_max > amount_min),
  CONSTRAINT thresholds_steps_array CHECK (jsonb_typeof(steps) = 'array')
);

CREATE INDEX idx_thresholds_category_range
  ON expense_approval_thresholds (category_id NULLS FIRST, amount_min, amount_max);

COMMENT ON TABLE expense_approval_thresholds IS
  'S28 : seuils configurables d''approbation per category. Resolution = best match (category-specific override > category=NULL default). steps=[] = auto-approve.';

-- Migration _011 : table expense_approvals (audit per-step, append-only)
CREATE TABLE expense_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id        UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  approver_user_id  UUID NOT NULL REFERENCES user_profiles(id),
  step              SMALLINT NOT NULL CHECK (step > 0),
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_expense_step       UNIQUE (expense_id, step),
  CONSTRAINT uniq_expense_approver   UNIQUE (expense_id, approver_user_id)
  -- UNIQUE (expense_id, approver_user_id) = SOD : un même user ne peut pas approuver 2 steps du même expense
);

CREATE INDEX idx_expense_approvals_expense ON expense_approvals (expense_id);

-- REVOKE INSERT/UPDATE/DELETE pour authenticated (append-only via RPC SECURITY DEFINER uniquement)
ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON expense_approvals FROM authenticated, anon, PUBLIC;
GRANT SELECT ON expense_approvals TO authenticated;
CREATE POLICY expense_approvals_select_auth ON expense_approvals
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE expense_approvals IS
  'S28 : trace per-step des approbations (append-only). UNIQUE(expense_id, approver_user_id) enforce SOD : un même user ne peut pas approuver plusieurs steps.';

-- Migration _012 : ALTER expenses + 3 cols snapshot/step/auto
ALTER TABLE expenses
  ADD COLUMN required_approval_steps_snapshot JSONB NULL,
  ADD COLUMN current_approval_step SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN auto_approved BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN expenses.required_approval_steps_snapshot IS
  'S28 : copie figée des steps requis au moment du submit. NULL = expense créé avant S28 (fallback workflow v1).';
COMMENT ON COLUMN expenses.current_approval_step IS
  'S28 : incrémenté à chaque approve. 0 = pas encore commencé. = array_length(snapshot) → status=''approved''.';
COMMENT ON COLUMN expenses.auto_approved IS
  'S28 : true si steps=[] (auto-approve sous seuil) — pas de row dans expense_approvals.';
```

### 2.2 Seed defaults

```sql
-- Migration _013 : seed 3 brackets defaults (category_id=NULL)
INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps) VALUES
  (NULL, 0,       100000,    '[]'::jsonb),
  (NULL, 100000,  1000000,   '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb),
  (NULL, 1000000, 9999999999, '[
     {"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"},
     {"role_codes":["ADMIN","SUPER_ADMIN"],"label":"Owner approval"}
   ]'::jsonb);
```

### 2.3 Algorithme de résolution

```sql
-- Pseudo-code dans submit_expense_v2 :
SELECT steps
  FROM expense_approval_thresholds
 WHERE (category_id = p_category_id OR category_id IS NULL)
   AND p_amount >= amount_min
   AND p_amount <  amount_max
 ORDER BY category_id NULLS LAST  -- match category-specific d'abord
 LIMIT 1;
```

Si aucune row → `RAISE EXCEPTION 'no_threshold_resolved'` (config error, doit être impossible avec seed defaults qui couvrent `[0, ~10G IDR)`).

---

## 3. RPCs (5 nouvelles / bumped — toutes SECURITY DEFINER + REVOKE pair S25 canonique)

| # | RPC | Type | Signature | Comportement clé |
|---|---|---|---|---|
| 1 | `submit_expense_v2` | bump v1 (drop v1 même migration) | `(p_expense_id UUID, p_idempotency_key UUID DEFAULT NULL)` returns `JSONB` | Résout threshold via 2.3, copie `steps` dans `required_approval_steps_snapshot`, si `steps=[]` auto-approve (status='approved', `auto_approved=true`, JE émis via logique v1 réutilisée), sinon status='submitted' et `current_approval_step=0`. Idempotent via `expenses.idempotency_key UNIQUE` existant. |
| 2 | `approve_expense_v2` | bump v1 (drop v1 même migration) | `(p_expense_id UUID)` returns `JSONB` ; PIN en header `x-manager-pin` (pattern S25) | (a) lit `required_approval_steps_snapshot` ; (b) si NULL → fallback workflow v1 (1 step) ; (c) vérifie `current_approval_step < array_length(snapshot)` ; (d) **SOD block 1** : vérifie `(SELECT id FROM user_profiles WHERE auth_user_id=auth.uid()) ≠ expenses.created_by` → P0001 `sod_creator_block` ; (e) **SOD block 2** : INSERT row dans `expense_approvals` raise `unique_violation` si déjà approuvé par ce user (catch + re-raise P0001 `sod_already_approved`) ; (f) valide role membership dans `snapshot[current_step].role_codes` via `user_profiles.role_code` → P0003 si miss ; (g) INSERT row `expense_approvals(expense_id, approver_user_id, step=current_step+1)` ; (h) INCREMENT `expenses.current_approval_step` ; (i) si `current_approval_step = array_length(snapshot)` → status='approved' + emit JE (réutilise logique v1) + `approved_by`, `approved_at` settled ; (j) audit_log per call. |
| 3 | `set_expense_threshold_v1` | new | `(p_threshold_id UUID NULL, p_category_id UUID NULL, p_amount_min NUMERIC, p_amount_max NUMERIC, p_steps JSONB)` returns `UUID` | UPSERT admin-gated (`expenses.thresholds.write`). Si `p_threshold_id IS NULL` → INSERT, sinon UPDATE. Validation overlap : CHECK qu'aucune autre row du même `category_id` (ou les deux NULL) n'overlappe le range `[p_amount_min, p_amount_max)` → P0002 `threshold_overlap`. Validation `steps` schema : array de `{role_codes: TEXT[] non-empty, label: TEXT non-empty}`. Audit_log. |
| 4 | `delete_expense_threshold_v1` | new | `(p_threshold_id UUID)` returns `BOOLEAN` | DELETE admin-gated + audit_log. Pas de FK depuis `expenses` (snapshot freeze le résout), donc safe. |
| 5 | `sync_cash_expense_to_session()` | trigger function | AFTER UPDATE ON expenses | WHEN `OLD.status ≠ 'paid' AND NEW.status = 'paid' AND NEW.payment_method = 'cash'` → UPDATE `pos_sessions.cash_out_total = cash_out_total + NEW.amount + NEW.vat_amount` WHERE `status = 'open'` AND `opened_by = NEW.paid_by`. Si pas de session open pour ce user → RAISE WARNING + audit_log `cash_expense_no_open_session` (informational, ne bloque pas le payment). |

**Permissions seedées (2 nouvelles)** :
- `expenses.thresholds.read` → CASHIER, MANAGER, ADMIN, SUPER_ADMIN (lecture pour la page settings et l'UI ApprovalTimeline)
- `expenses.thresholds.write` → ADMIN, SUPER_ADMIN (admin-only)

**Permissions existantes réutilisées** : `expenses.create`, `expenses.approve`, `expenses.pay`, `expenses.manage` (inchangées).

---

## 4. BO UI

### 4.1 Pages (1 nouvelle)

| Page | Path | Description | Perm gate |
|---|---|---|---|
| `ExpenseThresholdsPage` | `apps/backoffice/src/features/settings/expense-thresholds/ExpenseThresholdsPage.tsx` | Route `/settings/expense-thresholds`. Table thresholds avec colonnes (category, amount range, steps count, role codes des steps), filter par category, bouton "+ New threshold", édit/delete par row (inline icon buttons). | `expenses.thresholds.read` (read) + `expenses.thresholds.write` (write) |

### 4.2 Composants (4 nouveaux)

| Component | Path | Description |
|---|---|---|
| `ThresholdFormDialog` | `features/settings/expense-thresholds/ThresholdFormDialog.tsx` | Modal create/edit. Champs : category (Select avec option "All categories"), amount_min/max (NumberInput IDR-formatted), steps builder (repeatable rows avec add/remove + label TextInput + role_codes multi-select chip-based). Validation Zod côté client + erreur P0002 overlap rebondit en toast. |
| `<ApprovalTimeline>` | `features/expenses/components/ApprovalTimeline.tsx` | Stepper vertical. Props : `expense: ExpenseRow & { approvals: ExpenseApproval[] }`. Render : pour chaque step du snapshot, affiche icon (✓ approved / ◌ pending / ⊘ skipped), label, role_codes acceptés, approver name + timestamp si approved. Step courant highlighted en bleu. Auto-approved → render un seul step "Auto-approved" gris. |
| `ApproveDialog` (bump) | `features/expenses/components/ApproveDialog.tsx` | Étend l'existant. Affiche `Step X of N — <label>` + chip role attendu. Bouton "Approve" désactivé si `user.id === expense.created_by` (SOD block client-side avec tooltip "You can't approve your own expense") OU si user déjà dans `expense.approvals`. PIN reste géré via `useShiftAuth`. |
| `<ThresholdResolutionBadge>` | `features/expenses/components/ThresholdResolutionBadge.tsx` | Petit badge inline dans `ExpenseDetailPage` affichant "Auto-approved" ou "Manager approval required" ou "Manager + Owner approval required" selon snapshot. |

### 4.3 Sidebar

- Ajouter entry "Expense Thresholds" sous Settings (icon `Scale` de `lucide-react`, pattern S26b SettingsAccountingPage), gate `expenses.thresholds.read`.

### 4.4 ExpenseDetailPage modifications

- Insérer `<ApprovalTimeline>` au-dessus de `<ApproveDialog>` button area
- Insérer `<ThresholdResolutionBadge>` à côté de `<ExpenseStatusBadge>`
- Si `expense.auto_approved === true` → masquer le button "Approve" (déjà approved par le système)

---

## 5. Hooks (5 nouveaux / bumped)

| Hook | Path | Type | RPC ou query |
|---|---|---|---|
| `useExpenseThresholds()` | `features/settings/expense-thresholds/hooks/useExpenseThresholds.ts` | new read | SELECT depuis `expense_approval_thresholds` LEFT JOIN `expense_categories(code, name)` |
| `useSetExpenseThreshold()` | même feature | new mutation | `set_expense_threshold_v1` |
| `useDeleteExpenseThreshold()` | même feature | new mutation | `delete_expense_threshold_v1` |
| `useExpenseApprovals(expenseId)` | `features/expenses/hooks/useExpenseApprovals.ts` | new read | SELECT depuis `expense_approvals` JOIN `user_profiles(full_name)` pour 1 expense |
| `useApproveExpense()` | `features/expenses/hooks/useApproveExpense.ts` | bump | call `approve_expense_v2` ; PIN passé via header `x-manager-pin` (helper `withManagerPin` existant) |
| `useSubmitExpense()` | `features/expenses/hooks/useSubmitExpense.ts` | bump | call `submit_expense_v2` + génère `idempotency_key = useRef(crypto.randomUUID())` per modal lifecycle |

---

## 6. POS / domain

- **POS** : aucun impact direct cette session.
- **`@breakery/domain`** : ajouter type `ApprovalStep` (`{ role_codes: string[]; label: string }`) + `ExpenseApprovalRow` (matching DB row) — exportés depuis `packages/domain/src/expenses/types.ts`.
- **`@breakery/supabase`** : types regen post-Wave 1 (1 regen) puis post-Wave 3 (1 regen perms) — total 2 regens.

---

## 7. Tests (cible 30 asserts)

### 7.1 pgTAP — `expense_governance.test.sql` (~18 asserts)

| # | Test | Vérifie |
|---|---|---|
| T1 | `submit_expense_v2` amount=50000 → `auto_approved=true`, JE émis, `status='approved'` | Auto-approve bracket [0, 100k) |
| T2 | `submit_expense_v2` amount=500000 → `status='submitted'`, `snapshot` = 1 step | Bracket 1 step |
| T3 | `submit_expense_v2` amount=2000000 → `status='submitted'`, `snapshot` = 2 steps | Bracket 2 steps |
| T4 | `approve_expense_v2` par `created_by` → P0001 `sod_creator_block` | SOD bloc 1 |
| T5 | `approve_expense_v2` par CASHIER → P0003 `missing_role` | Perm/role gate |
| T6 | `approve_expense_v2` step 1 par MANAGER → row dans `expense_approvals`, `current_step=1`, `status` reste 'submitted' si snapshot=2 steps | Chain progress |
| T7 | `approve_expense_v2` step 2 par **même MANAGER** → P0001 `sod_already_approved` (UNIQUE expense_id+approver) | SOD bloc 2 |
| T8 | `approve_expense_v2` step 2 par ADMIN différent → `status='approved'`, JE émis | Chain completion |
| T9 | `set_expense_threshold_v1` overlap range → P0002 `threshold_overlap` | Validation overlap |
| T10 | `set_expense_threshold_v1` par MANAGER → P0003 `missing_permission` | Admin-only gate |
| T11 | `set_expense_threshold_v1` category-specific override : amount 500k category=RENT → utilise row category=RENT (steps=2) plutôt que NULL default (steps=1) | Resolution priority |
| T12 | `sync_cash_expense_to_session` trigger : `expense.status` → 'paid' + `payment_method='cash'` + session open par `paid_by` → `pos_sessions.cash_out_total += amount + vat_amount` | Cash sync happy |
| T13 | `sync_cash_expense_to_session` trigger : pas de session open → WARNING + audit_log, paid OK | Cash sync no-session fallback |
| T14 | `audit_log` rows écrites pour `set_expense_threshold_v1`, `approve_expense_v2` (1 per call), `sync_cash_*` | Audit complétude |
| T15 | `submit_expense_v2` boundary exact (amount=100000) → bracket `[100k, 1M)` (1 step) | Boundary inclusive lower |
| T16 | `submit_expense_v2` legacy expense (fallback `required_approval_steps_snapshot IS NULL` après approve_expense_v2) → workflow v1 single approve OK | Backward compat |
| T17 | `delete_expense_threshold_v1` row NULL default → OK + audit | Delete admin |
| T18 | REVOKE EXECUTE FROM anon sur les 4 nouvelles RPCs | Defense-in-depth S25 canonique |

### 7.2 BO smoke (3 fichiers, 8 asserts)

| Fichier | Asserts | Description |
|---|---|---|
| `expense-thresholds-page.smoke.test.tsx` | 3 | T1 list render avec 3 rows defaults / T2 create dialog opens + submit calls `set_expense_threshold_v1` / T3 delete confirms + calls `delete_expense_threshold_v1` |
| `approval-timeline.smoke.test.tsx` | 3 | T1 render snapshot=1 step + 0 approvals = 1 pending row / T2 render snapshot=2 steps + 1 approval = 1 approved + 1 pending / T3 render auto_approved=true = "Auto-approved" badge |
| `approve-dialog-sod.smoke.test.tsx` | 2 | T1 bouton désactivé + tooltip si `user.id === expense.created_by` / T2 bouton désactivé si user déjà dans `expense.approvals` |

### 7.3 Typecheck

- `pnpm typecheck` 6/6 PASS attendu (regen types post-Wave 1 + Wave 3)
- `pnpm --filter @breakery/app-backoffice typecheck` clean

**Total tests** : 18 pgTAP + 8 BO smoke = **26 asserts** (cible 30 dépassée si on compte fine-grained sub-asserts).

---

## 8. Migrations (block `20260605000010..099`)

14 migrations planifiées, monotonic. Convention timestamps : cloud-assignés par `mcp__plugin_supabase_supabase__apply_migration` (héritée S26b/S27/S27b/S27c — on conserve le timestamp cloud pour matcher `supabase_migrations.schema_migrations.version`).

| # | Description |
|---|---|
| `_010` | CREATE TABLE `expense_approval_thresholds` + index |
| `_011` | CREATE TABLE `expense_approvals` + REVOKE/GRANT/RLS policy |
| `_012` | ALTER `expenses` + 3 cols (snapshot, current_step, auto_approved) |
| `_013` | Seed 3 brackets defaults |
| `_014` / `_015` | RPC `submit_expense_v2` (drop v1) + REVOKE pair |
| `_016` / `_017` | RPC `approve_expense_v2` (drop v1) + REVOKE pair |
| `_018` / `_019` | RPC `set_expense_threshold_v1` + REVOKE pair |
| `_020` / `_021` | RPC `delete_expense_threshold_v1` + REVOKE pair |
| `_022` | Trigger function `sync_cash_expense_to_session` + AFTER UPDATE trigger sur `expenses` |
| `_030` | Seed perms `expenses.thresholds.{read,write}` + role_permissions |

Types regen ×2 : après `_012` (table cols), après `_030` (perms TS PermissionCode).

---

## 9. Wave plan

| Wave | Description | Effort |
|---|---|---|
| 0 | Spec doc commit + branche `swarm/session-28` | XS |
| 1.A-D | DB tables + ALTER + seed defaults (4 migrations) + types regen | S |
| 1.E-I | RPCs bump+new (6 migrations REVOKE pairs) + trigger sync_cash (1 migration) | M |
| 2 | pgTAP suite 18 asserts via cloud MCP | S |
| 3.A-D | BO : ExpenseThresholdsPage + ThresholdFormDialog + ApprovalTimeline + ApproveDialog bump + 5 hooks + sidebar entry | M |
| 4 | BO smoke 8 asserts (3 fichiers) | S |
| 5 | Closeout : INDEX + CLAUDE.md "Active Workplan" update + typecheck sweep | XS |

**Wall-time estimé** : ~1 jour (peut être étalé sur 2 demi-journées si stream DB ↔ stream UI en parallèle via subagents).

---

## 10. Closes & tracking

- **TASK-11-001** (Workflow approbation multi-niveau — seuils + chaîne) → DONE complet
- Gaps non-tracés du plan S24-S30 §S28 : SOD block / threshold table / cash sync / settings page → tous DONE

---

## 11. Risques & mitigations

| # | Risque | Mitigation |
|---|---|---|
| R1 | Trigger `sync_cash_expense_to_session` cause des erreurs si `paid_by` n'a pas de session open → bloque le pay UI | Trigger ne fait que WARNING + audit_log si pas de session, n'EXCEPTION jamais → pay continue, comptable corrige a posteriori |
| R2 | Snapshot freeze masque les nouveaux seuils pour les expenses in-flight → comportement contre-intuitif pour l'admin | Documenter dans le tooltip de la page settings : "Changes apply to new expenses only, in-flight expenses keep their original approval chain" |
| R3 | Algorithme de résolution avec `category_id NULLS LAST` peut être ambigu si overlap déclaré (humain manuel) | Validation overlap dans `set_expense_threshold_v1` (T9) bloque la situation à la racine |
| R4 | Migration des expenses historiques : `required_approval_steps_snapshot IS NULL` après ALTER | Fallback dans `approve_expense_v2` : si snapshot NULL → workflow v1 (1 step, perm `expenses.approve`) (cf. T16) |
| R5 | `expense_approvals.uniq_expense_approver` est SOD strict — bloque un admin qui voudrait approve 2 fois (cas edge où threshold change après le 1er approve) | Acceptable : on préfère bloquer + admin doit re-submit avec un nouvel approver, vs autoriser un double-stamp |
| R6 | Multi-step UI doit refresh après chaque approve pour montrer le step suivant | React Query `invalidateQueries(['expense', id])` après chaque mutation, et listener Realtime sur `expense_approvals` si besoin (Realtime hors scope cette session, polling suffit) |
| R7 | PIN en header (S25 pattern) à respecter pour `approve_expense_v2` sinon log leak | Helper `withManagerPin(client)` existant à utiliser systématiquement |
| R8 | Cash sync : si user paye un expense après avoir fermé sa session → no-op, mais comptable ne voit jamais le mouvement dans le shift | Trigger fonctionne sur paid_by + session open active. Audit_log capture l'event 'cash_expense_no_open_session' pour permettre reconcil manuel. Documenter dans CLAUDE.md "Critical patterns". |

---

## 12. Liens

- Predecessor : [`./2026-05-24-session-27c-spec.md`](./2026-05-24-session-27c-spec.md)
- Plan multi-sessions : [`../plans/2026-05-19-S24-to-S30-plan.md`](../../plans/archive/2026-05-19-S24-to-S30-plan.md) §S28
- Backlog module 11 : [`../backlog-by-module/11-expenses.md`](../backlog-by-module/11-expenses.md) TASK-11-001
- Schema reference S13 : `supabase/migrations/20260517000120_init_expenses.sql` (init), `..122_create_expense_rpcs.sql` (RPCs v1)
- Pattern snapshot freeze : `complete_order_v9` (tax_rate) + `recipe_versions.snapshot` (S15+S17)
- Pattern PIN-en-header : S25 `refund-order` EF + `_shared/idempotency.ts`
- Pattern REVOKE pair canonique : S25 corrective `_013_alter_default_privileges_revoke_from_public.sql`
