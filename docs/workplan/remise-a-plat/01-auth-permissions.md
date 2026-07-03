# Module 01 — Connexion & droits d'accès

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 01. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le socle (PIN, lockout, rate-limit, audit, RBAC serveur) est réel et plus solide que décrit, mais deux revendications centrales sont fausses : le sélecteur d'utilisateurs à la connexion est **codé en dur sur 2 comptes de seed** (un nouvel employé ne peut pas se connecter depuis l'UI), et le réglage « fin, case par case » des droits n'existe pas (grille en lecture seule).

> Recouvrement assumé avec le **Module 20** (gestion des employés & droits) : les RPCs user-management, la grille RBAC et la traçabilité des comptes sont analysés en détail dans `20-users-rbac.md` ; le durcissement transverse (REVOKE, redaction, rate-limit) dans `25-security.md`. Cette fiche couvre le parcours connexion/session/droits côté runtime.

## A. Ce qui fonctionne réellement (code vérifié)

- **Login par PIN 6 chiffres via EF `auth-verify-pin`** [EF] : regex `^\d{6}$`, vérif bcrypt via RPC `verify_user_pin` (`supabase/functions/auth-verify-pin/index.ts:11,89`), mint d'un JWT HS256 1 h + session applicative (`user_sessions`, token hashé SHA-256) (`index.ts:133-182`).
- **Lockout 5 essais / 15 minutes** [EF] : compteur `failed_login_attempts`, `locked_until` posé au 5ᵉ échec (`auth-verify-pin/index.ts:12-13,99-104`) ; chaque échec ET chaque succès écrit dans `audit_logs` (`login.failed` avec IP + tentative, `login.success` avec device + session) (`index.ts:105-111,185-191`).
- **Rate-limit durable par IP : 3 essais/min** [EF] : `checkRateLimitDurable` (mémoire + table Postgres `edge_function_rate_limits`) avant même de lire le body (`auth-verify-pin/index.ts:16,33-44` ; `supabase/functions/_shared/rate-limit.ts`).
- **Compte inactif/supprimé refusé au login** [EF] : `is_active=false` → 403 `user_inactive` ; `deleted_at` filtré (`auth-verify-pin/index.ts:71,79-81`).
- **Messages d'erreur opacifiés** [EF] : `redactError` collapse `user_not_found`/`invalid_pin` en un code unique (`_shared/error-redact.ts:37-44` ; `auth-verify-pin/index.ts:76`).
- **Permissions calculées côté serveur au login** [EF] : `computePermissionsForRole(role, userId)` lit `role_permissions` + `user_permission_overrides` et renvoie la liste au client (`auth-verify-pin/index.ts:194`) ; helper client pur `hasPermission`/`hasAnyPermission` (`packages/supabase/src/rls/permissions.ts:185-199`).
- **Gates serveur re-vérifiés à chaque appel** : les RPCs sensibles appellent `has_permission(auth.uid(), '…')` en live (ex. `supabase/migrations/20260517000200_create_user_rpcs.sql:101,195,293`) — un retrait de droits est donc effectif immédiatement côté RPC, contrairement à ce que la doc laisse entendre (seul le cache client et le JWT 1 h restent périmés).
- **Sessions serveur bornées** [EF] : `requireSession` coupe à 30 min d'inactivité et 24 h d'âge max, marque `ended_at`/`end_reason` (`supabase/functions/_shared/session-auth.ts:5-62`).
- **Auto-logout / verrouillage par inactivité, réglable par rôle** [UI câblée] : `roles.session_timeout_minutes` retourné par `auth-get-session` (`packages/supabase/src/auth/pinAuth.ts:130`), hook `useIdleTimeout` (`packages/ui/src/hooks/useIdleTimeout.ts`) ; le POS **verrouille** (shift et panier préservés, re-PIN) (`apps/pos/src/components/IdleTimeoutMount.tsx:18-27`), le BO déconnecte ; éditeur BO 5–480 min par rôle, audité, RPC `update_role_session_timeout_v1` (`apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx:45-61`, route gatée `settings.security.manage` `apps/backoffice/src/routes/index.tsx:940-943`).
- **Changement de PIN self-service** [EF] : `auth-change-pin` (self avec `current_pin`, admin override ADMIN/SUPER_ADMIN), rate-limit durable 5/min par compte cible, reset lockout, audit `pin.change_self`/`pin.change_admin` (`supabase/functions/auth-change-pin/index.ts:49-103`).
- **Détection de PIN faible — avertit sans bloquer** [EF+UI] : `evaluatePinStrength` (séquences, répétitions, ~100 PINs courants) miroir Deno/TS (`supabase/functions/_shared/pin-strength.ts`), retourné par `auth-change-pin` (`index.ts:105-109`) et affiché en warning à la réinitialisation BO (`apps/backoffice/src/pages/users/UserDetailPage.tsx:179-198`). Conforme au « avertit sans bloquer » de la doc.
- **Reset PIN par un tiers** [UI câblée] : `reset_user_pin_v1` (self OU `users.update`), efface le lockout, audité (`20260517000200_create_user_rpcs.sql:437-488`) ; UI dans `UserDetailPage` (`apps/backoffice/src/pages/users/UserDetailPage.tsx:142-200`).
- **Soft-delete avec garde dernier-admin + révocation de sessions** [UI câblée] : `delete_user_v1` (`LAST_ADMIN_PROTECTED`, `_revoke_user_sessions_v1`, audit) (`20260517000200_create_user_rpcs.sql:273-353`) — détail au module 20.
- **Journal d'audit consultable** [UI câblée] : page `reports/audit` gatée `reports.audit.read` (`apps/backoffice/src/routes/index.tsx:692-695`), RPC `get_audit_logs_v1` paginé curseur (`supabase/migrations/20260517000076_paginate_audit_log_rpc.sql`) ; RLS `audit_logs` = admin_read (cf. commentaire `20260702000010_create_get_audit_logs_v2_rpc.sql:10-12`).
- **En PLUS de la doc** 🔵 : rapports dédiés **Permission Changes** (`reports/permission-changes`, gate `reports.audit.read`, `routes/index.tsx:875-882`) et **Price Changes** (`routes/index.tsx:868`) qui répondent directement aux scénarios « qui a promu ce compte ? » / « qui a modifié ce prix ? » ; garde dernier-admin aussi sur le **downgrade de rôle** (`20260517000200:229-240`) ; révocation immédiate des sessions au changement de rôle (`:246`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Créer une fiche employé en 2 min (nom, code secret à 4 chiffres, rôle) ; « un nouveau caissier peut encaisser dès l'instant suivant ».
- B1.2 Rôles prédéfinis (patron, manager, caissier, serveur, cuisine, comptable, magasinier) + réglage fin « case par case » (~70 droits).
- B1.3 Connexion à la caisse en 2 s avec un code ; 5 erreurs = blocage 15 min ; un même appareil ne peut pas multiplier les essais.
- B1.4 Reset du code oublié par le manager au comptoir en 30 s, avec trace écrite.
- B1.5 Désactivation immédiate d'un compte sans perte d'historique.
- B1.6 Journal d'audit consultable (« Qu'a fait Made cette semaine ? ») avec l'avant/après de chaque modification.
- B1.7 Déconnexion automatique après inactivité, réglable par profil ; impossible de supprimer le dernier administrateur.

