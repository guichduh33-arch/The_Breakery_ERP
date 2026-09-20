# expense-governance — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Mental model — snapshot-at-submit
- RPCs de la chaîne (familles)
- BO — surface map (vérifiée le 2026-08-31)

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
