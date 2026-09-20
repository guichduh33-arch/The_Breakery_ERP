# security-fraud-guard — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Boundaries — ne pas dupliquer les skills voisins
- Mental model — defense in depth (5 couches)
- Critical patterns (re-vérifier avant de livrer — les ancrages datent du 2026-08-31)

Sélection : ce skill mène l’analyse transversale des abus d’argent, permissions, données personnelles et traçabilité, ainsi que les contrôles autorisés qui en découlent. [security-auth](../../security-auth/SKILL.md) couvre la mécanique des gates/RLS/PIN-JWT/sessions ; [pos-flow-audit](../../pos-flow-audit/SKILL.md) le parcours fonctionnel ; [stock-management](../../stock-management/SKILL.md) les contrôles propres au stock. Ne pas transformer une correction technique isolée en audit global.

# Security & Fraud Guard — The Breakery ERP/POS

> ⚠️ **RE-VÉRIFICATION DATÉE — ancrages relus contre le code le 2026-08-31.** Ce document
> porte une **méthode** (modèle de menace, checklists exécutables, taxonomie des findings)
> qui reste valable, et des **ancrages** qui pourrissent. Règles d'usage :
>
> 1. **Le CODE gagne.** Tout ce qui suit est un point d'entrée, pas une vérité : avant
>    d'affirmer, lire la migration au **numéro le plus haut** de la famille **et** le call-site.
> 2. **On désigne des FAMILLES de RPC, jamais des versions** (`refund_order_rpc`, pas
>    `refund_order_rpc_v<N>`) : les familles money-path bumpent plusieurs fois par mois. Les
>    versions citées ici sont des **faits datés**, jamais des pointeurs vivants.
> 3. **Les statuts « ouvert/critique » d'audits antérieurs sont périmés** : les 7 failles
>    « verified critical » du 2026-05-31 sont soldées (voir *Historique des failles closes*).
>    Ne pas rouvrir ces chantiers ; garder la méthode de détection.

Mission, dans les mots du propriétaire : rendre **la fraude, la manipulation de données et la
fuite d'information** difficiles à impossibles dans un système opéré quotidiennement par des
employés (caissiers, serveurs, managers) qui ont un accès légitime mais des incitations
contradictoires. Deux modes : **auditer** les 5 dimensions du [guide de contrôle](verification.md) (chaque contrôle est un
SQL exécutable via MCP `execute_sql` contre V3 dev `ikcyvlovptebroadgtvd` en enveloppe
`BEGIN … ROLLBACK`, ou un `Grep`) et **intervenir** pour poser le contrôle manquant
(permission + grant, paire REVOKE, écriture `audit_logs`, gate manager-PIN vérifié (en-tête pour une EF, argument pour une RPC),
idempotence, contrainte SOD, REVOKE append-only, pgTAP).

**`AGENTS.md` fait foi** pour les patterns transverses ; ce skill ajoute le modèle de menace,
les checklists d'audit et la guidance préventive.

## Boundaries — ne pas dupliquer les skills voisins

- **`stock-management`** : sécurité du flux d'inventaire (WAC, lot/FIFO, `stock_movements`
  append-only, trigger JE). **`pos-flow-audit`** : correction technique du POS (idempotence,
  versioning, races realtime), parcours UX, clôture de shift. **`security-auth`** : MÉCANIQUES
  d'auth (écrire une policy RLS, un gate RPC, la paire REVOKE, le fetch wrapper PIN-JWT, le
  rate-limit, le timeout de session).
- **Ce skill** : le cross-cut — **argent** (refund/void/remise/caisse/JE manuel), **identité**
  (auth PIN, intégrité RBAC, durée de session), **traçabilité** (complétude de `audit_logs`
  sur TOUS les modules), **exposition** (PII, vues, anon/PUBLIC), **intégrité append-only**.
  En cas de recouvrement : mener par l'angle fraude/fuite, citer le voisin pour la mécanique.

## Mental model — defense in depth (5 couches)

Une requête venue du terminal d'un employé traverse 5 portes ; la fraude réussit là où une
porte manque ou est mal réglée.

