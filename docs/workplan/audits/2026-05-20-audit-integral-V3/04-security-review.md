# Vague 4 — Security Review (RBAC + RLS + Auth + EFs)

> **Date** : 2026-05-20
> **Skill** : anthropic-skills:security-review (skill V2-scoped — appliqué manuellement sur V3)
> **Scope** : RBAC matrix, RLS, PIN auth, Edge Functions, idempotency, audit log, secrets, session timeout, GRANT hardening
> **Effort réel** : ~95 minutes
> **Scope DB** : 312 migrations, ~115 permission codes, 75 tables, 7 rôles, 11 Edge Functions

## TL;DR

Posture sécurité de V3 globalement **SOLIDE** mais avec **2 vulnérabilités critiques** (un secret cron hardcodé en clair dans Git + des permissions de gestion utilisateur jamais seedées qui rendent les RPCs admin user inaccessibles à TOUT rôle), **3 hauts findings** (déviation auth flow BO, `verify_jwt` non explicite sur 6 EFs sur 11, `_shared/permissions.ts` lit des colonnes inexistantes silencieusement → user overrides ignorés), et plusieurs medium/low. Le pattern S20 GRANT-hardening + S25 idempotency cross-EF + S19 rate-limit durable est globalement préservé. Le helper `has_permission()` v7 est verrouillé et utilisé uniformément ; les 35 migrations REVOKE pair `_anon + _PUBLIC` postérieures à S20 suivent le canon. Action immédiate : rotation du secret cron + seed des permissions `users.create/users.update` + couverture explicite de `verify_jwt` dans `supabase/config.toml`.

## Posture sécurité globale

| Pilier | Statut | Notes |
|---|---|---|
| RLS coverage | **OK** | 75/75 tables `ENABLE ROW LEVEL SECURITY` ; 161 policies actives ; pas de `DISABLE ROW LEVEL SECURITY` |
| Helper `has_permission()` v7 | **LOCKED** | Refactor S13 D10 pure-lookup ; aucun `CREATE OR REPLACE` ulterior ; CI grep gate documenté |
| PIN auth flow integrity | **PARTIAL** | POS conforme ; BackOffice utilise `auth.setSession()` explicitement interdit par CLAUDE.md |
| GRANT hardening S20 | **LOCKED** | Anon REVOKE en place sur tables/vues/fonctions ; futures migrations (S22+) suivent le pattern paire `_anon + _PUBLIC + ALTER DEFAULT PRIVILEGES` |
| Rate-limit durable | **5/5 EFs sensibles câblées** | `auth-verify-pin`, `kiosk-issue-jwt` (×2 buckets), `refund-order`, `void-order`, `cancel-item` ; `auth-change-pin` + `notification-dispatch` + `process-payment` ne sont PAS rate-limitées |
| Idempotency cross-EF | **1/3 EFs mutantes câblées** | `refund-order` v7 utilise `_shared/idempotency.ts` + header `x-idempotency-key` ; `void-order`, `cancel-item` NON ; `process-payment` utilise `idempotency_key` body (legacy v7 pattern, OK pour rétrocompat mais incohérent) |
| Audit log coverage | **OK** | 52 INSERTs SQL + 8 INSERTs EF ; actions sensibles couvertes (login.success/failed, refund.replay, kiosk.token.issued, role.session_timeout_changed, product.update, b2b.payment.recorded) |
| Secrets management | **FAIL** | 1× secret cron hardcodé dans 2 migrations + 1 fichier test (`birthday-cron-daily`) ; `.env` correctement gitignored ; pas d'autre secret hardcodé détecté |
| Session timeout per role | **OK** | RPC + `useIdleTimeout` wired dans POS + BO ; defaults respectent CHECK 5..480 |
| CORS allowlist | **MEDIUM** | `'Access-Control-Allow-Origin': '*'` sur toutes les EFs (mitigé par Bearer auth obligatoire) |
| `verify_jwt` config explicite | **PARTIAL** | 5/11 EFs déclarées dans `config.toml` ; 6 EFs (`refund-order`, `void-order`, `cancel-item`, `kiosk-issue-jwt`, `notification-dispatch`, `customer-birthday-notify`) reposent sur les defaults Supabase |

## Findings (OWASP-like format)

### Critiques — vuln exploitable / data leak

| ID | CWE | Catégorie | Finding | Fichier:ligne | PoC | Remediation |
|---|---|---|---|---|---|---|
| SEC-S30-CRIT-01 | CWE-798 | Hardcoded credential | Secret `BIRTHDAY_CRON_SECRET = 'birthday-cron-daily'` hardcodé en clair dans 2 migrations committées + 1 test public. Permet à tout lecteur du repo de POST `customer-birthday-notify` et déclencher un envoi de notifications email aux clients (DoS marketing + abus Resend quota + collecte de bounces) | `supabase/migrations/20260525000011_schedule_birthday_cron_ef.sql:37` ; `supabase/migrations/20260525000012_fix_birthday_cron_ef_net_schema.sql:23` ; `supabase/functions/customer-birthday-notify/__tests__/birthday.test.ts:22` | `curl -X POST https://ikcyvlovptebroadgtvd.functions.supabase.co/customer-birthday-notify -H "x-cron-secret: birthday-cron-daily" -d '{}'` → 200 et traitement effectif | (1) Rotation immédiate `BIRTHDAY_CRON_SECRET` (Supabase Dashboard → Functions → Env Vars → générer 32 octets aléatoires). (2) Migration corrective `_xxxxxx_rotate_birthday_cron_secret.sql` qui lit le nouveau secret depuis `vault.secrets` au lieu de l'inliner. (3) Considérer git-filter-repo ou BFG pour purger l'historique si V3 dev devient public, sinon documenter comme révoqué |
| SEC-S30-CRIT-02 | CWE-840 | Business logic — perms manquantes | Permissions `users.create` et `users.update` JAMAIS seedées dans la table `permissions` malgré leur usage dans `create_user_v1`, `update_user_role_v1`, `delete_user_v1`, `update_user_profile_v1`, `reset_user_pin_v1`. Le helper `has_permission()` v7 fait `EXISTS (SELECT 1 FROM role_permissions WHERE permission_code = p_perm)` → retourne FALSE pour tous rôles (y compris ADMIN/SUPER_ADMIN car ils sont seedés via `SELECT 'ADMIN', code FROM permissions` qui ne contient pas la perm). Conséquence : la console RBAC du BO ne peut créer/modifier/supprimer aucun user. Le bug est masqué par le fait que les premiers users ont été créés via seed.sql/SQL direct | `supabase/migrations/20260517000200_create_user_rpcs.sql:80,150,250` (RPCs qui réfèrent à `users.create` / `users.update`) ; `supabase/migrations/20260517000030_refactor_has_permission.sql:172-180` (seed perms — `users.read` et `users.view_audit` présentes, `users.create`/`users.update` ABSENTES) | Via BO connecté en SUPER_ADMIN : POST `useCreateUser` → RPC `create_user_v1` → `RAISE EXCEPTION 'missing permission users.create' USING ERRCODE = '42501'` | Migration corrective `_xxxxxx_seed_users_management_perms.sql` : `INSERT INTO permissions (code, module, action, description) VALUES ('users.create', 'users', 'create', '...'), ('users.update', 'users', 'update', '...') ON CONFLICT DO NOTHING;` PUIS `INSERT INTO role_permissions (role_code, permission_code) SELECT 'SUPER_ADMIN', code FROM (VALUES ('users.create'), ('users.update')) AS v(code) ON CONFLICT DO NOTHING;` (idem ADMIN). Ajouter test pgTAP qui assert toutes les perms référencées dans les RPCs `has_permission(_, 'X')` existent dans `permissions` |

