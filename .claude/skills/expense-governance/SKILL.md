---
name: expense-governance
description: >-
  Expense approval workflow expert — thresholds, SOD, multi-step chain, snapshot-at-submit,
  routage comptable du paiement. Audits approval integrity AND guides expense governance
  changes. Use this skill whenever the task mentions expense / dépense / note de frais,
  approval / approbation / validation de dépense, threshold / seuil d'approbation, SOD /
  separation of duties / séparation des tâches, auto-approve, approval chain / chaîne
  d'approbation, cash expense / dépense en espèces, receipt / justificatif — or touches
  apps/backoffice features/expenses, the expense-thresholds settings, or any supabase
  migration/test with expense in the name.
  Invoke it BEFORE editing any expense RPC, trigger, or threshold logic.
pathPatterns:
  - 'apps/backoffice/src/features/expenses/**'
  - 'apps/backoffice/src/features/settings/expense-thresholds/**'
  - 'apps/backoffice/src/pages/expenses/**'
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

> **Re-vérifié le 2026-08-31 contre le code.** Les faits ci-dessous ont été relevés sur les
> migrations au numéro le plus haut touchant chaque objet et sur les call-sites. En cas de
> divergence entre cette fiche et le code, **le code gagne** : on relit
> `supabase/migrations/`, `supabase/tests/expense_governance.test.sql` et les hooks du BO,
> puis on corrige la fiche — jamais l'inverse.

Expert de la chaîne d'approbation multi-étapes des dépenses (socle livré le 2026-05-24).
Deux usages :

1. **Audit** de la chaîne : violations SOD, dérive de snapshot, REVOKE pairs manquants.
2. **Guide** des évolutions (nouveaux steps, ajustement de seuils, bumps de RPC).

**`CLAUDE.md` est la source de vérité** des patterns projet (RPC versioning, REVOKE pairs,
idempotence, PIN). Cette fiche ajoute le modèle mental expense-governance, les noms de
schéma vérifiés et des checklists que CLAUDE.md ne porte pas.

## Mental model — snapshot-at-submit

```
SUBMIT                          APPROVE (step N)                 PAY
──────                          ────────────────                 ───
submit_expense                  approve_expense                  pay_expense
  ↓ resolve threshold             ↓ perm gate expenses.approve     ↓ status='paid'
  ↓ ORDER BY category_id          ↓ PIN en ARG, vérifié serveur    ↓ aucun trigger de
  ↓   NULLS LAST LIMIT 1          ↓ SOD block 1 (créateur)         ↓   synchro de caisse
  ↓ freeze snapshot JSONB         ↓   relâché pour SUPER_ADMIN     ↓ le cash sort du
  ↓ → steps=[] → auto-approve     ↓ SOD block 2 (UNIQUE approver)  ↓   coffre 1111
  ↓ → steps>0  → 'submitted'      ↓ role gate (step.role_codes)    ↓   (EXPENSE_CASH_OUT)
  ↓ emit JE (auto-approve)        ↓ step=final → 'approved' + JE
  ↓ audit: expense.auto_approved  ↓ audit: expense.approved_step
                                  ↓   (+ expense.self_approved)
```

### Schéma réel (vérifié contre le code au 2026-08-31)

**`expenses` — 3 colonnes de la chaîne d'approbation**
- `required_approval_steps_snapshot JSONB NULL` — copie figée des steps au submit.
  NULL = expense antérieure au 2026-05-24 (fallback 1-step).
- `current_approval_step SMALLINT NOT NULL DEFAULT 0` — compteur 0-based. Égale
  `jsonb_array_length(snapshot)` quand approuvé.
- `auto_approved BOOLEAN NOT NULL DEFAULT false` — true si `steps=[]` (montant sous le
  seuil le plus bas).

