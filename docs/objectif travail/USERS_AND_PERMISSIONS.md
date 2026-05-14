# Module Users & Permissions — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module Users & Permissions sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module Users & Permissions est la **carte d'identité interne** de The Breakery. Il répond à une question simple mais structurante pour un gérant qui n'est jamais seul derrière son comptoir :

> *"Qui a le droit de faire quoi dans mon application ? Qui peut encaisser, qui peut annuler une commande, qui peut voir la marge des produits, qui peut changer les prix, qui peut donner une remise de plus de 10 % ?"*

C'est le module qui transforme une **équipe de personnes physiques** en **système de comptes nommés, authentifiés et bridés**. Sans lui, n'importe qui pouvait tout faire ; avec lui, chaque clic est attribué à un humain identifié, autorisé pour cette action précise, et tracé dans l'audit.

Le module a deux faces complémentaires :

- **Users** — créer, modifier, désactiver les fiches employés (qui ils sont).
- **Permissions** — décider via les rôles ce que chacun a le droit de faire (ce qu'ils peuvent).

Les deux faces convergent sur **une mécanique d'authentification par PIN** rapide, adaptée au tempo caisse d'une boulangerie.

---

## 2. Les 3 grandes vues du module

| Vue | Job-to-be-done | Accès |
|---|---|---|
| **Users** (`/users`) | Créer / modifier / activer / désactiver les fiches employés, attribuer leurs rôles, gérer leur PIN | `users.view`, `users.create` |
| **Permissions Matrix** (`/users/permissions`) | Définir qui-peut-quoi via une grille rôles × permissions | `users.roles` |
| **Roles** (`/settings/roles`) | Créer / cloner / renommer / supprimer des rôles métier | `users.roles` |
| **Audit Log** (`/settings/audit`) | Tracer toutes les actions sensibles attribuées à un utilisateur | `users.roles` (ou admin) |

Le module est complété par le sous-système **PIN** (`auth-verify-pin`, `auth-change-pin`, `set-user-pin` Edge Functions) qui fournit le mécanisme d'authentification rapide à la caisse, sans clavier ni mot de passe long.

---

## 3. Les 4 invariants du module

Quelle que soit la vue consultée, l'utilisateur retrouve toujours les mêmes principes — c'est ce qui rend le RBAC robuste :

1. **Tout est nommé**. Aucune action sensible n'est anonyme — chaque commande, chaque void, chaque modif de prix porte le nom de l'utilisateur authentifié.
2. **Pas de droit hérité**. Une permission n'est jamais donnée à un humain en direct : elle est donnée à un **rôle**, et le rôle est attribué à l'humain. Cloisonnement par construction.
3. **Le rôle Owner est verrouillé**. Le rôle système "Owner" a *toutes* les permissions, il est non modifiable et indélétable. Il garantit qu'on ne peut jamais se retrouver enfermé hors de sa propre application.
4. **Soft delete uniquement**. On ne supprime jamais un utilisateur — on le désactive (`is_active = false`). L'historique des commandes, ventes, audits reste intact et attribué.

---

## 4. Vue **Users** — Gérer les fiches employés

C'est la vue **opérationnelle** : la liste de toute l'équipe avec ce qu'on a besoin de savoir au quotidien.

### 4.1 Liste des utilisateurs

Donner au gérant ou à l'admin une **vue centralisée et filtrable** de tous les comptes employés :

- Chaque ligne affiche : nom complet, code employé, téléphone, e-mail, rôle(s), statut actif / inactif, dernière connexion.
- **Recherche** par nom, code employé, téléphone.
- **Filtrer** par rôle (Manager / Cashier / Barista / Kitchen / Accountant…), par statut actif / inactif.
- **Toggle "Show inactive"** pour afficher ou masquer les comptes désactivés.
- **Statistiques agrégées** en haut : nombre total d'employés actifs, nombre par rôle, nombre connectés récemment.

Actions disponibles ligne par ligne :

- Modifier la fiche.
- Réinitialiser le PIN.
- Désactiver (ou réactiver) le compte.

Bénéfice métier : **avoir l'équipe sous les yeux**. En 5 secondes le gérant voit qui est cashier, qui est en congé prolongé (inactif), qui ne s'est pas connecté depuis 2 semaines.

### 4.2 Création / édition d'une fiche

Permettre au gérant de **créer rapidement** un compte pour un nouvel employé ou de **mettre à jour** une fiche existante.

Champs collectés :

- **Identité** : prénom, nom, nom d'affichage (celui qui apparaît sur les tickets), code employé (court, ex: `MADE01`).
- **Contact** : téléphone, e-mail.
- **Auth** : liaison à un compte Supabase Auth (`auth_user_id`) optionnelle — permet à l'employé de se connecter par e-mail/password depuis le BackOffice en plus du PIN caisse.
- **Langue préférée** : id / fr / en (pour l'affichage app — actuellement EN forcé).
- **PIN** : 4 chiffres pour l'auth caisse rapide.
- **Rôles** : liste cochable de rôles attribués à cet employé.
- **Rôle principal** : un rôle parmi les rôles attribués est désigné "primary" — c'est lui qui s'affiche dans l'audit log et sur les tickets.

Bénéfice métier : **embaucher un cashier en 2 minutes**. Saisie nom + code employé + PIN + rôle Cashier → l'employé peut encaisser dès l'instant suivant.

### 4.3 Réinitialisation du PIN

Permettre à un manager de **régénérer un PIN** quand un employé l'oublie ou quand on soupçonne une fuite :

- Demande d'un nouveau PIN à 4 chiffres.
- Application immédiate (l'ancien PIN est invalide à la seconde suivante).
- Trace dans l'audit log avec l'identité du manager qui a fait la réinit.

Bénéfice métier : **dépanner un employé sans avoir à appeler l'IT**. Le manager fait la manipulation en 30 secondes au comptoir, l'employé reprend la caisse.

### 4.4 Désactivation (soft delete)

Permettre au gérant de **fermer un compte** sans casser l'historique :

- `is_active = false` → l'utilisateur ne peut plus se connecter, ni en PIN ni en email.
- Ses commandes passées, ses sessions caisse, ses entrées d'audit restent attribuées à son nom.
- Réactivable d'un clic si l'employé revient.

Bénéfice métier : **respecter la durée légale de conservation** des données employés tout en bloquant immédiatement l'accès. Un licenciement à 14h bloque l'accès à 14h01 sans rien casser dans la compta du jour.

---

## 5. Vue **Permissions Matrix** — Le cœur du RBAC

C'est ici que se décide **qui peut quoi dans toute l'application**. La page affiche une **matrice rôles × permissions** : les rôles sont en colonnes, les permissions en lignes.

### 5.1 Structure de la matrice

Lignes (les permissions) sont regroupées par **module** :

| Module | Exemples de permissions |
|---|---|
| **Sales** | `sales.view`, `sales.create`, `sales.void`, `sales.discount`, `sales.refund` |
| **Products** | `products.view`, `products.create`, `products.update`, `products.pricing` |
| **Inventory** | `inventory.view`, `inventory.create`, `inventory.update`, `inventory.delete`, `inventory.adjust` |
| **Customers** | `customers.view`, `customers.create`, `customers.update`, `customers.loyalty` |
| **Reports** | `reports.sales`, `reports.inventory`, `reports.financial` |
| **Accounting** | `accounting.view`, `accounting.manage`, `accounting.journal.create`, `accounting.journal.update`, `accounting.vat.manage` |
| **Users** | `users.view`, `users.create`, `users.roles` |
| **Settings** | `settings.view`, `settings.update`, `settings.network` |
| **Production**, **Purchases**, **Kitchen**, **Admin** | … |

Au total **~70 permissions atomiques** réparties sur ~11 modules.

Colonnes (les rôles) : un par rôle existant — Owner, Manager, Cashier, Barista, Kitchen, Accountant, Stockman, etc.

### 5.2 Le geste métier

Le gérant ou l'admin coche / décoche **une case à la fois** :

- Case cochée = ce rôle a cette permission.
- Case décochée = ce rôle ne l'a pas.
- La colonne **Owner** est verrouillée (toutes les cases pré-cochées, non éditables) — c'est la garantie qu'on ne peut jamais perdre l'accès complet.
- Bouton "Save" en haut → push global de toute la matrice.

Bénéfice métier : **piloter la sécurité au niveau du geste**, pas du concept. Le gérant ne raisonne pas "le rôle Cashier devrait avoir tel niveau de droit" — il coche directement "Cashier peut faire `sales.discount`" ou pas.

### 5.3 Permissions atomiques typiques et leur enjeu

Quelques permissions à fort impact métier :

| Permission | Enjeu si donnée à la mauvaise personne |
|---|---|
| `sales.void` | Annuler une commande = potentiel d'encaisser puis annuler pour empocher le cash. Doit être un manager. |
| `sales.refund` | Rembourser = sortir de l'argent de la caisse. Même enjeu que `sales.void`. |
| `sales.discount` | Remises non contrôlées = sweethearting (remise à un complice). À encadrer. |
| `products.pricing` | Modifier les prix = manipulation directe de la marge. Manager / Owner uniquement. |
| `inventory.adjust` | Ajuster le stock = peut masquer un détournement. À tracer + limiter. |
| `customers.loyalty` | Ajouter / retirer des points → vol potentiel de valeur fidélité. |
| `accounting.manage` | Modifier les écritures = falsification comptable. Comptable / Owner uniquement. |
| `users.roles` | Modifier les permissions = **escalade de privilèges**. Owner uniquement. |
| `settings.update` | Modifier la taxe, la fidélité, les rôles = pouvoir absolu sur l'app. À verrouiller. |

Bénéfice métier : **chaque permission est un curseur risque/productivité**. Le module force le gérant à arbitrer explicitement à qui il fait confiance pour quoi.

---

## 6. Vue **Roles** — Définir les profils métier

Avant de remplir la matrice, il faut **créer les rôles**. La page Roles (dans `/settings/roles`) permet de :

### 6.1 Créer un rôle

- Donner un code court (`cashier`, `barista`, `manager`).
- Un libellé en anglais (affiché dans l'UI : "Cashier", "Manager").
- Une description optionnelle.

Les rôles standards livrés à l'installation :

| Code | Libellé | Profil cible |
|---|---|---|
| `owner` | Owner | Le propriétaire — toutes permissions, verrouillé |
| `manager` | Manager | Responsable de salle / opérations |
| `cashier` | Cashier | Caissier — ventes, encaissement |
| `barista` | Barista | Préparateur boissons |
| `kitchen` | Kitchen | Personnel cuisine — KDS uniquement |
| `accountant` | Accountant | Comptable — reports financiers + accounting |
| `stockman` | Stockman | Gestion stock + réceptions |

### 6.2 Cloner un rôle

Permettre au gérant de **dupliquer un rôle existant** pour créer une variante :

- Cloner "Cashier" → "Cashier Senior" qui hérite des mêmes permissions de base.
- Puis ajouter dans la matrice les permissions supplémentaires (`sales.discount` jusqu'à 10%).

Bénéfice métier : **évoluer la structure RH** sans repartir de zéro. Quand l'équipe grandit, on crée des grades intermédiaires sans tout reconfigurer.

### 6.3 Supprimer un rôle

Soft delete. Si un utilisateur a encore ce rôle attribué, suppression refusée. Le rôle Owner est non supprimable par construction.

---

## 7. Sous-système **PIN** — Authentification rapide caisse

Le module Users s'appuie sur un **système d'authentification PIN** dédié à la caisse, distinct de l'auth e-mail/password du BackOffice.

### 7.1 Le geste utilisateur

À la caisse, pour une action sensible (ouvrir une session, annuler une commande, valider une remise), l'app affiche un **clavier numérique virtuel** :

- L'utilisateur tape ses 4 chiffres.
- Vérification serveur via `auth-verify-pin` (Edge Function).
- En cas de succès → action autorisée et tracée à son nom.
- En cas d'échec → message d'erreur sans révéler si c'est le PIN ou l'utilisateur qui est faux.

### 7.2 Politique de sécurité

- **Longueur** : 4 chiffres (configurable dans Settings).
- **Tentatives** : 3 essais avant blocage temporaire du compte (configurable).
- **Durée de vie** : configurable (défaut : pas d'expiration forcée).
- **Stockage** : hash sécurisé côté serveur, jamais transmis en clair.
- **Session timeout** : 30 minutes d'inactivité avant déconnexion forcée (configurable).

### 7.3 Changement de PIN

- L'utilisateur peut changer son PIN à tout moment (depuis son profil).
- Le manager peut **réinitialiser** un PIN sans connaître l'ancien (cas oubli).
- Chaque changement / reset est tracé dans l'audit log.

Bénéfice métier : **rapidité caisse compatible avec sécurité staff**. Un cashier tape 4 chiffres en 2 secondes — pas de mot de passe long qui ralentit la file pendant le rush.

---

## 8. Audit Log — La trace écrite

Le module s'accompagne d'un **journal d'audit** (page `/settings/audit`) qui trace toutes les actions sensibles attribuées à un utilisateur.

### 8.1 Événements tracés

- Connexion / déconnexion.
- Échec d'authentification PIN (potentiel signal de fraude).
- Création / modification / désactivation d'utilisateur.
- Création / modification / suppression de rôle.
- Modification de permissions (ajout / retrait dans la matrice).
- Reset de PIN.
- Toute action portant l'attribut `audit: true` côté code (void, refund, large discount, settings update…).

### 8.2 Les filtres utiles

- Par utilisateur (que faisait Made cette semaine ?).
- Par type d'événement (toutes les modifications de rôle).
- Par période (l'historique du dernier mois).
- Par sévérité (info / warning / critical).

### 8.3 Détail d'un événement

Un clic sur une ligne ouvre le détail :

- Qui (utilisateur).
- Quoi (action exacte).
- Quand (timestamp précis).
- Avant / après (pour les modifications — anciennes vs nouvelles valeurs).
- Adresse IP / device si applicable.

Bénéfice métier : **dissuasion + résolution de litige**. Le simple fait que tous les staff sachent que tout est tracé réduit drastiquement les tentations. En cas de problème, la preuve est datée et nominative.

---

## 9. Mécaniques transverses — Comment le module se comporte

### 9.1 PermissionGuard et ModuleAccessGuard

Côté frontend, le module fournit deux composants utilisés partout :

- **`<PermissionGuard permission="sales.void">`** — enveloppe un bouton, un menu, une page. Si l'utilisateur n'a pas la permission, l'élément n'est pas rendu (pas juste masqué : pas envoyé au DOM).
- **`<ModuleAccessGuard module="accounting">`** — enveloppe une route entière. Si l'utilisateur n'a aucune des permissions du module, redirige vers le dashboard.

Bénéfice : **un utilisateur ne voit même pas ce qu'il ne peut pas faire**. Pas de bouton grisé, pas de tentation, pas de surface d'attaque côté UI.

### 9.2 Vérification serveur double

Toutes les permissions sont vérifiées **deux fois** :

1. **Côté frontend** (PermissionGuard) — pour la fluidité UX.
2. **Côté Supabase** (RLS policies + `user_has_permission()` SECURITY DEFINER) — pour la sécurité réelle.

Bénéfice : **un utilisateur qui contournerait le frontend** (via un appel API direct, un curl, un client compromis) tombe immédiatement sur le mur RLS côté base. La sécurité ne dépend jamais du browser.

### 9.3 Cache et propagation

- Les permissions de l'utilisateur courant sont chargées au login dans `authStore` (Zustand).
- Elles sont vérifiées via `usePermissions()` hook côté frontend (lookup O(1) en mémoire).
- Une modification de la matrice (par un admin) ne se propage qu'à la prochaine reconnexion de l'utilisateur affecté → pas de risque d'effet de bord en pleine session.

---

## 10. Ce que le module ne fait **pas** (par design)

- Le module **ne gère pas la paie**. Pas de feuille de temps, pas de calcul salaire, pas de fiche de paie. Ce n'est pas un SIRH.
- Le module **ne planifie pas les shifts**. Le planning staff est dans le module Operations à venir (cf. backlog reports : Peak Hour Staffing).
- Le module **ne synchronise pas avec un AD / LDAP externe**. The Breakery est une PME, l'auth est autonome.
- Le module **ne supprime jamais physiquement** un utilisateur ou un rôle qui a un historique. Soft delete uniquement.
- Le module **ne fait pas de SSO**. Pas de Google Sign-In, pas de Apple Sign-In — par choix de sobriété (et de contrôle).
- Le module **ne permet pas à un utilisateur de s'auto-attribuer un rôle**. Toute affectation passe par un admin avec `users.roles`.

---

## 11. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Détection auto d'escalade de privilèges** | Alerte temps réel si un utilisateur modifie ses propres permissions ou celles d'un complice. |
| 🔴 | **Approval workflow pour permissions sensibles** | Donner `accounting.manage` à un nouvel utilisateur exige une double validation (deux managers ou owner + manager). |
| 🟠 | **Permissions à seuil** | `sales.discount` jusqu'à 5% seul, 10% avec validation manager — au-delà refusé. Aujourd'hui binaire (a / a pas). |
| 🟠 | **Sessions multiples par utilisateur** | Voir et fermer à distance les sessions actives d'un employé (utile en cas de départ). |
| 🟠 | **Two-factor authentication (2FA)** | Pour les rôles à fort pouvoir (Owner, Manager, Accountant) — SMS ou app TOTP. |
| 🟡 | **Délégation temporaire** | Donner à un Cashier les droits Manager pour 2 heures (Owner part en réunion). Trace explicite. |
| 🟡 | **Groupes d'utilisateurs** | Au-dessus du rôle, un groupe (équipe matin / équipe soir) — pour filtres et reporting RH. |
| 🟢 | **Import en masse depuis CSV** | Onboarder 10 employés d'un coup à l'ouverture d'une nouvelle boutique. |
| 🟢 | **Export annuaire** | Sortir une liste équipe à jour (PDF / Excel) pour affichage en back-office. |

---

## 12. En une phrase

Le module Users & Permissions est **le gardien des frontières internes** de The Breakery : il transforme une équipe en comptes nommés, attribue à chacun strictement les droits dont il a besoin via un système de rôles cloisonnés, authentifie chaque geste sensible par un PIN à 4 chiffres en moins de 2 secondes, et trace tout dans un audit log nominatif et daté — pour qu'aucune action dans l'application ne soit ni anonyme, ni hors contrôle.
