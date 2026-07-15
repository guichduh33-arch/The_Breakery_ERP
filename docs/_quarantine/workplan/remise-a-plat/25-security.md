# Module 25 — Sécurité

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 livré** — `auth-change-pin` lit les PINs depuis les headers `x-current-pin`/`x-new-pin` (hard cutover S25, plus aucun PIN en body JSON, CORS étendu, EF redéployée v8 ACTIVE) ; la réserve B1.3 sur le PIN de rotation en body est levée (reste le PIN de login `auth-verify-pin`, à documenter/basculer). Voir `docs/workplan/plans/archive/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 25. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel avec un socle solide
> **Verdict global de l'analyse :** La doc est globalement fidèle — c'est le module le plus honnête des trois analysés. Les cinq revendications sont vérifiables dans le code (REVOKE anon + default privileges, lockout/rate-limit, redaction, prix serveur + advisory locks promo, audit consolidé), et les dettes annoncées « À venir » correspondent aux deferred réels. Deux nuances : les PINs transitent encore en body JSON sur les EFs `auth-*` (la règle « header » ne couvre que les manager-PINs), et la lecture du journal d'audit est réservée ADMIN/SUPER_ADMIN.

> Les flux login/PIN/session sont détaillés au **Module 01**, le cycle de vie des comptes au **Module 20** ; cette fiche couvre le durcissement transverse.

## A. Ce qui fonctionne réellement (code vérifié)

- **Fermeture des accès anonymes + double verrou par défaut** [migrations] :
  - `20260524000020_revoke_anon_grants_from_public_tables.sql` : REVOKE ALL anon sur tables/séquences + `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES/SEQUENCES FROM anon` (`:44-45`) — tout nouvel objet naît fermé.
  - `20260524000030/000031` : REVOKE EXECUTE anon **et PUBLIC** sur les fonctions + `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (`20260524000031:15`) — ferme le canal d'héritage PUBLIC.
  - Fuites d'objets dérivés fermées : vues DEFINER → invoker + MV REVOKE (`20260710000055_close_definer_view_mv_leaks.sql`), `search_path` (`_056`).
  - Filet de tests : `supabase/tests/security_anon_grants.test.sql`, `security_leak_guard.test.sql`, `security.test.sql`, `security_authenticated_policies.test.sql` (⚠️ exécution live à confirmer en DB — pgTAP via MCP).
- **Anti-devinette PIN** [EF + DB] : lockout 5 essais/15 min par compte + rate-limit durable 3/min **par IP** (table `edge_function_rate_limits`, RPC `record_rate_limit_v1`, deux couches mémoire+Postgres — `supabase/functions/_shared/rate-limit.ts:1-12`, `auth-verify-pin/index.ts:12-16,33-44`) ; header `Retry-After` sur 429 ; échecs/succès tracés dans `audit_logs` avec IP (`auth-verify-pin/index.ts:105-111,185-191`). Le lockout est aussi câblé côté SQL pour les PIN-gates métier : `_verify_pin_with_lockout` (`20260622000010`) branché sur sign-zreport, close-fiscal-period, manual-JE, approve-expense, complete-order (`20260622000011..15`).
- **Secrets non exposés** [EF + migrations] :
  - PINs stockés bcrypt (`hash_pin` via `crypt/gen_salt`, `20260503000006_init_helpers.sql`) ; grant colonne `pin_hash` durci (`20260619000023_harden_user_profiles_pin_hash_grant.sql`).
  - Manager-PIN en **header HTTP** `x-manager-pin`, jamais en body, sur les 5 EFs concernées : `process-payment`, `void-order`, `cancel-item`, `refund-order`, `verify-manager-pin` (grep `x-manager-pin` → 6 fichiers dont `_shared/cors.ts`) ; depuis S55 le PIN discount ne descend plus jamais en argument SQL (nonce `discount_authorizations`, `20260710000085/86`).
  - Messages d'erreur opacifiés : `_shared/error-redact.ts` (collapse user_not_found/invalid_pin, whitelist de champs préservés, `logAndRedact` pour les 500).
  - Tokens de session stockés hashés SHA-256 (`auth-verify-pin/index.ts:140`, trigger DB).
