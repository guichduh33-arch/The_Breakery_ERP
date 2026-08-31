# Audit expense-governance — 2026-08-31

## Synthèse

Périmètre réellement couvert : les 4 volets du protocole de la skill (A intégrité SOD,
B cohérence de snapshot, C routage comptable du paiement, D sécurité), sur les **corps
live** des 8 fonctions du périmètre dépenses (`create/submit/approve/reject/pay`,
`set/delete_expense_threshold`, `_emit_expense_je`), sur les contraintes, triggers,
policies RLS et grants de `expenses`/`expense_approvals`/`expense_approval_thresholds`,
sur les données de la base dev V3, et sur la surface BO (hooks + dialogues + éditeur de
seuils). Tout a été exécuté en `BEGIN; … ROLLBACK;` sur `ikcyvlovptebroadgtvd`.

Verdict : **les invariants que la skill met en avant tiennent tous** — pas de doublon
d'approbateur, pas de créateur-approbateur hors SUPER_ADMIN, compteur de step cohérent,
aucun snapshot NULL, trigger de caisse bien mort, `EXPENSE_CASH_OUT` → 1111 Petty Cash,
JE à 2 lignes équilibrées sans ligne VAT, anon révoqué sur les 4 RPC versionnées, PIN
vérifié par `_verify_pin_with_lockout`. **Ce sont les deux invariants que la skill ne
vérifie pas qui sont cassés.**

LE P0 : **tout le module dépenses est mort pour les comptes créés par le back-office.**
Les 8 RPC écrivent `audit_logs.actor_id` (et `journal_entries.created_by`) avec
`auth.uid()` alors que les deux colonnes portent une FK vers `user_profiles(id)`. Preuve
live, SQLSTATE 23503 sur `audit_logs_actor_id_fkey`. Second P0 dans le même souffle : la
policy RLS `expenses_update_owner_or_manager` laisse tout porteur de `expenses.manage`
(donc un MANAGER) faire passer n'importe quelle dépense en `approved` par un simple PATCH
PostgREST — sans ligne d'approbation, sans PIN, sans SOD, sans JE — et réécrire le
snapshot figé. Prouvé, puis annulé.

Compte : **P0 : 3 · P1 : 2 · P2 : 6 · P3 : 4** (15 findings ; les P0 1 et 2 partagent une
racine unique — `auth.uid()` là où une FK attend un `user_profiles.id` — mais frappent deux
contraintes distinctes, donc deux correctifs distincts).

## Findings