### Élevés — vuln avec contournement non trivial

| ID | CWE | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| SEC-S30-HIGH-01 | CWE-345 | Auth flow integrity | BackOffice viole la convention critique CLAUDE.md « JAMAIS de `auth.setSession()` raw » : `apps/backoffice/src/stores/authStore.ts:67` appelle `await supabase.auth.setSession({ access_token, refresh_token })` au lieu de `setSupabaseAccessToken(token)` (pattern POS correct). Risque double : (1) GoTrue moderne (ES256) rejette les JWT HS256 émis par `auth-verify-pin`, donc `setSession` échoue silencieusement → `auth.uid()` retourne NULL côté Postgres → toutes les requêtes RLS échouent ou retournent vide (mais l'UI ne le détecte pas car `getSupabaseClient()` n'a pas son `_accessToken` populé). (2) Si `setSession()` réussit dans un mode dégradé, le JWT est stocké dans le storage GoTrue avec un refresh-token contrefait `pin-session:...` → tentative de refresh automatique → erreurs cascading. Le BO est PROBABLEMENT NON FONCTIONNEL en RLS sauf en SUPER_ADMIN (via la branche `unconditional-true`). Aucun `setSupabaseAccessToken` n'apparaît dans `apps/backoffice/` (grep exhaustif négatif) | `apps/backoffice/src/stores/authStore.ts:67,91` | Aligner BO sur POS : remplacer `supabase.auth.setSession(...)` par `setSupabaseAccessToken(res.auth.access_token)` (login) et `setSupabaseAccessToken(null)` (logout). Ajouter test smoke qui assert `getSupabaseAccessToken() === res.auth.access_token` après login |
| SEC-S30-HIGH-02 | CWE-285 | Schema drift — user overrides ignorées | `supabase/functions/_shared/permissions.ts` lit `user_permission_overrides.override_type` (chaîne `'GRANT'`/`'DENY'`) ET filtre sur `.eq('user_id', userId)`. Or le schéma migration `20260517000030_refactor_has_permission.sql:46-55` définit `user_permission_overrides (user_profile_id UUID, permission_code TEXT, is_granted BOOLEAN, reason TEXT, ...)`. Donc : (a) le filtre `user_id` match RIEN car la colonne s'appelle `user_profile_id` → PostgREST renverra une erreur ou un set vide ; (b) si la requête réussit, `o.override_type` est `undefined` → ni GRANT ni DENY appliqué. Résultat : les overrides utilisateur (DENY explicite ou GRANT exceptionnel) sont **silencieusement ignorés à l'login**. Le helper SQL `has_permission()` lui-même fonctionne correctement (DB-side), donc le gate côté DB est OK ; mais le client cache la liste retournée par `computePermissionsForRole` → divergence entre UI (overrides ignorées) et DB (overrides appliquées) | `supabase/functions/_shared/permissions.ts:56-69` | Réécrire la requête : `.from('user_permission_overrides').select('permission_code, is_granted').eq('user_profile_id', userId)` puis `if (o.is_granted === false) perms.delete(code); else perms.add(code);` Ajouter test Vitest qui crée un override DENY et assert qu'il est filtré du retour de `computePermissionsForRole` |
| SEC-S30-HIGH-03 | CWE-352 | Config drift — verify_jwt implicite | `supabase/config.toml` ne déclare `verify_jwt` que pour 5 des 11 Edge Functions : `auth-verify-pin` (false), `auth-get-session` (false), `auth-logout` (false), `auth-change-pin` (false), `process-payment` (true). Les 6 autres (`refund-order`, `void-order`, `cancel-item`, `kiosk-issue-jwt`, `notification-dispatch`, `customer-birthday-notify`) héritent du default Supabase = `true`. Or `customer-birthday-notify` DOIT être public-callable (cron pg_net via x-cron-secret) ET `kiosk-issue-jwt` doit être appelable AVANT que le kiosk ait un JWT — donc ces deux EFs n'ont pas le bon comportement local (mais cloud peut être configuré différemment via Dashboard, créant un drift local↔cloud). Risque : déploiement local-first ne reproduit pas le cloud, et un futur reset du cloud via supabase CLI propage le default `verify_jwt=true` à `customer-birthday-notify` → cron rompu silencieusement | `supabase/config.toml:367-383` (n'a que 5 entrées) | Ajouter 6 stanzas explicites dans `config.toml` : `[functions.refund-order]` `verify_jwt = true` ; idem `void-order`, `cancel-item` ; `[functions.kiosk-issue-jwt]` `verify_jwt = false` ; `[functions.notification-dispatch]` `verify_jwt = false` (auth interne via x-secret) ; `[functions.customer-birthday-notify]` `verify_jwt = false`. Documenter dans CLAUDE.md la règle « toute nouvelle EF DOIT déclarer son `verify_jwt` explicitement » |