- **Prix de ligne recalculé par le serveur** [RPC] : helper interne `_resolve_line_price_v1` (SECURITY DEFINER, REVOKE PUBLIC+anon+authenticated, `20260710000063`) consommé par la money-path `complete_order_with_payment_v15→v17` (`20260710000064`, `_092`) — le prix client est ignoré ; combos validés ET pricés serveur via `_resolve_combo_price_v1` (`20260710000090`).
- **Plafonds promo verrouillés multi-caisses** [RPC] : gate dur atomique `pg_advisory_xact_lock` + re-count → `promo_cap_exceeded` dans `complete_order_with_payment_v17` (`20260710000092`) ET `pay_existing_order_v11` (`20260710000096`) ; colonnes `promotions.max_uses`/`max_uses_per_customer` (`_089`).
- **Journal d'audit consolidé** [migrations] : la vue compat `audit_log` (singulier) + trigger INSTEAD-OF sont droppés — `audit_logs` est l'unique surface (`20260710000087_repoint_audit_writers_to_audit_logs.sql` réécrit les 26 derniers writers, `20260710000088_drop_audit_log_compat_view.sql`) ; suite garde-fou `supabase/tests/audit_consolidation.test.sql` ; lecture gatée RLS admin_read via `get_audit_logs_v1/_v2` (`20260702000010:10-12`).
- **En PLUS de la doc** 🔵 : idempotency-replay sur void/cancel (`void_order_rpc_v4`/`cancel_order_item_rpc_v3`, EF-only, REVOKE authenticated `20260710000084`) ; sessions serveur cap 30 min/24 h (`_shared/session-auth.ts:5-6`) ; timeout d'inactivité par rôle éditable + audité (module 01) ; garde fail-closed des périodes fiscales (`20260710000077`) ; rate-limit durable aussi sur `auth-change-pin` bucketé par compte cible (anti brute-force du PIN courant, `auth-change-pin/index.ts:44-57`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Accès anonymes fermés (clients/ventes illisibles sans connexion), double verrou par défaut sur tout nouvel objet.
- B1.2 Tentatives de PIN limitées (anti-devinette, blocage temporaire, y compris par adresse réseau).
- B1.3 Codes secrets jamais en clair (journaux techniques, échanges réseau) ; messages d'erreur sans détails internes.
- B1.4 Prix de chaque ligne recalculé par le serveur central ; plafonds de promotions verrouillés contre les contournements simultanés multi-caisses.
- B1.5 Journal d'audit consolidé en une trace unique.

### B2. Annoncé « À venir »
- B2.1 Veille automatique des vulnérabilités des composants tiers.
- B2.2 Politique écrite de rotation des clés d'accès (départ d'un administrateur).
- B2.3 Verrous différés : protection mots de passe compromis (Leaked Password Protection), restriction de l'accès public aux images produits.
- B2.4 Test d'intrusion externe.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Accès anonymes fermés + défaut fermé | ✅ REVOKE anon tables/fonctions + PUBLIC + `ALTER DEFAULT PRIVILEGES` ×3 (`20260524000020:44-45`, `20260524000031:15`) ; fuites vues/MV fermées (`20260710000055`) ; suites pgTAP dédiées. ⚠️ l'état effectif des grants live n'est vérifiable qu'en DB (les suites nightly les couvrent). | ✅ CONFORME |
| B1.2 | Limitation PIN, blocage temporaire, par adresse réseau | ✅ Lockout 5/15 min + rate-limit durable 3/min par IP + lockout SQL sur les PIN-gates métier (`20260622000010..15`) ; scénario doc « dix codes → blocage + trace » vérifié (audit `login.failed` avec IP). | ✅ CONFORME |
| B1.3 | Secrets jamais en clair ; erreurs redactées | Largement vrai : bcrypt, header `x-manager-pin` (5 EFs), nonce discount S55, `error-redact`, token hashé. **Réserve** : les EFs `auth-verify-pin` et `auth-change-pin` reçoivent encore le PIN en **body JSON** (`auth-verify-pin/index.ts:53`, `auth-change-pin/index.ts:36` — `current_pin`/`new_pin`) : la règle S25 « secret en header » n'a jamais été étendue au flux login/rotation. Bodies loggables côté infra. | 🟠 PARTIEL |
| B1.4 | Prix serveur + plafonds promo anti-concurrence | ✅ `_resolve_line_price_v1`/`_resolve_combo_price_v1` (REVOKE ×3) + v17 ; `pg_advisory_xact_lock` + re-count dans v17 ET `pay_existing_order_v11` (`_092`, `_096`). | ✅ CONFORME |
| B1.5 | Trace d'audit unique | ✅ Vue `audit_log` droppée, 26 writers repointés (`_087/_088`), suite `audit_consolidation.test.sql`. Réserve mineure : dualité assumée `metadata`/`payload` (documentée), et lecture réservée ADMIN/SUPER_ADMIN (RLS admin_read) — « qui a fait quoi » n'est pas consultable par un MANAGER. | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :** 🔵 idempotency-reversals EF-only (S55) ; 🔵 lockout PIN unifié sur 5 RPCs métier ; 🔵 cap dur de session 30 min/24 h côté EF ; 🔵 rate-limit `auth-change-pin` par compte cible ; 🔵 fail-closed fiscal (`period_undefined`).

