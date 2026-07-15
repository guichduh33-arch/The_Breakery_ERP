# Travail — Users & RBAC

> Last updated: 2026-05-03
> Référence : [`../../reference/04-modules/01-auth-permissions.md`](../../reference/04-modules/01-auth-permissions.md) (auth flow), table `roles` / `user_roles` / `permissions`
> Sources audit : `docs/audit/01-architecture-security-audit.md` §P1-01 / P2-03 / P2-06, `docs/audit/04-reports-testing-audit.md` §P1-2, `docs/audit/07-product-backlog-audit.md` §10 (T6 2FA), `CLAUDE.md` (Permission Codes)

## Objectifs du module

1. Faciliter la gestion RBAC pour le manager non-tech : matrice rôles/permissions visuelle (vs. JSON brut) — cible : 1 UI par laquelle on coche/décoche permissions sans toucher SQL.
2. Tracer toute action sensible utilisateur (création, suppression, changement de rôle, reset PIN) — cible : 100 % des opérations user passent par audit_logs avec actor + target.
3. Onboarder massivement (bulk import 20 employés à l'ouverture saison) — cible : 1 CSV importable produit N user_profiles + roles assignés.
4. Hardenisation auth : 2FA admin (P3), SSO Google (P3 future), revocation immédiate de session sur changement de rôle.
5. Nettoyer les comptes inactifs : politique RGPD-friendly + recyclage des PIN — cible : alerte automatique sur user inactif > 90 jours.

---

## Tâches

### TASK-20-001 — UI matrice rôles/permissions [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.D. V3 evidence: `apps/backoffice/src/features/users/components/PermissionMatrix.tsx` + `hooks/usePermissionMatrix.ts` render a roles × permissions × role_permissions grid grouped by module (D-W5-5D-05). `has_permission()` lookup-only refactor came from Phase 1.B (`20260517000030_refactor_has_permission.sql`). Commit `bdf21aa`.
**Contexte** : `CLAUDE.md` liste 30+ permission codes (`sales.view`, `inventory.adjust`, `accounting.journal.create`, etc.). Manager actuellement doit demander à un dev d'éditer `role_permissions` via SQL. Le RPC `update_role_permissions(role_id, permission_ids[])` existe déjà mais sans UI dédiée fluide.
**Critère d'acceptation** :
- [ ] Page `/users/roles` : matrice (rôles en colonnes, permissions en lignes, cases à cocher)
- [ ] Permissions groupées par module (Sales, Inventory, Products, Customers, Reports, Accounting, Admin)
- [ ] Sauvegarde via `update_role_permissions` RPC (atomique)
- [ ] Diff visuel : permissions ajoutées/retirées surlignées avant Save
- [ ] Confirmation modale obligatoire pour rôles `super_admin`, `admin`
**Fichiers concernés** : `src/pages/users/RolesMatrixPage.tsx` (nouveau), `src/hooks/users/useRolesMatrix.ts`, route à enregistrer dans `src/routes/adminRoutes.tsx`
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : retirer une permission au rôle de l'utilisateur courant peut le verrouiller — bloquer auto-modif
**Notes** : UI inspirée des matrices RBAC GitHub Org / Notion teams

### TASK-20-002 — Audit log actions user (CRUD + assign role) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.D. V3 evidence: migration `20260517000200_create_user_rpcs.sql` defines `create_user_v1`, `update_user_role_v1`, `delete_user_v1`, `update_user_profile_v1`, `reset_user_pin_v1` — every one `INSERT INTO audit_logs` (lines 155, 248, 336, 417, 480). Actor resolution uses `user_profiles.id` (D-W5-5D-04). Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` mentionne audit logs sur login/logout/PIN change. `auth-user-management` Edge Function fait permission check mais ne loggue pas explicitement les CRUD (vérifier). `CLAUDE.md` Pitfalls mentionne audit_logs comme table existante.
**Critère d'acceptation** :
- [ ] Edge Function `auth-user-management` (et `create-admin-user`) loggue : `user.created`, `user.deleted`, `user.role_assigned`, `user.role_removed`, `user.pin_reset` avec actor + target
- [ ] Trigger Postgres sur `user_roles` insert/delete pour redondance (defense-in-depth si bypass Edge Function)
- [ ] Page `/users/activity-journal` ou réutiliser `/reports/audit` filtré par `action LIKE 'user.%'`
- [ ] IP + user-agent capturés
**Fichiers concernés** : `supabase/functions/auth-user-management/index.ts`, `supabase/functions/create-admin-user/index.ts`, `supabase/migrations/<date>_audit_user_role_changes.sql`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : doublon entre log Edge Function et log trigger DB → utiliser `metadata.source` pour dédup en lecture
**Notes** : aligner avec TASK-19-005 (audit settings)

### TASK-20-003 — Bulk user import CSV [P2] [TODO]
**Status note (2026-05-14)** : Phase 5.D shipped per-user CRUD only (`UserFormDialog.tsx`, `UsersTable.tsx`) — no `BulkImportPage` route, no `bulk-create-users` EF. Genuinely undone.
**Contexte** : `docs/audit/07-product-backlog-audit.md` ne le liste pas explicitement mais use case réel : ouverture/fermeture saisonnière → 15-20 users à créer/désactiver d'un coup. Aujourd'hui création manuelle dans `/users/new`.
**Critère d'acceptation** :
- [ ] Page `/users/import` : drag-drop CSV (colonnes : email, display_name, role_slug, pin?)
- [ ] Validation côté client : email format, role_slug existe, PIN 4-6 chiffres si fourni (sinon généré aléatoirement)
- [ ] Preview "10 users will be created, 2 errors" avec détail
- [ ] Apply via Edge Function batch `bulk-create-users` (transactionnel : tout ou rien)
- [ ] PIN générés affichés une seule fois (à imprimer/distribuer) — pas re-récupérables ensuite
- [ ] Audit log un row par user créé
**Fichiers concernés** : `src/pages/users/BulkImportPage.tsx`, `supabase/functions/bulk-create-users/index.ts`, `src/services/users/csvImport.ts`
**Dépend de** : TASK-20-002 (audit en place)
**Estimation** : `L`
**Risques** : transaction sur 20+ insertions auth.users + user_profiles + user_roles → vérifier limite Supabase Edge timeout (2s par défaut, 150s max)
**Notes** : sample CSV téléchargeable depuis la page

### TASK-20-004 — Role templates (preset roles métier) [P2] [TODO]
**Status note (2026-05-14)** : Phase 5.D shipped the PermissionMatrix viewer but no "Duplicate role" affordance or `is_system` column. The 5 seed roles (SUPER_ADMIN, ADMIN, MANAGER, CASHIER, KITCHEN) live in DB but custom-role creation flow is undone.
**Contexte** : Aujourd'hui rôles seedés statiquement via migrations. Manager ne peut pas dupliquer un rôle "Caissier confirmé" pour créer "Caissier confirmé soir" sans recopier 15 permissions.
**Critère d'acceptation** :
- [ ] Bouton "Duplicate role" dans `/users/roles` qui copie un rôle existant
- [ ] Templates système non-supprimables : `cashier`, `cashier_senior`, `manager`, `kitchen`, `accountant`, `admin`, `super_admin`
- [ ] Création ad hoc autorisée pour rôles custom (`is_system = false`)
- [ ] Page liste rôles indique badge "System" / "Custom"
**Fichiers concernés** : migration ajoutant colonne `is_system BOOLEAN DEFAULT false` à `roles`, `src/pages/users/RolesPage.tsx`, hook `useDuplicateRole`
**Dépend de** : TASK-20-001
**Estimation** : `M`
**Risques** : templates seedés dans migrations doivent être marqués `is_system = true` rétroactivement
**Notes** : —

### TASK-20-005 — Permission diff viewer (compare 2 users) [P3] [TODO]
**Status note (2026-05-14)** : No `PermissionDiffModal` exists in `apps/backoffice/src/features/users/components/` ; Phase 5.D scope did not include a 2-user comparator. Genuinely undone.
**Contexte** : Use case manager : "pourquoi Alice peut faire X mais pas Bob ?". Pas d'outil aujourd'hui pour comparer effectivement.
**Critère d'acceptation** :
- [ ] Modal dans `/users` : sélectionner 2 utilisateurs → tableau "Permission | Alice | Bob | Source (role:cashier OR direct)"
- [ ] Surligne les différences
- [ ] Affiche les rôles assignés à chaque user en haut
- [ ] Bouton "Sync to" pour appliquer les permissions de l'un à l'autre (avec confirmation)
**Fichiers concernés** : `src/components/users/PermissionDiffModal.tsx`, hook `useEffectivePermissions(userId)`
**Dépend de** : TASK-20-001
**Estimation** : `M`
**Risques** : risque de transposition mass de permissions — confirmer + audit log obligatoire
**Notes** : —

### TASK-20-006 — Cleanup users inactifs [P2] [TODO]
**Status note (2026-05-14)** : `delete_user_v1` (soft delete + audit + revoke) ships in migration 000200 but no `view_inactive_users` RPC nor `/users/inactive` page. Phase 5.D did not include the inactivity-detection scope. Genuinely undone.
**Contexte** : Aucun mécanisme aujourd'hui. Un employé qui quitte garde son PIN actif si manager oublie de désactiver. Risque sécurité réel.
**Critère d'acceptation** :
- [ ] Vue/RPC `view_inactive_users` : users sans login depuis > 90 jours (configurable)
- [ ] Page `/users/inactive` liste ces users + dernière activité + bouton "Disable" / "Delete"
- [ ] Notification banner sur dashboard admin si > 0 users inactifs
- [ ] Action "Disable" : `is_active = false`, sessions révoquées, PIN inchangé (récupérable si retour)
- [ ] Action "Delete" : soft delete (`deleted_at`), audit log
**Fichiers concernés** : nouvelle migration vue, `src/pages/users/InactiveUsersPage.tsx`, `src/components/dashboard/InactiveUsersBanner.tsx`
**Dépend de** : TASK-20-002
**Estimation** : `M`
**Risques** : faux positifs (employé en vacances 3 mois) — d'où "Disable" plutôt que "Delete" par défaut
**Notes** : seuil 90j configurable dans `pos_config.user_inactivity_threshold_days`

### TASK-20-007 — Revoke sessions on role change [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.D. V3 evidence: helper `_revoke_user_sessions_v1(p_profile_id)` in `20260517000200_create_user_rpcs.sql` (line 40) deletes from both `auth.sessions` and updates `user_sessions.end_reason='role_changed'` atomically ; invoked by `update_user_role_v1` and `delete_user_v1` (D-W5-5D-03). Commit `bdf21aa`.
**Contexte** : Si manager retire `accounting.manage` à Alice, sa session courante peut continuer à appeler des Edge Functions accounting jusqu'au refresh permissions cache. Pas d'audit dédié mais c'est un trou de sécurité documenté en best practice.
**Critère d'acceptation** :
- [ ] Trigger Postgres sur `user_roles` (insert/delete) qui termine toutes les `user_sessions` actives du user concerné
- [ ] User force-relogin → re-fetch permissions à jour
- [ ] Toast UI sur le device du user : "Your permissions changed, please log in again"
- [ ] Test : retirer rôle → session terminée < 5s
**Fichiers concernés** : `supabase/migrations/<date>_revoke_sessions_on_role_change.sql`, mécanisme push (Realtime ou polling Edge Function)
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : impact UX si trigger trop agressif (chaque ajout permission relogin) → ne déclencher que sur retrait
**Notes** : alternative moins disruptive : invalider seulement le cache permissions client, pas la session

### TASK-20-008 — 2FA TOTP pour admins [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Wave 7 per INDEX line 1088 : "2FA (Session 19+)". No `totp_secret` column on `user_profiles`, no `auth-verify-totp` EF.
**Contexte** : `docs/audit/07-product-backlog-audit.md` §10 — *"2FA. Security hardening. PIN-based auth is adequate for POS but 2FA would protect admin functions."* `CURRENT_STATE.md` T6.
**Critère d'acceptation** :
- [ ] Champ `totp_secret` ajouté à `user_profiles`
- [ ] Page `/profile/security` : enrôlement 2FA (QR code Google Authenticator), vérification 1er code
- [ ] Edge Function `auth-verify-totp` ; flow login : si user a `totp_secret`, demande code après PIN
- [ ] Backup codes (10 codes one-shot téléchargeables)
- [ ] Obligatoire pour rôles `super_admin` (enforce via migration after rollout)
- [ ] Audit log enrôlement / désactivation
**Fichiers concernés** : `supabase/migrations/<date>_add_totp_to_users.sql`, `supabase/functions/auth-verify-totp/`, `src/pages/profile/SecurityPage.tsx`
**Dépend de** : aucune
**Estimation** : `XL`
**Risques** : librairie TOTP (otplib) ; perte téléphone = lockout admin → backup codes critiques
**Notes** : décomposer en sous-tâches ; commencer par enrôlement optionnel avant enforce sur super_admin

### TASK-20-009 — SSO Google (P3 future) [P3] [TODO]
**Status note (2026-05-14)** : Not addressed in Session 13 ; no ADR `adr-002-sso-google.md` exists. Genuinely undone (low priority — kept TODO rather than BLOCKED since it's gated on product validation, not on session scope).
**Contexte** : `docs/audit/07-product-backlog-audit.md` ne le mentionne pas explicitement. Use case nice-to-have pour staff back-office utilisant déjà Google Workspace.
**Critère d'acceptation** :
- [ ] Étude faisabilité documentée (ADR `adr-002-sso-google.md`)
- [ ] Supabase Auth Google provider activé en sandbox
- [ ] Email Google → match avec `user_profiles.email` ; rejet si pas d'user existant
- [ ] PIN reste obligatoire pour POS (SSO uniquement back-office)
- [ ] Pas de provisioning automatique (compliance)
**Fichiers concernés** : ADR + config Supabase ; pas de code immédiat
**Dépend de** : direction produit valide le besoin
**Estimation** : `L`
**Risques** : interactions avec PIN auth flow — bien isoler
**Notes** : reporter tant que < 5 demandes utilisateurs explicites

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/_archive/objectif-travail-v2/USERS_AND_PERMISSIONS.md` §11 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). 2FA est couvert par TASK-20-008 (et TASK-01-010). Bulk import est couvert par TASK-20-003.

### TASK-20-010 — Détection auto d'escalade de privilèges [P2] [TODO]
**Status note (2026-05-14)** : Phase 5.D shipped audit trail (TASK-20-002 DONE) and last-admin protection (TASK-cascade-01-007 below), but no real-time escalation trigger / webhook / `/users/security-alerts` page. Genuinely undone.
**Contexte** : aujourd'hui TASK-20-002 trace les modifications de rôle / permissions en audit. Mais pas d'alerte temps réel si un utilisateur modifie ses propres permissions ou celles d'un complice.
**Bénéfice attendu** : alerte instantanée (notification manager + email owner) à chaque tentative d'escalade.
**Critère d'acceptation** :
- [ ] Trigger sur `user_roles` (update/insert) qui détecte : self-modification, ajout `users.roles` à un compte non-Owner, retrait massif de permissions.
- [ ] Webhook → push notification + email owner.
- [ ] Page `/users/security-alerts` : timeline des alertes.
- [ ] Threshold configurable (Settings → Security).
**Dépend de** : `TASK-20-002` (audit log) pour la source.
**Estimation** : M
**Risques** : faux positifs si modif légitime — option "Acknowledge as legit".
**Notes** : couplable avec TASK-14-013 (Unusual transaction patterns) — même framework alerte.

### TASK-20-011 — Approval workflow pour permissions sensibles [P2] [TODO]
**Status note (2026-05-14)** : No `permission_change_requests` table created in Session 13 ; Phase 5.D did not implement four-eyes approval. Genuinely undone.
**Contexte** : aujourd'hui donner `accounting.manage` ou `users.roles` à un utilisateur se fait d'un coup. Pas de double validation.
**Bénéfice attendu** : pour les permissions à haut risque (accounting.manage, users.roles, settings.update), exiger une double validation (deux managers ou Owner + Manager).
**Critère d'acceptation** :
- [ ] Table `permission_change_requests` (target_user, requested_by, requested_permissions, approver_required, status, approved_by, approved_at).
- [ ] Settings → Security → "Critical permissions" : liste des permissions à workflow.
- [ ] Quand un admin coche une permission critique : statut `pending_approval` ; le second admin reçoit notification.
- [ ] Audit log enrichi : qui a demandé, qui a approuvé.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : friction si pas de second admin disponible — fallback Owner override.
**Notes** : pattern "four-eyes" pour les actions critiques.

### TASK-20-012 — Permissions à seuil (granular thresholds) [P3] [TODO]
**Status note (2026-05-14)** : Not delivered — V3 `role_permissions` remains binary (no `threshold_config JSONB`). Phase 5.D out of scope. Genuinely undone.
**Contexte** : aujourd'hui les permissions sont binaires (a / a pas). `sales.discount` est tout ou rien — pas de "jusqu'à 5% seul, jusqu'à 10% avec validation manager".
**Bénéfice attendu** : associer un seuil à certaines permissions (`sales.discount.max_pct = 5`, `sales.refund.max_amount = 100000`).
**Critère d'acceptation** :
- [ ] Schéma `role_permissions` enrichi avec `threshold_config` JSONB par permission.
- [ ] UI matrice : pour les permissions à seuil, input numérique au lieu d'une checkbox.
- [ ] Côté code : `usePermission(perm, value)` vérifie aussi le seuil.
- [ ] Au-delà du seuil : escalade automatique (PIN manager) ou refus.
- [ ] Documentation : liste des permissions seuil-aware.
**Dépend de** : aucune.
**Estimation** : XL
**Risques** : refonte significative du système permissions — phasage par module.
**Notes** : commencer par sales.discount, sales.refund, expenses.approve.

### TASK-20-013 — Vue & gestion des sessions multiples [P3] [TODO]
**Status note (2026-05-14)** : `_revoke_user_sessions_v1` helper exists (TASK-20-007 DONE) but no admin-facing `/users/:id/sessions` page nor "Force logout" affordance shipped. Genuinely undone — UI surface is the gap.
**Contexte** : aujourd'hui aucune vue des sessions actives par utilisateur. En cas de départ d'employé, pas de moyen de force-logout à distance.
**Bénéfice attendu** : page admin qui liste les sessions actives par utilisateur + bouton "Force logout".
**Critère d'acceptation** :
- [ ] Table `user_sessions` enrichie : device_type, ip, last_activity_at, status.
- [ ] Page `/users/:id/sessions` (permission `users.roles`) : liste des sessions actives + dernière activité.
- [ ] Bouton "Force logout" : invalide la session (token blacklist).
- [ ] Notification utilisateur : "Votre session a été révoquée par {admin}".
- [ ] Audit log de chaque révocation.
**Dépend de** : `TASK-20-007` (revoke sessions on role change) — partage la mécanique.
**Estimation** : M
**Risques** : session blacklist non immédiat → délai max 30s tolérable.
**Notes** : critique pour départs d'employés sensibles.

### TASK-20-014 — Délégation temporaire de rôle [P3] [TODO]
**Status note (2026-05-14)** : No `role_delegations` table in V3, no `/users/delegate` page. Phase 5.D out of scope. Genuinely undone.
**Contexte** : si l'Owner part en réunion / vacances, pas de moyen propre de donner ses droits Manager à un Cashier pour 2 heures avec trace.
**Bénéfice attendu** : délégation temporaire programmée d'un rôle à un autre utilisateur avec expiration auto.
**Critère d'acceptation** :
- [ ] Table `role_delegations` (from_user, to_user, role_id, valid_from, valid_until, reason, status).
- [ ] Page `/users/delegate` : créer une délégation (durée max configurable, ex 24h).
- [ ] Job toutes les 5 min qui auto-révoque les délégations expirées.
- [ ] Audit log + notification dans la timeline utilisateur cible.
- [ ] Pas de délégation possible du rôle Owner (toujours actif).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : abus si durée trop longue — limit max 24h par défaut.
**Notes** : pattern utile pour les gardes / remplacements.

### TASK-20-015 — Groupes d'utilisateurs (au-dessus des rôles) [P3] [TODO]
**Status note (2026-05-14)** : No `user_groups` / `user_group_members` tables in V3. Phase 5.D out of scope. Genuinely undone.
**Contexte** : aujourd'hui, regroupement uniquement par rôle. Pas de concept "équipe matin" / "équipe soir" pour filtres et reporting RH.
**Bénéfice attendu** : groupes additionnels pour piloter par équipe (planning, reports, communications).
**Critère d'acceptation** :
- [ ] Table `user_groups` + `user_group_members`.
- [ ] Page `/users/groups` : CRUD groupes.
- [ ] Affectation : un user peut être dans N groupes.
- [ ] Filtres dans la liste users + dans les reports (Staff Performance par groupe).
- [ ] Notifications ciblées par groupe (TASK-19-011 scheduler).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : confusion rôles vs groupes — UX claire.
**Notes** : V1 simple ; V2 hiérarchie groupes parent/enfant.

### TASK-20-016 — Export annuaire équipe (PDF / Excel) [P3] [TODO]
**Status note (2026-05-14)** : No "Export" button on `/users` page (`UsersTable.tsx` lists only). Phase 5.D out of scope. Genuinely undone.
**Contexte** : aucun moyen propre de sortir la liste équipe à jour (pour affichage back-office, audit RH, transmission externe).
**Bénéfice attendu** : génération d'un annuaire formaté.
**Critère d'acceptation** :
- [ ] Bouton "Export" sur la page `/users`.
- [ ] PDF formaté : photo (si dispo), nom, code, rôle principal, téléphone, e-mail.
- [ ] Excel : colonnes étendues (tous rôles, statut, last login, etc.).
- [ ] Filtres respectés à l'export (only active, par rôle).
- [ ] Audit log de l'export (RGPD).
**Dépend de** : aucune.
**Estimation** : S
**Risques** : RGPD si export envoyé à un tiers — disclaimer + audit log.
**Notes** : pattern HR classique.

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 20-001, 20-002, 20-007 |
| P2 | 20-003, 20-004, 20-006 |
| P3 | 20-005, 20-008, 20-009 |