**`expense_approval_thresholds`** — configurable per-category
- `category_id UUID NULL` (NULL = default global)
- `amount_min NUMERIC(15,2) NOT NULL DEFAULT 0`, `amount_max NUMERIC(15,2) NOT NULL`
- `steps JSONB NOT NULL` — tableau `[{"role_codes":[...],"label":"..."}]`
- `CONSTRAINT thresholds_amount_range CHECK (amount_max > amount_min)`
- `CONSTRAINT thresholds_steps_array CHECK (jsonb_typeof(steps) = 'array')`
- 3 defaults seedés : `[0, 100k)` steps=[] (auto), `[100k, 1M)` 1-step MANAGER,
  `[1M, 9.9G)` 2-step MANAGER+ADMIN
- Résolution : `ORDER BY category_id NULLS LAST`, `LIMIT 1` — catégorie spécifique gagne
  sur NULL.

**`expense_approvals`** — append-only audit
- `CONSTRAINT uniq_expense_step UNIQUE (expense_id, step)` — une seule approbation par step
- `CONSTRAINT uniq_expense_approver UNIQUE (expense_id, approver_user_id)` — un même
  approver ne peut pas faire 2 steps → SOD block 2
- RLS : SELECT uniquement ; INSERT/UPDATE/DELETE revokés pour authenticated/anon/PUBLIC
- Writes via SECURITY DEFINER RPCs uniquement.

## Critical patterns (toujours vérifier avant de livrer)

1. **Snapshot-at-submit immuable** — `required_approval_steps_snapshot` est figé au moment
   du submit. Un changement de seuil admin n'invalide PAS une expense en cours de chaîne.
   Ne jamais UPDATE la colonne snapshot sur une expense déjà soumise.

2. **SOD à 2 niveaux, avec une dérogation DÉCIDÉE pour SUPER_ADMIN** — `approve_expense`
   bloque :
   - Bloc 1 (ligne) : `v_expense.created_by = v_caller_profile` → P0001 `sod_creator_block`,
     **sauf si le rôle appelant est `SUPER_ADMIN`** — relâché le 2026-06-23 pour le cas du
     propriétaire unique qui crée ET approuve. Le contournement est tracé : action d'audit
     dédiée `expense.self_approved` + `self_approval: true` dans les métadonnées de
     `expense.approved_step`. **Ce n'est pas une fraude, c'est une politique** : ne pas la
     signaler comme un défaut, ne pas la « re-durcir » sans nouvel arbitrage.
   - Bloc 2 (DB) : `INSERT INTO expense_approvals` catch `unique_violation` → P0001
     `sod_already_approved`. Intact, il s'applique aussi à SUPER_ADMIN.

3. **PIN en ARGUMENT RPC, pas en header — exception motivée** — `approve_expense` prend
   `p_manager_pin TEXT` et le vérifie **côté serveur** via `_verify_pin_with_lockout` contre
   le profil de l'appelant. Le call-site est `useApproveExpense` dans
   `apps/backoffice/src/features/expenses/hooks/useExpenseActions.ts`.
   Avant le 2026-06-01, le BO envoyait le PIN dans le header `x-manager-pin` et la RPC ne le
   lisait jamais : **security theater**, une session BO restée ouverte approuvait sans
   ré-auth. **Ne JAMAIS « re-corriger » vers le header.** La règle projet « PIN en header,
   jamais en body » vise les **Edge Functions**, dont les bodies sont loggés — elle reste
   vraie partout ailleurs. Une RPC Postgres n'a pas de body loggé de cette façon : l'arg est
   le bon véhicule, et c'est le seul qui soit réellement validé.

4. **Idempotence sur submit** — `submit_expense(p_expense_id, p_idempotency_key)` : le client
   génère un UUID via `useRef(crypto.randomUUID())` et le passe. Replay lit
   `expenses.idempotency_key` → retourne `{ idempotent_replay: true }`. `approve_expense` n'a
   PAS d'idempotency key (les approvals sont intentionnellement uniques par step).

5. **REVOKE pair canonique** sur chaque RPC — 3 lignes :
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   `submit_expense`, `set_expense_threshold` et `delete_expense_threshold` ont chacun leur
   migration `revoke_anon_*` dédiée ; pour `approve_expense`, la paire voyage **dans la
   migration de bump elle-même** (`20260601181353_bump_approve_expense_v3_manager_pin.sql`).
   Le helper interne `_emit_expense_je` est en plus revoké de `authenticated`.