```
1. AUTHENTICATION  PIN (bcrypt cost 10) → JWT (HS256, fetch wrapper dédié). Lockout =
   ↓               POLITIQUE CONFIGURABLE (catégorie `security` : pin_max_failed [3,10] /
                   pin_lockout_minutes [5,120]), défaut 5/15 — jamais une constante.
2. RATE LIMIT      Bucket Postgres durable sur auth-verify-pin, kiosk, refund/void/cancel,
   ↓               EFs pdf. Maillon faible : fail-open sur erreur DB (délibéré) ; toutes
                   les EFs mutantes ne sont pas couvertes.
3. AUTHORIZATION   has_permission(uid, 'module.action') — 4 étages DANS CET ORDRE : override
   ↓               DENY → role_permissions → override GRANT → false (le grant de rôle passe
                   AVANT le GRANT d'override). P0003 au refus. La matrice est de la DONNÉE
                   ÉDITABLE À CHAUD (ADR-031/032), pas un seed.
4. ATOMIC MUTATION RPC SECURITY DEFINER (jamais d'INSERT brut), search_path épinglé, clé
   ↓               d'idempotence. Les flux d'argent exigent EN PLUS un PIN manager (second
                   facteur) : en-tête pour une EF, argument vérifié pour une RPC Postgres.
5. TRACE           Ligne `audit_logs` (actor_id/action/entity_type/entity_id/metadata) +
                   ledger append-only. Quelques RPC status-only sans audit (à documenter).
                   `audit_log` (singulier) est DROPPÉE.
```

### Le triangle de la fraude (qui triche, et comment)

- **Caissier** — annule/rembourse une commande payée et empoche le cash ; fausse remise pour
  un ami ; sous-encaisse ; ouvre le tiroir via un faux mouvement de caisse. *Contrôle : PIN
  manager sur void/refund/remise + audit + réconciliation de caisse au Z-report.*
- **Manager** — approuve sa propre dépense ; valide un remboursement qu'il a initié ; édite un
  prix/coût pour masquer une perte ; antidate. *Contrôle : SOD, gate PIN sur le JE manuel,
  ledgers append-only, pas d'auto-approbation — **sauf exception décidée**, Pattern 8.*
- **Admin/technique** — écriture DB directe contournant les RPC ; relâche une RLS/un REVOKE ;
  lit la PII en masse ; désactive un trigger ; **édite la matrice RBAC** (nouveau, ADR-031).
  *Contrôle : append-only au niveau GRANT, search_path épinglé, audit sur les RPC qui touchent
  aux droits, balayage anon/PUBLIC.*

Le travail : rendre chacun de ces gestes indélébile et exiger un second acteur.

## Critical patterns (re-vérifier avant de livrer — les ancrages datent du 2026-08-31)

1. **`has_permission(p_uid UUID, p_perm TEXT)`** (`20260517000030_refactor_has_permission.sql`
   — dernière définition au 2026-08-31) est à 4 étages **dans cet ordre** : ① DENY explicite
   dans `user_permission_overrides` (bat tout, `expires_at`-aware) → ② `role_permissions` pour
   le `role_code` du profil → ③ GRANT explicite d'override → ④ FALSE par défaut.
   ⚠️ **Le grant de rôle passe AVANT le GRANT d'override, pas après** ; et le rôle est lu sur
   `user_profiles.role_code` (un rôle par profil), sans table de jointure multi-rôles. Énoncer
   la cascade à l'envers fait mal prédire l'effet d'un override, donc mal juger un finding.
   Compagnon `has_permission_for_profile(p_profile_id, p_perm)` pour le chemin profil (EF
   ayant déjà résolu le profil). Le refus lève **`P0003`** (certaines RPC de rapport lèvent le
   `42501` natif — même sens). La fonction est LOCKED par son propre COMMENT : une permission
   neuve s'ajoute par `INSERT INTO permissions` + `role_permissions`, jamais en la réécrivant.
   Greper toute RPC neuve pour un `has_permission` avant la première mutation ; une
   `SECURITY DEFINER` sans gate est un trou.

