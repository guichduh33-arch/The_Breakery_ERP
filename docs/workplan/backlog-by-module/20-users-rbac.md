# Travail — Users & RBAC

> Last updated: 2026-05-03
> Référence : [`../04-modules/01-auth-permissions.md`](../04-modules/01-auth-permissions.md) (auth flow), table `roles` / `user_roles` / `permissions`
> Sources audit : `docs/audit/01-architecture-security-audit.md` §P1-01 / P2-03 / P2-06, `docs/audit/04-reports-testing-audit.md` §P1-2, `docs/audit/07-product-backlog-audit.md` §10 (T6 2FA), `CLAUDE.md` (Permission Codes)

## Objectifs du module

1. Faciliter la gestion RBAC pour le manager non-tech : matrice rôles/permissions visuelle (vs. JSON brut) — cible : 1 UI par laquelle on coche/décoche permissions sans toucher SQL.
2. Tracer toute action sensible utilisateur (création, suppression, changement de rôle, reset PIN) — cible : 100 % des opérations user passent par audit_logs avec actor + target.
3. Onboarder massivement (bulk import 20 employés à l'ouverture saison) — cible : 1 CSV importable produit N user_profiles + roles assignés.
4. Hardenisation auth : 2FA admin (P3), SSO Google (P3 future), revocation immédiate de session sur changement de rôle.
5. Nettoyer les comptes inactifs : politique RGPD-friendly + recyclage des PIN — cible : alerte automatique sur user inactif > 90 jours.

---

## Tâches

### TASK-20-001 — UI matrice rôles/permissions [P1] [TODO]
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

### TASK-20-002 — Audit log actions user (CRUD + assign role) [P1] [TODO]
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

### TASK-20-007 — Revoke sessions on role change [P1] [TODO]
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

### TASK-20-008 — 2FA TOTP pour admins [P3] [TODO]
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

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 20-001, 20-002, 20-007 |
| P2 | 20-003, 20-004, 20-006 |
| P3 | 20-005, 20-008, 20-009 |