6. **PPN NON-PKP : foldé, plus de crash** — `_emit_expense_je` **n'émet plus de ligne
   `EXPENSE_VAT_INPUT`** depuis le 2026-07-06 : le PPN non récupérable est foldé dans le
   débit du compte de charge (le montant est déjà TTC, `vat_amount` y est inclus, jamais
   ajouté). Le compte 1151 reste désactivé (ADR-003, NON-PKP). Il n'y a donc **plus** de
   P0002 au runtime sur `vat_amount > 0` : ne pas ressusciter la consigne « vat_amount doit
   rester 0 ». Le seul garde-fou restant est un CHECK runtime `22023` :
   `vat_amount` ne peut être ni négatif ni supérieur au montant.

7. **Le paiement cash sort du coffre, pas de la caisse du shift** — le trigger
   `trg_expenses_sync_cash` et sa fonction `sync_cash_expense_to_session()` sont **droppés
   depuis le 2026-07-06**. La même migration remappe `EXPENSE_CASH_OUT` vers **1111 Petty
   Cash**. Payer une dépense en espèces **ne touche plus** `pos_sessions.cash_out_total` et
   n'est jamais bloqué par l'absence de session ouverte. Corollaire : les actions d'audit
   `expense.cash_synced_to_session` et `expense.cash_paid_no_session` sont **mortes** — elles
   ne vivaient que dans cette fonction. Ne pas recâbler la caisse du shift sans arbitrage.

8. **RPC versioning monotone** — bumper une RPC de la chaîne, c'est créer la version
   suivante et `DROP FUNCTION` l'ancienne **avec sa signature exacte** dans la même
   migration. Vérifier la version live avant de s'y fier, et partir du corps live
   (`pg_get_functiondef`), jamais du fichier de migration d'origine.

## RPCs de la chaîne (familles)

Versions live **relevées le 2026-08-31** — les revérifier avant de s'y appuyer.

| Famille | Version live 2026-08-31 | Signature | Gate | Idempotence |
|---------|------------------------|-----------|------|-------------|
| `submit_expense` | v2 | `(p_expense_id UUID, p_idempotency_key UUID DEFAULT NULL)` | `expenses.create` ou `expenses.manage` | `p_idempotency_key` arg |
| `approve_expense` | v3 | `(p_expense_id UUID, p_manager_pin TEXT)` | `expenses.approve` + PIN serveur | Aucune (append-only) |
| `set_expense_threshold` | v1 | `(p_threshold_id UUID, p_category_id UUID, p_amount_min NUMERIC, p_amount_max NUMERIC, p_steps JSONB)` | `expenses.thresholds.write` | — |
| `delete_expense_threshold` | v1 | `(p_threshold_id UUID)` | `expenses.thresholds.write` | — |
| `_emit_expense_je` | — | `(p_expense_id UUID)` | interne SECURITY DEFINER | — |

Familles adjacentes appelées par le même écran : `reject_expense` et `pay_expense`
(`(UUID, TEXT)`), toutes deux du socle dépenses initial.

**Permissions seedées** (au 2026-05-24 ; `role_permissions` est devenue de la DONNÉE
éditable depuis l'éditeur RBAC — le seed est un défaut initial, pas l'état courant) :
- `expenses.thresholds.read` — CASHIER / MANAGER / ADMIN / SUPER_ADMIN
- `expenses.thresholds.write` — ADMIN / SUPER_ADMIN uniquement

## BO — surface map (vérifiée le 2026-08-31)