2. **Le RBAC est de la DONNÉE, plus un seed figé (ADR-031 + ADR-032, 2026-08-25).** C'est le
   changement de modèle le plus important de ce skill — lire les deux ADR avant d'écrire quoi
   que ce soit sur les rôles.
   - `role_permissions` s'édite à chaud depuis le back-office (famille `set_role_permission`),
     les overrides utilisateur par `set_user_permission_override` /
     `delete_user_permission_override` (ADR-031), et les **rôles ont un cycle de vie** :
     `create_role` (clone optionnel) et `delete_role` (ADR-032). Les rôles `is_system` ne se
     suppriment ni ne se renomment ; tout rôle créé par l'écran naît `is_system = false`.
   - **Pour l'audit** : une liste de rôles gravée dans un document n'est plus une vérité de
     schéma, c'est un état daté. Au 2026-08-31 la base dev portait 5 rôles (4 `is_system` —
     SUPER_ADMIN, ADMIN, MANAGER, CASHIER — plus `waiter`) ; **le nombre est variable par
     construction, ne jamais le figer**.
   - **Pour pgTAP** : un test ne doit plus supposer la matrice seedée — épingler SUPER_ADMIN
     (ligne immuable par garde `super_admin_row_locked`), poser des overrides *dans* la
     transaction de test, ou partir du catalogue `permissions`. Un test qui assume « CASHIER
     n'a pas X » vire rouge le jour où un SUPER_ADMIN coche X : faux positif d'audit.
   - **Gardes gravées** (ADR-031) : ligne SUPER_ADMIN immuable ; aucun override ne peut cibler
     un profil SUPER_ADMIN ; mutations de matrice en INSERT/DELETE stricts (le trigger d'audit
     ne couvre pas `UPDATE is_granted`) ; permissions **figées au login** — un changement ne
     prend effet qu'à la session suivante.
   - Surface vivante : `apps/backoffice/src/pages/settings/roles/` (`RolesPage.tsx`,
     `RoleDetailPage.tsx`) et `features/settings/roles/components/` (`RoleMatrixGrid.tsx`,
     `RolePermissionsPanel.tsx`, `UserOverridesPanel.tsx`, `CreateRoleDialog.tsx`,
     `DeleteRoleAction.tsx`). Les deux anciennes matrices read-only sont supprimées ; il
     n'existe **pas** de hook « permissions matrix ».

3. **`audit_logs` est la SEULE table d'audit.** Canonique dans `20260503000005_init_settings.sql`
   (`id BIGSERIAL, actor_id UUID, action TEXT NOT NULL, entity_type TEXT NOT NULL,
   entity_id UUID, metadata JSONB, created_at`) ; `payload JSONB` ajoutée par `20260523000019`.
   `metadata` (contexte) et `payload` (diff) sont deux colonnes distinctes — ne pas les
   fusionner. La vue legacy `audit_log` (**singulier**) et son trigger INSTEAD-OF sont
   **DROPPÉS** (`20260710000087` repointe les écrivains, `20260710000088` supprime la vue) :
   ne plus la chercher, ne plus y écrire, ne plus la citer. Append-only garanti au niveau
   GRANT par `20260619000022`.
   **`actor_id` attend un `user_profiles.id`, jamais `auth.uid()`** — tout compte créé par le
   back-office a `id <> auth_user_id`. C'est la cause n°1 de lignes « system » dans le rapport
   Permission changes ; le trigger de matrice a été corrigé pour ça (`20260825000002`).
   **À contrôler sur chaque écrivain d'audit** — plusieurs RPC écrivent encore `auth.uid()`.

4. **Le véhicule du PIN dépend de la cible.** Vers une EF : en-tête dédié (`x-manager-pin`), jamais dans le JSON. Vers une RPC Postgres : argument `p_manager_pin` vérifié serveur avec verrouillage. `create_manual_je` n’est pas un défaut parce qu’elle reçoit cet argument ; contrôler sa validation effective et les tentatives échouées.

5. **La RPC est la frontière de sécurité — l'Edge Function ne l'est PAS.** Un gate PIN dans
   une EF ne protège rien si la RPC sous-jacente reste appelable via PostgREST. Pour chaque
   EF « protégée par PIN manager » : la RPC appelée est-elle REVOKEd de `authenticated`
   (service_role via EF seulement) ? le second facteur est-il re-vérifié serveur, ou est-ce
   un UUID de confiance fourni par l'appelant ? Le correct : REVOKE EXECUTE des RPC de
   reversal depuis `authenticated`, **ou** un jeton signé vérifié serveur — jamais un UUID
   client. Et l'`actor_id` d'audit doit être le manager approbateur, pas le caissier.
   ⚠️ **Ce pattern a régressé trois fois, à chaque bump de RPC de reversal**
   (`20260619000030` → régression → `20260709000010` → régression → `20260710000082/000084`) :
   **re-vérifier le REVOKE `authenticated` après TOUT nouveau `_vN` d'une famille de
   reversal.** Le PIN de remise transite par un nonce serveur `discount_authorizations`
   (`20260710000085/000086`) — plus de PIN en argument SQL sur ce chemin.

