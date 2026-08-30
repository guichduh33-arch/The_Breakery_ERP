---
name: security-fraud-guard
description: Cross-cutting security & anti-fraud authority for the ERP/POS — money flows (refund/void/discount/cash/manual JE), RBAC integrity, audit-log completeness, PII & information-leak surfaces, anon/PUBLIC hardening, and append-only ledger integrity. Two modes — AUDIT the system for fraud/manipulation/leak gaps (executable SQL checks) AND INTERVENE to add the controls (permissions, REVOKE pairs, audit_log writes, manager-PIN gates, pgTAP). Use this skill WHENEVER the user mentions security, fraud, manipulation by employees, "qui peut faire quoi", permissions/RBAC/roles, audit logs/traçabilité, refund/void/discount/cash-drawer/manual-journal-entry abuse, manager PIN, data leak / fuite d'information / PII, RLS / REVOKE / anon hardening, append-only ledgers, or "sécuriser / contrôler / enregistrer les actions" — even if they don't say the word "audit". Boundary vs security-auth: security-auth owns the AUTH MECHANICS (building an RLS policy or RPC gate, REVOKE/anon defense-in-depth, the PIN-JWT fetch wrapper, durable rate-limit, per-role session timeout); THIS skill owns the cross-cut FRAUD/MONEY/PII/traceability AUDIT and the addition of anti-fraud controls — reach here for "qui peut faire quoi", refund/void/discount/cash abuse, audit-log completeness, and data-leak surfaces. Defer inventory-specific security to stock-management and POS-flow technical correctness to pos-flow-audit; this skill owns the money, identity, traceability, and data-exposure cross-cut.
pathPatterns:
  # migrations touchant droits, argent, traçabilité, auth
  - 'supabase/migrations/*permission*.sql'   # couvre aussi has_permission
  - 'supabase/migrations/*rbac*.sql'
  - 'supabase/migrations/*role*.sql'
  - 'supabase/migrations/*audit*.sql'
  - 'supabase/migrations/*revoke*.sql'
  - 'supabase/migrations/*rate_limit*.sql'
  - 'supabase/migrations/*pin_policy*.sql'
  - 'supabase/migrations/*session_timeout*.sql'
  - 'supabase/migrations/*refund*.sql'
  - 'supabase/migrations/*void*.sql'
  - 'supabase/migrations/*cash*.sql'
  - 'supabase/migrations/*manual_je*.sql'
  # edge functions d'auth et de money-path + helpers partagés
  - 'supabase/functions/auth-verify-pin/**'
  - 'supabase/functions/auth-change-pin/**'
  - 'supabase/functions/verify-manager-pin/**'
  - 'supabase/functions/refund-order/**'
  - 'supabase/functions/void-order/**'
  - 'supabase/functions/cancel-item/**'
  - 'supabase/functions/_shared/**'
  # tests de sécurité
  - 'supabase/tests/security*.test.sql'
  - 'supabase/tests/pin_policy.test.sql'
  - 'supabase/tests/expense_governance.test.sql'
  # surfaces applicatives
  - 'packages/supabase/src/rls/**'
  - 'packages/utils/src/pin-strength.ts'
  - 'apps/backoffice/src/stores/authStore.ts'
  - 'apps/backoffice/src/features/settings/**'
  - 'apps/backoffice/src/pages/settings/roles/**'
  - 'apps/backoffice/src/pages/reports/AuditPage.tsx'
promptSignals:
  phrases: ['security', 'securite', 'fraud', 'fraude', 'manipulation', 'qui peut faire quoi',
    'permission', 'RBAC', 'role', 'audit log', 'tracabilite', 'manager PIN', 'refund abuse',
    'void abuse', 'discount abuse', 'cash drawer', 'data leak', 'fuite information', 'PII',
    'append-only', 'separation of duties', 'SOD']