```
apps/backoffice/src/
  pages/
    expenses/          ExpensesListPage.tsx, ExpenseDetailPage.tsx, NewExpensePage.tsx
  features/
    expenses/
      components/      ApprovalTimeline.tsx, ApproveDialog.tsx, RejectDialog.tsx,
                       PayDialog.tsx, ExpenseForm.tsx, CategoryPicker.tsx,
                       ReceiptUploader.tsx, ExpenseCategoryHistory.tsx,
                       ExpenseConsequenceRail.tsx, ThresholdResolutionBadge.tsx,
                       ExpenseStatusBadge.tsx
      hooks/           useExpenseActions.ts (submit / approve / reject / pay),
                       useExpensesList.ts, useExpenseDetail.ts, useCreateExpense.ts,
                       useExpenseApprovals.ts, useApprovalForecast.ts
      __tests__/       ExpenseForm.smoke, approval-forecast, approval-timeline.smoke,
                       approve-dialog-sod.smoke, expense-consequence-rail.smoke,
                       expense-thresholds-page.smoke
    settings/
      expense-thresholds/
        ExpenseThresholdsPage.tsx
        ThresholdFormDialog.tsx
        hooks/         useExpenseThresholds.ts, useSetExpenseThreshold.ts,
                       useDeleteExpenseThreshold.ts
```

`ApproveDialog` collecte le PIN et miroite les deux blocs SOD côté UI, **y compris la
dérogation SUPER_ADMIN** (le bouton reste actif pour le propriétaire sur sa propre dépense).

## Audit checklist

### A. Intégrité SOD
- [ ] **Double guard actif** — `SELECT expense_id, approver_user_id, COUNT(*) FROM
      expense_approvals GROUP BY 1,2 HAVING COUNT(*) > 1` → doit être vide.
- [ ] **Creator never approver, hors SUPER_ADMIN** — `SELECT e.id FROM expenses e JOIN
      expense_approvals ea ON ea.expense_id = e.id JOIN user_profiles p ON p.id =
      ea.approver_user_id WHERE e.created_by = ea.approver_user_id AND p.role_code <>
      'SUPER_ADMIN'` → doit être vide. Les lignes SUPER_ADMIN restantes doivent chacune
      avoir un `audit_logs` `expense.self_approved` en regard : **une auto-approbation non
      tracée, elle, est un défaut.**
- [ ] **Step count cohérent** — `current_approval_step = COUNT(*) FROM expense_approvals
      WHERE expense_id = ?` pour toute expense non-auto_approved.

### B. Snapshot cohérence
- [ ] **Snapshot figé** — comparer `required_approval_steps_snapshot` avec la résolution
      actuelle depuis `expense_approval_thresholds` : divergence = changement de seuil
      post-submit (attendu, pas un bug).
- [ ] **NULL snapshot** uniquement sur rows antérieures au 2026-05-24 (`submitted_at <
      '2026-05-24'`) — NULL après cette date = `submit_expense` non appelée ou bug.
- [ ] **Auto_approved cohérent** — `auto_approved = true` →
      `jsonb_array_length(required_approval_steps_snapshot) = 0` et `status = 'approved'`.

### C. Routage comptable du paiement
- [ ] **Aucun trigger de synchro de caisse** — `SELECT tgname FROM pg_trigger WHERE tgrelid
      = 'expenses'::regclass AND NOT tgisinternal` ne doit **pas** contenir
      `trg_expenses_sync_cash`. Sa réapparition serait une régression.
- [ ] **Mapping cash** — `SELECT account_code FROM accounting_mappings WHERE mapping_key =
      'EXPENSE_CASH_OUT'` → `1111` (Petty Cash). Un retour à `1110` renverrait les dépenses
      sur la caisse du shift.
- [ ] **`cash_out_total` non pollué** — payer une dépense en espèces ne doit rien ajouter à
      `pos_sessions.cash_out_total` (couvert par le cas de test « shift-drawer sync
      removed »).
- [ ] **JE équilibrée sans ligne VAT** — pour une expense approuvée avec `vat_amount > 0` :
      exactement 2 `journal_entry_lines`, débit charge = `amount` (PPN inclus), crédit
      `EXPENSE_AP` ou `EXPENSE_CASH_OUT` = `amount`.

