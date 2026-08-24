# ADR-031 — RBAC éditable : matrice des rôles et fiche rôle réservées au SUPER_ADMIN

> **Date :** 2026-08-25 · **Statut : ACTÉ** (décision propriétaire 2026-08-25 en session ;
> commit du texte après validation) · **Supersede** la décision propriétaire du 2026-07-06
> « RBAC lecture seule assumée — l'éditeur est ANNULÉ », matérialisée par la migration
> `20260710000111_delete_rbac_update_permission.sql` et jamais formalisée en ADR.

## Décision

Le back-office gagne un **éditeur RBAC** réservé au seul rôle **SUPER_ADMIN** :

1. une **matrice rôle × permission éditable** (cocher/décocher une permission pour un rôle) ;
2. une **fiche détaillée par rôle** : permissions groupées par module, **timeout de session**,
   et **overrides par utilisateur** (`user_permission_overrides`, GRANT ou DENY, avec raison
   et expiration) ;
3. cette surface **remplace** les deux matrices en lecture seule existantes
   (`/backoffice/settings/permissions` et `/backoffice/users/permissions`), qui sont
   supprimées avec leurs hooks.

L'accès est verrouillé par un **test de rôle** (`role_code = 'SUPER_ADMIN'`), côté RPC comme
côté navigation : SUPER_ADMIN et ADMIN portant aujourd'hui exactement les mêmes permissions,
une permission seule ne peut pas exprimer « super admin uniquement ».

## Contexte

Constats vérifiés dans le dépôt le 2026-08-25 :

- Le modèle relationnel complet existe déjà (`roles`, `permissions`, `role_permissions`,
  `user_permission_overrides`) et `has_permission()` est un pur lookup à cascade
  (DENY user → grant de rôle → GRANT user → refus par défaut) : tout grant posé en base
  prend effet sans migration de fonction.
- L'écriture directe sur `role_permissions` et `user_permission_overrides` est révoquée pour
  `authenticated` : toute mutation passe par des RPC `SECURITY DEFINER`, qui n'existent pas.
- La permission d'écriture `rbac.update` a été **supprimée de la base** par la décision du
  2026-07-06. Le propriétaire rouvre cette décision : le besoin d'ajuster les droits et les
  réglages de chaque rôle sans passer par une migration est redevenu réel.
- Les permissions d'un utilisateur sont **figées au login** (Edge Function `auth-get-session`) :
  un changement de matrice ne prend effet qu'à la prochaine session.

## Arbitrages (propriétaire, 2026-08-25)

1. **La matrice redevient éditable.** La décision « lecture seule » du 2026-07-06 est levée.
2. **La fiche rôle inclut les overrides par utilisateur**, pas seulement les grants de rôle.
3. **Les deux matrices read-only sont remplacées**, pas conservées à côté : une seule surface,
   visible du seul SUPER_ADMIN. Les autres rôles ne voient plus la matrice du tout.
4. **Le timeout de session s'édite dans la fiche rôle.** La page Security des réglages ne
   garde que la politique PIN. Conséquence assumée : ADMIN perd l'édition des timeouts.
5. **Le rapport « Permission changes » voit les overrides** : sa RPC est bumpée
   (`get_permission_changes_v2`) pour couvrir les nouvelles actions d'audit.

## Garde-fous gravés

- **La ligne SUPER_ADMIN de la matrice est immuable** (`super_admin_row_locked`) : personne,
  pas même un SUPER_ADMIN, ne peut retirer une permission au rôle SUPER_ADMIN. Comme seul un
  SUPER_ADMIN peut écrire, l'auto-privation est impossible ; aucun « last-admin guard »
  supplémentaire n'est nécessaire.
- **Aucun override ne peut cibler un profil SUPER_ADMIN** (`super_admin_target_locked`) : un
  DENY sur un SUPER_ADMIN pourrait verrouiller les gates serveur alors que le front l'ignore —
  c'est précisément le lockout à interdire. Cette garde subsume l'interdiction d'auto-DENY.
- **Les mutations de matrice se font en INSERT/DELETE strict**, jamais en `UPDATE is_granted` :
  le trigger d'audit ne couvre que INSERT/DELETE.
- L'UI annonce que **tout changement prend effet à la prochaine connexion** de chaque
  utilisateur.

## Conséquences

1. **Une permission neuve `rbac.manage`** est créée et seedée pour le seul SUPER_ADMIN. Le code
   supprimé `rbac.update` n'est pas ressuscité, pour ne pas réanimer un identifiant chargé
   d'histoire. `rbac.manage` sert au filtrage de navigation ; le verrou réel reste le test de
   rôle dans les RPC. `rbac.read` survit telle quelle : des policies RLS en dépendent.
2. **Trois RPC de mutation versionnées** naissent : `set_role_permission_v1`,
   `set_user_permission_override_v1`, `delete_user_permission_override_v1` — double gate
   (permission + rôle), audit, paire REVOKE complète.
3. **Le trigger d'audit `audit_role_permissions_changes` est corrigé** : il écrivait
   `auth.uid()` dans `audit_logs.actor_id`, qui attend un `user_profiles.id` — les comptes
   créés par le back-office (id ≠ auth_user_id) apparaissaient « system » dans le rapport.
4. Les overrides, qui n'avaient aucun audit, écrivent désormais `audit_logs` depuis leurs RPC
   (actions `user.permission_override_set` / `user.permission_override_removed`).
5. La lecture de la matrice reste en PostgREST direct sous RLS (`rbac.read`) ; aucune RPC de
   lecture n'est créée.

## Ce que cette décision ne tranche pas

- La **création ou suppression de rôles** : les cinq rôles existants restent gérés par
  migration.
- La **modification des permissions elles-mêmes** (créer un code, le renommer) : le catalogue
  `permissions` reste seedé par migration.
- Un éventuel **rafraîchissement à chaud** des permissions d'une session ouverte : l'effet à la
  prochaine connexion est assumé, un mécanisme de refresh serait un chantier séparé.