---

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
> 4. **Ce fichier dépasse volontairement le plafond de 500 lignes** (arbitrage Mamat du
>    2026-08-31). Le tableau *Historique des failles closes* est ce qui déborde, et son rôle
>    est précisément d'être lu **inline** : derrière un lien de `references/`, il n'empêcherait
>    plus un audit de re-signaler du travail déjà fait. Ne pas découper ce fichier pour
>    « rentrer dans les clous ».

Mission, dans les mots du propriétaire : rendre **la fraude, la manipulation de données et la
fuite d'information** difficiles à impossibles dans un système opéré quotidiennement par des
employés (caissiers, serveurs, managers) qui ont un accès légitime mais des incitations
contradictoires. Deux modes : **auditer** les 5 dimensions ci-dessous (chaque contrôle est un
SQL exécutable via MCP `execute_sql` contre V3 dev `ikcyvlovptebroadgtvd` en enveloppe
`BEGIN … ROLLBACK`, ou un `Grep`) et **intervenir** pour poser le contrôle manquant
(permission + grant, paire REVOKE, écriture `audit_logs`, gate manager-PIN en en-tête,
idempotence, contrainte SOD, REVOKE append-only, pgTAP).

**`CLAUDE.md` fait foi** pour les patterns transverses ; ce skill ajoute le modèle de menace,
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
                   facteur) — qui doit voyager en EN-TÊTE HTTP.
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