### B2. Annoncé « À venir »
- B2.1 Double vérification (2FA) pour les patrons.
- B2.2 Prise d'effet immédiate d'un retrait de droits.
- B2.3 Blocage (et non simple avertissement) des codes secrets faibles.
- B2.4 Hiérarchie technique (un manager ne peut pas modifier la fiche d'un supérieur).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Fiche employé en 2 min, « encaisse dès l'instant suivant » | La création marche (`create_user_v1` + `NewUserPage`), MAIS le sélecteur de connexion des DEUX apps est **codé en dur sur 2 comptes de seed** (`apps/pos/src/pages/Login.tsx:42-45`, `apps/backoffice/src/features/auth/UserPicker.tsx:4-7` — « replaced when `list_login_users()` RPC ships », RPC jamais créé, absent des migrations). Un nouvel employé **ne peut pas se connecter** depuis l'UI. De plus le PIN de login exige 6 chiffres alors que le formulaire de création accepte 4-8 (`UserFormDialog.tsx:38` vs `auth-verify-pin/index.ts:11`) : un PIN à 4 chiffres crée un compte inutilisable. La doc dit « 4 chiffres » : c'est 6. | 🔴 MANQUANT |
| B1.2 | 7 rôles prédéfinis + réglage case par case ~70 droits | 5 rôles seulement (SUPER_ADMIN, ADMIN, MANAGER, CASHIER, waiter — `20260517000030_refactor_has_permission.sql:70-76`) : pas de rôles cuisine/comptable/magasinier. 147 permissions (pas ~70). La grille rôle×permission est **en lecture seule** (cf. module 20, C-B1.1) : aucun réglage case par case, pas de création/duplication de rôle. | 🔴 MANQUANT (sur l'éditabilité) / 🟠 sur les rôles |
| B1.3 | Login rapide ; 5 erreurs = 15 min ; anti-multi-essais par appareil | ✅ Lockout 5/15 min (`auth-verify-pin/index.ts:12-13`) ; rate-limit durable 3/min **par IP** (pas par appareil, mais couvre le cas) (`index.ts:16,34-40`). PIN à 6 chiffres, auto-submit (`apps/pos/src/pages/Login.tsx:94-99`). | ✅ CONFORME |
| B1.4 | Reset PIN par le manager au comptoir, 30 s, tracé | Le RPC + l'UI existent et sont audités (`reset_user_pin_v1`, `UserDetailPage.tsx:142-200`) MAIS (a) c'est une page **BackOffice**, pas un geste « au comptoir » sur le POS ; (b) le gate est `users.update`, que le rôle MANAGER n'a **pas** dans les seeds (`20260517000030:200-262` ne donne que `users.read` ; `seed.sql` n'ajoute rien) → en l'état seuls ADMIN/SUPER_ADMIN peuvent dépanner. ⚠️ grants live à confirmer en DB. | 🟠 PARTIEL |
| B1.5 | Désactivation immédiate sans perte d'historique | ✅ `delete_user_v1` : soft-delete (`deleted_at` + `is_active=false`), révoque les sessions GoTrue + app, garde dernier-admin, audit (`20260517000200:273-353`) ; le login refuse `is_active=false` (`auth-verify-pin/index.ts:79-81`). Nuance : pas de toggle « désactiver/réactiver » distinct de la suppression (cf. module 20). | ✅ CONFORME |
| B1.6 | Journal d'audit avec avant/après, requêtes « qu'a fait X » | La page Audit Log existe mais n'affiche **ni filtres ni le détail avant/après** : colonnes timestamp/action/entity/actor uniquement, `metadata` non rendu (`apps/backoffice/src/pages/reports/AuditPage.tsx:59-96`) ; le hook accepte pourtant des filtres actor/action/entity jamais exposés (`useAuditLogs.ts:21-26`). L'avant/après existe en base (`metadata`/`payload`) et est rendu seulement pour les produits (`HistoryPanel`). RLS admin_read : un MANAGER voit un journal vide. | 🟠 PARTIEL |
| B1.7 | Auto-logout réglable par profil ; dernier admin indestructible | ✅ Timeout par rôle 5–480 min éditable + audité (`SecuritySettingsPage.tsx`), POS verrouille / BO déconnecte (`IdleTimeoutMount.tsx`) ; `LAST_ADMIN_PROTECTED` sur delete ET downgrade de rôle. | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :** 🔵 rapports Permission Changes / Price Changes câblés ; 🔵 révocation immédiate des sessions au changement de rôle (la doc classe la « prise d'effet immédiate » en À-venir alors que les gates RPC serveur sont déjà re-vérifiés à chaque appel — seuls le cache UI client et le JWT 1 h restent stales) ; 🔵 verrouillage POS préservant le shift au lieu d'un logout sec ; 🔵 cap dur serveur 30 min inactivité / 24 h de session (`session-auth.ts:5-6`).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Aligner la longueur de PIN partout sur 6** : `UserFormDialog.tsx:38` (4-8 → 6), `create_user_v1`/`reset_user_pin_v1` (`BETWEEN 4 AND 8` → `= 6`, nouvelle migration in-place ou _v2), copy « 4-6 digit PIN » de `apps/pos/src/pages/Login.tsx:16,136`. Done : impossible de créer un compte dont le PIN ne passe pas le login.
2. **Exposer les filtres du journal d'audit** : brancher `AuditLogFilters` (actor/action/entity) déjà supportés par `useAuditLogs.ts` dans `AuditPage.tsx`, + affichage dépliable du `metadata` (avant/après). Done : le scénario « qu'a fait Made cette semaine ? » est jouable.
3. **Étiquette honnête** : renommer l'entrée sidebar « RBAC Editor » (`apps/backoffice/src/layouts/Sidebar.tsx:231`) en « Permissions (lecture) » tant que D3.1 du module 20 n'est pas fait.

### D2. Chantiers moyens (1 session, plan requis)
1. **RPC `list_login_users_v1` + remplacement des 2 `UserPicker` codés en dur** (`apps/pos/src/features/auth/UserPicker.tsx`, `apps/pos/src/pages/Login.tsx:42-45`, `apps/backoffice/src/features/auth/UserPicker.tsx`). Points d'attention : RPC anon-callable par nécessité (pré-auth) → exposition minimale (id, prénom, initiale, rôle-label), REVOKE réfléchi + `COMMENT 'anon-callable'` (pattern S20), tri/actifs seulement, pagination si >20 employés. Done : un compte créé au BO apparaît au login POS/BO sans redéploiement.
2. **Décision MANAGER & dépannage PIN** : soit granter `users.update` (trop large), soit créer un gate dédié `users.pin_reset` accordé à MANAGER + éventuel flux POS (modale manager-PIN au comptoir). Nécessite la vérité DB live sur les 103 perms MANAGER.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Invalidation de session/JWT à effet immédiat** (B2.2 complet) : le JWT HS256 1 h reste valide après révocation pour les lectures PostgREST directes ; options = raccourcir l'exp + refresh silencieux via `user_sessions`, ou table de deny-list vérifiée par RLS. À spec-er avec le module 25.
2. **2FA patrons** (B2.1) — dépend d'un canal (email EF existe, SMS non).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. « Code secret à 4 chiffres » → **6 chiffres**.
2. « 7 rôles prédéfinis » → 5 rôles réels ; retirer cuisine/comptable/magasinier ou les déclarer À-venir.
3. « ~70 droits » → 147 permissions / 35 domaines.
4. Retirer « réglage fin case par case » de « aujourd'hui » (→ À venir, cf. module 20) et le scénario « duplique le rôle Caissier » (aucune création/duplication de rôle n'existe).
5. Nuancer l'À-venir « prise d'effet immédiate » : les gates serveur sont déjà immédiats ; ce qui reste stale = UI client + JWT ≤ 1 h.

## E. Dépendances croisées
- **Module 20 (users & RBAC)** : partage les RPCs user-management, la grille RBAC (lecture seule) et le journal — les corrections D1.1/D2.1/D2.2 sont co-portées.
- **Module 25 (sécurité)** : rate-limit, redaction, REVOKE anon (socle) ; le chantier D3.1 (invalidation JWT) est un sujet sécurité transverse.
- **Module 17 (tablette)** : le rôle `waiter` se connecte par le même Login POS → dépend de D2.1.
- **Module 19 (réglages)** : la page Security & PIN vit sous Settings (`settings.security.manage`).
