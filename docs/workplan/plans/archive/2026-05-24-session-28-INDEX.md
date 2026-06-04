# Session 28 — INDEX (Expense Governance)

> **Date** : 2026-05-24
> **Branche** : `swarm/session-28`
> **Base** : `swarm/session-27c` tip @ `0f1ad11` (S27c INDEX + CLAUDE.md closeout — S27c prérequis, merge en premier)
> **Spec** : [`docs/workplan/specs/2026-05-24-session-28-spec.md`](../../specs/archive/2026-05-24-session-28-spec.md)
> **Plan** : [`docs/workplan/plans/2026-05-24-session-28-plan.md`](2026-05-24-session-28-plan.md)
> **Effort réel** : ~1 séance (7 waves chaînées via subagent-driven-development + correctifs inline)
> **Status** : 7/7 waves DONE — prêt à merger (après merge S27c)

---

## 1. Résumé exécutif

Session 28 livre la fonctionnalité **Expense Governance** et ferme TASK-11-001 (Workflow approbation multi-niveau) en comblant 4 gaps structurels identifiés par l'audit S24-S30 : absence de seuils configurables, absence de séparation des tâches (SOD), absence de chaîne multi-niveau, et absence de sync cash vers `pos_sessions`. Le module 11 (Expenses) avait été initialisé en S13 avec un workflow flat (`draft → submitted → approved → paid`) sans contrôle d'approbation — n'importe quel user avec `expenses.approve` pouvait approuver n'importe quel montant, y compris ses propres expenses.

L'architecture retenue repose sur un **snapshot-at-submit** : au moment du `submit_expense_v2`, la chaîne d'approbation requise est résolue en interrogeant `expense_approval_thresholds` et figée dans `expenses.required_approval_steps_snapshot` (JSONB). Ainsi les modifications ultérieures des seuils n'invalident pas les expenses en vol — pattern inspiré de `complete_order_v9` (tax_rate snapshot) et `recipe_versions.snapshot` (S15/S17). Trois cas couverts : auto-approbation (≤ 100k IDR défaut), 1-step manager (100k–1M IDR défaut), 2-step manager+owner (> 1M IDR défaut). Les seuils sont configurables **per category** (NULL = défaut global) via 2 nouveaux RPCs admin (`set_expense_threshold_v1`, `delete_expense_threshold_v1`).

La SOD est enforced au niveau DB dans `approve_expense_v2` : un `UNIQUE(expense_id, approver_id)` sur la table `expense_approvals` (append-only) interdit qu'un même user apparaisse deux fois dans la chaîne, et un CHECK empêche le créateur de l'expense d'être l'un des approbateurs. Le trigger `sync_cash_expense_to_session` se déclenche sur `UPDATE expenses SET status = 'paid'` quand `payment_method = 'cash'` et décrémente `pos_sessions.cash_out_total` de façon atomique avec fallback audit_log en cas d'erreur (no-block). Côté BO, une nouvelle page `/settings/expenses/thresholds` permet la gestion des seuils, et `ExpenseDetailPage` reçoit l'`ApprovalTimeline` stepper + `ApproveDialog` SOD-aware.

Tests : **18 pgTAP asserts** cloud (suite `expense_governance.test.sql`) + **8 BO smoke asserts** (3 fichiers nouveaux) = **26 asserts total**. `pnpm typecheck` 6/6 PASS. Aucune régression sur les sweeps complets BO et POS.

---

## 2. Commits

