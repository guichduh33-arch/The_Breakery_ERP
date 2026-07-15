# Module 20 — Gestion des employés & droits

> ⚠️ **Mise à jour S58 (2026-07-04, `swarm/session-58`)** : **D1.1 livré** (sidebar « RBAC Editor » → « Permissions (read-only) ») ; le prérequis module 01 D2.1 (login des comptes créés) est livré. **Finding P0 nouveau (F-1, session INDEX S58)** : la garde dernier-admin de `delete_user_v1` ne filtre pas `is_active` — le seed `SYS-CRON` (SUPER_ADMIN inactif) permet de supprimer le dernier admin réel ; la revendication « impossible de supprimer le dernier administrateur » (A/C-B1.2) est donc contournable en l'état. Le reste de la fiche reste daté `5b0fa92`.

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **F-1 (P0) FIXÉ** (`_101`) — la garde dernier-admin filtre désormais `is_active = true AND deleted_at IS NULL`, sur `delete_user_v1` **et** `update_user_role_v1` (downgrade, même bug élargi vs finding d'origine). Le seed `SYS-CRON` inactif ne contourne plus la protection ; la revendication A/C-B1.2 « impossible de supprimer le dernier administrateur » est de nouveau tenue. Suite `users.test.sql` 29/29 (T_USR_07/11 verts). **La note S58 sur le finding F-1 est soldée.** Voir `docs/workplan/plans/archive/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 20. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** La traçabilité des opérations sur comptes est réelle et complète, et la révocation de sessions va plus loin que ce que la doc annonce ; mais la revendication phare — « grille visuelle des droits avec cases à cocher pour ajuster » — est fausse : la grille est strictement en lecture seule, aucune écriture RBAC n'existe (ni RPC, ni UI), et le nouvel employé créé ne peut pas se connecter (sélecteur de login codé en dur, cf. module 01).

> Recouvrement assumé avec le **Module 01** : le flux login/PIN/lockout/session y est analysé ; cette fiche couvre le cycle de vie des comptes et l'administration des droits. Le durcissement transverse est au **Module 25**.

## A. Ce qui fonctionne réellement (code vérifié)

- **CRUD employés complet côté BO** [UI câblée] : pages `users` (liste), `users/new`, `users/:id`, routées et gatées `users.read`/`users.create` (`apps/backoffice/src/routes/index.tsx:611-642`) ; 5 RPCs SECURITY DEFINER dans `supabase/migrations/20260517000200_create_user_rpcs.sql` :
  - `create_user_v1` (gate `users.create`) : crée `auth.users` + `user_profiles` avec PIN bcrypt (`hash_pin`), unicité `employee_code`, audit `user.create` (`:79-166`).
  - `update_user_role_v1` (gate `users.update`) : motif obligatoire ≥3 car., garde dernier-admin sur downgrade, **révoque toutes les sessions GoTrue + app du cible**, audit `user.role_change` avec old/new/reason (`:175-264`). UI `RoleChangeDialog` (`apps/backoffice/src/features/users/components/RoleChangeDialog.tsx`).
  - `delete_user_v1` (gate `users.update`) : soft-delete (`deleted_at` + `is_active=false`), motif obligatoire, `LAST_ADMIN_PROTECTED` (SQLSTATE P0001), révocation de sessions, audit `user.delete` (`:273-353`). UI `DeleteUserDialog` avec cas dernier-admin dédié (`useDeleteUser.ts:41-43`).
  - `update_user_profile_v1` (self ou `users.update`) : nom/code employé, audit avec old/new (`:359-431`).
  - `reset_user_pin_v1` (self ou `users.update`) : re-hash, efface lockout, audit `user.pin_reset` (`:437-488`). UI dans `UserDetailPage` avec warning PIN faible (`apps/backoffice/src/pages/users/UserDetailPage.tsx:142-200`).
- **Grille rôle × permission** [UI câblée, LECTURE SEULE] : route `users/permissions` gatée `rbac.read` (`routes/index.tsx:628-633`), composant `PermissionMatrix` — icônes ✓/✗ non interactives, filtre texte, source `roles`+`permissions`+`role_permissions` (`apps/backoffice/src/features/users/components/PermissionMatrix.tsx:87-98` ; hook `usePermissionMatrix.ts:53-80`, en-tête : « Read-only view »).
- **Modèle RBAC serveur** : tables `roles` (5 : SUPER_ADMIN/ADMIN/MANAGER/CASHIER/waiter, `20260517000030_refactor_has_permission.sql:70-76`), `permissions`, `role_permissions`, `user_permission_overrides` ; `has_permission()` = lookup pur re-évalué à chaque appel RPC. La permission `rbac.update` est seedée (`20260517000030:139`) mais **aucun code ne l'utilise** (aucun writer de `role_permissions`).
- **Rapport « Permission Changes »** [UI câblée] : `reports/permission-changes` gaté `reports.audit.read` (`routes/index.tsx:875-882`, RPC `get_permission_changes_v1`, fix gate `20260624000021`) — répond au scénario « qui a promu tel compte ? ».
- **Fiche employé riche** [UI câblée] : statut actif/supprimé, dernier login, tentatives échouées, `locked_until` (`UserDetailPage.tsx:110-140`).
- **Timeout de session par rôle éditable** [UI câblée] : `SecuritySettingsPage` + `update_role_session_timeout_v1` (détail au module 01, A).
- **En PLUS de la doc** 🔵 : la « déconnexion forcée immédiate » que la doc annonce « prévue » est **déjà implémentée** pour les cas changement de rôle et suppression (`_revoke_user_sessions_v1`, `20260517000200:40-70` — DELETE `auth.sessions` + `ended_at` sur `user_sessions`) ; garde dernier-admin aussi sur le downgrade de rôle, pas seulement la suppression.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Grille visuelle des droits (rôles en colonnes, autorisations en lignes, **cases à cocher**) permettant au gérant d'**ajuster** sans informaticien.
- B1.2 Toutes les opérations sensibles sur les comptes (création, suppression, changement de rôle, reset PIN) enregistrées avec auteur et cible.
- B1.3 Retrait de droits appliqué à la prochaine connexion ; désactivation du compte bloque toute nouvelle connexion ; déconnexion forcée « prévue ».

### B2. Annoncé « À venir »
- B2.1 Import en masse d'employés.
- B2.2 Détection des comptes inactifs.
- B2.3 Déconnexion forcée immédiate d'une session en cours.
- B2.4 Alerte en cas d'auto-attribution de droits + double validation pour les droits sensibles.
- B2.5 Droits à seuil (remise ≤5 % seul, au-delà validation manager).
- B2.6 Pointage des présences (lien paie).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Grille avec cases à cocher pour **ajuster** les droits | La grille existe et est atteignable (sidebar « RBAC Editor », `Sidebar.tsx:231`) mais est **en lecture seule** : icônes ✓/✗, aucun handler d'écriture (`PermissionMatrix.tsx:87-98`) ; aucune RPC de mutation de `role_permissions` ou `user_permission_overrides` dans les migrations ; `rbac.update` seedée mais orpheline. 0 override en base (fait établi session précédente). Le label sidebar « RBAC Editor » est mensonger. | 🔴 MANQUANT (la doc surclame) |
| B1.2 | Opérations sensibles sur comptes tracées (auteur + cible) | ✅ Les 5 RPCs écrivent `audit_logs` avec `actor_id` + `entity_id` cible + metadata (old/new rôle, reason, is_self…) (`20260517000200:154-163,248-257,336-344,417-427,480-484`) ; login réussi/échoué aussi tracé (module 01). Consultation via `reports/audit` + `reports/permission-changes`. Réserve : RLS admin_read — un MANAGER ne voit pas le journal. | ✅ CONFORME |
| B1.3 | Droits retirés → prochaine connexion ; désactivation → bloque toute connexion ; coupure forcée « prévue » | ✅ et mieux : `is_active=false`/`deleted_at` refusés au login (`auth-verify-pin/index.ts:71-81`) ; changement de rôle et suppression **révoquent immédiatement** les sessions (`_revoke_user_sessions_v1`) ; les gates RPC serveur re-vérifient à chaque appel. Limites réelles : pas de bouton « forcer la déconnexion » autonome (hors changement rôle/suppression), et le JWT PIN HS256 reste valide ≤1 h pour les lectures PostgREST directes. Pas non plus de toggle désactiver/réactiver distinct du soft-delete (le soft-delete est définitif côté UI : aucun flux de réactivation). | 🟠 PARTIEL (mieux que la doc sur un axe, en deçà sur l'autre) |

**Bonus code (le code fait plus que la doc) :** 🔵 révocation de sessions déjà câblée sur rôle-change/delete (B2.3 partiellement livré) ; 🔵 garde dernier-admin sur le downgrade ; 🔵 rapport Permission Changes dédié ; 🔵 motif obligatoire (≥3 car.) sur changement de rôle et suppression.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Renommer « RBAC Editor » → « Permissions (read-only) »** dans `apps/backoffice/src/layouts/Sidebar.tsx:231` et le titre de `PermissionsMatrixPage`, tant que D3.1 n'est pas livré. Done : plus de promesse UI mensongère.
2. **Bouton « Révoquer les sessions »** sur `UserDetailPage` : exposer `_revoke_user_sessions_v1` via un RPC gaté `users.update` (`revoke_user_sessions_v1` public + audit). Livre B2.3 pour de vrai à 90 % (reste le JWT ≤1 h, cf. module 01 D3.1). Fichiers : nouvelle migration, `UserDetailPage.tsx`, hook.
3. **Colonne « dernier login » + tri dans `UsersListPage`** pour un premier pas vers B2.2 (détection comptes dormants) — la donnée `last_login_at` existe déjà (`useUsersList.ts:26`).

### D2. Chantiers moyens (1 session, plan requis)
1. **Toggle désactiver/réactiver** distinct du soft-delete : RPC `set_user_active_v1` (gate `users.update`, garde dernier-admin, révocation sessions à la désactivation, audit), switch dans `UserDetailPage`. Le login refuse déjà `is_active=false`.
2. **Détection comptes inactifs** (B2.2) : vue/RPC `get_dormant_users_v1` (X jours sans login, seuil configurable) + encart sur `UsersListPage` ; option alerte via `notification-dispatch`.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Écriture RBAC réelle** (B1.1) : RPC `set_role_permission_v1`/`set_user_override_v1` gatées `rbac.update`, garde-fous obligatoires — interdiction de s'auto-élever (alerte B2.4), protection des grants ADMIN/SUPER_ADMIN, double validation pour les permissions à risque (liste à définir), audit exhaustif, invalidation du cache client. Impact transverse : chaque gate de l'app. Spec requise (c'est le vrai « module 20 » promis).
2. **Droits à seuil** (B2.5) : modèle de permission paramétrée (montant max remise) — touche `sales.discount`, le nonce `discount_authorizations` (S55) et le POS.
3. **Import en masse** (B2.1) + **pointage** (B2.6) : hors périmètre actuel, à prioriser avec le métier.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.1 : remplacer « cases à cocher… ajuster » par « grille de **consultation** des droits ; la modification des rôles se fait par changement de rôle d'un employé, pas par édition de la grille » — ou déplacer l'édition en À-venir.
2. B1.3 : mettre à jour — la coupure de session est déjà effective sur changement de rôle et suppression ; ce qui manque est le bouton autonome et l'invalidation du JWT ≤1 h.
3. Mentionner l'absence de réactivation d'un compte supprimé (soft-delete définitif côté UI).

## E. Dépendances croisées
- **Module 01** : sélecteur de login codé en dur (un compte créé ici ne peut pas se connecter → correction D2.1 du module 01 est un prérequis pour que ce module tienne sa promesse de bout en bout) ; longueur PIN 4-8 vs 6.
- **Module 25** : RLS `audit_logs` admin_read (qui a le droit de lire le journal), invalidation JWT, alerte auto-attribution (B2.4) = contrôle anti-fraude transverse.
- **Module 13 (promotions/remises)** : les droits à seuil (D3.2) s'implémentent dans le flux discount du POS.
- **Module 14 (rapports)** : AuditPage/PermissionChangesPage vivent dans reports.
