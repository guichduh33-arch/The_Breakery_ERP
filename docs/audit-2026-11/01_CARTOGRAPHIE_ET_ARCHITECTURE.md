# Audit 01 — Cartographie et architecture réelle

> **Relevé du 2026-11-09**, sur la branche `master` à `e204d57a`.
> Mode **lecture seule** : aucun fichier applicatif modifié, aucun commit, aucun
> build, test ni serveur lancé. Les lectures de base de données sont des `SELECT`
> sur le catalogue système et sur des comptages ; aucune écriture.
>
> Ce document décrit **ce qui EST**, pas ce qui doit être. Les décisions vivent
> dans `docs/adr/`, les intentions dans `docs/objectifs/`. Un écart entre une
> intention non livrée et le code est du backlog, pas une erreur : il est signalé
> comme tel.
>
> **Un relevé a une date.** Les chiffres de production ci-dessous sont ceux du
> 2026-11-09 ; ils ne prouvent pas l'état d'un autre jour. Les preuves privées
> (empreintes d'APK, captures) ne sont pas transportées par un clone.

---

## 0. Résumé du relevé

| Dimension | Valeur mesurée |
|---|---|
| Monorepo | pnpm 11.17.0 (`packageManager`) + Turborepo 2.x, Node ≥ 22.12 |
| Applications | 3 (`apps/pos`, `apps/backoffice`, `apps/print-bridge`) |
| Paquets partagés | 4 (`packages/{domain,supabase,ui,utils}`) |
| Code applicatif suivi | ~262 000 lignes TS/TSX hors migrations et tests SQL |
| Migrations SQL | 1 240 fichiers / ~200 000 lignes |
| Tests | 802 fichiers Vitest · 345 fichiers pgTAP · 15 specs Playwright |
| Base de production V3 | `yjhhhmjgsmyzyymvixot` — 133 tables, 286 policies, 491 fonctions |
| Base de dev V3 | `ikcyvlovptebroadgtvd` — 135 tables, 292 policies, 507 fonctions |
| Mise en service production | 2026-10-29 (relevé validé dans `docs/runbooks/etat-environnements.md`) |
| Activité réelle observée | 110 à 140 commandes/jour, 12 à 18 M IDR/jour, du 2026-10-29 au 2026-11-08 |

**Trois constats structurants, chacun prouvé des deux côtés (code déployé + base live) :**

1. **4 RPC appelées par le back-office déployé n'existent pas en production.**
   Le déploiement Vercel de production est sur le commit `e204d57a`
   (= `master` HEAD, vérifié par l'API Vercel, `dpl_FzQg9HfguPJSjpjdLKUroSrvda2U`,
   2026-11-08). Ce code appelle `bank_reconciliation_post_v5`,
   `bank_reconciliation_clearing_v3`, `preview_cash_journal_import_v3` et
   `apply_cash_journal_import_v4` ; la base de production ne contient que
   `bank_reconciliation_post_v4` et `bank_reconciliation_clearing_v2`, et
   **aucune** fonction d'import de journal de caisse. Détail en §5.4.
2. **Aucune tâche planifiée en production.** `cron.job` est vide sur
   `yjhhhmjgsmyzyymvixot`, alors que la base de dev en porte 9. Conséquences
   mesurées : deux vues matérialisées jamais peuplées, pas de purge du
   rate-limit, pas de sauvegarde autonome, pas de dispatch de notifications.
   Détail en §5.5.
3. **Le journal `pos_events` écrit tout dans sa partition par défaut** depuis le
   2026-10-07 (9 741 lignes au 2026-11-08). Les seules partitions existantes
   couvrent juillet, août et septembre 2026. Détail en §5.6.

---

## 1. Pile technique réelle

### 1.1 Socle

Mesuré dans les `package.json` de chaque workspace.

| Élément | Version déclarée | Source |
|---|---|---|
| Gestionnaire de paquets | `pnpm@11.17.0` | `package.json` (`packageManager`) |
| Node | `>=22.12.0` | `package.json` (`engines`) |
| Orchestrateur | `turbo ^2.11.10` | `package.json` |
| TypeScript | `^5.3.3` | `package.json` |
| Bundler | `vite ^6.4.5` | `apps/pos/package.json`, `apps/backoffice/package.json` |
| Tests unitaires | `vitest ^4.1.12` | tous les workspaces |
| E2E | `@playwright/test ^1.64.1` | `package.json` |
| Lint | `eslint ^8.57.1` + `typescript-eslint ^8.72.1` | `package.json` |

`pnpm-workspace.yaml` déclare les membres `apps/*`, `packages/*` et
`supabase/tests`. **`supabase/functions` n'est pas un membre du workspace** —
c'est la cause mécanique du trou de filet décrit en §6.3.

Le bloc `overrides:` des épinglages de sécurité Dependabot (13 entrées) vit bien
dans `pnpm-workspace.yaml` et non dans `package.json`, conformément au
comportement de pnpm 11.

### 1.2 Front-end

| Élément | POS | Back-office |
|---|---|---|
| React | `^18.2.0` | `^18.2.0` |
| Routeur | `react-router-dom ^7.18.5` | idem |
| Données serveur | `@tanstack/react-query ^5.105.0` | idem |
| État local | `zustand ^4.5.5` | idem |
| Styles | `tailwindcss ^3.4.17` + preset `@breakery/ui` | idem |
| Icônes | `lucide-react ^0.577.0` | idem |
| Notifications | `sonner ^2.0.8` | idem |
| Graphiques | — | `recharts ^2.13.0` |
| Tableur | — | `xlsx 0.20.3` (tarball CDN SheetJS) |
| Glisser-déposer | — | `@dnd-kit/*` |
| Empaquetage natif | `@capacitor/* ^8.6.0` (Android, ADR-029) | — |
| Supervision | `@sentry/react ^10.78.0` | idem |

**Aucune bibliothèque d'internationalisation**, et **aucun `zod` dans le
back-office** (`packages/utils` déclare `zod ^4.6.7`, mais le BO ne l'importe
pas). Les chaînes d'interface sont en dur dans le JSX.

### 1.3 Configuration TypeScript

`tsconfig.base.json` est la seule source ; les 9 `tsconfig.json` des
apps et paquets l'étendent **sans jamais abaisser une option** (vérifié un par un).

```
strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
noFallthroughCasesInSwitch, noImplicitOverride,
noUnusedLocals, noUnusedParameters, verbatimModuleSyntax, isolatedModules
```

C'est le réglage le plus strict pratiquement atteignable. Les conséquences
positives sont mesurables (§6.1) : 24 `any` seulement en code de production, zéro
`@ts-ignore`.

### 1.4 Base de données et exécution serveur

- **Cible unique : Supabase cloud.** Le Docker local est retiré depuis le
  2026-05-14 ; `pnpm db:start|db:stop|db:reset` sont des stubs qui échouent
  volontairement (`package.json`).
- Trois projets Supabase V3 nommés dans les sources : dev
  `ikcyvlovptebroadgtvd`, répétition `getctmbpjnrrjzncaqze`, production
  `yjhhhmjgsmyzyymvixot`. Ancienne V2 : `abjabuniwkqpfsenxljp` (lignée de
  migrations incompatible).
- Extensions en production : `btree_gist`, `pg_cron`, `pg_net`,
  `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `plpgsql`, `supabase_vault`,
  `uuid-ossp`. **`pgtap` est absent de la production** (il est présent en dev,
  installé dans `public`) — c'est correct.
- `btree_gist` et `pg_trgm` sont installés dans le schéma `public` en production
  (avis Supabase `extension_in_public`, 2 occurrences). Conséquence visible :
  les ~200 fonctions internes de ces extensions sont exécutables par `anon`,
  ce qui est normal et sans effet métier (§5.3).

---

## 2. Structure des dossiers et volumétrie

Mesuré par `git ls-files` + `wc -l` (fichiers suivis uniquement).

| Zone | Fichiers | Lignes |
|---|---|---|
| `apps/backoffice/src` | 1 159 | 146 613 |
| `apps/pos/src` | 637 | 75 517 |
| `apps/print-bridge` | 40 | 3 583 |
| `packages/ui/src` | 147 | 21 054 |
| `packages/domain/src` | 189 | 15 159 |
| `packages/supabase/src` | 16 | 13 168 (dont `types.generated.ts`) |
| `packages/utils/src` | 19 | 1 362 |
| `supabase/functions` | 62 | 6 798 |
| `supabase/migrations` | 1 240 | 200 175 |
| `supabase/tests` | 463 | 69 589 |
| `scripts` | 92 | 7 720 |
| `tests` (E2E) | 17 | 2 753 |

Répartition du back-office : 788 fichiers source (101 365 lignes) et 368 fichiers
de tests co-localisés (~44 870 lignes). Le ratio test/source est de 44 %.

### 2.1 Les deux invariants d'architecture tiennent

Vérifiés par `grep` :

- **`packages/domain` est IO-free.** Aucun import de `react`, `@supabase/*` ou
  `@breakery/supabase` ; aucun `fetch(`, `localStorage` ou `window.` hors
  commentaire. L'invariant est en plus **outillé** par
  `import/no-restricted-paths` dans `eslint.config.mjs` (11 zones déclarées),
  qui interdit aussi les imports croisés POS ↔ back-office.
- **`packages/ui` n'importe jamais Supabase.** Zéro occurrence.

### 2.2 Les 9 dossiers de `features/` présents dans les deux apps

Ce n'est pas une duplication accidentelle : les deux apps servent deux personae
et l'étanchéité est imposée par ESLint. Les volumes montrent la spécialisation.

| Dossier | POS | Back-office |
|---|---|---|
| `reports` | 4 642 l. | 12 087 l. |
| `products` | 3 158 l. | 11 057 l. |
| `settings` | 3 671 l. | 7 495 l. |
| `customers` | 829 l. | 2 773 l. |
| `combos` | 1 471 l. | 2 691 l. |
| `auth` | 1 411 l. | 267 l. |
| `promotions` | 1 056 l. | 1 200 l. |
| `loyalty` | 27 l. | 1 030 l. |
| `floor-plan` | 883 l. | 921 l. |

---

## 3. Application POS (`apps/pos`)

### 3.1 Routes réelles

Déclarées dans `apps/pos/src/routes/index.tsx:82-171`.

| Route | Écran | Garde |
|---|---|---|
| `/login` | `pages/Login.tsx` | aucune |
| `/pos` | `pages/Pos.tsx` — caisse (import **statique** délibéré) | `Protected` + `CashierSurface` + `VirtualKeypadProvider` |
| `/pos/stock` | vitrine POS | `ProtectedLazy` |
| `/pos/reports` + 7 sous-routes | rapports POS (`payments`, `voids`, `sessions`, `mix`, `products`, `margin`, `activity`) | `ProtectedLazy` |
| `/pos/settings` | réglages terminal | `ProtectedLazy allowSetup` |
| `/pos/debts` | créances client | `ProtectedLazy` |
| `/pos/outstanding` | encaissement d'impayés | `ProtectedLazy` |
| `/kds` | `pages/Kds.tsx` — écran cuisine | `Protected` seul, **sans verrou ni pavé virtuel**, par décision (`routes/index.tsx:66-67`) |
| `/display` | écran client | **aucune garde** — authentifié par JWT kiosk |
| `/tablet`, `/tablet/order`, `/tablet/orders` | tablette serveur | garde propre + `TerminalLockedOverlay` interne |
| `*` | `/tablet` si coquille native (ADR-029), sinon `/pos` | — |

Amorçage : `main.tsx` charge `secureContextPolyfill` en premier (contexte LAN en
`http`), puis `AppErrorBoundary` + `StrictMode` + Sentry. Un `BootGate`
(`App.tsx:56-78`) bloque le routeur jusqu'à `bootstrapStatus === 'ready'` ; le
commentaire explique le motif (sans lui, toute requête Supabase part en 401 et
provoque une tempête de reprises).

### 3.2 Gestion d'état

`apps/pos/src/stores/` contient 14 fichiers dont **7 stores Zustand** ; les 7
autres sont des modules de types, de verrous ou de persistance brute.

| Store | Rôle | Persistance |
|---|---|---|
| `authStore` | session PIN, permissions, verrou, bootstrap | `persist` + `safeStorage` (`sessionStorage` en web, Capacitor Preferences en natif) |
| `cartStore` | panier caisse, lignes imprimées, client, promos | `persist` → `sessionStorage`, clé `breakery.cart.v2` |
| `tabletCartStore` | panier tablette | `persist` → `sessionStorage` |
| `kdsStore` | station et filtres KDS | `persist` + `safeStorage` |
| `posSettingsStore` | réglages par terminal | `persist` → **`localStorage`**, clé `pos:settings` |
| `paymentStore` | tentative de paiement, tenders, clé d'idempotence | pas de `persist` ; écriture manuelle en `localStorage` via `stores/paymentAttempt.ts` |
| `shiftStore` | shift courant (miroir) | aucune (mémoire) |

**Asymétrie assumée et importante** : le panier vit en `sessionStorage` (perdu à
la fermeture de l'onglet), la **tentative de paiement** vit en `localStorage`
(survit). L'argent survit, la saisie non.

Trois copies de l'état de shift coexistent (store mémoire, query React Query,
snapshot `sessionStorage`), avec une réconciliation défensive explicite dans
`features/lan/OfflineSaleContext.tsx:107-108`.

### 3.3 Flux de données

- **Wrapper fetch PIN-JWT** (`packages/supabase/src/client.ts:104-152`) :
  GoTrue est hors circuit (`autoRefreshToken: false`, `persistSession: false`),
  le bearer est injecté par un `global.fetch` custom, et `realtime.accessToken`
  est monkey-patché pour que le SDK n'écrase pas le jeton PIN à chaque
  reconnexion. Jamais de `auth.setSession` ni d'`Authorization` brut sur le
  client.
- **Coupe-circuit cloud** : `setSupabaseCloudEnabled(false)` fait répondre le
  fetch localement en 409 `CLOUD_SESSION_NOT_VALIDATED` sans qu'un paquet sorte.
- **12 Edge Functions** appelées par le POS, dont `process-payment` (paiement),
  `refund-order`, `void-order`, `cancel-item`, `cancel-unpaid-order`,
  `verify-manager-pin`, `generate-zreport-pdf`.
- **60 sites appellent une RPC directement** depuis le navigateur.

**Écart à signaler, documenté dans le code.** `AGENTS.md` écrit : « Le POS
n'appelle jamais la RPC directement ». La création de vente respecte bien la
règle (elle passe par `process-payment`). Mais trois RPC de money-path sont
appelées en direct :

| RPC | Site | Compensation en place |
|---|---|---|
| `pay_existing_order_v25` | `features/payment/hooks/useCheckout.ts:224` | `p_idempotency_key` + nonce `discount_authorizations` minté par EF (`useCheckout.ts:207-213` l'énonce mot pour mot) |
| `defer_pos_order_v5` | `features/payment/hooks/useCheckout.ts:222` | `p_idempotency_key` |
| `settle_pos_outstanding_v2` | `features/outstanding/OutstandingPage.tsx:37` | `p_idempotency_key` + `p_expected_paid` (concurrence optimiste) |

**C'est l'énoncé factuel d'`AGENTS.md` qui est trop large, pas le code qui
dérive** : la règle devrait dire « la RPC de *création de vente* ne s'appelle
jamais directement ». L'écart est signalé, non corrigé.

**Deux RPC échappent au versionnement `_vN`** et existent bel et bien en
production, `SECURITY DEFINER`, exécutables par `authenticated` :
`pickup_tablet_order(p_order_id uuid, p_session_id uuid)` et
`mark_item_served(p_item_id uuid)`.

### 3.4 Hors ligne

`features/lan/offlineOutbox.ts` + `offlineReplay.ts`. IndexedDB
`breakery-pos-offline` v2, magasins `outbox` et `quarantine`, repli
`localStorage`.

Quatre `kind` d'intent, format append-only respecté :

| `kind` | RPC rejouée | Statut |
|---|---|---|
| `fire` | `fire_counter_order_v12` | émis |
| `payment` | `pay_existing_order_v25` (multi-tender, ADR-015) | émis |
| `cash_payment` | `pay_existing_order_v25` (mono-règlement) | **lecture seule** — plus jamais émis, toujours lu |
| `tablet_order` | `create_tablet_order_v12` | émis |

Quarantaine (ADR-018) : écriture avant retrait de la file, classement définitif
sur une liste **explicite** de 4 SQLSTATE (`P0011`, `23514`, `23503`, `22P02`),
cascade sur la même racine, puis le drain continue. Tout autre code reste
transitoire et arrête le drain.

**Aucun chemin de double encaissement par rejeu n'a été trouvé** : la clé de
l'intent est la clé serveur, un verrou module empêche la réentrance, et
`replayAllowed()` est re-testé à chaque itération.

### 3.5 `print-bridge`

Un seul processus porte trois fonctions : pont d'impression thermique HTTPS, hub
WebSocket LAN `/ws`, et serveur statique du bundle POS (`POS_DIST_DIR`).
1 518 lignes de production, **18 fichiers de tests**.

| Route | Permission d'appareil requise |
|---|---|
| `GET /health` | **aucune** |
| `GET /hub/status`, `/scan/printers`, `/status/probe` | `diagnostics` |
| `POST /print/receipt` | `receipts.print` |
| `POST /print/ticket` | `tickets.print` |
| `POST /drawer/open` | `drawer.open` |
| `GET *` | aucune — repli SPA, seulement si `POS_DIST_DIR` est défini |

Sécurité mesurée : TLS obligatoire en production (refus de démarrer sans
`HUB_TLS_CERT`/`HUB_TLS_KEY` et au moins une origine), `minVersion TLSv1.2`,
garde d'origine avant tout, **authentification par appareil** (`x-lan-device-code`
+ `x-lan-secret`) avec permissions granulaires, anti-injection ESC/POS récursive,
deux gardes anti-SSRF indépendantes, `/drawer/open` qui ignore toute cible du
corps, `timingSafeEqual` sur le registre d'appareils.

**C'est le composant le mieux durci du dépôt. Aucun défaut de sécurité trouvé.**
Seul point ouvert : `/health` expose la version et le SHA de release à tout
appelant du LAN.

---

## 4. Back-office (`apps/backoffice`)

### 4.1 Routage

`apps/backoffice/src/routes/index.tsx` — **1 278 lignes**, le plus gros fichier
du dépôt.

| Mesure | Valeur |
|---|---|
| `<Route>` | 138 |
| Chunks `lazy()` | 124 |
| Eager (volontaire) | 2 — `LoginPage`, `BackofficeLayout` |
| `<PermissionGate>` | 116 |
| `<SuperAdminGate>` | 9 |
| `<AdminGate>` | 2 |
| Imports résolvant vers un fichier inexistant | **0** |

Quatre gardes : `Protected` (authentification), `PermissionGate` (code ou
tableau conjonctif, refus = `RouteDenied` dans la coquille avec URL conservée),
`AdminGate` (ADMIN ou SUPER_ADMIN), `SuperAdminGate`. `hasPermission` renvoie
`true` d'office au SUPER_ADMIN, d'où le recours au rôle plutôt qu'à la permission
pour les surfaces réservées.

**Aucune entrée de `layouts/nav.ts` ne pointe vers une route inexistante.**

### 4.2 Permissions figées en session — confirmé

Le commentaire `stores/authStore.ts:36-37` l'affirme ; le code le confirme sur
quatre points indépendants :

1. `permissions` n'est écrit que par `login()`, `validateSession()` et `logout()`.
2. `validateSession()` ne part que depuis `bootstrap()` (rechargement complet) ou
   depuis `stores/sessionRefresh.ts:12`, qui programme **un seul** réveil 10
   minutes avant l'expiration du bearer — soit un rafraîchissement toutes les
   ~50 minutes pour un JWT de 3 600 s.
3. **Aucun abonnement realtime sur `role_permissions`.**
4. `features/settings/roles/hooks/useSetRolePermission.ts:38` n'invalide que la
   clé de la matrice RBAC, jamais la session.

Conséquence : un SUPER_ADMIN qui modifie la matrice ne voit rien changer avant un
rechargement de page. L'interface le dit déjà à l'utilisateur à un endroit
(`features/kitchen/KitchenAccessPanel.tsx:27` : « Permission changes take effect
at the next sign-in »), mais pas dans l'éditeur RBAC lui-même.

### 4.3 Flux de données

| Voie | Occurrences |
|---|---|
| RPC via PostgREST (`supabase.rpc`) | **215 appels**, 214 noms distincts |
| Table directe (`.from(...)`) | 159, dont **22 écritures** |
| Edge Functions | 12 (7 `fetch` direct, 5 `functions.invoke`) |

**Les 214 noms de RPC appelés existent tous dans `supabase/migrations/`.** Trois
sont créés dynamiquement depuis le corps live par
`supabase/migrations/20261107000001_financial_reports_owner_only.sql:11-38`
(`pg_get_functiondef` + injection du gate `is_business_owner_v1()`) :
`get_gross_margin_by_product_v5`, `get_payments_by_method_v5`,
`get_pb1_report_v6`. C'est le pattern imposé par `AGENTS.md`, pas un défaut.
**Aucun rapport n'est branché sur une RPC droppée.**

Les 22 écritures de table directes portent sur 7 tables (`suppliers`,
`promotions`, `lan_devices`, `holidays`, `email_templates`, `receipt_templates`,
`notification_templates`). Ce n'est **plus** un trou d'audit :
`supabase/migrations/20261104000002_activity_audit_coverage.sql:37-59` installe 7
triggers d'audit couvrant exactement ces tables. Seul écart :
`audit_promotion_changes` est `AFTER INSERT OR UPDATE` (ligne 42) alors que les
six autres couvrent aussi `DELETE`.

**Aucune écriture brute sur `orders`, `order_items`, `stock_movements`,
`audit_logs` ou `order_payments`** : les invariants money-path et ledger
append-only sont respectés.

**Arbitrage PIN respecté partout** : header `x-manager-pin` vers les Edge
Functions, argument `p_manager_pin` vers les RPC Postgres. Aucun PIN en corps
JSON.

### 4.4 Langue de l'interface — conforme, mesuré

Trois balayages successifs sur les 788 fichiers source :

1. Attributs `label`/`placeholder`/`title`/`aria-label`, appels `toast.*`,
   `new Error`, `setError`, nœuds texte JSX → 3 résultats, **3 faux positifs**
   (tous en anglais).
2. Caractères accentués hors commentaires (après neutralisation correcte de `//`
   en épargnant les `://` d'URL, et de `/* */`) → **0 occurrence**. Contrôle de
   sanité : 647 fichiers contiennent `é`, tous dans des commentaires.
3. Mots-clés français non accentués dans les chaînes et le JSX → toutes les
   correspondances sont des commentaires, vérifiées ligne par ligne.

**Verdict : 0 libellé en français dans le JSX du back-office.** La règle
« l'interface parle anglais, les commentaires parlent français » est tenue à
100 % sur ce périmètre.

Point de fragilité : **aucune garde CI ne surveille la langue.** La conformité
repose sur la discipline de revue. Une garde (grep accents + mots-clés hors
commentaires) serait verte au premier essai aujourd'hui.

---

## 5. Modèle de données et état de la production

### 5.1 Volumétrie et sécurité du schéma

| Mesure | Production `yjhhhmjgsmyzyymvixot` | Dev `ikcyvlovptebroadgtvd` |
|---|---|---|
| Tables (`public`) | 133 | 135 |
| Tables avec RLS activée | **133 / 133** | **135 / 135** |
| Tables sans aucune policy | 1 (`pos_payment_attempt_keys`) + 1 hors `public` | 0 |
| Policies | 286 | 292 |
| Vues | — | 7 |
| Vues matérialisées | 3 | 3 |
| Fonctions applicatives | 491 | 507 |
| dont `SECURITY DEFINER` | 445 | 460 |
| dont versionnées `_vN` | — | 422 |
| Enums | — | 20 |

**La RLS est activée sur 100 % des tables `public`, dans les deux bases.** Aucune
table de la production n'est en RLS désactivée.

Les deux tables « RLS activée, aucune policy » (`pos_payment_attempt_keys`,
`stock_private.mutation_requests`) sont **fail-closed** : sans policy, aucun
accès `authenticated` n'est possible, et les écritures passent par des RPC
`SECURITY DEFINER`. C'est correct, et c'est à conserver tel quel.

### 5.2 Tables critiques et leur volumétrie de production (2026-11-09)

| Table | Lignes | Rôle (commentaire DB) |
|---|---|---|
| `journal_entry_lines` | 28 863 | lignes d'écriture comptable, debit XOR credit |
| `audit_logs` | 21 172 | piste d'audit append-only |
| `order_items` | 12 462 | lignes de commande, écriture par RPC seulement |
| `journal_entries` | 11 855 | en-têtes d'écriture (1 par vente / annulation) |
| `edge_function_rate_limits` | **9 502** | compartiments de rate-limit — **jamais purgés** (§5.5) |
| `pos_events_default` | **9 741** | journal POS — **partition par défaut** (§5.6) |
| `stock_movements` | 7 682 | ledger append-only, RLS révoque UPDATE/DELETE |
| `orders` | 5 033 | commandes |
| `order_payments` | 4 716 | lignes de paiement immuables |
| `historical_import_documents` | 4 171 | documents de la reprise historique d'octobre |
| `recipe_versions` | 3 952 | snapshots append-only de nomenclature |
| `historical_import_payments` | 3 957 | règlements importés |
| `display_movements` | 1 826 | ledger vitrine POS |
| `products` | 379 | catalogue |
| `recipes` | 809 | nomenclatures |
| `production_records` | 495 | lots de production |
| `role_permissions` | 301 | matrice de droits (donnée, pas code) |
| `permissions` | 162 | catalogue `module.action` |
| `user_profiles` | 11 | identités applicatives |
| `roles` | 6 | catalogue de rôles |

### 5.3 Modules jamais utilisés en production (0 ligne)

Ce sont des **surfaces écrites et déployées, jamais exercées**. Ce n'est pas un
défaut, c'est une information de couverture métier.

`refunds`, `refund_lines`, `refund_payments`, `refund_sequences` · `promotions`,
`promotion_applications` · `discount_templates` · `cash_movements` ·
l'intégralité des 12 tables `bank_reconciliation_*` et `bank_statement_*` ·
`notification_outbox`, `notification_templates`, `email_templates`,
`receipt_templates` · `holidays` · `display_screens`, `kiosk_devices` ·
`production_schedules` · `margin_alerts` · `stock_reservations` ·
`product_category_prices` · `held_order_idempotency_keys` · `b2b_settings` ·
`pos_events_2026_07/08/09` · `business_day_releases`.

**Le point le plus notable : `refunds` est vide.** 12 commandes sont en statut
`voided` (du 2026-10-31 au 2026-11-02), mais **aucun remboursement partiel n'a
jamais été effectué en production**. Le module remboursement — par ailleurs le
code financier le mieux armé du dépôt — n'a jamais tourné sur de l'argent réel.

### 5.4 **P0 — 4 RPC appelées par le back-office déployé sont absentes de la production**

Preuve des deux côtés :

- **Côté déployé** : API Vercel, déploiement de production
  `dpl_FzQg9HfguPJSjpjdLKUroSrvda2U`, état `READY`, créé le 2026-11-08, commit
  `e204d57a0b585c52a5332397e1f5b0ce3dc73d77` — soit **exactement `master` HEAD**.
- **Côté base** : requête sur `pg_proc` de `yjhhhmjgsmyzyymvixot`, croisée avec
  les 280 noms de RPC extraits de `git grep` sur `apps`, `packages` et
  `supabase/functions`.

| RPC appelée | Site d'appel | Ce que la production contient |
|---|---|---|
| `bank_reconciliation_post_v5` | `features/accounting/bank-reconciliation/api.ts:69` | `bank_reconciliation_post_v4` |
| `bank_reconciliation_clearing_v3` | `features/accounting/bank-reconciliation/api.ts:23` | `bank_reconciliation_clearing_v2` |
| `preview_cash_journal_import_v3` | `features/accounting/components/CashJournalImport.tsx:31` | **aucune fonction d'import de journal de caisse** |
| `apply_cash_journal_import_v4` | `features/accounting/components/CashJournalImport.tsx:46` | idem |

Les quatre existent en dev. Ce n'est donc pas un bug de code : c'est un **écart
de livraison**. Le back-office est publié sur Vercel indépendamment des paquets
de migration de la base, et quatre appels ont pris de l'avance sur le schéma.

**Effet attendu** : PostgREST répond `PGRST202` (« Could not find the function »).
Concrètement, en production aujourd'hui : la **comptabilisation** d'un
rapprochement bancaire, la **lecture du compte d'attente** de ce
rapprochement, et **tout l'écran d'import de journal de caisse** échouent.

Ces modules n'ont jamais été utilisés en production (§5.3 : 0 ligne dans toutes
les tables `bank_reconciliation_*`), ce qui explique pourquoi la panne n'a pas
encore été vue. **Elle sera vue au premier usage.**

### 5.5 **P0 — Aucune tâche planifiée en production**

`select * from cron.job` renvoie **0 ligne** sur `yjhhhmjgsmyzyymvixot`.

La base de dev en porte 9 :

| Tâche (dev) | Horaire | Active |
|---|---|---|
| `mark_expired_lots_hourly()` | `7 * * * *` | non |
| `refresh_mv_sales_daily()` | `5 * * * *` | oui |
| `refresh_mv_stock_variance()` | `*/15 * * * *` | oui |
| `refresh_mv_pl_monthly()` | `0 2 * * *` | oui |
| `release_expired_reservations()` | `*/5 * * * *` | oui |
| purge de `edge_function_rate_limits` | `5 19 * * *` | oui |
| `net.http_post` vers une Edge Function | `0 2 * * *` | oui |
| `net.http_post` vers une Edge Function | `* * * * *` | oui |
| `expire_store_credit_v1()` | `15 2 * * *` | oui |

**Cause racine identifiée.** 13 migrations du dépôt appellent `cron.schedule`
(`20260517000045`, `20260517000071`, `20260517000132`, `20260517000222`,
`20260519000142`, `20260523000011`, `20260525000011`, `20260525000012`,
`20260630000023`, `20260716000169`, `20260726000236`, `20260901000016`,
`20260906000002`). Or la production **n'a pas été construite par la lignée de
migrations** : son journal `supabase_migrations.schema_migrations` ne contient
que 37 entrées, dont 16 parties d'un dump de schéma
(`production_candidate_aa7b34ed_schema_part_01` à `_12` + 3 `acl_part_*` +
`approved_references`) puis 21 paquets de livraison. Un dump du schéma `public`
ne transporte pas les lignes de la table `cron.job`.

**Conséquences mesurées en production :**

| Conséquence | Preuve |
|---|---|
| `mv_sales_daily` **jamais peuplée** | `pg_class.relispopulated = false`, 8 192 octets |
| `mv_pl_monthly` **jamais peuplée** | idem |
| `mv_stock_variance` peuplée (112 ko) | `relispopulated = true` — l'a donc été manuellement une fois |
| `edge_function_rate_limits` croît sans limite | 9 502 lignes |
| Réservations de stock jamais libérées | `release_expired_reservations` jamais appelée (`stock_reservations` = 0 ligne, donc sans effet **aujourd'hui**) |
| Avoirs client jamais expirés | `expire_store_credit_v1` jamais appelée |
| Lots périmés jamais marqués | `mark_expired_lots_hourly` jamais appelée (et désactivée même en dev) |
| Notifications jamais envoyées | voir §5.7 — les deux EF concernées ne sont pas déployées |
| Sauvegarde autonome absente | cohérent avec `docs/runbooks/etat-environnements.md` (« La sauvegarde quotidienne autonome n'est pas activée ») |

Une vue matérialisée non peuplée fait **échouer** tout `SELECT` dessus
(`ERROR: materialized view ... has not been populated`). Aucune fonction
applicative de production ne lit `mv_sales_daily` ni `mv_pl_monthly` — seules
`refresh_mv_sales_daily` et `refresh_mv_pl_monthly` les citent. Donc **l'effet
actuel est nul**, mais les deux vues sont de la structure morte, et tout rapport
qui s'y brancherait un jour échouerait immédiatement.

### 5.6 **P1 — Le journal `pos_events` écrit dans sa partition par défaut**

`pos_events` est partitionnée par mois sur `occurred_at`. Partitions existantes
en production :

| Partition | Bornes |
|---|---|
| `pos_events_2026_07` | 2026-07-01 → 2026-08-01 (+08) |
| `pos_events_2026_08` | 2026-08-01 → 2026-09-01 |
| `pos_events_2026_09` | 2026-09-01 → 2026-10-01 |
| `pos_events_default` | `DEFAULT` |

Il n'existe **aucune partition pour octobre ni novembre 2026**. Résultat :
`pos_events_default` contient 9 741 lignes, de `2026-10-07 22:45:53+08` à
`2026-11-08 17:59:03+08`. Les trois partitions mensuelles sont vides.

La fonction `create_pos_events_partition_v1` existe en production, mais rien ne
l'appelle (pas de cron — §5.5).

Deux effets :

1. Le bénéfice du partitionnement (élagage de partition, purge par `DROP`) est
   perdu : tout vit dans une seule table qui grossit.
2. **Créer la partition d'octobre ou de novembre échouera désormais** : Postgres
   refuse d'attacher une partition dont la plage recouvre des lignes déjà
   présentes dans la partition par défaut. Il faudra d'abord déplacer les lignes.
   Plus on attend, plus le geste est lourd.

### 5.7 Edge Functions — déployé contre dépôt

Le dépôt contient **19 fonctions** (+ `_shared`). La production en a **17**
actives.

**Absentes de la production** : `notification-dispatch`,
`customer-birthday-notify`.

C'est cohérent avec §5.5 (le cron qui les déclenche n'existe pas) et avec
`notification_outbox` à 0 ligne. **Le module de notifications est intégralement
inactif en production** : code écrit, tables créées, fonction non déployée,
planificateur absent.

`verify_jwt` observé en production : `true` pour `process-payment`,
`generate-pdf`, `generate-zreport-pdf`, `kiosk-issue-jwt`,
`download-expense-receipt` ; `false` pour les autres, qui vérifient
l'authentification dans leur code.

### 5.8 Traçabilité des migrations — le point faible de l'architecture

| Mesure | Valeur |
|---|---|
| Fichiers dans `supabase/migrations/` | 1 240 |
| Entrées dans `schema_migrations` (dev) | 1 137 |
| Entrées dans `schema_migrations` (production) | **37** |
| Fichiers portant un numéro **dupliqué** | 12 fichiers, 6 paires |
| Migrations contenant `BEGIN;`/`COMMIT;` (interdit) | 13 |

- **Numéros dupliqués** : `20260710000135`, `20260710000136`, `20260818000006`,
  `20260818000007`, `20260818000008`, `20260920000001` portent chacun deux
  fichiers différents. Le numéro est la clé primaire du journal : deux fichiers
  pour un numéro signifie qu'un seul peut être enregistré.
- **`BEGIN;`/`COMMIT;` dans le corps** : 13 migrations historiques
  (`20260517000120`, `…121`, `…122`, `…200`, `…220`, `…221`, `…222`, `…230`,
  `20260525000020`, `20260706000009`, `20260706000027`, `20260710000099`,
  `20260710000100`). `AGENTS.md` l'interdit (le MCP wrappe déjà). Elles sont
  déjà appliquées ; le constat est historique, pas actionnable.
- **La production n'est pas reconstructible depuis le dépôt.** Son journal
  n'identifie que des *paquets* (`production_candidate_b29c78ee_validated_delta`,
  `pos_outstanding_financial_compatible_release`, …), pas des fichiers. Savoir
  « quelle migration est appliquée en production » n'a pas de réponse au niveau
  du fichier — seulement au niveau du paquet. C'est exactement le mécanisme qui a
  laissé passer les 4 RPC manquantes du §5.4 et les 9 tâches cron du §5.5.

### 5.9 Objets de base présents en dev et absents du dépôt

13 fonctions existent dans la base de dev sans qu'aucune migration ne les crée.
Dix ne sont **même pas nommées** dans le dépôt :

`_guard_expense_approval_invoice_v1` · `_guard_expense_payment_invoice_v1` ·
`_guard_invoice_fields_v1` · `_guard_outstanding_invoice_v2` ·
`_guard_po_payment_invoice_v1` · `_imported_before_invoice_cutoff_v1` ·
`_payment_invoice_valid_v1` · `close_shift_v11` · `hold_fired_order_v4` ·
`kiosk_jwt_signing_keys_placeholder_never`

**Aucune des dix n'existe en production** (vérifié). Ce sont des objets créés
directement sur dev par `execute_sql`, hors fichier de migration.

Conséquence concrète et vérifiée : la base de dev contient
`hold_fired_order_v4` **et pas `v3`**, alors que le POS appelle
`hold_fired_order_v3` (`apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts:15`).
La production, elle, a bien `v3`. **La mise en attente d'une commande envoyée est
donc cassée sur dev et fonctionnelle en production** — l'inverse de ce qu'un
environnement de répétition doit garantir.

### 5.10 Versions de RPC concurrentes en production

`AGENTS.md` impose : « créer `_vN+1` et DROP l'ancienne dans la même migration ».
Neuf familles ont plusieurs versions vivantes en production :

| Famille | Versions en production | Appelée par le code | Ancienne exécutable par `authenticated` |
|---|---|---|---|
| `close_shift` | v10, v12, v13 | v13 | **oui** pour v12 (`SECURITY DEFINER`) ; v10 n'est pas `SECURITY DEFINER` |
| `refund_order_rpc` | v14, v15 | v15 | **non** — révoquée (appel par EF service-role uniquement) |
| `void_order_rpc` | v13, v14 | v14 | **non** — révoquée |
| `defer_pos_order` | v1, v5 | v5 | **oui** |
| `settle_pos_outstanding` | v1, v2 | v2 | **oui** |
| `record_cash_movement` | v2, v4 | v4 | **oui** |
| `get_cash_wallet_balances` | v2, v4 | v4 | **oui** |
| `_guard_pos_outstanding` | v1, v2, v3 | — (helper) | — |
| `_post_pos_outstanding` | v2, v3 | — (helper) | — |

Le point rassurant : **les deux familles les plus sensibles (remboursement et
annulation) sont correctement révoquées pour `authenticated`.** Le point à
corriger : `close_shift_v12`, `defer_pos_order_v1`,
`settle_pos_outstanding_v1`, `record_cash_movement_v2` et
`get_cash_wallet_balances_v2` sont des versions abandonnées, `SECURITY DEFINER`,
**toujours appelables par tout compte connecté** via
`/rest/v1/rpc/<nom>`. Elles ne portent plus aucun correctif apporté depuis.

> **Limite assumée** : je n'ai pas exécuté ces fonctions (écriture en production
> interdite). Le constat est une **exposition prouvée**, pas un exploit
> démontré : je n'ai pas établi qu'un appel à `close_shift_v12` réussirait
> aujourd'hui.

### 5.11 Avis de sécurité Supabase sur la production (2026-11-08)

Relevé par `get_advisors(type: security)`.

| Avis | Nombre | Lecture |
|---|---|---|
| `authenticated_security_definer_function_executable` | **321** | **Attendu par conception.** Toute l'écriture métier passe par des RPC `SECURITY DEFINER` appelées par `authenticated` ; le contrôle est fait *dans* la fonction (`has_permission`, PIN, verrous). Ce n'est pas un défaut — sauf pour les 5 versions abandonnées du §5.10. |
| `function_search_path_mutable` | 16 | `get_loyalty_tier`, `round_idr`, `pos_events_block_mutations`, `tr_block_payment_on_historical_po`, `hash_session_token_trigger`, … — durcissement à faire (`SET search_path`) |
| `extension_in_public` | 2 | `btree_gist`, `pg_trgm` |
| `anon_security_definer_function_executable` | **1** | `list_login_users_v1` — **justifiée** : `COMMENT` = « anon-callable: pre-auth login user picker — minimal exposure (id, name, role) » |
| `rls_enabled_no_policy` | 2 | `pos_payment_attempt_keys`, `stock_private.mutation_requests` — fail-closed voulu |
| `auth_leaked_password_protection` | 1 | protection HaveIBeenPwned désactivée dans GoTrue |

**Le contrôle d'exposition `anon` est tenu.** Les deux seules fonctions
applicatives exécutables sans authentification sont `list_login_users_v1` et
`enforce_pin_session_v2`, et **les deux portent un `COMMENT` de justification**
au format exigé par `AGENTS.md`. Tout le reste de la liste `anon` provient des
extensions `btree_gist` / `pg_trgm` installées dans `public`.

---

## 6. État des modules métier

Barème. **COMPLET** : parcours câblé, erreurs et chargement rendus, tests
présents. **PARTIEL** : fonctionnel, trou identifié. **FRAGILE** : trou de filet
(aucun test, ou échec de lecture non rendu sur un parcours argent ou stock).

### 6.1 Caisse / POS

| Module | Fichiers / tests | Statut | Trou identifié |
|---|---|---|---|
| `cart` | 27 / **33** | COMPLET | — |
| `payment` | 20 / 18 | COMPLET | `usePaymentFlowLogic.ts` à 498 lignes |
| `kds` | 29 / 20 | COMPLET | — |
| `tablet` | 24 / 24 | PARTIEL | `hooks/useTabletOffline.ts` (118 l.) inaccessible depuis `main.tsx`, et **trois commentaires affirment le contraire** |
| `lan` (hors ligne) | 24 / 21 | PARTIEL | quarantaine écrite sans lecteur (§7.1) |
| `shift` | 18 / 12 | COMPLET | — |
| `display` | 19 / 15 | COMPLET | pas de fail-open : un JWT kiosk invalide purge le jeton et renvoie à l'appairage |
| `order-history` | 15 / 7 | COMPLET | module remboursement = meilleur code financier du dépôt |
| `reports` | 20 / 11 | COMPLET | 8 pages routées |
| `settings` | 22 / 9 | COMPLET | — |
| `stock` | 17 / **4** | PARTIEL | 5 RPC d'écriture dans un ledger append-only pour 4 fichiers de tests — le pire ratio du POS |
| `outstanding` | 1 / **0** | FRAGILE | l'écran **encaisse** (`settle_pos_outstanding_v2`) et n'a aucun test |
| `inbox` | 7 / 2 | FRAGILE | **4 des 7 fichiers inaccessibles** — implémentation parallèle du pickup tablette, supersédée par `features/cart/HeldOrdersModal` ; **2 tests valident du code mort** |
| `promotions` | 5 / 4 | FRAGILE | repli TypeScript silencieux sur les remises (§7.3) |
| `auth`, `customers`, `customerCategories`, `discounts`, `heldOrders`, `products` | — | PARTIEL | fichiers morts, détail dans le rapport 02 |
| `audit`, `combos`, `floor-plan`, `nav`, `sync`, `tables`, `loyalty` | — | COMPLET | — |

**Piège de méthode confirmé** : `features/loyalty` a 0 test dans son dossier et
est pourtant couvert par 5 fichiers de tests ailleurs (`src/__tests__/loyalty*`,
`features/payment/__tests__/`, `packages/ui/`). Conclure « pas de test » depuis
un seul répertoire aurait été faux.

### 6.2 Back-office / ERP

| Module | Fichiers / lignes / tests | Statut | Trou identifié |
|---|---|---|---|
| **Reporting** (`reports`) | 76 / 8 294 / **77** | COMPLET | 42 pages de rapport, hub à 45 tuiles, socle `ReportShell` avec bannière `role="alert"` unifiée. Toutes les RPC sont vivantes. |
| **Comptabilité** (`accounting`) | 59 / 5 640 / 22 | COMPLET | 23 RPC ; mais **2 RPC de rapprochement bancaire absentes en production** (§5.4) |
| **Catalogue** (`products`) | 66 / 7 812 / 33 | COMPLET | bouton « Recipes » no-op (§7.5) |
| **Réglages** (`settings`) | 40 / 4 584 / 27 | COMPLET | 17 pages ; 6 pages sans surface d'erreur de lecture |
| **Production** (`inventory-production`) | 35 / 4 251 / 20 | COMPLET | `ProductionTodayPanel` affiche « rien produit » sur échec de lecture |
| **Stocks** (`inventory`) | 25 / 2 702 / 20 | COMPLET | `StockDeclarationsPanel.tsx:33` valide `Array.isArray` avant le cast — **la meilleure pratique du dépôt** |
| **Commandes** (`orders`) | 27 / 3 186 / 14 | COMPLET | `useOrdersList.ts:114` déréférence `next_cursor_val` sans garde (§7.4) |
| **B2B** (`btob`) | 29 / 2 921 / 14 | COMPLET | `B2bInvoicesTab.tsx:115` : échec de lecture = « aucune facture » sur un écran de créances |
| **Dépenses** (`expenses`) | 31 / 2 220 / 15 | PARTIEL | 3 routes sans garde de permission ; `ApprovalTimeline.tsx:16` rend une frise vide sur échec |
| **Achats** (`purchasing`) | 17 / 1 773 / 9 | COMPLET | `PurchaseOrderDetailPage.tsx` à 700 lignes |
| **Utilisateurs / Rôles** | 10 + 12 / 4 tests | COMPLET | matrice RBAC **éditable** (6 composants + 6 hooks, 5 RPC), mais les droits ne se propagent pas à la session (§4.2) |
| **Clients** (`customers`) | 22 / 2 217 / 8 | PARTIEL | la fiche client et ses 4 onglets n'ont **aucune** surface d'erreur |
| **Imports** (`catalog-import`, `data-import`) | 15 / 1 130 / 8 | COMPLET | — |
| `historical-import` | 4 / 435 / 4 | PARTIEL | **pas de route** — monté en `lazy` dans `AccountingIndexPage.tsx:44` ; injection PostgREST (§7.6) |
| **Fournisseurs** (`suppliers`) | 17 / 1 279 / **0 interne** | FRAGILE | CRUD en **écriture PostgREST brute** ; audité par trigger DB |
| `promotions` | 12 / 1 036 / 1 | FRAGILE | écritures brutes ; trigger d'audit **sans `DELETE`** |
| `loyalty` | 12 / 894 / 1 | FRAGILE | — |
| `marketing` | 8 / 643 / 1 | FRAGILE | les 4 pages ne rendent **aucune** erreur et n'utilisent pas `ReportShell` alors qu'elles figurent au hub des rapports |
| `inventory-alerts` | 11 / 2 | PARTIEL | `AlertsBadge.tsx:16` : échec = « 0 alerte » dans le chrome |
| `inventory-movements` | 6 / 1 | PARTIEL | — |
| `sections` | 2 / **0** | FRAGILE | — |
| `inventory-dashboard` | 2 / **0** | FRAGILE | — |
| `lan-devices` | 7 / 3 | PARTIEL | la page et sa table divergent sur le même hook |
| `kitchen` | 8 / 2 | COMPLET | gestion d'erreur exemplaire (`KitchenPage.tsx:64-68`) |
| `cash-register` | 8 / 4 | COMPLET | PIN en **argument** RPC, conforme à l'arbitrage |
| `floor-plan` | 4 / 1 | PARTIEL | gardée par `tables.update` (permission d'écriture pour une lecture) |
| `accounting-mappings` | 3 / 1 | PARTIEL | — |
| `inventory-opname` | 13 / 6 | COMPLET | `finalize_opname_v6` : réponse castée sans validation (§7.2) |
| **`devices`** | 1 / 0 | **MORT** | 0 importeur de production ; doublon de `lan-devices` |

### 6.3 Filets de vérification

| Filet | Portée réelle |
|---|---|
`governance-guards` (CI, job nu) | 2 gardes inline + **10 gardes nommées**, dont la n°10 `line-total-formula` qui protège la formule de prix de ligne |
`lint` (bloquant) | **seulement les fichiers changés**, et seulement sous `**/src/**` |
`lint-advisory` | `pnpm lint` complet, `continue-on-error` |
`typecheck` | `turbo run typecheck` — périmètre workspace |
`unit-tests` | matrice `[backoffice, pos, shared]`, `fail-fast: false` |
`build` | `pnpm build` |
`pgtap-pr.yml` + `db-gate` | pgTAP requis pour `supabase/{migrations,tests,functions}` |
`playwright-e2e.yml` | **manuel** |
`vitest-live.yml` | **manuel** |
`pgtap-nightly.yml` | programmation déclarée ; exécution effective à vérifier sur GitHub |
`staging-deploy.yml` | s'arrête volontairement avant déploiement |

**Trou de filet P0.** `supabase/functions` — les ~3 000 lignes de Deno qui portent
`process-payment`, `refund-order`, `void-order`, `cancel-item`,
`cancel-unpaid-order`, `verify-manager-pin` et `auth-verify-pin`, soit **tout
l'encaissement et toute l'authentification** — n'ont **aucune analyse statique en
intégration continue**. Trois faits vérifiés indépendamment :

1. Le lint bloquant exige le glob `**/src/**` ;
   `supabase/functions/process-payment/index.ts` n'est pas sous un `src/`.
2. `pnpm lint` = `turbo run lint`, limité aux membres du workspace ;
   `supabase/functions` n'en est pas un.
3. `grep -rni "deno" .github/workflows/` → **zéro résultat**. Aucun `deno check`,
   aucun `deno lint`, aucun `tsc` sur ces fonctions.

C'est aussi l'explication mécanique du comptage des `any` : 14 des 24 `any` de
production du dépôt sont dans `supabase/functions`, le seul endroit où
`no-explicit-any: 'error'` ne s'applique jamais.

**Asymétrie à noter** : `supabase/functions` *déclenche* l'exigence pgTAP de
`db-gate`, mais n'a aucun filet statique. Le filet DB s'applique, le filet de
code non.

---

## 7. Fragilités de parcours identifiées

Classées par risque financier décroissant. Chaque constat porte sa preuve.

### 7.1 ADR-018 décision 5 n'est pas implémentée — argent encaissé invisible

`docs/adr/018-quarantaine-intents-hors-ligne-rejetes.md:44-48` décide qu'un
intent de **règlement** quarantiné déclenche « une alerte visible en caisse qui
ne se referme pas d'elle-même : c'est de l'argent déjà encaissé qui ne remontera
pas sans geste humain ».

Faits :

- `replayOfflineOutbox` renvoie bien `quarantined`
  (`features/lan/offlineReplay.ts:102`, `:285`, `:337`).
- **Le seul consommateur de ce retour ignore le champ** :
  `features/lan/hooks/useOfflineReplay.ts:48-70` ne lit que `res.replayed` et
  `res.failed`.
- `quarantinedIntentCount` et `getQuarantinedIntents`
  (`offlineOutbox.ts:313`, `:325`) **n'ont aucun appelant en production**
  (confirmé deux fois : scan de symboles et `grep -rn "quarantin"` sur tout le
  dépôt hors tests).
- La pastille du header ne compte que la file vivante, pas la quarantaine
  (`pages/Pos.tsx:123` → `pendingIntentCount`, qui ne lit que le magasin
  `outbox`).

Conséquence : un encaissement espèces hors ligne définitivement rejeté disparaît
de l'écran du caissier. La seule trace restante est l'événement
`pos.offline_intent_quarantined` dans le journal d'audit du back-office, qu'il
faut aller chercher.

C'est un **écart décision ↔ implémentation**, donc du backlog au sens
d'`AGENTS.md`, pas une erreur documentaire.

Aggravant : `offlineReplay.ts:175-186` passe `p_session_id: intent.root_client_uuid`
— un UUID de commande en identifiant de session — sur le chemin de retrouvaille
d'une racine rejouée dans un run précédent. Si la racine est absente côté
serveur, l'erreur attendue (`23503` ou `23514`) figure dans
`DEFINITIVE_ERROR_CODES` (`:45-50`) : le règlement part en quarantaine, donc
invisible par le point ci-dessus.

### 7.2 `finalize_opname_v6` : réponse de mouvements de stock non validée

`features/inventory-opname/hooks/useOpnameMutations.ts:151` type
`FinalizeOpnameResult.movements` en `any[]`, et `:166` fait
`return data as FinalizeOpnameResult;` **sans une seule vérification** : ni
`count_id` concordant, ni `status`, ni `Number.isFinite(movements_emitted)`, ni
`idempotent_replay` booléen.

C'est l'opération qui solde un inventaire physique et redresse la valeur du
stock. Une réponse tronquée ou un rejeu silencieux affiche « finalisé » avec un
nombre de mouvements faux.

Tout le reste du dépôt valide ces enveloppes — c'est le seul écart net sur un
parcours de stock.

### 7.3 Repli TypeScript silencieux sur le calcul des remises

`features/promotions/hooks/useEvaluatePromotions.ts:225-241` : sur échec de la
RPC `evaluate_promotions_v3`, un `catch` fait `console.warn` puis bascule sur le
moteur TypeScript local `evaluatePromotionsFallback`. **Aucun toast, aucun signal
utilisateur.**

Le serveur revalide à l'encaissement (`useCheckout.ts:99-106`), donc l'argent est
protégé. Mais une panne réseau transitoire suffit à faire afficher au caissier un
panier calculé par un moteur non autoritaire, et une divergence TS ↔ SQL produit
un prix annoncé que le serveur refusera ou corrigera.

À noter : `packages/domain/src/promotions/` contient **deux** moteurs,
`evaluatePromotions` (`evaluator.ts:135`, 165 lignes) et
`evaluatePromotionsFallback` (`bogoEngine.ts:350`, 375 lignes). **Seul le
fallback est appelé en production** ; `evaluatePromotions` n'a aucun consommateur
applicatif, mais 5 fichiers de tests s'appuient dessus.

### 7.4 Pagination des commandes : déréférencement sans garde

`features/orders/hooks/useOrdersList.ts:110` caste la réponse de
`get_orders_list_v7` vers un type non nullable, puis `:114` et `:116`
déréférencent `lastPage.next_cursor_val` et `lastPage.next_cursor_id` dans
`getNextPageParam`. Un `NULL` SQL lève un `TypeError` **hors** du `queryFn` :
l'erreur ne passe donc pas par `error` et remonte jusqu'à `RouteErrorBoundary`.

Le modèle de correction existe dans le même module :
`features/orders/hooks/useOrdersCounters.ts:73-83` caste vers une forme nullable
à champs optionnels puis valide chaque cellule.

### 7.5 Le bouton « Recipes » du catalogue est un no-op

- `features/products/components/ProductsHeader.tsx:84-87` rend un bouton actif.
- `pages/Products.tsx:271` lui câble `navigate('/backoffice/inventory/recipes')`.
- `routes/index.tsx:401` renvoie cette route vers `/backoffice/products`.

Cliquer « Recipes » depuis la page Produits recharge la page Produits. Mêmes
liens morts dans `pages/recipes/RecipeDetailPage.tsx:55` et `:84`.

### 7.6 Deux injections de filtre PostgREST

**(a)** `features/historical-import/HistoricalReferencePanel.tsx:51` interpole
des données venant d'un **fichier JSON téléversé par l'utilisateur** dans un
filtre `or=` sans aucune sanitisation :

```
.or(`code.eq.${ref.code},name.ilike.${ref.name}`)
```

Une virgule ou une parenthèse dans `name` restructure la condition. L'impact est
borné par la RLS et par la liste de colonnes, donc pas d'exfiltration arbitraire
— mais le résultat de cette requête **pilote une garde d'ambiguïté** (lignes
52-54) : un filtre détourné peut faire créer un fournisseur en doublon.

**(b)** Le dépôt a une défense correcte, définie **quatre fois à l'identique** :

```
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
```

dans `features/accounting/hooks/useJournalEntries.ts:93-95`,
`features/customers/hooks/useCustomersList.ts:74-76`,
`features/loyalty/hooks/useLoyaltyCustomersList.ts:71-73` et
`layouts/usePaletteSearch.ts:41-43`.

**Deux fichiers utilisent une version affaiblie** qui n'échappe que les jokers
`LIKE` : `features/expenses/hooks/useExpensesList.ts:54` et
`features/suppliers/hooks/useSuppliersList.ts:36`. Une virgule tapée dans la
barre de recherche ajoute une condition au `or=`.

Les filtres `.is('deleted_at', null)` restent en `AND`, donc les lignes
supprimées ne fuitent pas ; l'effet est un élargissement du jeu de résultats ou
une erreur PostgREST brute à l'écran.

La cause est connue du dépôt lui-même : le sanitizer est **dupliqué 4 fois** au
lieu de vivre dans `packages/utils`, et aucune garde CI ne surveille
l'interpolation dans un `.or(`.

### 7.7 Argent en flottant sur le rapprochement bancaire

`features/accounting/bank-reconciliation/money.ts` fait tout en `BigInt` de
centimes, avec validation regex et plafond — précisément pour ne jamais toucher à
un flottant. Puis `api.ts:62-63` et `:71` le défont avec `Number(...)`.

Atténuation réelle : le `validate` de `sendBankManage` recompare la valeur
renvoyée à la chaîne d'origine, donc une dérive **refuse l'opération** au lieu de
perdre de l'argent. Mais `p_fee_amount` (`api.ts:71`) n'a **pas** de
recomparaison équivalente dans le `validate` de `sendBankPost`, qui ne vérifie
que des UUID.

**Vérification complémentaire faite sur la base live** : les arguments
`p_opening_balance` et `p_closing_balance` de `bank_reconciliation_balances_v2`
sont bien des `numeric`, et la fonction n'est **pas** `STRICT`
(`proisstrict = false`), donc elle accepte `NULL`. Les trois `null!` de
`api.ts:62,63,71` contournent donc une **inexactitude du type généré**, pas un
contrat serveur. Ce n'est pas une vérification de sûreté désactivée.

> Rappel : ce module n'a jamais tourné en production (0 ligne dans les 12 tables
> `bank_reconciliation_*`), et deux de ses RPC y sont absentes (§5.4).

### 7.8 Les « faux vides » — un échec de lecture indistinguable d'un « rien à faire »

Le défaut dominant du back-office n'est pas le `catch` muet (il n'y en a aucun
par négligence), c'est le hook de **lecture** dont on ne destructure que `data`.
Les 6 plus graves, sur un parcours argent ou stock :

| Site | Effet d'un échec de lecture |
|---|---|
| `features/expenses/components/ApprovalTimeline.tsx:16` | frise d'approbation vide, rendue comme le cas « approbation automatique » — un approbateur peut croire qu'aucune étape ne reste |
| `features/btob/components/B2bInvoicesTab.tsx:115` | « aucune facture » sur un écran de **créances** |
| `pages/customers/customer-detail/StoreCreditTab.tsx:30` | « aucun historique » là où un crédit magasin peut exister |
| `features/inventory-alerts/components/AlertsBadge.tsx:16` | « 0 alerte » dans le chrome |
| `features/inventory-production/components/ProductionTodayPanel.tsx:77` | « rien produit aujourd'hui » sur le journal de production |
| `pages/users/NewUserPage.tsx:12` | sélecteur de rôle vide, formulaire insoumettable sans explication |

Neuf autres sites sont listés dans le rapport 02.

### 7.9 Ce qui est délibéré et correct — ne pas « corriger »

Plusieurs motifs ressemblent à des défauts et sont des décisions *fail-closed*
commentées. Ils sont documentés ici pour qu'ils ne soient pas cassés par un
nettoyage.

- **`apps/pos/src/stores/paymentAttempt.ts:39-43`** — `savePaymentAttempt` écrit
  **sans** `try/catch`, volontairement : si le stockage est plein, le paiement ne
  part pas. L'appelant traite finement les deux régimes
  (`paymentStore.ts:25` lit sous `try` avec un message opérateur explicite ;
  `:90` et `:100` écrivent sous `try` parce que la tentative est déjà persistée).
  **Un audit superficiel signalerait un bug ici.**
- **`features/lan/offlineOutbox.ts:199-227`** — les deux écritures de la file
  loguent **et relancent**, pour que l'appelant sache que l'intent n'est pas
  durable. Écriture d'abord, publication ensuite.
- **`services/print/printJobs.ts:40-57`** — journal d'impression sous
  `navigator.locks` exclusif, avec relecture de vérification après écriture et
  refus si le verrouillage inter-onglets est indisponible.
- **`features/lan/offlineReplay.ts:131-151`** — `p_tolerate_unsellable: true`
  systématique au rejeu : décision ADR-022 décision 3. Une vente faite sous
  l'ancien catalogue ne peut pas devenir rétroactivement irrecevable.
- **`close_shift_v13` est idempotent par ÉTAT, pas par clé**
  (`supabase/migrations/20261102000055_close_shift_v13_outstanding_reversals.sql:69`
  prend un `FOR UPDATE`, `:74-79` renvoie `idempotent_replay: TRUE` si le statut
  n'est plus `open`). `CloseShiftModal.tsx:149-171` ne passe jamais de clé
  d'idempotence et **c'est sans danger**. Ne pas « corriger » cette absence.
- **`pay_expense_v4` n'a pas de clé d'idempotence** mais fait
  `SELECT … FOR UPDATE` puis refuse si le statut n'est plus `approved`
  (`supabase/migrations/20261025133301_expense_payment_method_locked.sql:36-41`).
  Pas de double paiement possible ; le coût est qu'une réponse perdue se
  présente comme une erreur et non comme un rejeu.
- **Les 2 tables « RLS sans policy »** sont fail-closed voulu (§5.1).
- **`reports/perishable-turnover` hors menu** : décision ADR-004 documentée dans
  `layouts/nav.ts:214-226`. Ne pas « corriger » cette absence.
- **`features/inventory-production/components/ProductionRecordList.tsx`** est un
  orphelin **assumé et nommé comme tel** dans
  `RevertProductionAction.tsx:35-37`.

---

## 8. Activité de développement et zones d'instabilité

### 8.1 Rythme depuis la mise en service

| Fenêtre | Commits | `fix` | `feat` | `test` | `docs` | `chore` | `ci` |
|---|---|---|---|---|---|---|---|
| Depuis le 2026-10-29 (mise en service) | 123 | **47** | 16 | 10 | 6 | 4 | 1 |
| Deux dernières semaines | 150 | 57 | 17 | 11 | 6 | 7 | 1 |

**38 % des commits post-mise-en-service sont des correctifs**, pour 13 % de
fonctionnalités. C'est la signature normale d'une première semaine
d'exploitation, mais elle dit où l'instabilité se concentre.

### 8.2 Portées de correctif, depuis le 2026-10-29

| Portée | `fix` |
|---|---|
| `pos` | **14** |
| `reports` | 5 |
| `security` | 3 |
| `stock`, `release`, `production`, `print`, `orders`, `audit`, `antifraud` | 2 chacune |
| `workspace`, `shift`, `print-bridge`, `payments`, `operations`, `migration`, `inventory`, `dashboard`, `catalog`, `b2b`, `accounting` | 1 chacune |

### 8.3 Hotspots de fichiers (hors tests et fichiers générés), 2 semaines

| Modifications | Fichier |
|---|---|
| 7 | `apps/backoffice/src/layouts/nav.ts` |
| 6 | `apps/backoffice/src/routes/index.tsx` |
| 5 | `apps/pos/src/features/payment/hooks/useCheckout.ts` |
| 5 | `apps/backoffice/src/lib/pendingFinancialAttemptSchema.ts` |
| 4 | `supabase/functions/void-order/index.ts` |
| 4 | `apps/pos/src/features/order-history/hooks/useVoidOrder.ts` |
| 4 | `apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts` |
| 4 | `apps/backoffice/src/lib/useFinancialAttempt.ts` |
| 4 | `apps/backoffice/src/features/kitchen/api.ts` |
| 4 | `apps/backoffice/src/features/inventory-production/hooks/useRecordProduction.ts` |
| 4 | `apps/backoffice/src/features/inventory-production/hooks/useRecordBatchProduction.ts` |
| 4 | `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` |

**Lecture.** `types.generated.ts` est en tête absolue (28 modifications en 2
semaines), ce qui est normal pour un fichier régénéré à chaque changement de
schéma. Ensuite, trois zones ressortent :

1. **Le money-path POS** (`useCheckout`, `useVoidOrder`, `useReopenHeldOrder`,
   `void-order`) — c'est l'encaissement et l'annulation, remaniés en continu.
2. **La production et les recettes** (3 fichiers `inventory-production` à 4
   modifications chacun) — le chantier de précision des ingrédients, dont les
   deux derniers commits de `master` portent encore la trace
   (`5ba6ea09 fix(stock): preserve fractional ingredient consumption`).
3. **Le routage et la navigation du back-office** (`nav.ts` 7 fois,
   `routes/index.tsx` 6 fois) — signe que les droits d'accès aux rapports
   financiers ont bougé plusieurs fois (`b0b528c1 fix(reports): reserve sensitive
   financial reports for Owner`).

### 8.4 Anomalie d'exploitation à confirmer avec la boutique

Commandes et chiffre d'affaires par jour, production, du 2026-10-25 au
2026-11-08 :

| Jour | Commandes | Total IDR |
|---|---|---|
| 2026-10-25 | 121 | 13 477 000 |
| 2026-10-26 | 113 | 12 985 000 |
| 2026-10-27 | 118 | 14 086 000 |
| 2026-10-28 | 135 | 18 057 000 |
| 2026-10-29 | 105 | 12 460 000 |
| 2026-10-30 | 138 | 16 111 000 |
| 2026-10-31 | 129 | 13 874 000 |
| 2026-11-01 | 139 | 16 588 000 |
| **2026-11-02** | **3** | **570 000** |
| 2026-11-03 | 121 | 24 659 000 |
| 2026-11-04 | 96 | 10 412 000 |
| 2026-11-05 | 114 | 13 421 000 |
| 2026-11-06 | 113 | 12 365 000 |
| 2026-11-07 | 118 | 15 476 500 |
| 2026-11-08 | 114 | 14 004 000 |

Le **2026-11-02** porte 3 commandes pour 570 000 IDR, contre ~120 commandes les
jours voisins. C'est aussi le dernier jour où une commande a été annulée
(`voided`). **Je ne peux pas dire d'ici si c'est une fermeture de boutique ou une
panne de caisse** : les deux produisent le même relevé. À confirmer avec
l'exploitation ; si c'est une panne, les ventes de ce jour n'ont pas été
enregistrées.

Autres chiffres d'état, production, 2026-11-09 :

| Statut de commande | Nombre | Période |
|---|---|---|
| `paid` | 4 812 | 2026-09-01 → 2026-11-08 |
| `b2b_pending` | 119 | 2026-10-01 → 2026-11-08 |
| `pending_payment` | 88 | 2026-10-01 → 2026-11-07 |
| `voided` | 12 | 2026-10-31 → 2026-11-02 |
| `draft` | 2 | 2026-11-05 |

Les commandes antérieures au 2026-10-29 proviennent de la reprise historique
d'octobre (4 171 `historical_import_documents`), pas de la caisse en service.

---

## 9. Limites de ce relevé

À lire avant de citer ce document comme preuve.

- **Aucun build, test, lint ni typecheck n'a été exécuté** (consigne d'audit en
  lecture seule). Je **ne peux pas** affirmer que `pnpm typecheck` ou
  `pnpm lint` passent aujourd'hui. Toutes les affirmations sur la CI portent sur
  ce que les workflows **déclarent**, pas sur leur dernier résultat.
- **Aucune écriture en production.** Les versions de RPC abandonnées du §5.10
  sont une **exposition prouvée**, pas un exploit démontré : je n'ai pas appelé
  `close_shift_v12`.
- Les 4 RPC manquantes du §5.4 sont prouvées **par le catalogue système** ; je
  n'ai pas provoqué l'appel HTTP qui renverrait `PGRST202`.
- Les constats de rendu (mémoïsation, re-renders) sont des **lectures de code**,
  pas des profils navigateur.
- Le relevé de couverture « orphelin / jamais importé » est **statique**. Un
  fichier déclaré mort reste à confirmer par un `typecheck` et la suite de tests
  complète avant tout retrait.
- La programmation effective de `pgtap-nightly.yml` ne se vérifie que sur GitHub.
- Les preuves privées citées par `docs/runbooks/etat-environnements.md`
  (empreintes d'APK, captures, JSON de livraison) n'ont pas été relues : elles ne
  sont pas transportées par un clone.
- `docs/` a servi de référence d'intention ; la quarantaine documentaire n'a
  jamais été lue, conformément à `AGENTS.md`.

---

## 10. Ordre de traitement suggéré

Ce n'est pas une décision : c'est un classement par risque, à arbitrer.

1. **§5.4** — remettre la base de production et le back-office déployé d'accord
   sur les 4 RPC. C'est la seule panne **active** aujourd'hui.
2. **§5.5** — installer les tâches planifiées en production, ou décider
   explicitement de ne pas les avoir et retirer les deux vues matérialisées
   mortes. En l'état, la sauvegarde autonome et le dispatch de notifications
   n'existent pas.
3. **§5.6** — créer les partitions `pos_events` manquantes **avant** que le
   déplacement des 9 741 lignes de la partition par défaut ne devienne un
   chantier.
4. **§6.3** — ajouter `deno check` + `deno lint` sur `supabase/functions` en CI.
   Quelques lignes de workflow pour couvrir tout l'encaissement serveur.
5. **§5.10** — révoquer ou dropper les 5 versions de RPC d'argent abandonnées
   encore exécutables par `authenticated`.
6. **§7.1** — implémenter ADR-018 décision 5 : l'alerte caisse sur règlement
   quarantiné.
7. **§7.2**, **§7.4**, **§7.6** — valider la réponse de `finalize_opname_v6`,
   garder la pagination des commandes, factoriser le sanitizer `or=` dans
   `packages/utils` avec une 11ᵉ garde CI.
8. **§7.8** — les « faux vides », en commençant par la chaîne d'approbation de
   dépense et les créances B2B.

Aucun de ces points n'a été corrigé. Aucun fichier applicatif n'a été touché.
