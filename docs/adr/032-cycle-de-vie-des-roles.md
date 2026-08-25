# ADR-032 — Cycle de vie des rôles : créer, cloner, supprimer depuis l'écran

> **Date :** 2026-08-25 · **Statut : ACTÉ** (décision propriétaire 2026-08-25 en session ;
> commit du texte après validation) · **Supersede** le point « Ce que cette décision ne
> tranche pas » de l'ADR-031 qui laissait la création et la suppression des rôles à la
> migration. Le reste de l'ADR-031 est inchangé.

## Décision

La page Roles du back-office (réservée au SUPER_ADMIN par l'ADR-031) gagne le **cycle de
vie des rôles** :

1. **Créer** un rôle : code, nom, description, timeout de session — vierge de toute
   permission, ou **cloné** d'un rôle existant ;
2. **Supprimer** un rôle créé à la main.

Le **renommage d'un code de rôle reste exclu** : le code est la clé primaire, référencée
partout ; changer un nom d'affichage n'est pas ce chantier, changer un code est interdit.

## Arbitrages (propriétaire, 2026-08-25)

1. **Les rôles système sont intouchables.** Les rôles marqués `is_system` (SUPER_ADMIN,
   ADMIN, MANAGER, CASHIER) ne se suppriment pas et ne se renomment pas. Ils se **clonent**
   pour créer une variante (« Cashier Senior »). Tout rôle créé par l'écran naît
   `is_system = false`, donc supprimable.
2. **La suppression est bloquée tant que le rôle est porté.** Le geste échoue avec la
   liste et le compte des employés concernés ; la réassignation se fait dans la page
   Users existante. Pas de réassignation en masse intégrée.
3. **Le clone ne copie jamais `rbac.manage`.** Cette permission est réservée au
   SUPER_ADMIN par l'ADR-031 ; on peut donc cloner n'importe quel rôle — y compris
   SUPER_ADMIN — sans fabriquer de pseudo-super-admin. Le verrou réel reste de toute
   façon le test de rôle dans les RPC.
4. **Le rapport « Permission changes » voit les naissances et morts de rôles** : sa RPC
   est bumpée pour couvrir les nouvelles actions d'audit.

## Garde-fous gravés

- Mêmes triples gates que l'éditeur ADR-031 : authentifié, `rbac.manage`, rôle
  `SUPER_ADMIN`.
- Le code d'un rôle neuf est validé (lettres/chiffres/underscore, commence par une
  lettre, 3 à 30 caractères) et son unicité est vérifiée **insensible à la casse**
  (« admin » n'est pas créable à côté d'« ADMIN »).
- La suppression d'un rôle emporte ses grants par cascade — chaque retrait est tracé par
  le trigger d'audit existant ; la création et la suppression écrivent en plus leurs
  propres lignes d'audit (`role.created`, `role.deleted`).
- Un rôle neuf fonctionne sans redéploiement : `has_permission` et le calcul de session
  sont de purs lookups ; le front affiche le `name` porté par la base pour tout code
  inconnu de sa table de libellés.

## Conséquences

1. Deux RPC versionnées naissent : `create_role_v1` (avec clone optionnel) et
   `delete_role_v1` — paire REVOKE complète, audit, pgTAP.
2. `get_permission_changes` est bumpée (v3) pour ajouter `role.created` / `role.deleted`
   au filtre du rapport.
3. La page Roles gagne un bouton « New role » (dialog avec clone optionnel) et la fiche
   rôle une action « Delete role », grisée avec la raison quand le rôle est système ou
   porté.
4. Le timeout d'un rôle cloné est repris du rôle source sauf valeur explicite.

## Ce que cette décision ne tranche pas

- Le **renommage** (code ou nom d'affichage) d'un rôle existant.
- Un éventuel archivage/désactivation d'un rôle sans le supprimer.
- La réassignation en masse des employés d'un rôle vers un autre.