### Moyens — defense-in-depth manquante

| ID | CWE | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| SEC-S30-MED-01 | CWE-942 | CORS wildcard | `supabase/functions/_shared/cors.ts:3` définit `'Access-Control-Allow-Origin': '*'` pour TOUTES les EFs y compris les sensibles (`auth-verify-pin`, `refund-order`, `void-order`, `cancel-item`). Mitigé en pratique par : (a) Bearer auth obligatoire (un attaquant doit déjà avoir un JWT valide) ; (b) `auth-verify-pin` est public-callable par design (login). Mais ouvre une surface CSRF résiduelle sur EFs qui acceptent un Bearer (le navigateur joint le cookie/credentials sur la requête cross-origin) | `supabase/functions/_shared/cors.ts:3` | Refactor `corsHeaders` pour accepter un allowlist `['https://pos.thebreakery.com', 'https://bo.thebreakery.com']` lu depuis env `CORS_ALLOWED_ORIGINS` ; fallback `*` en dev. Vérifier `Origin` request header avant de retourner le bon `Allow-Origin` |
| SEC-S30-MED-02 | CWE-1392 | Audit FK violation latent | 11 RPCs SECURITY DEFINER insèrent dans `audit_logs.actor_id` la valeur `v_caller_id := auth.uid()` qui est `auth.users.id` (UUID), MAIS `audit_logs.actor_id REFERENCES user_profiles(id)`. Si `user_profiles.id ≠ auth.users.id` (c'est le cas par défaut — `gen_random_uuid()` indépendant + `auth_user_id` colonne séparée), l'INSERT lève FK violation → transaction rollback → l'UPDATE/INSERT métier précédent est annulé. Le pattern correct (utilisé par `record_stock_movement_v1`, `pay_existing_order_rpc`, et 30+ autres) est `SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid`. Affecté : `update_role_session_timeout_v1`, `update_product_v1`, `create_product_v1`, `set_product_units_v1`, `set_product_sections_v1`, `upsert_product_modifiers_v1`, `create_category_v1`, `update_category_v1`, `reorder_categories_v1`, `fix_reorder_categories_v1_ambiguous_id`, `fix_set_product_sections_v1_primary_reassign`. **Le fait que les tests pgTAP T5 passent suggère que sur V3 dev cloud, le seed `EMP000` a artificiellement `user_profiles.id == auth.users.id`** — convention dev non documentée. Risque : si en prod un nouveau user est créé par GoTrue admin avec un UUID différent, ces 11 RPCs deviennent inutilisables silencieusement | Multiples — voir liste dans Finding | Refactor : extraire le pattern `_resolve_caller_profile(p_uid uuid) RETURNS uuid` helper SECURITY DEFINER STABLE et l'utiliser systématiquement. Migration corrective qui patch les 11 RPCs. Test pgTAP qui crée un user dont `id ≠ auth_user_id` et exécute un appel à chaque RPC |
| SEC-S30-MED-03 | CWE-307 | Rate-limit gap sur EFs mutantes | `auth-change-pin`, `notification-dispatch`, `process-payment` ne sont PAS rate-limitées. Cible évidente : brute-force du `current_pin` via `auth-change-pin` (l'EF appelle `verify_user_pin` RPC sans rate-limit propre — la seule défense est le compteur DB `failed_login_attempts` qui ne s'incrémente PAS sur ce chemin car le code path n'a pas le `MAX_FAILED`/`locked_until` logic d'`auth-verify-pin`). Permet à un attaquant détenant un session token valide de brute-forcer le PIN actuel pour le rotate | `supabase/functions/auth-change-pin/index.ts` (pas d'appel à `checkRateLimitDurable`) ; `supabase/functions/process-payment/index.ts` ; `supabase/functions/notification-dispatch/index.ts` | Câbler `checkRateLimitDurable({ functionName: 'auth-change-pin', bucketKey: 'session:' + sessionResult.sessionId, maxPerWindow: 5, windowSec: 60 })` en tête de `auth-change-pin`. Pour `process-payment` envisager bucket sur `user_id` avec maxPerWindow: 30/min pour éviter abuse caisse. `notification-dispatch` est moins critique (auth interne) |
| SEC-S30-MED-04 | CWE-209 | Error leak optional | `process-payment` retourne `error.message` au client sur tous les codes d'erreur RPC (`P0001`, `P0002`, `P0003`, `P0010`, `23514`, `internal`). Le message Postgres peut contenir des indices internes (e.g. "session_id = abc not found" leak des UUIDs valides). À comparer avec `auth-verify-pin` qui utilise `redactError()` systématique | `supabase/functions/process-payment/index.ts:166-171` | Wrapper avec `logAndRedact` / `redactError` ; whitelist explicite des codes safe (`insufficient_stock`, `no_open_session`) avec message générique pour le reste |
| SEC-S30-MED-05 | CWE-732 | Cost price escape hatch | `create_product_v1` whitelist accepte `cost_price` dans le payload (line 15), bypassant le hardening WAC `update_cost_price_v1` (S22). À la création il n'y a pas encore d'historique WAC à corrompre, mais la philosophie « tout `cost_price` passe par RPC dédiée + audit stock_movements » est cassée pour la création. Permet à un MANAGER (qui a `products.create` mais pas `inventory.update`) d'initialiser un cost_price arbitraire sans trace `stock_movements` | `supabase/migrations/20260520101735_create_create_product_v1_rpc.sql:15-16,73,86` | Soit (a) retirer `cost_price` de `v_allowed` et forcer `cost_price = 0` à la création, puis exiger un appel `receive_stock_v1` ou `update_cost_price_v1` pour le set ; soit (b) si vraiment souhaité, émettre un `stock_movements` row `movement_type='initial_cost'` en parallèle de l'INSERT |
| SEC-S30-MED-06 | CWE-863 | RBAC matrix incohérence Owner | Aucun rôle « Owner » dans la table `roles` (seed définit `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, `waiter`). Les rôles évoqués dans la spec V2 (Owner, Manager, Cashier, Barista, Kitchen, Accountant, Stockman) ne sont PAS tous implémentés. Conséquence : la matrice est de facto 5 rôles, pas 7. Si la spec attend que `Barista` ait des perms spécifiques inventory.production.create + KDS, c'est manquant. Aucune perm `Barista/Kitchen` séparée de `CASHIER` n'a été observée | `supabase/migrations/20260517000030_refactor_has_permission.sql:70-76` (seed roles canonique) | Décision produit : (a) si Owner=SUPER_ADMIN intentionnel, renommer dans la doc ; (b) si rôles métier séparés voulus (Barista, Kitchen), créer migration `_seed_extended_roles` avec leurs perms. Aligner `PermissionCode` TS et `packages/supabase/src/enums.ts` |
| SEC-S30-MED-07 | CWE-209 | Idempotency replay metric leak | `record_b2b_payment_v1` retourne `idempotent_replay: true` dans le JSON envelope sans audit log dédié (contrairement à `refund-order` qui INSERT `audit_logs.action='refund.replay'`). Permet à un attaquant qui obtient un idempotency_key valide de probe l'existence d'un payment sans laisser trace forensique | `supabase/migrations/20260601000020_create_record_b2b_payment_v1.sql:74-91` | Ajouter `INSERT INTO audit_logs (action='b2b.payment.replay', actor_id=v_profile_id, entity_id=v_existing_row.id, metadata={'idempotency_key': p_idempotency_key})` dans le bloc replay |

### Bas — info, hardening incrémental

- **SEC-S30-LOW-01** : `void-order` et `cancel-item` continuent à lire `manager_pin` depuis le body JSON (`req.json()`), contrairement à `refund-order` v7 qui a hard-cutover vers le header `x-manager-pin`. Backlog post-S30 sweep documenté dans CLAUDE.md.
- **SEC-S30-LOW-02** : `void-order` n'a pas d'idempotency propagée (`p_idempotency_key` arg). Si un manager double-tap, deux refund_orders peuvent être créés. Mitigé par CHECK constraint sur `order.order_status` mais à durcir lors du sweep.
- **SEC-S30-LOW-03** : `reset_user_pin_v1` accepte 4-8 digits côté DB (`length BETWEEN 4 AND 8`) tandis que `auth-verify-pin` exige strictement 6. Documenté DEV-S19-3.B-01.
- **SEC-S30-LOW-04** : `corsHeaders.Access-Control-Allow-Methods` inclut `GET` sur EFs auth-* qui n'ont pas de pathway GET (sauf `auth-get-session`). Mineur.
- **SEC-S30-LOW-05** : `_shared/idempotency.ts` UUID_REGEX accepte UUID v1-5 (ne valide pas strictement v4 malgré le message). Inoffensif car POS utilise `crypto.randomUUID()` = v4. Documenté DEV-S25-1.A-01.
- **SEC-S30-LOW-06** : Pas de `Strict-Transport-Security`/`X-Frame-Options`/`Content-Security-Policy` headers sur les EFs. Le default Supabase ajoute HSTS au niveau du LB, mais les headers applicatifs sont absents.
- **SEC-S30-LOW-07** : `audit_logs.action` est `TEXT` sans CHECK ni enum — drift possible (e.g. `pin.change_self` vs `pin_change_self`). Considérer migration vers enum ou table catalogue.
- **SEC-S30-LOW-08** : `permissions.action` est `TEXT` sans CHECK — les seeds utilisent `'read'`, `'create'`, `'update'`, `'delete'`, mais aussi `'session.view'`, `'sale.create'` (incohérence : module.action vs sub-namespace inline).
- **SEC-S30-LOW-09** : `kiosk-issue-jwt` calcule un UUIDv5 manuellement sur le `kiosk_id` (deterministic sub) — algorithme custom non testé contre la RFC4122. Risque collision si deux `kiosk_id` hashent identiquement (négligeable mais audit-worthy).
- **SEC-S30-LOW-10** : `session-auth.ts` TIMEOUT_MS est hardcodé 30 min côté EF tandis que le timeout per-role est appliqué côté client (`useIdleTimeout`). Cohérent comme baseline serveur mais double check (côté serveur on log out à 30 min même pour SUPER_ADMIN qui a 240 min en BO).

## Détails par section

### 1. RBAC matrix (~115 perms × 5 rôles effectifs)

Permissions seedées : **~115 codes distincts** observés dans les seeds (`INSERT INTO permissions`). Catégorisation par module :

| Module | Perms | Couverture rôles |
|---|---|---|
| pos.{session,sale} | 9 | CASHIER (5), MANAGER (9), ADMIN/SUPER_ADMIN (9) |
| products | 4 (read/create/update/delete) + 3 (units/sections/modifiers.update — S27) | MANAGER (3) + ADMIN/SUPER_ADMIN (4) ; les 3 S27 = ADMIN+ seulement |
| categories, customers, tables, combos, suppliers | 4 chacune (read/create/update/delete) | MANAGER (3 sans delete) ; ADMIN+ (4) |
| customer_categories, discount_templates | 4 chacune | ADMIN+ only (sensible — pricing) |
| inventory.{read,adjust,receive,waste,transfer.*,opname.*,production.*,sections.update,reservation.*,reservation.release} | 14 | MANAGER (7) ; ADMIN+ (14) |
| accounting.{read,post,reverse,mapping.update,period.close} | 5 | MANAGER (1 read) ; ADMIN+ (5) |
| expenses.{read,create,update,approve,delete,pay,manage} | 7 | MANAGER (4) ; ADMIN+ (7) |
| cash_register.{read,open,close,adjust} | 4 | CASHIER (2 read/open) ; MANAGER (4) ; ADMIN+ (4) |
| reports.{read,export,sales.read,inventory.read,audit.read,financial.read} | 6 | MANAGER (2) ; ADMIN+ (6) |
| settings.{read,update,holidays.manage,kiosk.manage} | 4 | MANAGER (1 read) ; ADMIN+ (4) |
| users.{read,view_audit,create*,update*} | 2 + 2 manquantes | MANAGER (1 read) ; ADMIN+ (2) ; **users.create/update non seedées** |
| rbac.{read,update} | 2 | ADMIN+ only |
| promotions.{read,create,update,delete} | 4 | MANAGER (3) ; ADMIN+ (4) |
| loyalty.{read,adjust} | 2 | MANAGER (1 read) ; ADMIN+ (2) |
| sales.{create,discount,read} | 3 | waiter (1 create) ; MANAGER (1 discount) ; ADMIN+ (3) |
| payments.process | 1 | CASHIER + MANAGER + ADMIN+ |
| audit.read | 1 | ADMIN+ only |
| display.{read,manage} | 2 | ADMIN+ only (kiosk admin) |
| kiosk.issue | 1 | ADMIN+ only (mint kiosk JWT) |
| lan.devices.{read,manage} | 2 | ADMIN+ only |
| print_queue.{read,manage} | 2 | ADMIN+ only |
| notifications.send | 1 | ADMIN+ only |
| kds.operate | 1 | CASHIER + MANAGER + ADMIN+ (kitchen flow) |
| financial.read | 1 | ADMIN+ only |
| shift.{open,close,cash_movement} | 3 | CASHIER + MANAGER + ADMIN+ |
| customers.b2b.update | 1 | MANAGER + ADMIN+ |
| purchasing.po.{create,read,receive,cancel} | 4 | MANAGER + ADMIN+ |

**Rôles** :
- `SUPER_ADMIN` (full system — all 115 perms)
- `ADMIN` (full business — all 115 perms via seed `SELECT 'ADMIN', code FROM permissions`)
- `MANAGER` (whitelist ~50 perms — sans deletes, sans accounting.post/reverse/period.close)
- `CASHIER` (~7 perms — session + sale + payments)
- `waiter` (2 perms — sales.create + products.read)

**Gaps détectés** :
- **CRITIQUE (SEC-S30-CRIT-02)** : `users.create` et `users.update` jamais seedées → RPCs admin user inaccessibles à tous rôles.
- **MEDIUM (SEC-S30-MED-06)** : Rôles métier V2 (Owner, Barista, Kitchen, Accountant, Stockman) non implémentés.
- `accounting.manage` (mentionné dans la spec V2) absent — découpé en `accounting.{read,post,reverse,mapping.update,period.close}` (OK granulaire).
- Permissions « orphelines » seedées mais jamais référencées par RPC ou policy (à vérifier) : `display.manage`, `display.read`, `kds.operate`, `financial.read` (vs `reports.financial.read` qui EST utilisé) — possibles duplications ou dead permissions.
- `audit.read` (dans le S13 seed) vs `audit_log.read` (référencée dans audit_log RLS policy `20260515000002_init_audit_log.sql:30`) — schism nominal entre table `audit_log` (drop S13) et `audit_logs` (canonique). Probable dead policy sur l'ancienne table.

### 2. RLS audit

**Toutes les 75 tables ont RLS ENABLED.** Aucun `DISABLE ROW LEVEL SECURITY` détecté dans les migrations.

161 policies définies. Distribution :
- `auth_read` / `perm_read` SELECT : 75 (1 par table en moyenne)
- `perm_create` INSERT : 22
- `perm_update` UPDATE : 24
- `admin_*` / `super_admin_*` : 18
- `self_*` (overrides self-only) : 8
- Spéciales (`has_kiosk_jwt`, `is_authenticated`) : 14

**Policies `USING(true)` restantes** (par design — données non-PII / catalogue) :
- `expense_categories_select_auth` (`20260517000120:162`) — catégories statiques
- `email_receipt_templates` (2× — receipt + email templates)
- `lan_devices_select_authenticated` (CORRIGÉ S20 W3 → `lan.devices.read`)
- `holidays_select_auth` (`20260517000191:51`) — calendar public read
- `notification_templates_select_auth` (×2) — templates statiques
- `print_queue_select_authenticated` (CORRIGÉ S20 W3 → `print_queue.read OR has_kiosk_jwt()`)
- `display_screens_select_auth`
- `refund_sequences_select_auth` (S20 W1 RLS hotfix — sequences readable)
- `tablet_order_idempotency_keys_select_auth` (S25 — ledger SELECT-only)

Toutes ces sont **OK par design** — pas de PII résiduel.

**Helper `has_permission()` v7 utilisation** : 100% des policies de mutation passent par lui (vérifié sur 22 INSERT + 24 UPDATE policies). Pas de duplication logique. Helper `has_permission_for_profile()` existe pour le cas where = id direct (8 usages).

**Tables sensibles avec policies bien gated** :
- `customers` (PII : phone, email, name) → `auth_read` AND `deleted_at IS NULL` AND `is_authenticated()` (pas de branch kiosk car PII)
- `audit_logs` → `admin_read` only (`role_code IN ('SUPER_ADMIN', 'ADMIN')`)
- `user_profiles` → `auth_read` AND `deleted_at IS NULL` ; `perm_update` self-or `users.update`
- `user_sessions` → own only via `user_id IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())` ; service_role bypasses

**Tables append-only enforcés** (REVOKE INSERT/UPDATE/DELETE FROM authenticated, writes via SECURITY DEFINER) :
- `stock_movements` (S12) ✓
- `audit_logs` (S15) ✓
- `b2b_payments` (S24) ✓
- `tablet_order_idempotency_keys` (S25) ✓
- `journal_entries` / `journal_entry_lines` (S13) ✓
- `loyalty_transactions` (S13) ✓

### 3. PIN auth flow

**Architecture confirmée** :
```
POS PinPad → loginWithPin() → POST /auth-verify-pin
                             → admin.rpc('verify_user_pin', { user_id, pin })
                             → INSERT user_sessions
                             → signJwt(HS256, SUPABASE_JWT_SECRET)
                             → return { user, session: { token }, auth: { access_token (HS256 JWT) }, permissions }

POS App.tsx → setSupabaseAccessToken(access_token)
            → custom-fetch wrapper injects Authorization: Bearer <token>
            → Supabase client requests carry HS256 JWT
            → PostgREST validates HS256 with SUPABASE_JWT_SECRET
            → auth.uid() = profile.auth_user_id côté DB
            → RLS policies evaluate has_permission(auth.uid(), ...)
```

**Conformité POS** : `apps/pos/src/stores/authStore.ts` utilise `setSupabaseAccessToken(res.auth.access_token)` (login) et `setSupabaseAccessToken(null)` (logout). NO `auth.setSession()`, NO `signOut()`. ✓

**Non-conformité Backoffice** (SEC-S30-HIGH-01) : `apps/backoffice/src/stores/authStore.ts:67` utilise `await supabase.auth.setSession({ access_token, refresh_token })` au lieu du pattern POS. Aucun appel à `setSupabaseAccessToken` dans tout le BO (grep exhaustif). Cf finding HIGH-01.

**Rate-limit `auth-verify-pin`** : ✓ — `checkRateLimitDurable({ functionName: 'auth-verify-pin', bucketKey: 'ip:'+ip, maxPerWindow: 3, windowSec: 60 })` durable Postgres backend.

**Lockout flow** : ✓ — `MAX_FAILED = 5` puis `locked_until = now() + 15min`. Compteur réinitialisé sur PIN valide.

**PIN strength** : `evaluatePinStrength` retourne `{ weak, reason }` mais l'EF `auth-change-pin` ne BLOQUE PAS sur PIN faible — retourne `{ ok: true, weak: true, weak_reason: ... }` informational. **Par design (S19 warn-only)** mais à durcir : pour les MANAGER+ rotations, considérer fail-closed.

**Error redaction** : ✓ — `auth-verify-pin` utilise `redactError()` pour collapser `user_not_found`/`invalid_pin` en `invalid_credentials` opaque.

**Session token lifecycle** : ✓ — SHA-256 hash en DB, comparaison constant-time via `=` (Postgres native), TIMEOUT_MS 30min serveur + MAX_AGE_MS 24h hard cap.

**PIN/JWT en logs** : Aucun `console.log(pin|token|secret)` trouvé via grep exhaustif. ✓

**Idle timeout per-role** : ✓ — câblé POS + BO via `useIdleTimeout` hook + `sessionTimeoutMinutes` du store. `auth-get-session` retourne `session_timeout_minutes` joint depuis `roles`. Defaults respectent CHECK 5..480 (CASHIER 30 / MANAGER 60 / ADMIN 120 / SUPER_ADMIN 240).

### 4. Edge Functions security

| EF | verify_jwt config | Rate-limit | Auth method | Idempotency | Audit log | Notes |
|---|---|---|---|---|---|---|
| `auth-verify-pin` | false (explicite) | ✓ durable (3/min/IP) | Public (PIN body) | N/A | login.success/login.failed | OK |
| `auth-get-session` | false (explicite) | NON | x-session-token | N/A | NON | Read-only, OK |
| `auth-logout` | false (explicite) | NON | x-session-token | N/A | logout | OK |
| `auth-change-pin` | false (explicite) | **NON (gap)** | x-session-token + body | N/A | pin.change_self / pin.change_admin | **SEC-S30-MED-03** |
| `process-payment` | true (explicite) | NON | Bearer JWT | body `idempotency_key` (legacy) | via RPC complete_order | error.message leak (SEC-S30-MED-04) |
| `refund-order` | implicite (default true) | ✓ durable (10/min/IP) | Bearer JWT + x-manager-pin header | ✓ `x-idempotency-key` header | refund.replay | Best practice EF |
| `void-order` | implicite (default true) | ✓ durable (10/min/IP) | Bearer JWT + manager_pin **body** | NON (gap) | via RPC void_order | PIN en body — SEC-S30-LOW-01 |
| `cancel-item` | implicite (default true) | ✓ durable (10/min/IP) | Bearer JWT + manager_pin **body** | NON (gap) | via RPC cancel_order_item | PIN en body — SEC-S30-LOW-01 |
| `kiosk-issue-jwt` | implicite (default true) | ✓ durable (10/min/IP + 1/min/kiosk_id) | Public (env KIOSK_ALLOWED_IPS) | N/A | kiosk.token.issued | IP allowlist via env — verify_jwt SHOULD BE false (SEC-S30-HIGH-03) |
| `customer-birthday-notify` | implicite (default true) | NON | x-cron-secret OR service_role | dedup via idempotency_key DB | NON | verify_jwt MUST BE false (SEC-S30-HIGH-03) + secret hardcodé (SEC-S30-CRIT-01) |
| `notification-dispatch` | implicite (default true) | NON | Bearer JWT + has_permission('notifications.send') OR ?secret= | dedup via outbox idempotency | NON | OK |

### 5. Idempotency S25

**Cross-EF coverage** :
- ✓ `refund-order` v7 utilise `_shared/idempotency.ts` (`getIdempotencyKey(req)` → propagé au RPC `refund_order_rpc_v2(p_idempotency_key)`)
- ✗ `void-order` : pas de propagation idempotency
- ✗ `cancel-item` : pas de propagation idempotency
- ✓ `process-payment` : utilise `body.idempotency_key` (legacy v7 pattern, RPC `complete_order_with_payment_v9` accepte `p_idempotency_key`)
- ✓ `customer-birthday-notify` : compute idempotency_key via SHA-256 et passe à `enqueue_notification_v1`
- ✓ `kiosk-issue-jwt` : pas d'idempotency (mint stateless)

**Tables idempotency dédiées** (PK = client_uuid, REVOKE all sauf SELECT) :
- ✓ `tablet_order_idempotency_keys` (S25 — `client_uuid PK`, REVOKE INSERT/UPDATE/DELETE FROM authenticated)
- ✓ `b2b_payments.idempotency_key UNIQUE` (S24 — colonne sur la table métier, OK car même table = même flow)
- ⚠️ Pas de table dédiée pour `refund_orders` ni `void_orders` — ils utilisent `p_idempotency_key` mais le replay s'appuie sur le `RECORD` existant (cf fix S25 `_015` qui a corrigé un bug dormant S13)

**Replay envelope** : `record_b2b_payment_v1` retourne `{ idempotent_replay: true, ... }` (SEC-S30-MED-07 : pas d'audit row sur replay) ; `refund-order` v7 INSERT `audit_logs.action='refund.replay'` (best practice).

### 6. Audit log coverage

**Actions tracées** (sample) :
- ✓ `login.success`, `login.failed` (auth-verify-pin)
- ✓ `logout` (auth-logout)
- ✓ `pin.change_self`, `pin.change_admin` (auth-change-pin)
- ✓ `kiosk.token.issued` (kiosk-issue-jwt)
- ✓ `refund.replay` (refund-order)
- ✓ `role.session_timeout_changed` (update_role_session_timeout_v1)
- ✓ `product.update`, `product.create`, `category.create`, `category.update`, `category.reorder`, `category.delete` (S27/27b RPCs)
- ✓ `b2b.payment.recorded`, `b2b.balance.adjusted` (S24)
- ✓ `expense.created`, `expense.approved`, `expense.deleted` (S13)
- ✓ `customer.soft_deleted` (S12)
- ✓ `loyalty.adjusted` (S14)
- ✓ `pos_session.opened`, `pos_session.closed` (S13)
- ✓ `recipe.duplicated` (S15)
- ✓ `cost_price.corrected` (S22)
- ✓ `kds.recall`, `kds.bump` (S13)

**Gaps détectés** :
- `void-order` ne loggue PAS dans audit_logs (le RPC `void_order_rpc` historique ne le fait pas non plus)
- `cancel-item` idem
- `record_b2b_payment_v1` idempotent replay silent (SEC-S30-MED-07)
- `process-payment` audit via le RPC `complete_order_with_payment_v9` (à confirmer)

**Format `audit_logs.payload`** : JSONB structuré ✓ (e.g. `{role_code, before, after}`)

**`audit_logs.entity_id`** : Toujours rempli sauf cas légitime (ex: `update_role_session_timeout_v1` met NULL car roles PK est TEXT)

**FK violation latent SEC-S30-MED-02** : 11 RPCs récentes insèrent `auth.uid()` dans `audit_logs.actor_id` (FK vers user_profiles.id). Voir Medium-02.

### 7. Secrets management

**Hardcoded scan** :
- ❌ **CRITIQUE** : `BIRTHDAY_CRON_SECRET = 'birthday-cron-daily'` dans 2 migrations + 1 test (SEC-S30-CRIT-01)
- ✓ Aucun `service_role_key` hardcodé (grep négatif)
- ✓ Aucun JWT hardcodé (`eyJ` grep négatif)
- ✓ Aucun mot de passe hardcodé
- ✓ Aucun API key Resend / autre tier hardcodé dans le code TS/SQL

**`.env` hygiene** :
- ✓ `apps/pos/.env`, `apps/backoffice/.env`, `supabase/functions/.env` sont gitignored (`git check-ignore` positif)
- ✓ `.env.example` est committé (légitime)
- ✓ `.gitignore` couvre `.env`, `.env.local`, `.env.*.local`

**`VITE_SUPABASE_ANON_KEY` exposition** :
- ✓ Validation `z.string().min(1)` dans `packages/utils/src/env.ts`
- ✓ Utilisé uniquement comme `anonKey` côté client (pas de service_role exposé)

**Supabase Vault** :
- ⚠️ Pas d'utilisation de `vault.secrets` détectée — secrets EFs reposent sur `Deno.env.get()` qui lit depuis `supabase/functions/.env` (dev) ou Dashboard env vars (cloud). Migration vers vault recommandée pour rotation programmable.

### 8. Session timeout per role

**DB** : ✓ — `roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` (S19 migration `20260523000020`). Seeds : CASHIER/waiter 30 ; MANAGER 60 ; ADMIN 120 ; SUPER_ADMIN 240.

**RPC `update_role_session_timeout_v1`** : ✓ — perm gate `settings.update` + role gate `ADMIN/SUPER_ADMIN` + bounds check + audit log. REVOKE EXECUTE FROM anon (corrective S19 `_022`). **Bug latent FK actor_id** (SEC-S30-MED-02).

**Frontend wiring** : ✓ — `useIdleTimeout` hook mounted dans `apps/pos/src/App.tsx` et `apps/backoffice/src/App.tsx`. `auth-get-session` retourne `session_timeout_minutes` joint depuis `roles`. `IdleWarningToast` (S19) affiche un warning avant logout.

**Default values respectent CHECK** : ✓ — toutes valeurs dans [5..480].

### 9. GRANT hardening S20

**État actuel** :
- ✓ Migration `20260524000020` REVOKE ALL ON tables/views FROM anon (DO loop) + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES/SEQUENCES FROM anon`
- ✓ Migration `20260524000030` REVOKE EXECUTE FROM anon + `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM anon`
- ✓ Migration `20260524000031` (corrective) REVOKE EXECUTE FROM **PUBLIC** + `ALTER DEFAULT PRIVILEGES FROM PUBLIC` (capture `=X/postgres` ACL caveat)
- ✓ Migration `20260524000040` tighten USING(true) sur 5 tables avec perm gates

**Drift S20+ (migrations postérieures)** :
- ✓ S22 `update_cost_price_v1` : REVOKE pair anon + PUBLIC présent
- ✓ S24 B2B RPCs (3) : REVOKE pair anon + PUBLIC présent
- ✓ S25 `create_tablet_order_v2` : REVOKE pair anon + PUBLIC présent (migration `_012` + `_013` canonique)
- ✓ S27 product RPCs (4) : REVOKE pair anon + PUBLIC + ALTER DEFAULT PRIVILEGES
- ✓ S27b create/update/reorder category + create product RPCs (4) : REVOKE pair canonique
- ✓ S19 `update_role_session_timeout_v1` : REVOKE FROM anon (corrective `_022`) — antérieur au sweep S20 mais OK

**Résultat** : 100% des migrations RPC SECURITY DEFINER postérieures à S19 suivent le canon. Aucun drift détecté.

**Résidual `pgtap` extension views** : `pg_all_foreign_keys`, `tap_funky` et fonctions pgtap helper sont anon-readable car `supabase_admin` owner non altérable. DEV-S20-2.A-01 documenté informational.

## Plan de remediation prioritisé

1. **[CRITIQUE — H+0]** Rotation `BIRTHDAY_CRON_SECRET` cloud + migration corrective qui lit depuis `vault.secrets` ou `Deno.env.get('BIRTHDAY_CRON_SECRET')` (jamais inliné). Documenter dans CLAUDE.md « JAMAIS de secret inliné dans une migration ». *Effort : 1h*
2. **[CRITIQUE — H+1]** Migration `_xxxxxx_seed_users_management_perms.sql` : seed `users.create` + `users.update` dans `permissions` ET `role_permissions` (ADMIN, SUPER_ADMIN). Test pgTAP qui itère toutes les `has_permission(_, 'X')` du codebase et assert que X existe dans `permissions`. *Effort : 2h*
3. **[HIGH — H+2]** Fix `apps/backoffice/src/stores/authStore.ts` : remplacer `supabase.auth.setSession()` par `setSupabaseAccessToken(...)` pour aligner sur POS. Test smoke + pgTAP qui assert RLS fonctionne avec un user MANAGER côté BO. *Effort : 2h*
4. **[HIGH — H+3]** Fix `supabase/functions/_shared/permissions.ts` : utiliser `user_profile_id` (pas `user_id`) et `is_granted` (pas `override_type`). Test Vitest qui crée un override DENY et assert qu'il est appliqué. *Effort : 1h30*
5. **[HIGH — H+4]** Compléter `supabase/config.toml` avec les 6 stanzas `verify_jwt` manquantes. Documenter dans CLAUDE.md. *Effort : 30min*
6. **[MEDIUM — H+5]** Sweep PIN body → header (`void-order`, `cancel-item`) + sweep idempotency cross-EF (`void-order`, `cancel-item`) — déjà tracké dans CLAUDE.md backlog post-S30. *Effort : 4h*
7. **[MEDIUM — H+6]** Fix FK violation latent : extraire helper `_resolve_caller_profile()` + patcher les 11 RPCs S27/S27b/S19. *Effort : 3h*
8. **[MEDIUM — H+7]** CORS allowlist — env-driven plutôt que wildcard. *Effort : 2h*
9. **[MEDIUM — H+8]** Rate-limit `auth-change-pin` + `process-payment` + `notification-dispatch`. *Effort : 2h*
10. **[LOW — backlog]** Migration vers vault.secrets ; CSP/HSTS headers ; enum `audit_logs.action`/`permissions.action` ; uniformiser PIN length 4-8 vs 6.

## Annexes

### A1 — Matrice RBAC dense

Sample (extrait — full matrix dans la DB `role_permissions` table) :

| Perm | SUPER_ADMIN | ADMIN | MANAGER | CASHIER | waiter |
|---|---|---|---|---|---|
| `pos.session.open` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `pos.session.close_other` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `pos.sale.create` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `pos.sale.void` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `pos.sale.refund` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `sales.create` | ✓ | ✓ | ✗ | ✗ | ✓ |
| `products.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products.create` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `products.delete` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `customers.b2b.update` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `accounting.read` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `accounting.post` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `accounting.period.close` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `inventory.opname.finalize` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `users.read` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `users.create` | ✗ (perm n'existe pas) | ✗ (perm n'existe pas) | ✗ | ✗ | ✗ |
| `users.update` | ✗ (perm n'existe pas) | ✗ (perm n'existe pas) | ✗ | ✗ | ✗ |
| `rbac.update` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `settings.update` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `kiosk.issue` | ✓ | ✓ | ✗ | ✗ | ✗ |

### A2 — Liste exhaustive des RLS policies sensibles

| Table | Policy | TO | Gate |
|---|---|---|---|
| `audit_logs` | admin_read | authenticated | `role_code IN ('SUPER_ADMIN','ADMIN')` |
| `audit_log` (DROP S13) | perm_read | authenticated | `has_permission('audit_log.read')` |
| `customers` | auth_read | authenticated | `is_authenticated() AND deleted_at IS NULL` (PAS de kiosk branch) |
| `orders` | auth_read | authenticated | `is_authenticated() OR has_kiosk_jwt(NULL)` |
| `order_items` | auth_read | authenticated | `is_authenticated() OR has_kiosk_jwt(NULL)` |
| `order_payments` | auth_read | authenticated | `is_authenticated()` (pas de kiosk) |
| `pos_sessions` | auth_read | authenticated | `is_authenticated() OR has_kiosk_jwt('kds')` |
| `user_profiles` | auth_read | authenticated | `is_authenticated() AND deleted_at IS NULL` |
| `user_sessions` | own_sessions_read | authenticated | `user_id IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())` |
| `stock_movements` | perm_read | authenticated | `has_permission('inventory.read')` |
| `journal_entries` | perm_read | authenticated | `has_permission('accounting.read')` |
| `b2b_payments` | perm_read | authenticated | `has_permission('customers.b2b.update')` (assumed — à vérifier) |
| `cash_movements` | cash_movements_select_auth | authenticated | `has_permission('cash_register.read') OR has_permission('reports.financial.read')` |

### A3 — Mapping EF → contrôles security

| EF | CORS | verify_jwt | Rate-limit (durable) | JWT auth | Manager PIN | Idempotency | Audit log row |
|---|---|---|---|---|---|---|---|
| auth-verify-pin | `*` | false explicit | ✓ 3/min/IP | N/A (public) | N/A | N/A | login.success/login.failed |
| auth-get-session | `*` | false explicit | NON | x-session-token | N/A | N/A | NON |
| auth-logout | `*` | false explicit | NON | x-session-token | N/A | N/A | logout |
| auth-change-pin | `*` | false explicit | **NON** ⚠️ | x-session-token | N/A | N/A | pin.change_* |
| process-payment | `*` | true explicit | NON | Bearer | N/A | body idempotency_key | via RPC |
| refund-order | `*` | true default | ✓ 10/min/IP | Bearer | header x-manager-pin | ✓ header x-idempotency-key | refund.replay |
| void-order | `*` | true default | ✓ 10/min/IP | Bearer | body manager_pin ⚠️ | NON ⚠️ | via RPC void_order |
| cancel-item | `*` | true default | ✓ 10/min/IP | Bearer | body manager_pin ⚠️ | NON ⚠️ | via RPC cancel_order_item |
| kiosk-issue-jwt | `*` | true default ⚠️ | ✓ 10/min/IP + 1/min/kiosk_id | Public (env IP allowlist) | N/A | N/A | kiosk.token.issued |
| customer-birthday-notify | `*` | true default ⚠️ | NON | x-cron-secret OR Bearer service_role | N/A | DB dedup via idempotency_key | NON (par notification_outbox) |
| notification-dispatch | `*` | true default | NON | Bearer + perm + query secret | N/A | outbox dedup | NON |

---

**Audit terminé** — Pour clarification ou follow-up sur un finding spécifique, références exhaustives dans le rapport.
