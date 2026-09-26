---
name: expense-governance
description: >-
  Dépenses Breakery : soumission, seuils, approbation multi-étapes, séparation des tâches, PIN, paiement et routage comptable. Pour auditer ou modifier ce workflow ; accounting couvre les règles comptables générales.
---

# Expense Governance — The Breakery ERP

Suivre soumission → snapshot → approbations → paiement. Préserver les deux contrôles SOD, leur exception SUPER_ADMIN tracée et le PIN vérifié en argument RPC.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

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

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
