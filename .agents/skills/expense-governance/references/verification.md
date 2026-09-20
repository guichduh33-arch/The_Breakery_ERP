# expense-governance — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist
- Checklists préventives
- Sources de vérité (pointeurs)
- Verification before claiming a fix is complete
- When to escalate
- Checklists préventives
- Sources de vérité (pointeurs)
- Verification before claiming a fix is complete
- When to escalate

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
      WHERE pronamespace = 'public'::regnamespace AND proname ~ '^(submit_expense|approve_expense|set_expense_threshold|delete_expense_threshold)_v[0-9]+
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
  AGENTS.md §Critical patterns — idempotence 2 saveurs, REVOKE pair anon, RPC versioning
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
  aucune implémentation existante ; c'est une décision produit avant d'être du code.` → true. Vérifier aussi que chaque famille attendue est présente : zéro ligne n’est pas une preuve de protection.
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
  AGENTS.md §Critical patterns — idempotence 2 saveurs, REVOKE pair anon, RPC versioning
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