### D. Sécurité
- [ ] **REVOKE pair complet** — cas de test « anon REVOKEd » :
      `SELECT bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc
      WHERE proname IN ('submit_expense_v2', 'approve_expense_v3',
      'set_expense_threshold_v1', 'delete_expense_threshold_v1')` → true. **Mettre à jour
      cette liste à chaque bump** : elle épingle des noms versionnés.
- [ ] **Perm gates** — chaque RPC appelle `has_permission(v_caller_uid, 'expenses.<scope>')`
      avant toute opération.
- [ ] **PIN réellement vérifié** — `approve_expense` doit appeler
      `_verify_pin_with_lockout` (et non `verify_user_pin`, qui n'a pas de verrouillage).
      Un PIN collecté par l'UI mais non vérifié serveur est la régression exacte qui a été
      corrigée le 2026-06-01.
- [ ] **audit_logs** — chaque mutation produit un row avec
      `actor_id / action / entity_type / entity_id / metadata`. Actions vivantes :
      `expense.auto_approved`, `expense.submitted`, `expense.approved_step`,
      `expense.self_approved`, `expense_threshold.created`, `expense_threshold.updated`,
      `expense_threshold.deleted`.

## Checklists préventives

### Avant d'ajouter un step dans `expense_approval_thresholds.steps`
- [ ] `role_codes` contient des codes de rôles existants dans `roles` (ex. `MANAGER`,
      `ADMIN`, `SUPER_ADMIN`). Ne pas inventer un code.
- [ ] Le range `[amount_min, amount_max)` ne chevauche pas un existant dans la même
      catégorie → le cas de test « overlapping range » couvre l'overlap via
      `set_expense_threshold`.
- [ ] pgTAP coverage : happy path resolution + boundary inclusive.

### Avant de bumper `submit_expense`
- [ ] `DROP FUNCTION` de la version sortante avec sa signature exacte, dans la même
      migration.
- [ ] Call-site `useSubmitExpense` migré (grep du nom versionné sortant dans `apps/`).
- [ ] REVOKE pair sur la nouvelle version.
- [ ] Idempotency arg préservé (ne pas retirer `p_idempotency_key`).
- [ ] pgTAP : auto-approve + 1-step + 2-step + replay idempotent.

### Avant de bumper `approve_expense`
- [ ] **Partir du corps live** (`pg_get_functiondef`) : la version courante cumule le PIN
      serveur (2026-06-01), le verrouillage `_verify_pin_with_lockout` (2026-06-22) et la
      dérogation SUPER_ADMIN (2026-06-23) — trois passes posées *en place*, qu'une recopie
      depuis un vieux fichier de migration effacerait en silence.
- [ ] SOD bloc 1 (avec sa dérogation SUPER_ADMIN **et** son audit `expense.self_approved`)
      et SOD bloc 2 préservés.
- [ ] `p_manager_pin` conservé en **argument** et vérifié via `_verify_pin_with_lockout` —
      ne pas migrer vers un header.
- [ ] Call-site `useApproveExpense` migré, et la liste de noms du cas de test « anon
      REVOKEd » mise à jour.
- [ ] `DROP FUNCTION` de la version sortante avec sa signature exacte, dans la même
      migration.
- [ ] pgTAP : perm 42501 + creator block P0001 + UNIQUE already-approved P0001 + PIN faux
      P0003 + PIN NULL P0001 + final step → status=approved.

### Avant de toucher au routage comptable du paiement cash
- [ ] Vérifier d'abord ce qui existe : il n'y a **plus** de trigger sur `expenses` pour la
      caisse. Un besoin de suivi du cash sortant se traite sur le coffre Petty Cash, pas en
      ressuscitant la synchro de shift.
- [ ] Tout changement de `accounting_mappings.EXPENSE_CASH_OUT` est forward-only : les JE
      historiques ne se réécrivent pas.

## Sources de vérité (pointeurs)

```
Migrations — socle de la chaîne (2026-05-24)
  supabase/migrations/20260524111854_create_expense_approval_thresholds_table.sql
  supabase/migrations/20260524112621_create_expense_approvals_table.sql
  supabase/migrations/20260524113023_alter_expenses_add_approval_snapshot_columns.sql
  supabase/migrations/20260524113353_seed_expense_approval_thresholds_defaults.sql
  supabase/migrations/20260524114442_bump_submit_expense_v2_rpc.sql
  supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql
  supabase/migrations/20260524115713_revoke_anon_submit_expense_v2.sql
  supabase/migrations/20260524121337_create_set_expense_threshold_v1_rpc.sql
  supabase/migrations/20260524122002_revoke_anon_set_expense_threshold_v1.sql
  supabase/migrations/20260524122136_create_delete_expense_threshold_v1_rpc.sql
  supabase/migrations/20260524122427_revoke_anon_delete_expense_threshold_v1.sql
  supabase/migrations/20260524123026_seed_perms_expenses_thresholds.sql

Migrations — évolutions (LIRE EN PRIORITÉ, elles annulent des faits du socle)
  supabase/migrations/20260601181353_bump_approve_expense_v3_manager_pin.sql
      PIN en arg, vérifié serveur ; drop de la version précédente d'approve_expense.
  supabase/migrations/20260622000014_wire_pin_lockout_approve_expense_v3.sql
      substitution en place vers _verify_pin_with_lockout.
  supabase/migrations/20260706000019_expense_cash_out_to_petty_drop_shift_trigger.sql
      EXPENSE_CASH_OUT -> 1111 Petty Cash ; DROP du trigger et de sa fonction.
  supabase/migrations/20260706000023_allow_super_admin_self_approve_expense_v3.sql
      SOD bloc 1 relâché pour SUPER_ADMIN, tracé expense.self_approved.
  supabase/migrations/20260710000102_emit_expense_je_fold_vat_non_pkp.sql
      PPN foldé dans la charge, ligne EXPENSE_VAT_INPUT supprimée.

Tests (vérité comportementale)
  supabase/tests/expense_governance.test.sql    # T1-T20 au 2026-08-31 (pgTAP via MCP)
  supabase/tests/expenses.test.sql              # suite de base du socle dépenses

BO (surface UI)
  apps/backoffice/src/pages/expenses/
  apps/backoffice/src/features/expenses/
  apps/backoffice/src/features/settings/expense-thresholds/

Patterns canon
  CLAUDE.md §Critical patterns — idempotence 2 saveurs, REVOKE pair anon, RPC versioning
  ADR-003 (NON-PKP) — statut fiscal qui commande le traitement du PPN
```

## Verification before claiming a fix is complete

```bash
# Type-check (rapide, run first)
pnpm typecheck

# BO smoke tests
pnpm --filter @breakery/app-backoffice test expenses

# pgTAP (via MCP execute_sql, BEGIN/ROLLBACK envelope)
# Fichier : supabase/tests/expense_governance.test.sql
```

Baseline pré-existante : des échecs BO env-gated (`VITE_SUPABASE_URL Required`,
DEV-S25-2.A-02) existent hors de tout changement — relever leur nombre **avant** de toucher
au code et comparer, ne jamais raisonner sur un compte mémorisé.

## When to escalate

- Relax d'une contrainte SOD au-delà de la dérogation SUPER_ADMIN déjà décidée (UNIQUE
  `expense_approvals`, ou extension du bypass créateur à d'autres rôles) → flag
  systématique, brise l'invariant d'audit.
- Retour du PIN vers un header, ou remplacement de `_verify_pin_with_lockout` par une
  vérification sans verrouillage → régression de sécurité connue, refuser sans arbitrage.
- Besoin de suivre à nouveau les dépenses cash sur la caisse du shift → décision produit
  (renverse le routage vers le coffre du 2026-07-06), pas un correctif.
- Activation de la TVA déductible (si The Breakery devient PKP) → `_emit_expense_je` doit
  redevenir à 3 lignes, compte 1151 réactivé, nouvel ADR supersédant l'ADR-003 requis (un
  ADR ne se modifie jamais).
- Override admin d'une approval chain en cours (forcer un step, sauter un approbateur) →
  aucune implémentation existante ; c'est une décision produit avant d'être du code.