| # | Sév. | Zone | Constat (fichier:ligne + ancre stable) | Preuve (SQL/grep exécuté) | Correctif proposé |
|---|------|------|----------------------------------------|---------------------------|-------------------|
| 1 | **P0** | D — traçabilité / disponibilité | `actor_id` reçoit `auth.uid()` et non `user_profiles.id` dans **les 8 RPC** du périmètre. Ancres : `supabase/migrations/20260706000023_allow_super_admin_self_approve_expense_v3.sql:147` et `:164` (fonction `approve_expense_v3`, variable `v_caller_uid`) ; `supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql:213` et `:234` (`submit_expense_v2`) ; `supabase/migrations/20260517000122_create_expense_rpcs.sql:90` (`create_expense_v1`), `:357` (`pay_expense_v1`), `:422` (`reject_expense_v1`) ; `supabase/migrations/20260524121337_create_set_expense_threshold_v1_rpc.sql:99` (`set_expense_threshold_v1`) ; `supabase/migrations/20260524122136_create_delete_expense_threshold_v1_rpc.sql:40` (`delete_expense_threshold_v1`). Or la contrainte `audit_logs_actor_id_fkey` est `FOREIGN KEY (actor_id) REFERENCES user_profiles(id)`. Chaque RPC résout pourtant déjà `v_caller_profile` juste au-dessus. | `pg_get_constraintdef` → `audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES user_profiles(id)`. Appel réel de `create_expense_v1` sous `request.jwt.claims.sub = '33c265ce-…'` (profil `Riyanti`, ADMIN, `id = e1de5dc6-… <> auth_user_id`), capture de l'exception → **`sqlstate 23503 : insert or update on table "audit_logs" violates foreign key constraint "audit_logs_actor_id_fkey"`**, 0 dépense créée. Sur dev : 6 profils ont `id = auth_user_id` (legacy seed), **1 ne l'a pas** — et il échoue. | Remplacer `v_caller_uid` par `v_caller_profile` dans les 8 `INSERT INTO audit_logs`, en bumpant chaque RPC selon la règle de versioning monotone (`_vN+1` + `DROP` de la sortante dans la même migration). Ajouter au pgTAP une fixture dont `id <> auth_user_id` (cf. finding 10). |
| 2 | **P0** | D + A — contournement complet de la chaîne | Même racine, seconde contrainte : `_emit_expense_je` et `pay_expense_v1` écrivent `journal_entries.created_by = v_caller_uid`. Ancres : `supabase/migrations/20260710000102_emit_expense_je_fold_vat_non_pkp.sql:70` (fonction `_emit_expense_je`) et `supabase/migrations/20260517000122_create_expense_rpcs.sql:327` (`pay_expense_v1`, bloc `INSERT INTO journal_entries`). Contrainte `journal_entries_created_by_fkey → user_profiles(id)`. Même corrigé le finding 1, le money-path resterait mort. | `INSERT INTO journal_entries (…, created_by) VALUES (…, '33c265ce-…')` en transaction annulée → **`sqlstate 23503 : … violates foreign key constraint "journal_entries_created_by_fkey"`**. | Idem : `v_caller_profile` (déjà résolu dans `pay_expense_v1`) ; dans `_emit_expense_je`, résoudre le profil au lieu de propager `auth.uid()`. |
| 3 | **P0** | A + B — SOD contournable par l'API | `supabase/migrations/20260517000120_init_expenses.sql:179`, policy **`expenses_update_owner_or_manager`** : `USING (has_permission(auth.uid(), 'expenses.manage') OR (status='draft' AND created_by = …))`, `WITH CHECK` identique. Aucune restriction de colonne, aucune contrainte de transition d'état. La table porte `GRANT UPDATE TO authenticated`. Le commentaire de la migration l'assume : « Manager+ can update anything ». Cette policy date du 2026-05-17, **une semaine avant** la chaîne d'approbation (2026-05-24) et n'a jamais été resserrée. Conséquence : un MANAGER (qui détient `expenses.manage`) peut, par un PATCH PostgREST direct, poser `status='approved'` sans aucune ligne `expense_approvals`, sans PIN, sans SOD, sans JE ; réécrire `required_approval_steps_snapshot` **rétroactivement** (le défaut que la skill nomme explicitement) ; et modifier `amount` sur une dépense déjà `paid`, désynchronisant la JE postée. | Sous `SET LOCAL ROLE authenticated` + `request.jwt.claims.sub = '00000000-…-0004'` (Manager Demo, MANAGER) : `UPDATE public.expenses SET required_approval_steps_snapshot='[]', amount=999999999, status='approved'` → **1 ligne retournée** (`status=approved`, `amount=999999999.00`, `snap=[]`). Contrôle négatif avec le CASHIER `…-0002` → **0 ligne**. `role_permissions` : `expenses.manage` = ADMIN, MANAGER, SUPER_ADMIN. Le tout annulé. | Restreindre la policy UPDATE aux transitions légitimes : l'autoriser uniquement sur `status='draft'` pour le créateur, et laisser toute autre mutation aux RPC `SECURITY DEFINER`. À défaut, `REVOKE UPDATE ON expenses FROM authenticated` et passer les éditions de brouillon par une RPC (le BO ne fait déjà que des SELECT sur la table — voir `useExpenseDetail.ts:13`, `useExpensesList.ts:31`). Décision produit : à arbitrer par Mamat, c'est un changement de comportement. |
| 4 | **P1** | C — routage comptable du paiement | `supabase/migrations/20260517000122_create_expense_rpcs.sql:322`, fonction `pay_expense_v1` : le compte de crédit est **toujours** `resolve_mapping_account('EXPENSE_CASH_OUT')`, quel que soit `p_payment_method`. Or `apps/backoffice/src/features/expenses/components/PayDialog.tsx:50-52` propose explicitement `Cash` / `Bank transfer` / `Card`, et `apps/backoffice/src/features/expenses/hooks/useExpenseActions.ts:108` transmet le choix. Depuis le remap du 2026-07-06, `EXPENSE_CASH_OUT` = **1111 Petty Cash**. Un règlement par virement bancaire vide donc la petite caisse dans les livres ; le compte `1112 Bank - Operating` (actif) n'est jamais touché. Même défaut dans `_emit_expense_je` pour une dépense directement `transfer`/`card` (branche `ELSE` du test `payment_method = 'credit'`). | Sur les JE `reference_type='expense_payment'` de la base dev : **12 lignes, 6 600 000 IDR, `payment_method='transfer'`, créditées sur `1111 Petty Cash`** (débit `2141 Accounts Payable`). Aucune écriture sur `1112`. `SELECT payment_method, count(*), sum(amount) FROM expenses` → cash 12 / 10 200 000 ; transfer 12 / 6 600 000. | Introduire des clés de mapping par moyen de règlement (`EXPENSE_BANK_OUT`, `EXPENSE_CARD_OUT`) et router sur `p_payment_method` dans un `pay_expense_v2`. Forward-only : les JE historiques ne se réécrivent pas (règle de la skill). Impact comptable existant à signaler au comptable. |
| 5 | **P1** | A — chaîne configurable jusqu'à l'impasse | `apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx:24`, constante **`ROLE_OPTIONS = ['CASHIER','MANAGER','ADMIN','SUPER_ADMIN']`** : la liste est en dur ET elle offre **CASHIER**, qui ne détient pas `expenses.approve`. Un palier configuré avec `role_codes:['CASHIER']` produit une étape que **personne** ne peut satisfaire : `approve_expense_v3` exige d'abord `has_permission('expenses.approve')` (42501 pour un caissier), et tout autre rôle échoue sur le test `role_codes` (P0003). `set_expense_threshold_v1` ne valide que la *forme* des steps (`supabase/migrations/20260524121337_create_set_expense_threshold_v1_rpc.sql`, bloc « 4. Validate each step shape ») — jamais l'existence du rôle ni sa capacité à approuver. Aucun override admin n'existe (la skill le dit : « aucune implémentation existante »). Toutes les dépenses de la tranche gèlent en `submitted` ; la seule sortie est `reject_expense_v1`, et une dépense `rejected` **ne peut pas être re-soumise** (`submit_expense_v2` exige `status='draft'`) : il faut la recréer. | `SELECT code, string_agg(role_code…) FROM permissions … WHERE code LIKE 'expenses%'` → `expenses.approve` = ADMIN, MANAGER, SUPER_ADMIN (**pas CASHIER**). `SELECT code FROM roles` → ADMIN, CASHIER, MANAGER, SUPER_ADMIN, waiter. Corps live de `approve_expense_v3` : gate `expenses.approve` **puis** test `v_caller_role = ANY(v_required_roles)`. Corps live de `reject_expense_v1` : `IF v_row.status <> 'submitted' THEN RAISE` — seule échappatoire. | Alimenter les options depuis la table `roles` filtrée par `role_permissions` sur `expenses.approve`, et ajouter la même validation serveur dans `set_expense_threshold_v1` (un step dont aucun `role_code` ne détient `expenses.approve` est refusé, 22023). |
| 6 | P2 | Idempotence | `expenses.idempotency_key` est une **colonne UNIQUE unique** (`expenses_idempotency_key_key`) partagée par deux familles : `create_expense_v1` y écrit sa clé, puis `submit_expense_v2` l'**écrase** — `idempotency_key = COALESCE(p_idempotency_key, idempotency_key)`, la clé de submit gagne (`supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql`, blocs `UPDATE expenses SET … idempotency_key = COALESCE(...)`). La protection de rejeu du `create` disparaît donc dès la soumission. De plus la lecture de rejeu de submit (`SELECT * INTO v_replay FROM expenses WHERE idempotency_key = p_idempotency_key`) n'est **pas bornée à `p_expense_id`** : une clé recyclée renverrait l'état d'une autre dépense en `idempotent_replay: true`. | Corps live des deux fonctions (`pg_get_functiondef`) ; `pg_get_constraintdef` → `expenses_idempotency_key_key UNIQUE (idempotency_key)`. Côté client les clés sont des `crypto.randomUUID()` frais (`useExpenseActions.ts:23`, rotation correcte en `ExpenseDetailPage.tsx:125`), ce qui rend la collision improbable — c'est la conception qui est fragile, pas l'exploitation qui est facile. | Séparer les deux clés (`create_idempotency_key` / `submit_idempotency_key`), ou au minimum borner la lecture de rejeu de submit à `id = p_expense_id`. |
| 7 | P2 | Traçabilité | `supabase/migrations/20260517000122_create_expense_rpcs.sql:376`, fonction `reject_expense_v1` : un **rejet** écrit `approved_by = v_caller_profile`. La table a bien `rejected_reason` et `rejected_at`, mais **pas de `rejected_by`** : la colonne « qui a approuvé » désigne donc, sur une dépense rejetée, celui qui a refusé. | Corps live de `reject_expense_v1` (`UPDATE expenses SET status='rejected', rejected_reason=…, approved_by = v_caller_profile, rejected_at = now()`). `grep -rn "approved_by" apps/backoffice/src` → la colonne n'est pas rendue dans l'UI (dégât confiné à la DB et aux lecteurs SQL, dont `_trg_notify_expense_approved` qui lit `NEW.approved_by`). | Ajouter `rejected_by` et cesser de polluer `approved_by` (bump `reject_expense_v2`). |
| 8 | P2 | D — durcissement SECURITY DEFINER | Trois fonctions `SECURITY DEFINER` du périmètre ont `search_path = public` **sans `pg_temp`** : `create_expense_v1`, `pay_expense_v1`, `reject_expense_v1`. Les cinq autres (`submit_expense_v2`, `approve_expense_v3`, `set_/delete_expense_threshold_v1`, `_emit_expense_je`) ont bien `public, pg_temp`. Ancre : `supabase/migrations/20260517000122_create_expense_rpcs.sql`, clause `SET search_path` de chacune des trois. | `SELECT proname, array_to_string(proconfig,' | ') FROM pg_proc …` → `create_expense_v1 : search_path=public` · `pay_expense_v1 : search_path=public` · `reject_expense_v1 : search_path=public` · les 5 autres : `search_path=public, pg_temp`. | Aligner les trois retardataires sur `SET search_path TO 'public', 'pg_temp'` au prochain bump. |
| 9 | P2 | D — grants | `expense_approvals` a bien été durci (`authenticated` n'a que `SELECT, REFERENCES, TRIGGER`), mais **`expense_approval_thresholds` conserve `TRUNCATE` pour `authenticated`** — et `TRUNCATE` ignore la RLS. Un porteur de session BO quelconque peut donc vider la table des seuils ; toute soumission lève alors `no threshold matches` (déni de service sur la chaîne). | `information_schema.role_table_grants` : `expense_approval_thresholds → REFERENCES,SELECT,TRIGGER,TRUNCATE` vs `expense_approvals → REFERENCES,SELECT,TRIGGER`. **Contexte** : 71 tables sur 94 portent ce `TRUNCATE` (défaut Supabase `GRANT ALL`) — c'est donc systémique, pas propre aux dépenses ; ce qui est propre aux dépenses, c'est que le durcissement de `expense_approvals` a oublié sa table sœur. | `REVOKE TRUNCATE ON expense_approval_thresholds FROM authenticated, anon` (et, hors mandat, poser la question du chantier systémique à Mamat). |
| 10 | P2 | Couverture de test | `supabase/tests/expense_governance.test.sql:41-44` : la fixture inline `Admin2 Gov28` pose `id` **et** `auth_user_id` à la même valeur `bbbbbbbb-0000-…-0001` ; les autres acteurs sont les profils seedés `00000000-…-000X`, tous avec `id = auth_user_id`. **La suite T1-T20 ne peut donc structurellement pas voir les findings 1 et 2** — ce n'est pas une assertion manquante, c'est un angle mort de fixture. C'est la raison pour laquelle le P0 a survécu. | Lecture du fichier ; `SELECT id, auth_user_id FROM user_profiles` sur dev confirme que les 6 profils seedés ont `id = auth_user_id`. Les 2 lignes `expense.self_approved` de la base portent `actor_id = 00000000-…-0001`, qui *est* un `user_profiles.id` — d'où l'absence d'erreur historique. | Ajouter une fixture `id <> auth_user_id` et un test « une dépense créée par un compte back-office aboutit », qui échouerait aujourd'hui. |
| 11 | P2 | Documentation dans le code | Trois commentaires affirment que le PIN est vérifié par **`verify_user_pin`** alors que le corps live appelle `_verify_pin_with_lockout` depuis le 2026-06-22 : `apps/backoffice/src/features/expenses/hooks/useExpenseActions.ts:5` et `:61`, `apps/backoffice/src/features/expenses/components/ApproveDialog.tsx:3`, `supabase/tests/expense_governance.test.sql:47`. La skill fait justement de cette distinction un point de contrôle (« et non `verify_user_pin`, qui n'a pas de verrouillage »). | Corps live d'`approve_expense_v3` : `IF NOT public._verify_pin_with_lockout(v_caller_profile, p_manager_pin) THEN … P0003`. | Corriger les 4 commentaires (aucun changement de comportement). |
| 12 | P3 | RBAC | La permission `expenses.delete` est seedée (`supabase/migrations/20260517000030_refactor_has_permission.sql:153`) et accordée à ADMIN + SUPER_ADMIN, mais **aucun code ne la consomme** : aucune RPC de suppression, aucune policy DELETE sur `expenses`, aucune occurrence dans `apps/`. Depuis ADR-031 la matrice est éditable, donc elle affiche une capacité qui n'existe pas. | `grep -rn "expenses.delete" apps/ supabase/` → une seule occurrence, le seed. `pg_policies` sur `expenses` → aucune policy `DELETE`. | Retirer la permission, ou implémenter la suppression logique qu'elle promet. Arbitrage produit. |
| 13 | P3 | UX de l'approbation | `apps/backoffice/src/features/expenses/components/ApproveDialog.tsx:45-52` : le miroir SOD couvre bien le blocage créateur (avec sa dérogation SUPER_ADMIN) et la double approbation, mais **pas le gate de rôle du step courant**. Un ADMIN devant un step `role_codes:['MANAGER']` voit un bouton « Approve » actif, saisit son PIN, et récolte le message brut `approve_expense_v3: missing_role — step 1 requires one of {MANAGER}`. | Lecture du composant ; corps live d'`approve_expense_v3` (`RAISE … missing_role … USING ERRCODE = 'P0003'`). | Désactiver le bouton quand `currentUserRole` n'est pas dans les `role_codes` du step courant, avec le même `title` explicatif que les deux autres blocages. |
| 14 | P3 | Robustesse | `create_expense_v1`, `pay_expense_v1` et `reject_expense_v1` résolvent `v_caller_profile` **sans le garder** (`SELECT id INTO v_caller_profile …` puis usage direct), là où `submit_expense_v2` et `approve_expense_v3` lèvent `28000` si le profil est introuvable. Sur un compte sans profil, `created_by` / `paid_by` / `approved_by` partiraient à NULL. En pratique la FK de `audit_logs` masque le cas — mais elle le masque par un 23503 illisible (finding 1). | Corps live des cinq fonctions, comparaison des blocs de résolution de profil. | Ajouter le garde `IF v_caller_profile IS NULL THEN RAISE … 28000` aux trois. |
| 15 | P3 | a11y | Les trois messages d'erreur du périmètre sont rendus sans `role="alert"` : `ApproveDialog.tsx:104`, `PayDialog.tsx:56`, `ThresholdFormDialog.tsx:224` — alors que le motif dominant du BO l'inclut (ex. `AdjustB2bBalanceModal.tsx:92`, `CreateB2bOrderModal.tsx:227`). Un échec de PIN n'est donc pas annoncé. | `grep -rn "text-red" apps/backoffice/src` : 3 occurrences du périmètre sans `role="alert"`, plusieurs voisines avec. | Ajouter `role="alert"`. Relève de la campagne `/impeccable`, signalé ici parce que le message masqué est celui d'un refus d'authentification. |

## Dérives de la skill

1. **La skill ne porte pas la règle `actor_id`.** Sa checklist D dit : « chaque mutation
   produit un row avec `actor_id / action / entity_type / entity_id / metadata` ». Un
   auditeur qui suit la fiche à la lettre coche la case : les rows existent bel et bien.
   C'est `CLAUDE.md` (§ Audit-trail) qui porte le fait décisif — « `actor_id` attend un
   `user_profiles.id`, JAMAIS `auth.uid()` ». **La skill devrait rendre ce test explicite
   pour son périmètre** : c'est le P0 qu'elle a laissé passer.

2. **La liste des « actions vivantes » est incomplète.** La skill en énumère sept :
   `expense.auto_approved`, `expense.submitted`, `expense.approved_step`,
   `expense.self_approved`, `expense_threshold.created/updated/deleted`. Le code en émet
   **trois de plus** — `expense.create` (`create_expense_v1`), `expense.reject`
   (`reject_expense_v1`), `expense.pay` (`pay_expense_v1`) — et les trois sont présentes
   dans `audit_logs` sur dev (`SELECT DISTINCT action … WHERE action LIKE 'expense%'` →
   `expense.approved_step, expense.auto_approved, expense.create, expense.pay,
   expense.self_approved, expense.submitted`).

3. **Le schéma mental place la sortie de caisse au mauvais moment.** L'ASCII de la fiche
   annonce, sous `PAY` : « le cash sort du coffre 1111 (`EXPENSE_CASH_OUT`) ». C'est vrai
   **uniquement pour le chemin `credit`**. Pour une dépense `cash`, `transfer` ou `card`,
   le crédit sur 1111 est posé par `_emit_expense_je` **à l'approbation**, et `pay_expense_v1`
   se contente alors de basculer `status='paid'` sans aucune JE (branche `ELSE` du corps
   live). Vérifié sur les données : les 12 dépenses `cash` n'ont **qu'une** JE
   (`reference_type='expense'`), les 12 `transfer` en ont deux.

4. **La fiche ne recense qu'un trigger, et il est mort.** `expenses` en porte deux vivants :
   `trg_expenses_set_updated_at` et surtout **`trg_notify_expense_approved`** (fonction
   `_trg_notify_expense_approved`, migration `20260716000170_notification_triggers.sql`,
   AFTER UPDATE OF status WHEN new.status='approved'), absent de la fiche alors qu'il
   s'exécute dans la transaction d'approbation. Il avale toutes ses erreurs
   (`EXCEPTION WHEN OTHERS THEN RAISE WARNING`), donc il n'aggrave rien — mais il fait
   partie de la surface.

5. **`create_expense_v1` n'apparaît nulle part.** La fiche cite `reject_expense` et
   `pay_expense` comme « familles adjacentes », mais omet l'entrée même de la chaîne, qui
   est pourtant une RPC gatée, auditée, et idempotente sur la **même colonne** que
   `submit_expense_v2` (finding 6).

6. **La checklist D s'arrête aux `REVOKE` sur les fonctions.** Elle ne regarde ni les
   grants de table ni les policies RLS de `expenses` — c'est exactement l'angle par lequel
   la SOD qu'elle passe trois paragraphes à décrire se contourne (finding 3). Une
   checklist « intégrité SOD » qui ne vérifie pas que la table est fermée en écriture
   directe donne une garantie qu'elle n'a pas.

## Faux positifs écartés

- **PIN en argument `p_manager_pin`** — correct, arbitrage du 2026-08-31 (header = Edge
  Function, argument = RPC). Le seul test valable a été passé : `approve_expense_v3`
  appelle bien `_verify_pin_with_lockout` et non `verify_user_pin`.
- **Absence de `trg_expenses_sync_cash`** — attendue (droppé le 2026-07-06). Vérifié :
  `pg_trigger` sur `expenses` ne contient que `set_updated_at` et `notify_expense_approved`.
- **JE de dépense à 2 lignes sans ligne VAT** — comportement attendu (PPN foldé, ADR-003).
  Vérifié exhaustivement : `HAVING count(lines) <> 2 OR sum(debit) <> sum(credit) OR
  bool_or(code='1151')` sur toutes les JE `expense`/`expense_payment` → **0 anomalie**.
  Le compte 1151 est bien `is_active = false`.
- **Auto-approbation SUPER_ADMIN** — politique, pas fraude. Les 2 seules occurrences de
  dev (`expense.self_approved`, 2026-06-23 et 2026-08-04) sont **tracées**, c'est le cas
  conforme. Leur dépense n'existe plus (reliquats de test, `expense_approvals` emporté par
  le `ON DELETE CASCADE`) : ce n'est pas une SOD trouée, c'est un audit_log qui survit à
  son entité, ce qui est le comportement voulu d'un journal.
- **`approve_expense` sans idempotence** — par conception.
- **Divergence snapshot / seuils courants** — attendue. Aucune mutation rétroactive
  constatée dans les données ; le vecteur de mutation existe (finding 3) mais n'a pas servi.
- **`text-red` (ApproveDialog.tsx:104)** — j'ai failli le signaler comme classe morte au
  titre de la garde `tailwind-dead-classes`. C'est un **vrai token** :
  `packages/ui/tailwind-preset.ts:84` déclare la famille `red`. Aucune alpha n'y est
  appliquée. Rien à signaler.
- **`resetIdempotency` jamais appelé** — j'ai failli le signaler : le commentaire du hook
  (`useExpenseActions.ts:22`) en fait une obligation d'appelant. Il **est** appelé, à
  `ExpenseDetailPage.tsx:125`, immédiatement après le `mutateAsync`. Conforme.
- **`expenses_cash_total` du Z-report** — `_build_zreport_snapshot` agrège encore les
  dépenses cash payées dans la fenêtre du shift, ce qui pouvait ressembler à une survivance
  du couplage caisse-dépense enterré le 2026-07-06. Vérifié : la valeur n'est qu'une ligne
  d'affichage du snapshot ; la réconciliation lit `v_session.expected_cash`, pas
  `v_expenses_cash`. Aucun double compte, `pos_sessions.cash_out_total` n'est écrit par
  aucune fonction du périmètre.
- **`TRUNCATE` accordé à `authenticated`** — réel, mais systémique (71 tables sur 94, défaut
  Supabase). Rapporté en P2 (finding 9) sur le seul écart *propre au périmètre* : la table
  sœur `expense_approvals` a été durcie, pas `expense_approval_thresholds`.
- **`ALTER DEFAULT PRIVILEGES` sur les fonctions** — `pg_default_acl` montre deux entrées
  pour `public` : celle du rôle `postgres` **exclut bien `anon`** (c'est la paire du projet),
  celle héritée de `supabase_admin` l'inclut encore. Les migrations MCP s'exécutent en
  `postgres`, donc les fonctions neuves naissent fermées à anon. Vérifié sur les 4 RPC
  versionnées : `has_function_privilege('anon', …, 'EXECUTE')` = **false** partout, `public`
  = false, comme sur `_emit_expense_je` (également révoqué à `authenticated`).

## Ce que je n'ai pas pu vérifier

- **La production.** Interdite par le mandat et de lignée de migrations incompatible (V2
  monolith `abjabuniwkqpfsenxljp`). Les findings 1 et 2 sont donc démontrés sur dev, où
  **un seul** profil a `id <> auth_user_id` ; l'ampleur réelle dépend du nombre de comptes
  créés depuis le back-office en prod, que je n'ai pas relevé. Si ce nombre est non nul, le
  module dépenses y est cassé pour ces comptes.
- **L'exécution du pgTAP `expense_governance.test.sql` (T1-T20).** Mandat lecture seule et
  aucun finding ne l'exigeait ; les 20 assertions ont été lues statiquement, pas rejouées.
  Le finding 10 porte sur les fixtures, qui se lisent — pas sur un résultat d'exécution.
- **La suite Vitest du back-office.** Non lancée : aucun finding ne repose sur un test JS,
  et la consigne demande de ne pas lancer la suite complète. Je n'ai donc pas de baseline
  d'échecs env-gated à opposer.
- **L'exploitabilité réelle du finding 3 depuis un client authentifié via PostgREST.** Je
  l'ai prouvé au niveau SQL (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), ce qui
  reproduit exactement le contexte d'exécution de PostgREST, mais je n'ai pas émis de
  requête HTTP réelle contre l'API.
- **Le rendu à l'écran** des findings 13 et 15 : aucune session navigateur ouverte, le
  constat est fait sur le code.