| # | Wave | SHA | Description |
|---|---|---|---|
| 1 | 0 | `b61ebb3` | docs : Spec Session 28 — Expense Governance (fichier spec initial) |
| 2 | 0 | `43f834f` | docs : Plan d'implémentation Session 28 (Expense Governance) |
| 3 | 1.A | `360d370` | DB : table `expense_approval_thresholds` (pk uuid, category_id nullable FK, min/max_amount_idr, required_steps SMALLINT, created_at) |
| 4 | 1.A.1 (corrective) | `2c989cf` | DB : corrective — index sur `category_id` NULLS LAST (résolution per-category priorise category-specific sur défaut global ; NULLS FIRST incorrecte pour ORDER BY `category_id NULLS LAST`) |
| 5 | 1.B | `f4932ed` | DB : table `expense_approvals` append-only audit (pk uuid, expense_id FK, approver_id FK, step SMALLINT, approved_at, notes ; UNIQUE `(expense_id, approver_id)` SOD) |
| 6 | 1.C | `b128416` | DB : ALTER `expenses` + 3 cols (`required_approval_steps_snapshot JSONB NULL`, `current_approval_step SMALLINT NOT NULL DEFAULT 0`, `auto_approved BOOLEAN NOT NULL DEFAULT false`) |
| 7 | 1.D | `70d669a` | DB : seed 3 seuils défaut globaux (NULL category_id : ≤ 100k auto ; 100k–1M 1-step ; > 1M 2-step) + types regen |
| 8 | 1.D.1 (corrective) | `7031a46` | BO : patch fixtures pre-existing pour les 3 nouvelles cols `expenses` (ExpenseDetailPage + ExpensesListPage smoke tests — tests existants S13, non spécifiques S28) |
| 9 | 2.A | `59383c3` | DB : `submit_expense_v2` (bump v1, drops v1) + helper interne `_emit_expense_je(uuid)` extrait de v1 ; résolution threshold + snapshot freeze + auto-approve si 0 steps requis |
| 10 | 2.A.1 (corrective) | `acc5168` | DB : hardening sécurité `submit_expense_v2` + `_emit_expense_je` : auth check before idempotency replay, `pg_temp` dans `search_path`, `COALESCE(vat_amount, 0)`, REVOKE `_emit_expense_je` de `authenticated` (helper interne) |
| 11 | 2.B | `03cd24f` | DB : REVOKE pair `submit_expense_v2` (REVOKE FROM anon + ALTER DEFAULT PRIVILEGES FROM PUBLIC) |
| 12 | 2.C | `603be00` | DB : `approve_expense_v2` (bump v1, drops v1) — SOD guard (CHECK créateur ≠ approbateur) + chaîne multi-step (avance `current_approval_step`, marque `approved` + émet JE seulement si toutes les steps complétées) |
| 13 | 2.D | `c264296` | DB : REVOKE pair `approve_expense_v2` |
| 14 | 2.E | `d897be5` | DB : `set_expense_threshold_v1` (UPSERT + validation non-overlap : ranges ne peuvent pas se chevaucher pour la même category_id) |
| 15 | 2.F | `00d85e5` | DB : REVOKE pair `set_expense_threshold_v1` |
| 16 | 2.G | `46f6042` | DB : `delete_expense_threshold_v1` (DELETE par id, gate `expenses.thresholds.write`, audit_log) |
| 17 | 2.H | `ee25f3b` | DB : REVOKE pair `delete_expense_threshold_v1` |
| 18 | 2.I | `188771d` | DB : trigger `sync_cash_expense_to_session()` AFTER UPDATE ON `expenses` (status → 'paid' + payment_method = 'cash') → décrémente `pos_sessions.cash_out_total` ; no-block : fallback audit_log si pos_session introuvable |
| 19 | 3.A | `a3f8b00` | DB + TS : seed perms `expenses.thresholds.{read,write}` + extension `PermissionCode` union dans `packages/supabase` |
| 20 | 4 | `2b35b58` | Test : pgTAP suite `expense_governance.test.sql` — 18/18 PASS via cloud MCP |
| 21 | 5.A | `e4b4513` | BO : hook `useExpenseThresholds` (SELECT `expense_approval_thresholds` ordered by category_id NULLS LAST, min_amount_idr ASC) |
| 22 | 5.B | `5c7bae5` | BO : hooks `useSetExpenseThreshold` + `useDeleteExpenseThreshold` (mutations RPC + invalidate query) |
| 23 | 5.C | `c0e3b0a` | BO : hook `useExpenseApprovals(expenseId)` (SELECT `expense_approvals` WHERE expense_id = $1 ORDER BY step ASC) |
| 24 | 5.D | `b22d7a0` | BO : bump `useSubmitExpense` → v2 (idempotency key via `useRef(crypto.randomUUID())`) + bump `useApproveExpense` → v2 (PIN in header `x-manager-pin` per S25 pattern) |
| 25 | 5.E | `b3767dc` | BO : `<ThresholdFormDialog>` — create/edit avec builder de steps (native `<select>` + Tailwind, `@breakery/ui` n'exporte pas Select) |
| 26 | 5.F | `b7f57b3` | BO : `<ExpenseThresholdsPage>` + route `/settings/expenses/thresholds` + entrée sidebar Settings |
| 27 | 5.G | `508fefc` | BO : `<ApprovalTimeline>` stepper component (steps visuels avec statut pending/approved, timestamp, notes, approver name) |
| 28 | 5.H | `eda38a8` | BO : `<ThresholdResolutionBadge>` + `<ApproveDialog>` SOD-aware (champ PIN en header) + wiring `ExpenseDetailPage` (timeline + badge + bouton approve conditionnel) |
| 29 | 6.A | `2c7cbf9` | Test BO : `ExpenseThresholdsPage` smoke 3/3 PASS |
| 30 | 6.B | `58f2728` | Test BO : `ApprovalTimeline` smoke 3/3 PASS |
| 31 | 6.C | `5c6f6a0` | Test BO : `ApproveDialog` SOD smoke 2/2 PASS |

Total : **31 commits** S28 sur la branche depuis `0f1ad11` (tip S27c). Les commits S27c précédents sur cette branche (branche créée off `swarm/session-27c`) ne sont **pas** comptabilisés ici — S27c mergera séparément.

---

## 3. Migrations DB (16)

Block `20260524111854..123026` — tous les timestamps sont **cloud-assignés** par `mcp__plugin_supabase_supabase__apply_migration` (convention héritée S27/S27b/S26b/S27c ; on conserve le timestamp cloud pour matcher `supabase_migrations.schema_migrations.version`).

| # | Version cloud | Fichier local | Description |
|---|---|---|---|
| 1 | `20260524111854` | `_create_expense_approval_thresholds_table.sql` | Table `expense_approval_thresholds` (uuid PK, `category_id` nullable FK `expense_categories.id`, `min_amount_idr NUMERIC(15,2) NOT NULL`, `max_amount_idr NUMERIC(15,2) NULL`, `required_steps SMALLINT NOT NULL`, timestamps). Index sur `(category_id NULLS LAST, min_amount_idr)` pour résolution rapide. |
| 2 | `20260524112433` | `_fix_thresholds_index_nulls_order.sql` | **Corrective Wave 1.A.1** — index recréé avec `NULLS LAST` sur `category_id` (l'algo de résolution ORDER BY `category_id NULLS LAST` priorise les entrées category-specific avant le défaut global NULL ; NULLS FIRST était incorrect). |
| 3 | `20260524112621` | `_create_expense_approvals_table.sql` | Table `expense_approvals` append-only audit (uuid PK, `expense_id` FK `expenses.id`, `approver_id` FK `users.id`, `step SMALLINT NOT NULL`, `approved_at TIMESTAMPTZ`, `notes TEXT NULL` ; UNIQUE `(expense_id, approver_id)` enforces SOD at DB level). RLS REVOKE UPDATE/DELETE pour `authenticated`. |
| 4 | `20260524113023` | `_alter_expenses_add_approval_snapshot_columns.sql` | ALTER `expenses` + 3 colonnes : `required_approval_steps_snapshot JSONB NULL` (figé au submit), `current_approval_step SMALLINT NOT NULL DEFAULT 0` (0 = non commencé), `auto_approved BOOLEAN NOT NULL DEFAULT false`. |
| 5 | `20260524113353` | `_seed_expense_approval_thresholds_defaults.sql` | Seed 3 lignes globales (category_id = NULL) : row 1 `min=0 max=100000 steps=0` (auto) ; row 2 `min=100000 max=1000000 steps=1` (manager) ; row 3 `min=1000000 max=NULL steps=2` (manager+owner). Types regen inclus (PermissionCode + generated types). |
| 6 | `20260524114442` | `_bump_submit_expense_v2_rpc.sql` | `submit_expense_v2(p_expense_id UUID, p_idempotency_key UUID)` SECURITY DEFINER — DROP FUNCTION `submit_expense_v1` + CREATE OR REPLACE v2. Résout le threshold applicable (per-category THEN global) → snapshot JSONB figé dans `required_approval_steps_snapshot` → si steps=0 : `auto_approved=true`, `status='approved'`, émet JE via `_emit_expense_je`. Gate `expenses.submit` (unchanged). |
| 7 | `20260524115443` | `_fix_submit_expense_v2_security_hardening.sql` | **Corrective Wave 2.A.1** — 4 fixs sécurité : (1) auth check déplacé AVANT replay idempotency (évite info-disclosure sur idempotency_key d'un autre user) ; (2) `SET search_path = public, pg_temp` (project convention vs path injection) ; (3) `COALESCE(vat_amount, 0)` dans `_emit_expense_je` (NULL-safety sur col nullable) ; (4) REVOKE EXECUTE `_emit_expense_je` FROM `authenticated` (helper interne — ne doit pas être callable directement). |
| 8 | `20260524115713` | `_revoke_anon_submit_expense_v2.sql` | REVOKE EXECUTE `submit_expense_v2` FROM `anon` + ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC (S25 canonical REVOKE pair). |
| 9 | `20260524120104` | `_bump_approve_expense_v2_rpc.sql` | `approve_expense_v2(p_expense_id UUID, p_manager_pin TEXT)` SECURITY DEFINER — DROP FUNCTION `approve_expense_v1` + CREATE OR REPLACE v2. SOD : RAISE si `approver_id = expense.created_by` (`P0001 expense_sod_violation`) ; RAISE si `approver_id` déjà dans `expense_approvals` pour cet expense (`P0001 already_approved_this_expense`) ; INSERT `expense_approvals` step = `current_approval_step + 1` ; si `current_approval_step + 1 >= required_steps` → `status='approved'` + émet JE via `_emit_expense_je` ; sinon avance `current_approval_step`. Gate `expenses.approve`. |
| 10 | `20260524121140` | `_revoke_anon_approve_expense_v2.sql` | REVOKE pair `approve_expense_v2`. |
| 11 | `20260524121337` | `_create_set_expense_threshold_v1_rpc.sql` | `set_expense_threshold_v1(p_category_id UUID NULL, p_min NUMERIC, p_max NUMERIC NULL, p_steps SMALLINT)` SECURITY DEFINER — UPSERT avec validation non-overlap (ranges ne se chevauchent pas pour la même `category_id`). Gate `expenses.thresholds.write` (SUPER_ADMIN only). Audit_log. |
| 12 | `20260524122002` | `_revoke_anon_set_expense_threshold_v1.sql` | REVOKE pair `set_expense_threshold_v1`. |
| 13 | `20260524122136` | `_create_delete_expense_threshold_v1_rpc.sql` | `delete_expense_threshold_v1(p_threshold_id UUID)` SECURITY DEFINER — DELETE + audit_log. Gate `expenses.thresholds.write`. RAISE `P0002 threshold_not_found` si absent. |
| 14 | `20260524122427` | `_revoke_anon_delete_expense_threshold_v1.sql` | REVOKE pair `delete_expense_threshold_v1`. |
| 15 | `20260524122632` | `_create_sync_cash_expense_trigger.sql` | Trigger function `sync_cash_expense_to_session()` + AFTER UPDATE ON `expenses` FOR EACH ROW WHEN (NEW.status = 'paid' AND NEW.payment_method = 'cash' AND OLD.status IS DISTINCT FROM 'paid'). Recherche la `pos_session` active du jour du `paid_at`, décrémente `cash_out_total`. No-block : en cas d'absence de session ou d'erreur, INSERT dans `audit_logs` (action `'cash_expense_sync_skipped'`) sans RAISE. |
| 16 | `20260524123026` | `_seed_perms_expenses_thresholds.sql` | Seed `expenses.thresholds.read` + `expenses.thresholds.write` dans `permissions` + `role_permissions` (read : MANAGER/ADMIN/SUPER_ADMIN ; write : SUPER_ADMIN only). Types regen inclus. |

---

## 4. Pages livrées (1 nouvelle)

### BO

- **`<ExpenseThresholdsPage>`** (`apps/backoffice/src/features/expenses/ExpenseThresholdsPage.tsx`) — Route `/settings/expenses/thresholds` + entrée sidebar Settings (gated `expenses.thresholds.read`). Affiche la table des seuils (category, range min–max IDR, nb steps requis, bouton Edit + Delete). Bouton "+ Add threshold" ouvre `<ThresholdFormDialog>`. Chaque row DELETE appelle `useDeleteExpenseThreshold`. Entrée sidebar placée sous la section Settings → « Expense Thresholds » (icône SlidersHorizontal).

Session 28 modifie également une page existante :

- **`<ExpenseDetailPage>`** (`apps/backoffice/src/features/expenses/ExpenseDetailPage.tsx`) — Enrichie avec : `<ThresholdResolutionBadge>` (affiche "Auto-approved" / "1 approval required" / "2 approvals required" selon `auto_approved` + snapshot), `<ApprovalTimeline>` (historique des steps d'approbation), bouton "Approve" conditionnel (visible si `status = 'submitted'` et `current_approval_step < required_steps` et SOD non violé), `<ApproveDialog>` (modal PIN).

---

## 5. Composants livrés (4)

### BO (4)

- **`<ThresholdFormDialog>`** (`apps/backoffice/src/features/expenses/ThresholdFormDialog.tsx`) — Dialog create/edit pour un seuil d'approbation. Champs : category selector (native `<select>` + options expense_categories — `@breakery/ui` n'exporte pas `<Select>/<SelectItem>`, pattern cohérent avec sibling components vérifiés), min_amount_idr, max_amount_idr (optionnel = open-ended), required_steps (native `<select>` : 0 auto / 1 / 2). Submit appelle `useSetExpenseThreshold`. Validation inline : max > min si fourni.

- **`<ApprovalTimeline>`** (`apps/backoffice/src/features/expenses/ApprovalTimeline.tsx`) — Stepper visuel vertical listant les steps d'approbation depuis `expense_approvals` + les steps requises selon le snapshot. Chaque step affiche : step number, statut (pending = cercle vide / approved = check vert), nom approbateur, timestamp `approved_at` formaté, notes. Data provient de `useExpenseApprovals(expenseId)`. Semantic tokens : `text-text-muted` (non `text-muted-foreground` — mapping Tailwind corrigé pour le design system @breakery).

- **`<ThresholdResolutionBadge>`** (`apps/backoffice/src/features/expenses/ThresholdResolutionBadge.tsx`) — Badge `<Badge>` primitif de `@breakery/ui` (le projet dispose bien de ce composant). 3 variantes : `auto` (green "Auto-approved"), `1-step` (yellow "1 approval required"), `2-step` (orange "2 approvals required"). Source : `expenses.auto_approved` + `expenses.required_approval_steps_snapshot`.

- **`<ApproveDialog>`** (bump de `apps/backoffice/src/features/expenses/ApproveDialog.tsx`) — Remplace le champ `notes` par un champ `notes` + un champ PIN (6 digits). Le PIN est envoyé via header `x-manager-pin` (S25 pattern, jamais dans le body JSON). Message SOD affiché si l'utilisateur courant est le créateur de l'expense (bouton "Approve" grisé côté UI ; la DB renforce également la contrainte). Notes : champ texte optionnel transmis à `approve_expense_v2`.

---

## 6. Hooks livrés (5)

### BO (5)

| Hook | Fichier | Description |
|---|---|---|
| `useExpenseThresholds()` | `hooks/useExpenseThresholds.ts` | SELECT `expense_approval_thresholds` ORDER BY category_id NULLS LAST, min_amount_idr ASC. Retourne la liste complète pour la page settings. |
| `useSetExpenseThreshold` | `hooks/useSetExpenseThreshold.ts` | Mutation RPC `set_expense_threshold_v1` (UPSERT) + invalidation query `expense-thresholds`. |
| `useDeleteExpenseThreshold` | `hooks/useDeleteExpenseThreshold.ts` | Mutation RPC `delete_expense_threshold_v1` + invalidation query `expense-thresholds`. |
| `useExpenseApprovals(expenseId)` | `hooks/useExpenseApprovals.ts` | SELECT `expense_approvals` WHERE expense_id = $1 ORDER BY step ASC. Polling 30s pour rafraîchir l'ApprovalTimeline. |
| `useSubmitExpense` (bumped v2) | `hooks/useExpenseActions.ts` | Bump inline dans le fichier existant. `useRef(crypto.randomUUID())` lifecycle : reset on dismiss (S25 idempotency flavor 2 — RPC arg `p_idempotency_key`). Appelle `submit_expense_v2`. |
| `useApproveExpense` (bumped v2) | `hooks/useExpenseActions.ts` | Bump inline dans le même fichier. PIN transmis via header `x-manager-pin` (S25 pattern). Appelle `approve_expense_v2`. |

Note : `useSubmitExpense` et `useApproveExpense` sont des bumps dans le fichier existant `useExpenseActions.ts` (pas de nouveaux fichiers) — comptabilisés ensemble comme 2 hooks modifiés dans la colonne « 5 hooks livrés » (3 nouveaux + 2 bumped).

---

## 7. Tests

### pgTAP (1 fichier, 18/18 PASS via cloud MCP)

`supabase/tests/expense_governance.test.sql` :

- **T1** — `submit_expense_v2` happy path auto-approve : expense ≤ 100k IDR → `auto_approved = true`, `status = 'approved'`, JE émise, `current_approval_step = 0`.
- **T2** — `submit_expense_v2` happy path 1-step : expense 100k–1M → snapshot `required_steps = 1`, `status = 'submitted'`, `auto_approved = false`.
- **T3** — `submit_expense_v2` happy path 2-step : expense > 1M → snapshot `required_steps = 2`.
- **T4** — `submit_expense_v2` idempotency replay : même `p_idempotency_key` → retourne le même résultat sans double-emit JE.
- **T5** — `submit_expense_v2` forbidden (CASHIER sans `expenses.submit`) → `P0003`.
- **T6** — `approve_expense_v2` happy path 1-step : approbateur distinct du créateur → `status = 'approved'` + JE émise.
- **T7** — `approve_expense_v2` SOD violation : créateur essaie d'approuver son propre expense → `P0001 expense_sod_violation`.
- **T8** — `approve_expense_v2` double-approval SOD : même approbateur approuve deux fois → `P0001 already_approved_this_expense` (UNIQUE constraint `expense_approvals`).
- **T9** — `approve_expense_v2` 2-step intermediate : step 1 approuvée → `status` reste `'submitted'`, `current_approval_step = 1`.
- **T10** — `approve_expense_v2` 2-step complete : step 2 approuvée (approbateur 2 distinct) → `status = 'approved'` + JE émise.
- **T11** — `approve_expense_v2` forbidden (CASHIER) → `P0003`.
- **T12** — `set_expense_threshold_v1` happy path UPSERT (SUPER_ADMIN) → upsert confirmé.
- **T13** — `set_expense_threshold_v1` overlap validation → RAISE `P0001 threshold_overlap`.
- **T14** — `set_expense_threshold_v1` forbidden (MANAGER) → `P0003`.
- **T15** — `delete_expense_threshold_v1` happy path.
- **T16** — `delete_expense_threshold_v1` not found → `P0002 threshold_not_found`.
- **T17** — trigger `sync_cash_expense_to_session` : expense paid + cash → `pos_sessions.cash_out_total` décrémenté.
- **T18** — trigger no-block : expense paid + cash sans session active → audit_log `'cash_expense_sync_skipped'` + pas de RAISE.

### BO smoke (3 fichiers, 8/8 PASS)

| Fichier | Asserts | Couvre |
|---|---|---|
| `expense-thresholds-page.smoke.test.tsx` | 3 | Page renders threshold rows + "+ Add" opens ThresholdFormDialog + Delete calls `delete_expense_threshold_v1` shape |
| `approval-timeline.smoke.test.tsx` | 3 | Timeline renders 2 approved steps + pending step + timestamps affichés |
| `approve-dialog-sod.smoke.test.tsx` | 2 | Bouton "Approve" désactivé si currentUser = créateur (SOD UI gate) + PIN field present on open |

### Fixtures pré-existantes patchées (Wave 1.D.1)

| Fichier | Nature | Pourquoi |
|---|---|---|
| `ExpenseDetailPage.smoke.test.tsx` | Fixture mock `expenses` | 3 nouvelles cols `expenses` ajoutées Wave 1.C → mock incomplet → test fail |
| `ExpensesListPage.smoke.test.tsx` | Fixture mock `expenses` | Idem |

Ces 2 fichiers sont des tests S13 pre-existing, non S28-specific — le patch de fixture n'est pas un régression S28, c'est un ajustement de compatibilité.

### Sweep complet

- `pnpm typecheck` : 6/6 packages PASS.
- `pnpm --filter @breakery/app-backoffice test` : PASS — no regression (sweep complet incluant les S13 expense tests + S28 nouveaux).
- `pnpm --filter @breakery/app-pos test` : PASS — no regression (S28 ne touche pas au POS sauf via DB trigger).

---

## 8. Permissions / Roles utilisés

Seedées Wave 3.A migration `_123026` :

| Permission | Roles seeded | Used by |
|---|---|---|
| `expenses.thresholds.read` | MANAGER, ADMIN, SUPER_ADMIN | `ExpenseThresholdsPage` (gate route + sidebar entry) ; `useExpenseThresholds` hook |
| `expenses.thresholds.write` | SUPER_ADMIN only | `set_expense_threshold_v1` + `delete_expense_threshold_v1` RPCs (gate DB-level) ; boutons Edit/Delete/Add grisés pour MANAGER/ADMIN |

Permissions existantes S13 conservées sans modification :
- `expenses.submit` — gate `submit_expense_v2` (bump v2, perm inchangée)
- `expenses.approve` — gate `approve_expense_v2` (bump v2, perm inchangée)
- `expenses.create`, `expenses.read`, `expenses.pay`, `expenses.reject` — inchangées

Pattern : `expenses.thresholds.write` réservé SUPER_ADMIN uniquement (les seuils d'approbation sont une politique business critique — un MANAGER ne devrait pas pouvoir abaisser son propre seuil). Aligné avec `accounting.coa.write` (S26b) et `update_role_session_timeout_v1` (S19) qui sont également SUPER_ADMIN.

---

## 9. Closes (TASK + gaps)

- **TASK-11-001** Workflow approbation multi-niveau — **DONE** (complet : SOD + multi-step + seuils configurables + settings page + cash sync).
- **Gap 11-1** SOD (séparation des tâches) — **DONE** (UNIQUE `expense_approvals(expense_id, approver_id)` + CHECK créateur ≠ approbateur dans `approve_expense_v2`).
- **Gap 11-2** Chaîne multi-niveau — **DONE** (snapshot-at-submit + `current_approval_step` + 2-step chain dans `approve_expense_v2`).
- **Gap 11-3** Cash sync pos_sessions — **DONE** (trigger `sync_cash_expense_to_session`).
- **Gap 11-4** Settings page seuils — **DONE** (`ExpenseThresholdsPage` + route + sidebar).

---

## 10. Hors scope (déféré post-S28)

- **TASK-11-003** Recurring expenses (template expenses + cron auto-submit mensuel/hebdo).
- **TASK-11-004** OCR receipt upload — **BLOCKED** : nécessite Capacitor camera plugin non installé. Post-S30.
- **TASK-11-005** Cost centers (sous-allocation d'expenses à des centres de coût via colonne `cost_center_id`).
- **TASK-11-006** Per diem et avances (expenses pré-approuvées avant la dépense réelle).
- **Notifications email / in-app** aux approbateurs à chaque step (S28 livre uniquement un toast côté BO après approbation ; `pg_net`-based notifications déférées — même gap que S13 DEV birthday cron D-W6-6B-02).
- **Workflow reject multi-step** (S28 conserve le `reject_expense_v1` S13 one-shot depuis `submitted` — un reject en mid-chain annule toute la chaîne, pas de retour à l'étape précédente).
- **Migration historique expenses** : les expenses S13 existantes ont `required_approval_steps_snapshot = NULL` + `current_approval_step = 0` + `auto_approved = false`. Le code `approve_expense_v2` gère ce cas via fallback NULL snapshot (traité comme 1-step). Pas de backfill.
- **Per-category thresholds UI avancée** : la page settings affiche les seuils groupés par category mais ne permet pas la réorganisation DnD ou l'import CSV.

---

## 11. Déviations & DEV log

| ID | Wave | Description | Status |
|---|---|---|---|
| DEV-S28-1.A-01 | 1.A corrective | Index initial `expense_approval_thresholds(category_id)` créé NULLS FIRST ; l'algo de résolution requiert NULLS LAST pour prioriser les entries category-specific (non-NULL) avant le défaut global (NULL). Corrective `_112433` recréé l'index NULLS LAST. | **Medium, fixed** |
| DEV-S28-2.A-01 | 2.A / 2.C | Plan spec listait les cols `audit_logs` comme `actor_user_id` / `entity` / `payload` ; les colonnes réelles dans la DB S13 canonique sont `actor_id` / `entity_type` / `metadata`. Corrigé uniformément sur les 5 implémentations RPC avant apply. La spec était incorrecte — les implémenteurs ont utilisé les cols canoniques directement. | **Medium, fixed** (informationnel — aucune donnée corrompue, correction à la source avant apply) |
| DEV-S28-2.A-02 | 2.A / 2.C | Chemin VAT dans `_emit_expense_je` (`vat_amount > 0` → `resolve_mapping_account('EXPENSE_VAT_INPUT')` → account 1151) non testable : account 1151 désactivé par S26 ADR-003 (NON-PKP). Le code path est conservé verbatim depuis `approve_expense_v1` (S13). Ce n'est PAS une régression S28 — même status qu'avant S28. Serait réactivé si The Breakery devient PKP (hors scope). | Informationnel (NON-PKP business) |
| DEV-S28-2.A-03 | 2.A.1 corrective | `submit_expense_v2` Wave 2.A initialement plaçait le check `has_permission()` APRÈS la lookup idempotency replay. En cas de replay d'un key appartenant à un autre user, le système retournait les données de l'autre expense (info-disclosure). Corrective `_115443` déplace le check auth en premier. | **Medium, fixed** |
| DEV-S28-5.E-01 | 5.E | `@breakery/ui` n'exporte pas `<Select>` / `<SelectItem>` primitives. `ThresholdFormDialog` utilise native HTML `<select>` + Tailwind classes (pattern cohérent avec vérification sibling components). Bouton variant `outline` inexistant dans `@breakery/ui` → variant `secondary` utilisé. | Informationnel |
| DEV-S28-5.G-01 | 5.G | Tailwind classes `text-muted-foreground` / `bg-muted` utilisées dans le plan ne correspondent pas aux semantic tokens du design system @breakery (qui utilise `text-text-muted` / `bg-surface-muted`). Corrigé lors de l'implémentation. | Informationnel |
| DEV-S28-5.H-01 | 5.H | `@breakery/ui` exporte bien `<Badge>` primitif — utilisé pour `ThresholdResolutionBadge` comme prévu. (Vérification positive, contraire à S27c où Badge aurait pu être absent.) | Informationnel |
| DEV-S28-6.A-01 | 6.A | Wave 6.A nécessité 5 adaptations de test : (1) default export vs named export dans le mock ; (2) `mutateAsync` vs `mutate` (React Query API) ; (3) chemin import `useExpensesList` ; (4) sélecteur Zustand pour `currentUser` ; (5) warning a11y Radix Dialog sans `<DialogDescription>`. Aucun impact fonctionnel — adaptations d'outillage de test. | Informationnel |
| DEV-S28-MIGRATIONS-01 | toutes | Timestamps cloud-assigned dévient du bloc planifié (`20260524110000..099` planifié approximativement → `20260524111854..123026` réel). Convention S27c/S27b/S26b/S27/S26 conservée : on garde les timestamps cloud-assignés pour matcher `schema_migrations.version`. | Informationnel |
| DEV-S28-BRANCH-01 | all | La branche `swarm/session-28` a été créée off `swarm/session-27c` (tip `0f1ad11`) et non off `master`. Les commits S27c précèdent les commits S28 dans l'historique git de cette branche. PR sequence : S27c merges first → S28 PR targets updated master. Le count de 31 commits + 16 migrations INDEX couvre **uniquement les commits S28**. | Informationnel |

---

## 12. Métriques

- **Commits S28** : 31 (2 Wave 0 docs + 16 DB/types + 1 test pgTAP + 9 BO hooks/components + 3 BO smoke).
- **Migrations** : 16 (block `20260524111854..123026` ; dont 2 correctives : 1.A.1 index NULLS LAST + 2.A.1 security hardening).
- **Tables créées** : 2 (`expense_approval_thresholds`, `expense_approvals`).
- **Colonnes ajoutées** : 3 sur `expenses` (`required_approval_steps_snapshot`, `current_approval_step`, `auto_approved`).
- **RPCs livrées** : 5 (`submit_expense_v2` bump, `approve_expense_v2` bump, `set_expense_threshold_v1`, `delete_expense_threshold_v1`, `_emit_expense_je` helper interne).
- **Trigger** : 1 (`sync_cash_expense_to_session`).
- **Permissions seedées** : 2 (`expenses.thresholds.read`, `expenses.thresholds.write`).
- **Hooks livrés** : 5 (3 nouveaux + 2 bumps inline).
- **Composants livrés** : 4 (`ThresholdFormDialog`, `ApprovalTimeline`, `ThresholdResolutionBadge`, `ApproveDialog` bumped).
- **Pages livrées** : 1 nouvelle (`ExpenseThresholdsPage`) + 1 modifiée (`ExpenseDetailPage`).
- **Tests** : 1 pgTAP suite (18 asserts) + 3 BO smoke files (8 asserts) = **26 asserts total**.

---

## 13. PR

**Title** : `feat(expenses): session 28 — expense governance (SOD + multi-step + thresholds + cash sync)`

**Branch** : `swarm/session-28` → `master` (après merge S27c)

**Body suggestion** :

```
## Summary
- Snapshot-at-submit architecture : threshold resolution figée au submit, in-flight expenses immunes aux changements de config
- SOD enforced DB-level via UNIQUE(expense_id, approver_id) + CHECK créateur ≠ approbateur dans approve_expense_v2
- Multi-step chain : auto (≤ 100k IDR) / 1-step manager (≤ 1M) / 2-step manager+owner (> 1M), configurable per category
- trigger sync_cash_expense_to_session : decrement pos_sessions.cash_out_total when expense paid+cash
- BO : ExpenseThresholdsPage settings + ApprovalTimeline + ThresholdResolutionBadge + ApproveDialog SOD-aware
- 26 tests : 18 pgTAP + 8 BO smoke (all PASS via cloud MCP)

Closes TASK-11-001 + gaps 11-1 (SOD) / 11-2 (chain) / 11-3 (cash sync) / 11-4 (settings).
Prerequisite: swarm/session-27c must merge first.

INDEX : docs/workplan/plans/2026-05-24-session-28-INDEX.md
Spec  : docs/workplan/specs/2026-05-24-session-28-spec.md

## Test plan
- [x] pnpm typecheck — 6/6 packages PASS
- [x] pgTAP expense_governance.test.sql — 18/18 PASS via cloud MCP
- [x] BO smoke (3 new files) — 8/8 PASS
- [x] BO full sweep — PASS (no regression, incl. S13 expense tests)
- [x] POS full sweep — PASS (no regression)
```

Merge squash recommandé pour préserver les 31 commits séparés par Wave (lisibilité historique S28 future debugging).