6. **La paire REVOKE est obligatoire sur chaque RPC neuve :**
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   `REVOKE FROM anon` **seul est insuffisant** — anon hérite EXECUTE par appartenance à PUBLIC
   (ACL `=X/postgres`). Le balayage `20260524000020..031` a révoqué anon+PUBLIC partout et posé
   les ALTER DEFAULT PRIVILEGES (`_031` = le correctif ajoutant la ligne FROM PUBLIC) : les
   objets neufs ne restent révoqués que grâce à elle. Besoin anon légitime = grant explicite
   par objet + `COMMENT … 'anon-callable: <raison>'`.

7. **`SECURITY DEFINER` doit épingler `search_path`.** Toute fonction definer s'exécute avec
   des droits élevés ; sans `SET search_path = public` (ou `public, pg_temp`), un appelant
   peut la détourner en masquant une table/fonction dans son propre schéma. Le standard du
   projet est un `SET search_path` explicite ; une definer sans lui est une vulnérabilité.

8. **La SOD est une contrainte, pas une convention — avec UNE exception décidée.**
   `expense_approvals` porte `UNIQUE(expense_id, approver_user_id)` : une même personne ne
   peut pas valider deux étapes du même dossier (blocage SOD 2). La famille `approve_expense`
   bloque `created_by = appelant` (blocage SOD 1) **SAUF pour SUPER_ADMIN**, autorisé à
   auto-approuver depuis le 2026-06-23
   (`20260706000023_allow_super_admin_self_approve_expense_v3.sql`) : contexte
   mono-opérateur, le propriétaire crée ET doit approuver. La dérogation est tracée par une
   action d'audit dédiée **`expense.self_approved`** et par `self_approval: true` dans la
   metadata de `expense.approved_step` ; le blocage SOD 2 reste actif pour SUPER_ADMIN aussi.
   ⚠️ **Énoncer « aucune auto-approbation » sans cette exception est FAUX** — c'est le genre
   de ligne qui fait crier à la fraude sur un comportement décidé. Un `expense.self_approved`
   par un SUPER_ADMIN est la trace attendue ; porté par un autre rôle, c'est un finding. Pour
   tout NOUVEAU flux multi-parties : encoder « un humain différent » en contrainte DB, et
   restreindre toute dérogation par rôle **et** la tracer par une action d'audit propre.

9. **Une vue s'exécute avec les droits de son propriétaire sauf `security_invoker=on`** (PG15+)
   et contourne alors la RLS de l'appelant — fuite silencieuse. Instances connues corrigées
   (`20260619000020/000021` : `security_invoker=on` sur `view_b2b_invoices` / `view_ar_aging`,
   `REVOKE ALL … FROM anon, PUBLIC` sur les MV `mv_*`, angle mort du balayage anon car
   `relkind='m'`). **Méthode à ré-appliquer sur toute NOUVELLE vue/MV :** ne jamais croire le
   commentaire de migration — vérifier `SELECT relname, reloptions FROM pg_class WHERE relkind
   IN ('v','m')` ; corriger par `ALTER VIEW <v> SET (security_invoker = on)` / `REVOKE ALL ON
   <mv> FROM anon, PUBLIC`.

10. **Append-only s'applique au niveau GRANT, pas seulement RLS.** Les ledgers
    (`stock_movements`, `audit_logs`, `b2b_payments`, `expense_approvals`,
    `loyalty_transactions`) `REVOKE INSERT/UPDATE/DELETE FROM authenticated` (les plus
    stricts aussi anon+PUBLIC) ; écritures par RPC definer uniquement. Ne jamais « réparer »
    par UPDATE/DELETE — poser une écriture compensatoire ou une RPC de la famille `_void`.

11. **La robustesse du PIN est un avertissement, pas un blocage** : `evaluatePinStrength`
    (`packages/utils/src/pin-strength.ts` + miroir Deno) signale répétition/séquence/liste
    fuitée mais laisse passer `111111`. Le lockout est **configurable** (catégorie `security`,
    clés `pin_max_failed` / `pin_lockout_minutes` écrites par la famille `set_setting`, bornes
    [3,10] et [5,120], défauts 5/15 — cf. `supabase/tests/pin_policy.test.sql` et
    `supabase/functions/auth-verify-pin/index.ts`). Jeton de session : UUIDv4 côté client,
    SHA-256 dans `user_sessions.session_token_hash` ; timeout d'inactivité par rôle via
    `useIdleTimeout` + `roles.session_timeout_minutes` (édité dans la fiche rôle, ADR-031).
    ⚠️ **Divergence connue, à traiter comme un finding** : la politique configurable ne vaut
    que pour le chemin EF ; le helper SQL `_verify_pin_with_lockout` (`20260622000010`), qui
    couvre les RPC prenant le PIN en argument, code **5/15 en dur**.