**Cohérence des « À venir » avec le code :** B2.3 exacte — bucket `product-images` bien créé **PUBLIC** (`20260706000009_create_storage_bucket_product_images.sql:5,23-24`) et Leaked Password Protection non activée (réglage dashboard, ⚠️ à confirmer en DB live) ; B2.1/B2.2/B2.4 sans objet code (aucun Dependabot/renovate dans le repo — cohérent).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Étendre la règle header aux EFs auth** : `auth-change-pin` lit `current_pin`/`new_pin` depuis des headers dédiés (`x-current-pin`/`x-new-pin`), hard cutover même commit côté POS/BO (`packages/supabase/src/auth/pinAuth.ts` + call-sites). Pour `auth-verify-pin` (login), documenter l'exception ou basculer aussi en header. Done : plus aucun PIN en body JSON.
2. **Activer Leaked Password Protection** (dashboard Supabase, action manuelle) et tracer la décision — dette S51 explicitement reportée.
3. **Encart CI audit deps** : job `pnpm audit`/`npm audit signatures` non bloquant dans le workflow existant → premier pas B2.1.

### D2. Chantiers moyens (1 session, plan requis)
1. **Privatiser le bucket `product-images`** (dette S51) : bucket privé + URLs signées ou proxy EF ; toucher `20260706000009` (nouvelle migration), les uploaders BO et les lecteurs POS/BO. Risque : cache d'URLs publiques en prod.
2. **Politique de lecture du journal élargie et sûre** : décider si MANAGER obtient une vue filtrée (ses équipes, sans PII) — RLS `audit_logs` + `get_audit_logs_v3` gaté `users.view_audit` (permission seedée mais aujourd'hui sans effet).

### D3. Chantiers lourds (spec dédiée avant code)
1. **Invalidation immédiate des JWT PIN** (partagé avec module 01 D3.1) : le HS256 1 h reste valide après révocation de session pour PostgREST direct.
2. **Politique de rotation des clés** (B2.2) : inventaire des secrets (SUPABASE_SERVICE_ROLE_KEY — présent dans les secrets repo depuis le 2026-06-27, vérifié `gh secret list` fiche 23 ; la dette « secret manquant » de CLAUDE.md est périmée ; JWT secret ; clés kiosk), procédure de départ admin, runbook écrit. Documentation + opérations, pas du code applicatif.
3. **Pentest externe** (B2.4) : après stabilisation, périmètre EFs + PostgREST + storage.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.3 : préciser « les PINs de validation manager transitent en en-tête ; le PIN de connexion transite chiffré (HTTPS) dans le corps de la requête » — ou corriger le code (D1.1) et laisser la phrase.
2. B1.5 : préciser que la consultation du journal est réservée aux administrateurs (le manager n'y a pas accès aujourd'hui).
3. Ajouter aux « À venir » l'invalidation immédiate des jetons (≤1 h de latence résiduelle après révocation) — la doc du module 1 le mentionne, celle du module 25 devrait aussi.

## E. Dépendances croisées
- **Module 01** : lockout/rate-limit/redaction vivent dans les EFs auth ; chantier JWT commun (D3.1).
- **Module 20** : RLS `audit_logs` (D2.2) conditionne les scénarios « qui a fait quoi » des modules 1 et 20 ; l'écriture RBAC future (mod. 20 D3.1) devra hériter des garde-fous anti-auto-élévation.
- **Module 03 (encaissement)** : `_resolve_line_price_v1`/v17/nonce discount = money-path ; toute correction passe par la discipline RPC-versioning.
- **Module 13 (promotions)** : advisory locks des caps promo.
- **Module 5 (catalogue)** : privatisation `product-images` (D2.1) touche l'upload produit BO et l'affichage POS.
- **Module 23 (qualité/tests)** : suites pgTAP security_* et le job nightly live-RPC (le secret CI existe depuis le 2026-06-27 ; l'échec nightly vient d'ailleurs — réseau/clé, cf. fiche 23).