4. **Le PIN manager voyage en EN-TÊTE HTTP, jamais dans le corps JSON** (les corps sont
   loggés par PostgREST/pgaudit/proxies, les en-têtes rarement). Canonique `x-manager-pin`,
   lu par les EF `refund-order`, `void-order`, `cancel-item`, `process-payment`,
   `verify-manager-pin` (en-tête déclaré dans `supabase/functions/_shared/cors.ts`).
   **Reste ouvert :** la famille `create_manual_je` prend toujours le PIN en **argument SQL**
   (`p_manager_pin`), appelée en RPC directe depuis le BO, sans EF — seul item de ce pattern
   non soldé, vérifié le 2026-08-31.

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
    `internal_transfers`, `loyalty_transactions`, `role_permissions`,
    `user_permission_overrides`) `REVOKE INSERT/UPDATE/DELETE FROM authenticated` (les plus
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

## Historique des failles closes (ne pas rouvrir — garder la méthode)

Les 7 failles « verified critical » du 2026-05-31 sont soldées ; ce tableau évite qu'un audit
les re-signale et garde les correctifs traçables.

| Faille (2026-05-31) | Correctif |
|---|---|
| RPC de reversal appelables en direct via PostgREST (bypass du PIN) | `20260619000030` → régression → `20260709000010` → régression → `20260710000082/000084` ; **régresse à chaque bump, cf. Pattern 5** |
| PIN dans le corps JSON de `void-order` / `cancel-item` | migré en en-tête `x-manager-pin` ; `kiosk-issue-jwt` conforme |
| `view_b2b_invoices` / `view_ar_aging` sans `security_invoker` ; MV `mv_*` lisibles par `anon` | `20260619000020/000021` |
| Vue legacy `audit_log` écrite en parallèle + append-only sur RLS seule | vue + trigger DROPPÉS (`20260710000087/000088`) ; GRANT durci `20260619000022` |
| PII `customers` lisible sans gate `customers.read` | gate en place |
| `user_profiles.pin_hash` lisible par `authenticated` | REVOKE au niveau colonne |
| RPC PIN-in-arg sans persistance des échecs (brute-force illimité) | helper `_verify_pin_with_lockout` (`20260622000010`) + câblage sur `create_manual_je`, `approve_expense`, `sign_zreport`, `close_fiscal_period`, `complete_order` (`20260622000011..015`) |

## Audit checklist (5 dimensions : argent / identité / traçabilité / exposition / intégrité)

Lancer une section quand un trou est suspecté. Chaque ligne est un SQL ou un grep exécutable.
**Résoudre la version live de chaque famille citée avant de lancer le contrôle.**

### A. Argent & anti-fraude (reversals, remises, caisse, JE)

- [ ] **Tout reversal exige un PIN manager.** Pour les familles `refund_order_rpc`,
  `void_order_rpc`, `cancel_order_item_rpc` : confirmer qu'un contrôle de PIN manager existe
  ET que l'`actor_id` d'audit est le *manager*, pas le caissier (un reversal avec le caissier
  pour seul acteur = vecteur de fraude). *Résoudre la version live sur le call-site de l'EF ;
  au 2026-08-31 c'était v10 / v10 / v6, chiffre daté qui ne se recopie pas.*
- [ ] **PIN en en-tête, pas dans le corps.** Greper les EF de reversal et la famille
  `create_manual_je` pour des PIN lus dans le corps (`body.manager_pin`, `p_manager_pin`) :
  chaque occurrence est un secret dans les logs (Pattern 4).
- [ ] **Remise / surcharge de prix gatée et loggée** (`sales.discount` ou équivalent) avec
  montant et motif dans l'audit : les remises non loggées sont le canal de fraude caissier n°1.
- [ ] **Les mouvements de caisse se réconcilient.** La famille `record_cash_movement`
  (apport/retrait/banque) écrit un audit et, le cas échéant, un JE ; la clôture (famille
  `close_shift` → snapshot `z_reports`) réconcilie `cash_in - cash_out` contre le comptage.
  Un retrait avec `reason` NULL/vide = à signaler.
- [ ] **Le JE manuel est sous double contrôle** : la famille `create_manual_je` exige des
  lignes équilibrées (débit XOR crédit, somme nulle), un PIN manager, écrit l'audit
  `accounting.je.create_manual`, et l'antidatage hors période fiscale ouverte est bloqué
  (verrou de la famille `close_fiscal_period`).
- [ ] **Auto-approbation : seul SUPER_ADMIN y a droit.** La famille `approve_expense` bloque
  `created_by = approbateur` pour tous les rôles SAUF SUPER_ADMIN, `UNIQUE(expense_id,
  approver_user_id)` tient, et la dérogation écrit `expense.self_approved` (Pattern 8). Test :
  approuver sa propre dépense en MANAGER → refus ; en SUPER_ADMIN → succès **plus** la ligne
  dédiée. `SELECT actor_id, metadata FROM audit_logs WHERE action = 'expense.self_approved'` :
  toute ligne dont l'acteur n'est pas SUPER_ADMIN est un finding.

### B. Identité & accès (intégrité RBAC, auth, session)

- [ ] **Aucune RPC definer sans gate.** `SELECT proname FROM pg_proc WHERE prosecdef AND
  proname NOT LIKE '\_%'` puis greper chacune pour `has_permission`. Les helpers internes
  (préfixe `_`, REVOKEd de `authenticated`) sont exemptés ; les RPC appelables non.
- [ ] **Les overrides ne sont pas une porte dérobée.** `SELECT * FROM
  user_permission_overrides WHERE is_granted` — tout GRANT permanent doit porter une raison
  documentée et, si pertinent, une `expires_at`. Un caissier avec un override
  `expenses.approve` défait la SOD. Poses/retraits tracés par
  `user.permission_override_set` / `user.permission_override_removed`.
- [ ] **Les grants de rôle correspondent à l'intention — mais la matrice est ÉDITABLE.**
  Croiser `role_permissions` pour un rôle bas portant un code sensible (CASHIER avec
  `pos.sale.refund`, `accounting.*`, `users.*`, `rbac.manage`). **Un écart n'est plus
  forcément une régression de migration : depuis l'ADR-031 c'est peut-être une décision prise
  à l'écran** — chercher la ligne d'audit (trigger de matrice, rapport Permission changes)
  avant de conclure à une fraude.
- [ ] **Les rôles créés à l'écran sont sains.** Depuis l'ADR-032, `roles` peut contenir des
  rôles hors seed : `SELECT code, is_system FROM roles`, puis pour chaque `is_system = false`
  vérifier ses grants (le clone ne copie jamais `rbac.manage`) et l'audit `role.created`.
- [ ] **Lockout & rate-limit couvrent tous les chemins d'auth** : `auth-verify-pin` les
  applique, aucun chemin alternatif (kiosk, RPC PIN-in-arg) ne les contourne. Rappel
  Pattern 11 : le chemin RPC code un 5/15 en dur, désynchronisé du réglage.
- [ ] **La durée de session est bornée par rôle** : `roles.session_timeout_minutes` renseigné
  (bornes 5..480, CASHIER court) et `useIdleTimeout` monté dans POS et BO. L'édition vit dans
  la fiche rôle (ADR-031), plus dans la page Security des réglages.

### C. Traçabilité (complétude du journal d'audit)

- [ ] **Toute RPC mutante écrit une ligne d'audit.** Pour chaque `SECURITY DEFINER` qui mute
  l'état, confirmer un `INSERT INTO audit_logs`. Trous connus et tolérés : quelques RPC
  status-only (`mark_item_served`, `send_items_to_kitchen`) — à documenter. Une mutation
  d'**argent, d'identité ou de schéma** sans audit n'est jamais acceptable.
- [ ] **`actor_id` est un `user_profiles.id`, pas `auth.uid()`.** Contrôle transverse à
  passer sur tout écrivain d'audit : `SELECT a.action, count(*) FROM audit_logs a
  LEFT JOIN user_profiles p ON p.id = a.actor_id WHERE a.actor_id IS NOT NULL AND p.id IS NULL
  GROUP BY 1` — toute ligne remontée a été écrite avec un `auth.uid()` et affichera « system »
  dans les rapports.
- [ ] **`entity_id` renseigné (ou NULL documenté).** `SELECT action, count(*) FROM audit_logs
  WHERE entity_id IS NULL GROUP BY action`. Connu : `role.session_timeout_changed` porte
  `role_code` dans le payload. Tout autre NULL casse le drill-down → à signaler.
- [ ] **Le replay est distinguable.** Les retries idempotents loggent une action `*.replay`
  (p. ex. `refund.replay`) : la même opération apparaissant N fois sans `.replay` signale une
  couche d'idempotence contournée.
- [ ] **La table d'audit est gatée en lecture — mais par la RLS seule.** La lecture repose
  sur la policy `admin_read` (`get_current_role() IN ('SUPER_ADMIN','ADMIN')`).
  ⚠️ **La famille `get_audit_logs` est SECURITY INVOKER, GRANT EXECUTE à `authenticated`, et
  ne porte AUCUN gate `has_permission`** — constat assumé et écrit dans la migration, pas un
  oubli ; son durcissement est un arbitrage ouvert. Corollaire : `reports.audit.read` et
  `users.view_audit` existent dans l'union `PermissionCode` mais ne gardent pas cette lecture.
  Consommateurs : `AuditPage.tsx`, `useSettingsHistory`, `useProductAuditLog`.
- [ ] **Complétude de la LECTURE : le journal affiché est-il le journal réel ?** Un contrôle
  d'audit-completeness ne s'arrête pas à « la ligne est écrite », il vérifie qu'elle
  **ressort** : comparer `SELECT count(*) FROM audit_logs WHERE <filtre>` à ce que rend la
  famille `get_audit_logs` sur le même filtre. Écart connu **non expliqué** : le 2026-08-08,
  l'onglet History d'un produit rendait 5 lignes sur 7, les 2 manquantes étant exactement
  celles à `actor_id IS NULL` (deux `product.cost_recomputed` — la réponse à « pourquoi ma
  marge a bougé »). **Re-vérifié le 2026-08-31 : ni le corps live de la RPC ni la policy
  `admin_read` ne filtrent sur `actor_id`, et la base dev portait 763 lignes sans acteur sur
  8 220.** Symptôme réel et daté, cause ailleurs qu'on ne le croyait — à re-prouver avant
  d'agir, jamais à citer comme un comportement documenté. Noter aussi que `payload` (le diff)
  n'est servi par aucun membre de la famille : seul `metadata` est affichable.
- [ ] **Les lectures sensibles sont loggées là où ça compte** : les exports en masse de
  PII/financiers (CSV/PDF) devraient émettre une ligne d'audit — un manager qui aspire la
  liste clients doit être visible.

### D. Exposition de données (PII & fuite d'information)

- [ ] **anon ne voit rien** sur `customers`, `orders`, `payments`, `expenses`,
  `journal_entries`, `audit_logs` : `has_table_privilege('anon','customers','SELECT')` = false,
  et `has_table_privilege('anon','mv_sales_daily','SELECT')` = false en contrôle de
  non-régression (le trou MV est corrigé, `20260619000020`).
- [ ] **La lecture PII client est gatée** : la policy SELECT sur `customers` ne doit pas se
  contenter de `is_authenticated()` ; le BO passe par `customers.read`, le POS par une RPC
  definer étroite. Et **`pin_hash` reste illisible** — `REVOKE SELECT (pin_hash) … FROM
  authenticated` (niveau colonne) ne doit pas réapparaître dans un grant.
- [ ] **Les colonnes PII client sont protégées en écriture** : `customers` n'autorise
  INSERT/UPDATE `authenticated` que sur `(name, phone, email, customer_type, category_id,
  birth_date, marketing_consent, b2b_*)` ; fidélité/dépense/visites ne mutent que par RPC
  definer. Vérifier qu'aucun élargissement n'a été introduit.
- [ ] **Les vues ne contournent pas la RLS** (Pattern 9) ; les MV ne sont grantées ni aux
  rôles bas ni à anon.
- [ ] **Pas de PII dans les logs/metadata.** Greper `metadata`/`payload` et les logs d'EF pour
  téléphones/emails/PIN bruts : une PII dans `metadata` fuit même si la table est gatée.
- [ ] **Les messages d'erreur n'énumèrent pas** (pas de « utilisateur inconnu » vs
  « mauvais PIN »).

### E. Append-only & intégrité de schéma

- [ ] **Les ledgers refusent UPDATE/DELETE.** Pour chaque table append-only (Pattern 10),
  `has_table_privilege('authenticated','<t>','UPDATE')` = false. Si vrai, le REVOKE a régressé.
- [ ] **`search_path` épinglé sur toutes les definer.** `SELECT proname FROM pg_proc WHERE
  prosecdef AND proconfig IS NULL` → chaque résultat est un risque de détournement.
- [ ] **Paire REVOKE sur chaque RPC neuve** (Pattern 6) : ALTER DEFAULT PRIVILEGES manquant
  = anon hérite via PUBLIC.
- [ ] **La suite pgTAP de sécurité passe**, via MCP `execute_sql` en BEGIN/ROLLBACK, sur
  `supabase/tests/` : `security.test.sql`, `security_{anon_grants, append_only_ledgers,
  authenticated_policies, leak_guard, partition_grants, refund_sequences}.test.sql`,
  `expense_governance.test.sql`, `s26_db_hardening.test.sql`, `pin_policy.test.sql`.
  Rappel Pattern 2 : un test qui suppose la matrice RBAC seedée est fragile.

## Checklists préventives (5 interventions concrètes)

### 5.A — Avant d'ajouter une RPC sensible (mutation d'argent / identité / données)
- [ ] `SECURITY DEFINER` + `SET search_path = public` + `has_permission(auth.uid(),
  'module.action')` explicite levant `P0003` ; paire REVOKE (Pattern 6).
- [ ] Si elle déplace de l'argent ou inverse une transaction → PIN manager en second facteur
  venu de l'**en-tête** (`x-manager-pin` dans l'EF, validé avant la RPC), `actor_id` d'audit
  = le manager approbateur ; `p_idempotency_key UUID` si retry-safe, le replay renvoyant le
  résultat initial et loggant `*.replay`.
- [ ] `INSERT INTO audit_logs` avec les colonnes canoniques et une `metadata` utile (montants,
  motif) mais **sans secret ni PII** ; `actor_id` résolu en `user_profiles.id`.
- [ ] pgTAP : nominal + permission refusée + (si argent) PIN requis + replay + assertion
  REVOKE-from-anon ; types régénérés via MCP `generate_typescript_types`.

### 5.B — Avant d'ajouter un code de permission
- [ ] Ajouter à `permissions` (seed, `ON CONFLICT DO NOTHING`) ET à l'union `PermissionCode`
  de `packages/supabase/src/rls/permissions.ts` (137 entrées au 2026-08-31 — compteur daté,
  à recompter, pas à recopier).
- [ ] Moindre privilège : accorder au rôle le **plus haut** qui en a besoin, pas « MANAGER+
  par défaut » ; re-justifier tout grant CASHIER. **Un grant de seed n'est plus définitif** :
  depuis l'ADR-031 un SUPER_ADMIN peut le modifier à l'écran — l'audit lit la base.
- [ ] Câbler le gate : `PermissionGate` / `authStore.hasPermission` côté UI, `has_permission`
  dans la RPC (un gate purement UI est cosmétique) ; pgTAP prouvant que le code refuse un rôle
  qui ne l'a pas, en posant l'état de matrice **dans la transaction de test**.

### 5.C — Avant d'exposer des données par une vue / un rapport / une RPC
- [ ] Vue : `WITH (security_invoker = on)` ; jamais de vue definer sur de la PII sans raison
  forte. Si elle agrège (MV/rapport) : l'agrégat lui-même n'est pas sensible et le SELECT est
  gaté. Pas de PII brute dans la projection si la permission du consommateur ne la justifie
  pas ; masquer téléphone/email quand un nom suffit. Auditer les exports en masse.

### 5.D — Avant de toucher au code d'auth, de PIN ou de session
- [ ] Lockout + rate-limit préservés ; toute voie d'auth (kiosk, RPC PIN-in-arg) passe par le
  même comptage. Si un seuil de lockout bouge, le modifier **des deux côtés** (politique
  configurable côté EF **et** helper `_verify_pin_with_lockout`), sinon la divergence du
  Pattern 11 s'aggrave.
- [ ] PIN jamais loggé, jamais renvoyé, jamais dans un corps qui se logge ; bcrypt ≥10 ; jeton
  de session haché au repos. Robustesse PIN avertissement → blocage : étaler, motiver.
- [ ] pgTAP / test d'EF : compte verrouillé rejeté, session expirée rejetée.

### 5.E — Avant de modifier un REVOKE / une RLS / une contrainte append-only
- [ ] Relâcher un REVOKE append-only ou une RLS couvre presque toujours un bug latent —
  trouver la cause réelle d'abord. Si une table doit accepter une correction : RPC
  compensatoire ou famille `_void`, jamais rouvrir UPDATE/DELETE à `authenticated`.
- [ ] Rejouer toute la suite pgTAP de sécurité + celle du module concerné ; objets neufs :
  re-confirmer que la ligne ALTER DEFAULT PRIVILEGES FROM PUBLIC tient.

## Sources de vérité (points d'entrée — résoudre la version live avant de citer)

```
RBAC / permissions
  20260517000030_refactor_has_permission.sql       # has_permission 4 étages (dernière définition)
  *seed*permission*.sql                            # pattern de seed (DO, ON CONFLICT)
  20260825000001..000009_*.sql                     # éditeur RBAC ADR-031/032 : rbac.manage,
      # correctif actor_id du trigger de matrice, familles set_role_permission,
      # set_user_permission_override, delete_user_permission_override, create_role, delete_role
  docs/adr/031-rbac-editable-super-admin.md   docs/adr/032-cycle-de-vie-des-roles.md
  packages/supabase/src/rls/permissions.ts         # union PermissionCode + helpers
  apps/backoffice/src/stores/authStore.ts          # gate client (Zustand)
  apps/backoffice/src/pages/settings/roles/  + features/settings/roles/components/

Audit
  20260503000005_init_settings.sql   # audit_logs (canonique, SEULE surface)
  20260523000019 (+payload)   20260619000022 (append-only GRANT)   20260710000087/000088 (vue droppée)
  *get_audit_logs*.sql               # famille de lecture (bornes de dates métier)
  apps/backoffice/src/pages/reports/AuditPage.tsx  + features/reports/hooks/useAuditLogs.ts

Auth / PIN / rate-limit / session
  supabase/functions/auth-verify-pin/index.ts   # bcrypt, lockout configurable, JWT
  supabase/functions/_shared/{idempotency.ts,rate-limit.ts,cors.ts}
  20260622000010_create_verify_pin_with_lockout_helper.sql   # chemin RPC (5/15 EN DUR)
  *pin_policy*.sql   20260523000010..012_*rate_limit*.sql   20260523000020 (session timeout)
  packages/utils/src/pin-strength.ts   packages/ui/src/hooks/useIdleTimeout.ts

Flux d'argent (vérifier gate + emplacement du PIN + audit pour chacun)
  supabase/functions/{refund-order,void-order,cancel-item,process-payment,verify-manager-pin}/
  *refund* *void* *cancel* *cash_movement* *manual_je* *expense*approve*.sql
  20260706000023_allow_super_admin_self_approve_expense_v3.sql   # exception SOD

Durcissement anon / RLS / append-only
  20260524000020..031_*.sql   # balayage anon+PUBLIC (+ _031 correctif FROM PUBLIC)
  20260619000020/000021_*.sql # security_invoker + REVOKE MV
  *b2b_payments* *expense_approvals* *internal_transfers*.sql

Tests (vérité comportementale, liste complète en checklist E) + CLAUDE.md "Critical patterns"
```
(chemins nus = `supabase/migrations/` ou `supabase/tests/`.)

## Vérification avant d'annoncer un audit ou un correctif complet

```bash
pnpm typecheck
# pgTAP de sécurité via MCP execute_sql, enveloppe BEGIN/ROLLBACK (liste en checklist E)
pnpm --filter @breakery/app-backoffice test roles     # éditeur RBAC / matrice
pnpm --filter @breakery/app-backoffice test audit     # visualiseur du journal
```

Les filtres vitest matchent le **nom de fichier**, pas le `describe`, et beaucoup de tests du
BO sont en kebab-case : localiser par glob avant de conclure « ça passe ». Auditer toujours
contre le cloud V3 dev `ikcyvlovptebroadgtvd` via le MCP Supabase — jamais la prod
(`abjabuniwkqpfsenxljp`, lignée incompatible), en `BEGIN … ROLLBACK`.

## Quand escalader (signaler, ne pas continuer en silence)

- Une `SECURITY DEFINER` sans gate `has_permission` ou sans `SET search_path` ; une RPC
  mutante d'argent/identité/schéma sans ligne d'audit ; un `actor_id` écrit avec `auth.uid()`.
- Une RPC d'argent/reversal sans second facteur manager, avec le caissier pour seul `actor_id`,
  OU `GRANT EXECUTE TO authenticated` la rendant appelable via PostgREST en contournant le PIN
  de l'EF (Pattern 5 — **régresse à chaque bump**) ; un PIN lu depuis le corps ; tout nouveau
  chemin d'auth qui saute lockout, rate-limit ou audit.
- `pin_hash` (ou toute colonne de secret) lisible par `authenticated`, PII `customers` lisible
  sans gate, NOUVELLE vue PII/financiers sans `security_invoker`, MV lisible par `anon`.
- Un GRANT permanent d'override sans raison documentée, un rôle bas portant une permission
  sensible, un rôle non-système (ADR-032) trop doté, un clone ayant hérité `rbac.manage` —
  **après avoir vérifié que ce n'est pas une décision prise à l'écran** (ADR-031) : chercher
  la ligne d'audit avant de crier à la fraude.
- Sur le point de relâcher un REVOKE append-only ou une policy RLS (couvre presque toujours un
  bug latent) ; ou un écart entre ce que `audit_logs` contient et ce que la famille
  `get_audit_logs` rend — un journal incomplet est un défaut de contrôle, pas d'affichage.
