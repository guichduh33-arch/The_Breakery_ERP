# Audit 03 — Tri de la documentation

> **Relevé du 2026-11-09**, branche `master` à `e204d57a`.
> Mode **lecture seule** : aucun document modifié, supprimé ou commité.
>
> **Deux règles appliquées sans exception dans tout ce document.**
>
> 1. **Un énoncé INTENTIONNEL non implémenté est du backlog, jamais une
>    obsolescence.** « Le caissier doit pouvoir… » ne se corrige pas contre le
>    code. Seuls les énoncés **factuels** (nom de table, de route, de RPC, de
>    composant, compteur, statut « livré ») se corrigent. Toutes les erreurs
>    listées ici sont factuelles.
> 2. **Aucun ADR n'est à supprimer.** Le texte de décision d'un ADR est immuable.
>    Un ADR remplacé garde toute sa valeur : il explique pourquoi le code est ce
>    qu'il est. L'action correcte est toujours de **MARQUER**, jamais d'effacer.

---

## 0. Volumétrie

`git ls-files '*.md'` = **311 fichiers / 42 858 lignes / 2 895 131 octets**.

### En périmètre d'audit : 99 fichiers / 18 582 lignes / ≈ 1 246 ko

| Zone | Fichiers | Lignes | Octets |
|---|---|---|---|
| `docs/objectifs/` | 20 | 5 597 | **339 890** |
| `docs/adr/` | 34 | 3 788 | 229 561 |
| `docs/audits/` | 9 | 2 250 | **214 309** |
| `apps/*/DESIGN.md` + `apps/*/PRODUCT.md` | 4 | 2 192 | 123 848 |
| `docs/runbooks/` | 9 | 1 792 | 113 266 |
| `.impeccable/critique/` | 9 | 970 | **91 127** |
| `docs/product/` | 2 | 513 | 47 686 |
| Racine (`README` / `AGENTS` / `CLAUDE`) | 3 | 581 | 38 133 |
| `packages/supabase/README.md` | 1 | 289 | 9 624 |
| `.design-sync/` | 2 | 132 | 11 111 |
| `apps/print-bridge/README.md` | 1 | 103 | 6 389 |
| `tests/e2e/README.md` | 1 | 95 | 5 662 |
| `docs/README.md` + `docs/context-profiles.md` | 2 | 185 | 8 311 |
| `docs/specs/` | 1 | 37 | 4 511 |
| `.github/workflows/STAGING_SETUP.md` | 1 | 57 | 2 913 |

### Hors périmètre : les skills

`.agents/skills/**` = **123 fichiers / 1 015 679 o** (la source).
`.claude/skills/**` = **83 fichiers / 614 173 o** — **miroir généré** par
`node scripts/agents/sync.mjs --write`, contrôlé par `--check` en CI. **Ne jamais
l'éditer à la main.** L'écart 123 → 83 est normal : les skills tierces
`impeccable` et `playwright-cli` sont exclues de la génération
(`docs/runbooks/agent-tooling.md:15`).

S'ajoutent `.claude/agents/*.md` (6 fichiers / 18 938 o), source des
`.codex/agents/*.toml` (les 6 `.toml` existent). Non audités.

### Bilan du tri

| Catégorie | Fichiers |
|---|---|
| **[À JOUR]** | 13 |
| **[PARTIELLEMENT OBSOLÈTE]** | 72 |
| **[À ARCHIVER / SUPPRIMER car trompeur]** | 14 |

**Potentiel de réduction sans perte d'information vivante : ≈ 430 ko sur
1 246 ko (35 %)**, dont ≈ 305 ko par suppression ou archivage sec et ≈ 125 ko par
fusion et purge d'habillage.

---

## 1. Les 5 documents les plus dangereux

Avant les tableaux complets : voici ce qui fait **écrire du code faux** ou **agir
à tort**, par ordre de nuisance.

| # | Document | Ce qu'il fait croire | Réalité |
|---|---|---|---|
| 1 | `docs/runbooks/disaster-recovery.md` | prescrit des commandes SQL d'incident sur **5 objets inexistants** | `pos_read_only_mode`, `auth_email_password_fallback`, `tablet_orders`, `verify_journal_entry_balance`, `requeue_print_job_v1` → **0 occurrence** dans tout le code et toutes les migrations |
| 2 | `apps/print-bridge/README.md` | la table des variables d'environnement | **omet les 4 variables obligatoires** (`HUB_TLS_CERT`, `HUB_TLS_KEY`, `HUB_ALLOWED_ORIGINS`, `HUB_REGISTRY_FILE`) : `server.ts:21-22` refuse de démarrer sans elles. **Lancer le bridge d'après ce README plante.** |
| 3 | `packages/supabase/README.md` | son OpenAPI place le **PIN dans le corps JSON** (`LoginRequest.required: [user_id, pin, device_type]`) | le code met le PIN en **en-tête** (`x-login-pin`, `x-current-pin`). `AGENTS.md` : « PIN / secrets en header HTTP, **jamais** en body JSON (les bodies sont loggés) ». Un client écrit d'après ce doc viole l'invariant **et** échoue au login. |
| 4 | `README.md` | « pnpm >= 9.0 » | `package.json` fixe `pnpm@11.17.0`, et un pnpm 9 **ignore en silence** les overrides de sécurité de `pnpm-workspace.yaml`. La consigne est activement dangereuse. |
| 5 | `docs/objectifs/*` (8 fiches) | des **codes de permission qui n'existent pas** | `sales.void`, `pos.open_session`, `expenses.view`, `accounting.journal.create`, `users.roles`, `inventory.create`… → 0 occurrence. Un agent qui écrit un gate RPC ou une policy RLS d'après ces fiches produit un code qui ne correspond à **aucune ligne de la table `permissions`** (162 lignes en production). |

---

## 2. Racine et navigation

| chemin | catégorie | preuves | action |
|---|---|---|---|
| `README.md` (144 l. / 6 623 o) | **[PARTIELLEMENT OBSOLÈTE]** | l.21 « pnpm >= 9.0 » vs `package.json` `"packageManager": "pnpm@11.17.0"` — et un pnpm 9 ignore les overrides **sans rien dire**. l.4 « 2 apps spécialisées » et le tableau d'architecture l.8-16 **omettent `apps/print-bridge`**. l.114 « Loi du dépôt : `CLAUDE.md` (**source de vérité**) » → faux : `CLAUDE.md` fait 6 lignes et n'est qu'un pointeur `@AGENTS.md` ; `docs/README.md:7-8` dit correctement l'inverse. l.50-53 **publie en clair les PIN seedés `1234`/`5678`** dans un dépôt dont la production tourne depuis le 2026-10-29. Vrais : l.93 version MCP 0.37.0 (`.mcp.json:7`), l.59-62 scripts `context:snapshot:*`, l.129 numérotation NAME-block. | Corriger pnpm, ajouter `print-bridge`, inverser la phrase CLAUDE/AGENTS, **retirer les PIN**. **Garder le fichier** (18 références entrantes). |
| `AGENTS.md` (431 l. / 31 299 o) | **[PARTIELLEMENT OBSOLÈTE]** | C'est la loi et **la seule copie du texte des règles**. Écarts factuels : la liste « Filets CI » **omet 3 workflows existants** — `production-backoffice.yml` (le circuit de publication production réel), `package-shop-release.yml`, `selective-bank-rehearsal.yml`. « Jamais plus de 3 specs vivantes » : il en reste 1, et elle est morte (§5). Les renvois « règle documentaire 4/5 » cités par 6 ADR ne correspondent plus à la numérotation actuelle. Vérifiés vrais : tag `quarantine/2026-07-27`, vue `audit_log` singulier droppée, garde `line-total-formula` présente, pnpm 11, identités Supabase dev/prod/V2. **Un écart nouveau relevé par le rapport 01** : la règle « Le POS n'appelle jamais la RPC directement » est factuellement trop large — 3 RPC de money-path sont appelées en direct, avec compensation documentée dans le code. | Compléter la liste des workflows ; préciser la règle d'appel RPC. **Ne pas réduire ni fusionner ce fichier.** |
| `CLAUDE.md` (6 l.) | **[À JOUR]** | Pointeur généré, `@AGENTS.md`. Les 208 « références » entrantes sont des occurrences du nom dans les skills miroir, normales. | Aucune. **Ne jamais y écrire de règle** : elle serait invisible pour Codex. |
| `docs/README.md` (78 l.) | **[À JOUR]** | Révision du 2026-11-08, la plus récente du corpus. Les 9 liens de la table « Entrées de lecture » résolvent tous. l.7-8 énonce correctement la hiérarchie que `README.md` contredit. | Aucune. **C'est le seul index fiable ; s'en servir comme pivot du nettoyage.** |
| `docs/context-profiles.md` (107 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.99-105 présente `scripts/context-snapshot.mjs` comme « le » script, alors qu'`AGENTS.md` et `agent-tooling.md:39` imposent `scripts/agents/context.mjs` comme point d'entrée ; le doc le mentionne l.4 puis se contredit l.96. Les 4 profils et leurs commandes sont exacts. Doublon de fond avec `README.md:74-99`. | Fusionner dans `docs/runbooks/agent-tooling.md` (déjà propriétaire du sujet) ou réduire à 30 lignes. 3 références entrantes à reprendre. |

---

## 3. `docs/adr/` — 34 fichiers, **aucun à supprimer**

Classement : **17 [À JOUR]**, **17 [PARTIELLEMENT OBSOLÈTE]**, **0 à supprimer**.

### 3.1 Les 17 [À JOUR] — et le modèle qu'ils donnent

`004`, `005`, `010`, `011`, `014`, `016`, `017`, `018`, `020`, `023`, `024`,
`025`, `026`, `028`, `031`, `032`, `036`.

Preuves d'implémentation relevées : 004 → cron d'expiration désactivé
(`20260710000109`) ; 017 → `20260730000002-4` ; 018 → `20260731000002` +
`apps/pos/src/features/lan/offlineReplay.ts:32` ; 031 → `set_role_permission_v1`
(`20260825000003`) ; 032 → `create_role_v1` / `delete_role_v1`
(`20260825000007/08`) ; 036 → `20261102000061_b2b_independent_display_stock.sql`
+ 3 fichiers pgTAP.

**Les ADR 018 à 026 citent les familles de RPC, pas les versions. Ce sont les
plus robustes du corpus, et c'est exactement le modèle à reproduire.** Tous les
ADR qui ont cité un `_vN` ont pourri ; tous ceux qui ont cité une famille ont
survécu.

### 3.2 Les 17 [PARTIELLEMENT OBSOLÈTE], par gravité

| chemin | preuves | action |
|---|---|---|
| `034-autorisation-appareils-lan.md` | **STATUT FAUX.** l.3 « Statut : projet, texte à valider avant commit » alors que le texte est **commité, mergé** (`d5209c7a`, PR #545, 2026-09-27) **et implémenté** : `supabase/migrations/20260927112730_secure_lan_devices.sql` (table `lan_device_credentials`, `manage_lan_device_v1`), `supabase/functions/lan-device-access/index.ts`, `apps/print-bridge/src/config.ts:39-40` (`HUB_TLS_CERT`/`HUB_TLS_KEY`), `server.ts:54` `https.createServer`. De plus l.9 déclare remplacer le transport en clair « d'ADR-030 et ADR-033 » : le clair est en réalité décrit par **ADR-029** (l.25-30, l.52-55) et ADR-030:10-11, pas par 033. | **Arbitrage du propriétaire requis** sur le statut : un agent ne peut pas poser « Accepté » à sa place. Puis bilan factuel daté + mentions croisées dans 029, 030, 033 et 006 §5. |
| `021-fin-de-projet...` | l.32-34 « la boulangerie tourne sur un autre outil, la V3 n'a jamais servi en réel » et décision 2 (l.54-69) **auto-bornée** : « elle tombe le jour où la V3 encaisse en réel ». **La clause est atteinte** : production V3 en service depuis le 2026-10-29. l.41 « dix-sept fiches » → 20 aujourd'hui. | Marquer « décision 2 expirée par sa propre clause à la bascule ». **Lourd de conséquences : c'est l'ADR qui gèle la fonctionnalité nouvelle.** |
| `006-settings-socle...` | Décision 6 (matrice read-only, l.51-56) remplacée par ADR-031. §5 A1 (l.146-148, non-cash online-only) et A5 (l.161-164, `offline_max_hours`) remplacés de fait par ADR-015 — **aucune mention dans aucun des deux sens**. Résiduels §5 l.175-179 périmés : `HUB_TOKEN` absent du code, bridge en https. Pointeurs morts : `get_settings_by_category_v2` / `set_setting_v2` (live v10 / v13), `offline_cash_enabled` → `offline_payments_enabled`. | Marquer les 3 remplacements partiels + bilan daté. |
| `003-pkp-status-non-pkp.md` | l.4 « remplacé par ADR-005 » mais 005:11-18 reprend NON-PKP / 10 % / compte 1151 « tel quel » : **remplacement partiel présenté comme total**. Pages citées inexistantes : `VATManagementPage`, `PB1ManagementPage`, route `/accounting/pb1-management` (0 occurrence ; la page vivante est `pages/reports/Pb1ReportPage.tsx`, route `reports/pb1`). | Préciser « remplacé partiellement (localisation fiscale) ; NON-PKP toujours en vigueur ». |
| `007-domaine-produits-catalogue.md` | Décision 6 (`is_test`, l.95-104) remplacée par ADR-035 (`035:12`) — **ADR-007 ne le dit pas**. l.43 cite `complete_order_with_payment_v18`, droppée (live v32). l.87 cite « useSectionsList.ts (lignes 51-85) » : numéros de ligne pourris. | Marquer le supersede partiel. |
| `029-empaquetage-capacitor...` | l.21-24 « aucune dépendance @capacitor, aucun dossier android/ » → `apps/pos/capacitor.config.ts` et `apps/pos/android/` existent. l.25-30 et l.52-55 (cleartext autorisé étroitement) remplacés par ADR-034. | Marquer. |
| `030-hebergement-...-vercel` | l.10-11 « servis en clair sur le LAN » remplacé par ADR-034. l.23-26 « Rien n'est déployé » → BO sur Vercel + domaine `backoffice.the-breakery.com`. **La décision centrale (BO sur Vercel, POS en local) reste vraie.** | Marquer. |
| `033-pos-local-first.md` | l.26-28 « paiement dépendant de la reconnexion tant qu'un flux hors-ligne dédié n'est pas décidé » **contredit ADR-015 et ADR-018**, antérieurs **et** implémentés (`offlineOutbox.ts:61-66`). Corps retouché par la PR #541 sans date de révision. | Marquer le renvoi 015/018. |
| `012`, `013`, `015`, `008`, `009`, `027`, `019`, `022`, `035` | Défauts mineurs. Pointeurs `_vN` morts présentés comme vivants : 012 → `complete_order_with_payment_v19/v20` (live v32) ; 013 → `void_order_rpc_v6` (live v14), `refund_order_rpc_v7` (live v15) ; 015 → `close_shift_v8` (live v13) ; 008 → `record_batch_production_v1/v2` (live v14). 008:16 affirme « PRODUCTION.md (aujourd'hui archivée) » alors que `docs/objectifs/PRODUCTION.md` est vivant. 027 ne renvoie ni vers 036 ni vers 008. 019 et 022 : renumérotation des règles d'`AGENTS.md`. | Bilans factuels datés ; **ne pas toucher les décisions**. |

### 3.3 Le graphe des supersedes — les mentions croisées manquantes

C'est le vrai piège du corpus ADR : un ADR remplacé qui ne le sait pas est lu
comme vivant.

| Remplacement / précision | Déclaré côté… | **Manquant côté…** |
|---|---|---|
| 005 ← 003 (partiel en réalité) | les deux | — (à requalifier « partiel ») |
| 035 → décision 6 de 007 | 035:12 | **007** |
| 034 → transport clair de 030, 033 (**et 029, et 006 §5**) | 034:9, inexactement | **030, 033, 029, 006** |
| 015 → 006 §5 A1 + A5 | **personne** | **015 et 006** |
| 031 → décision 6 de 006 | 031 (partiellement) | **006** |
| 032 → point « non tranché » de 031 | 032:4-6 | **031** |
| 016 précise 008 D1 | 016:4 | **008** |
| 033 précise 030 | **personne** | **030 et 033** |
| 033 contredit 015/018 | **personne** | **033** |
| 036 précise 027 | 036:23-25 | **027** |
| 027 touche 008 (sections) | 027:68-69 | **008** |
| 021 décision 2 expirée par sa clause | **personne** | **021** |

### 3.4 Synthèse des supersedes

- **Remplacement total : un seul.** ADR-003 par ADR-005, et il est **mal
  qualifié** : ADR-005 reprend NON-PKP, les 10 % et le compte 1151 tel quel, il
  ne corrige que la juridiction et l'autorité fiscale.
- **Remplacements partiels : 11**, dont **10 avec au moins une mention croisée
  manquante**. Les 4 trous les plus coûteux : ADR-007 ne sait pas que sa décision
  6 est morte ; ADR-029/030/033 ne savent pas que leur transport en clair est
  remplacé ; ADR-006 ne sait pas que sa décision 6 et son §5 sont remplacés ;
  ADR-031 ne sait pas que son point non tranché l'est.
- **Un statut factuellement faux : ADR-034.**
- **Une décision expirée par sa propre clause : ADR-021 décision 2.** Personne ne
  l'a marqué, et c'est l'ADR qui gèle la fonctionnalité nouvelle : **son
  expiration non signalée est un risque de gouvernance, pas de documentation.**
- **Vocabulaire de statut non normalisé** : « ✅ Accepted », « ACTÉ »,
  « accepté », « accepté par Mamat le … », « projet ». Un seul ADR (003) porte un
  champ « remplacé par ».

**Proposition** : un champ `Statut:` à vocabulaire fermé et un champ
`Remplacé par:` systématique, posés **sans toucher au corps**.

---

## 4. `docs/objectifs/` — 20 fiches, 339 ko, le plus gros poste

### 4.1 Les 3 [À JOUR] — le modèle à reproduire

Courtes, intentionnelles, sans nom de code ni compteur vivant.

| chemin | preuves | action |
|---|---|---|
| `AUDIT_TRAIL.md` (129 l.) | `pos_events` partitionné par mois et gaté `reports.audit.read` (`20260710000155_create_pos_events.sql:1,81`) ; `audit_logs` commenté « Append-only » ; les 3 codes de lecture de l.93 existent. Seul défaut : l.74 « ~5 300 gestes au 2026-08-02 » — compteur **daté** donc toléré, mais périssable. | Retirer le compteur. |
| `INVENTORY.md` (139 l.) | `stock_lots` existe et dormant (conforme ADR-004). l.127 « 12 pages sous `inventory/` sur 18 routes au 2026-07-28 » → 13 routes `inventory/*` aujourd'hui : daté mais déjà faux. | Retirer le compteur ; citer ADR-027/036. |
| `TABLET_ORDERING.md` (279 l.) | Routes `/tablet`, `/tablet/order`, `/tablet/orders` vraies ; famille `create_tablet_order` vivante ; §14 est un état de preuve correctement daté (2026-09-19). | Dater la péremption de §14. |

### 4.2 Les 17 [PARTIELLEMENT OBSOLÈTE]

**Aucune n'est à supprimer : le métier dedans est bon, c'est l'habillage
technique qui a pourri.**

| chemin | preuves factuelles fausses (échantillon prouvé) | action |
|---|---|---|
| `ACCOUNTING.md` (360 l.) | l.3 « 8 pages sur 7 routes » vs l.30 « les 11 pages » : **contradiction interne**. l.286 statuts `open/pending_closure/closed` → la base impose `draft/open/closed/locked` ; `pending_closure` = 0 hit. l.73-77 **plan comptable faux** (1120/1300/1400/2100/5100/5200/4900) → seed réel 1112/1141-1143/1131/2141/5000/5210/4910-5910. Permissions `accounting.journal.create`, `accounting.vat.manage` = 0 hit (réelles `accounting.je.create_manual`, `accounting.bank.manage`). `calkService`, `useVatFilings`, `useARManagement` = 0 hit. | Réécrire §2/§4.1/§14, supprimer le tableau de comptes, trancher la contradiction 2110 vs 2143 avec `SETTINGS:179`. |
| `USERS_AND_PERMISSIONS.md` (337 l.) | l.38-39, l.172-177, l.324 « cycle de vie des rôles NON livré, aucun écran ne crée/clone/supprime un rôle » → **faux depuis ADR-032** : `create_role_v1`, `delete_role_v1`, `CreateRoleDialog.tsx`, `useCreateRole`/`useDeleteRole`. Rôles l.188-196 `owner/cashier/barista/kitchen/accountant/stockman` → seed réel SUPER_ADMIN/ADMIN/MANAGER/CASHIER/waiter ; `stockman` = 0 hit. `PermissionGuard`, `ModuleAccessGuard`, `usePermissions` = 0 hit. | Réécrire §5/§6/§9 d'après ADR-031/032 ; remplacer les catalogues par un renvoi aux **données** (`roles` 6 lignes, `permissions` 162, `role_permissions` 301 en production). |
| `KDS.md` (310 l.) | Stations l.32-37 `hot_kitchen`, `waiter` → CHECK réelle `{kitchen, barista, display, none}` ; sélecteur à 3 stations. **Six hooks/services inexistants** : `useKdsUrgentAlertLoop`, `kdsSoundService`, `useOrderAutoRemove`, `useKdsOrderReceiver`, `useKdsOrderQueue`, `useKdsOrderActions` ; canaux `'appgrav-lan'`, `'lan-hub'` = 0 hit (réels : `useKdsAlarm`, `useKdsRealtime`, `useKdsBumpItem`). l.49/107 colonne `item_status` → réelle `kitchen_status`. **Reliquat V2 massif.** | Réécrire §2 et §7-12 ; nuancer le statut « Livré ». |
| `CASH_REGISTER.md` (297 l.) | §7 l.169-179 statut `recounting` « prévu par le système » → `shift_status` = `open\|closed` seulement ; `'recounting'` = 0 hit. Colonnes l.115-159 `closing_cash_details`, `cash_difference`, `actual_cash`, `manager_validated` = 0 hit (réelles `closing_cash`, `closing_denominations`, `expected_cash`, `variance_total`, `variance_approved_by`). Permissions l.245-249 `pos.open_session` = 0 hit (réelles `pos.session.open`, `shift.variance.approve`). | Réécrire §6-7 d'après la famille `close_shift` live ; statut → Partiel. |
| `PROMOTIONS_AND_COMBOS.md` (319 l.) | §4 l.58-90 « 4 types dont `buy_x_get_y` » → enum réel = percentage, fixed_amount, **bogo**, free_product, **threshold**, **bundle**. l.136-137 « Aucun aller-retour serveur — tout est calculé côté client » → **faux** : `useEvaluatePromotions.ts:10,215` appelle `evaluate_promotions_v3`. `promotionEngine`, `promotionMatchers`, `promotionCalculators`, `promo_code` = 0 hit. | Réécrire §4-§6. |
| `CUSTOMER_DISPLAY.md` (298 l.) | §7 l.159-165 messages LAN `CART_UPDATE`/`CART_CLEAR`/`ORDER_READY` = 0 hit. l.246 « aucune lecture directe en base » → **faux** : `useDisplayOrders.ts:42` `.from('orders')`, `useReadyOrders.ts:61`, `useShowcaseProducts.ts:49`, `useDisplayRealtime.ts:48` `postgres_changes`. `useDisplayBroadcast` = 0 hit (réel `useCartBroadcast.ts`). | Réécrire §7 et §10. |
| `CUSTOMERS.md` (315 l.) | l.79-80 « numéro de membre unique `membership_number` » et QR `BRK-XXXXXX-YYMM` « générés à la création » → 0 hit ; `CustomerAttachModal.tsx:446` dit « *will be able to* flash their loyalty QR » = **futur**. l.136-138 types `bonus`/`expire` → enum réel `loyalty_txn_type` = earn/redeem/adjust/refund. `add_loyalty_points` = 0 hit. | Déclasser le QR et le n° de membre en **backlog** (ce sont des intentions, pas des erreurs). |
| `ORDERS.md` (340 l.) | Fiche de révision 2026-08-09 qui **ignore ADR-025** : `features/orders/statusMeta.ts:5-8` déclare les libellés « New/Preparing/Ready » morts avec la refonte, alors que les filtres l.116-124 et la bande de 5 KPI l.92-100 les décrivent. l.50/143 `payment_status` = 0 hit (réel `refund_status` none/partial/full). Permissions `sales.view/void/refund` = 0 hit. `ITEMS_PER_PAGE` = 0 hit. | Réaligner sur ADR-025 et ADR-028. |
| `B2B.md` (391 l.) | l.310 table `b2b_price_lists` = 0 hit → mécanisme réel `customer_product_prices`. Routes l.34-39 `/b2b/orders/new`, `/b2b/clients/:id`, `/settings/b2b` inexistantes. Flag `stock_deducted` = 0 hit. Machine à états l.206 ≠ enum `order_status` réel. | Déclasser §6/§7/§11 en « vision ». |
| `SETTINGS.md` (243 l.) | l.3-33 : **journal de 6 révisions avec numéros de PR (#218…#276)**, interdit par les règles d'écriture d'`AGENTS.md`. l.3 « rév. 6 (2026-07-24) » vs l.39 « Révision 2026-07-28 » vs dernier commit 2026-08-25. l.215 renvoie à `docs/specs/006x-hub-lan.md` : **fichier inexistant** (seul `006x-lan-device-security.md` existe). l.160-163 « cycle de vie des rôles par migration » → supersédé par ADR-032. `HUB_TOKEN` → remplacé par ADR-034. | Supprimer l.3-33 et §6.C. **Le plus gros bruit par ligne utile du dossier.** |
| `PRODUCTS.md` (166 l.) | l.110 « 36 colonnes » → 34 réelles. l.22-23/80-81/146 toggle `is_test` « livré ADMIN+ » → **ADR-035 (2026-10-29) l'a retiré** ; `useSetProductTestFlag.ts` est orphelin (rapport 02 §2.4). l.130/138 « DROP `combo_available_from/to` à faire » → fait (`20260809000003:225`). `StubPanel.tsx` absent de `git ls-files`. | Reclasser §2.1/§5 ; citer ADR-035. |
| `REPORTS.md` (322 l.) | l.3 « 31 pages / 30 routes au 2026-07-28 » → **42 routes `reports/*`** et 42 rapports. §5-§10 décrivent **au présent** ~45 rapports dont « Revenue Forecast », « ABC Product Analysis », « Customer Lifetime Value », « Ghost Stock Movements », « Expired Stock » = 0 hit. l.3 « export Z-Report à livrer 🔴 » → l'EF `generate-zreport-pdf` et `SignZReportModal.tsx` existent. | **Scinder « livré » / « cible »** ; remplacer les compteurs par un renvoi au système de fichiers. |
| `POS.md` (416 l.) | Cœur métier solide et vérifié (EF `process-payment`, `cancel_order_item_rpc`, `offline_payments_enabled`, routes `/pos/debts` et `/pos/outstanding`). Faux : hooks `useCartPromotions`, `useDisplayBroadcast`, `useAllOpenSessions`, `useKdsStatusListener` = 0 hit ; l.152 `send_items_rpc` → la fonction est `send_items_to_kitchen`. **Noms de composants dans une fiche objectifs** (interdit par `AGENTS.md`) : `PaymentSuccess`, `StockBadge`, `SplitPaymentFlow`, `VirtualKeypadProvider`. ADR-033 non cité. | Purger les identifiants de code ; citer ADR-033. |
| `EXPENSES.md` (340 l.) | `expenses.view` = 0 hit (réel `expenses.read`, 17 fichiers) ; statut `pending_approval` = 0 hit ; l.3/32 « page de catégories à livrer 🟠 » → **livrée** comme onglet (`ExpenseCategoriesTab` monté dans `ExpensesListPage.tsx`, RPC `get_expense_categories_admin_v1`) ; comptes 6130-6900 → seed réel 6111-6116. | Corriger ; acter l'onglet livré. |
| `PRODUCTION.md` (313 l.) | l.147 « raison du waste : notes libres, chantier à lancer » → l'enum `waste_reason` existe. l.238-240 comptes « 1310/1320 » → réels 1142/1143. `getUnitConversionFactor`, `cogs_production` = 0 hit. l.1-15 : **deux blocs de révision/ADR en double**. Statut ADR-008 D1-D9 non réconcilié alors que `20261108000026/27/28` sont récents. | Dédoublonner l'en-tête ; purger les noms TS. |
| `PURCHASING_AND_SUPPLIERS.md` (164 l.) | l.7 « Livré » alors que l.51 `shipping_cost`, l.64 `partially_received` et §3.5 (retours fournisseur) = 0 hit en schéma comme en RPC. Permissions `inventory.create/update` = 0 hit (réelles `purchasing.po.*`). | Marquer §3.1/§3.5 comme intentions ; statut → Partiel. |
| `PRINTING_AND_DEVICES.md` (119 l.) | l.110-112 🔴 « bouton de relance encore à livrer » → **livré** (`apps/pos/src/features/cart/PrintJobsPanel.tsx:26-42`, monté `BottomActionBar.tsx:356`, dernier commit 2026-11-06). l.81-83 « bus protégé par un secret partagé de boutique » → modèle remplacé par ADR-034 (`app.ts:95` lit `x-lan-device-code`/`x-lan-secret`). Vrai : plus de file d'impression persistante (`20260710000110_drop_print_queue.sql:15`). | Rayer le 🔴 ; renvoyer à ADR-034. |

### 4.3 Les 5 classes d'erreur qui dominent — et qui font dériver un agent

1. **Codes de permission imaginaires, dans 8 fiches** : `sales.void/refund/view`,
   `pos.open_session`, `expenses.view`, `accounting.journal.create`,
   `users.roles`, `settings.view`, `inventory.create`, `customers.view`,
   `reports.security` — **tous 0 hit**. Un agent qui écrit un gate RPC ou une
   policy RLS d'après ces fiches crée un code qui ne correspond à aucune ligne de
   la table `permissions`.
2. **Plan comptable faux, dans 4 fiches** (ACCOUNTING, EXPENSES, PRODUCTION,
   CASH_REGISTER) contre le seed
   `20260517000005_seed_full_coa_sak_emkm.sql`, **avec une contradiction
   interne** : ACCOUNTING donne 2110 Collected + 2143 Payable, `SETTINGS:179`
   donne 2110 Payable seul.
3. **Identifiants V2 présentés comme vivants** : hooks, services, canaux,
   colonnes, enums. Touche KDS, POS, ORDERS, PROMOTIONS, CUSTOMER_DISPLAY,
   CASH_REGISTER. `AGENTS.md` interdit déjà tout composant de code dans
   `docs/objectifs/` : **ces lignes sont des violations de règle doublées de faux
   faits.**
4. **Statuts « Livré / DONE » en en-tête qui contredisent le corps** :
   CASH_REGISTER, CUSTOMERS, KDS, PURCHASING, PRODUCTION. **L'en-tête est lu en
   premier.**
5. **Compteurs nus** : REPORTS 31/30, INVENTORY 12/18, PRODUCTS 36, USERS ~70,
   POS ~16, ACCOUNTING 8/7 — **tous déjà faux**.

Le gabarit « Bénéfice métier » + « En une phrase » + « Héritage V2 », répété dans
15 fiches, représente **~1 000 lignes sur 5 597 (≈ 18 %)** jamais vérifiables
mais lues comme des faits.

---

## 5. `docs/runbooks/` (9) et `docs/specs/` (1)

| chemin | catégorie | preuves | action |
|---|---|---|---|
| `pos-outstanding-shifts.md` (75 l.) | **[À JOUR]** | **Le plus fiable du dépôt.** État de validation daté du 2026-11-02, SHA `ad718421…` et `d448d8f0…`, runs CI/pgTAP/paquet nommés, installation caisse « verified », APK 1.14 → 1.15 avec SHA-256, sortie papier confirmée. Chaque affirmation porte sa limite (« la recette financière authentifiée reste à effectuer »). | Aucune. **Référence de forme pour tous les autres bilans.** |
| `etat-environnements.md` (320 l.) | **[À JOUR]** | Document pivot, 12 références entrantes, cité par `AGENTS.md:119`. Tableau de qualification l.22-27 (Observé / Rapporté / Configuré non vérifié / Inconnu) exemplaire. Complément du 29 octobre : candidat `b29c78ee…`, cible `yjhhhmjgsmyzyymvixot`, 4 SHA-256 d'artefacts, limites explicites. | Aucune. **Y rattacher les bilans dispersés ailleurs.** |
| `pos-internet-outage.md` (136 l.) | **[À JOUR]** | §« Sources du comportement » l.118-130 cite 7 fichiers : **les 7 existent**. Temporisation 15/30/60 s et exclusion de l'avoir conformes à ADR-015/018. Livraison datée 2026-10-05 avec PR et migration nommées. | Aucune. |
| `agent-tooling.md` (209 l.) | **[À JOUR]** | Table des miroirs exacte (6 `.codex/agents/*.toml` vérifiés). Les 6 commandes citées existent dans `scripts/agents/`. Mandat d'autonomie daté 2026-11-02 cohérent avec `AGENTS.md`. | Aucune. **Candidat d'accueil pour `context-profiles.md`.** |
| `delivery-standard.md` (191 l.) | **[À JOUR]** | `scripts/ci/ci-scope.mjs`, `scripts/agents/test.mjs` et `scripts/agents/inventory.mjs` existent ; §« Préparer le BO avant une migration incompatible » cohérent avec `production-backoffice.yml`. | Aucune. **À lire avec le rapport 01 §5.4** : c'est exactement la procédure que l'écart des 4 RPC a contournée. |
| `production-v3-cutover.md` (288 l.) | **[PARTIELLEMENT OBSOLÈTE]** | Bilans d'import des 6-7 octobre exacts et bien bornés. Mais §« Conditions de départ » l.127-128 « la V3 actuelle ne contient que des données de test » et §« Activation administrative » l.137 « À réaliser seulement après validation explicite » décrivent un **avant-bascule** : la bascule a eu lieu le 2026-10-29 (run `40739207119`, déploiement `dpl_HitfVyNBWA8LEvmznsbW6Nawf8Bi`). l.151-152 « accès Vercel HTTP 403 pendant l'audit du 2026-09-25 » est un constat de septembre jamais relevé depuis. §« Répétition obligatoire » reste présentée comme à faire. | Dater en tête « procédure appliquée le 2026-10-29 », ou scinder procédure / bilans. **9 références entrantes : ne pas supprimer.** |
| `tablet-capacitor-build.md` (94 l.) | **[PARTIELLEMENT OBSOLÈTE — contradiction d'ADR]** | Factuellement **exact sur le code** : `apps/pos/capacitor.config.ts:31` `androidScheme: 'http'`, `network_security_config.xml:79` `<domain>192.168.1.92</domain>` avec `cleartextTrafficPermitted="true"`. **Mais** le doc présente ces deux points comme « les deux invariants à ne pas casser » (l.73-84) alors qu'**ADR-034 impose HTTPS/WSS** et supprime le transport en clair. Le runbook enjoint donc de préserver ce qu'un ADR acté interdit. Le code lui donne raison : **écart code ↔ ADR-034 réel, non corrigé depuis `22787b40` (2026-08-22)**. | **Signalement avant correction** : c'est un écart code vs ADR, pas une erreur documentaire. À trancher — corriger le code et le runbook, ou acter l'exception. |
| `context-tools.md` (84 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.76 « Ruflo reste déclaré dans `.mcp.json`, démarrage automatique désactivé » → **faux** : `.mcp.json` ne contient **que** `headroom` (vérifié intégralement, un seul serveur). La seule trace de `ruflo` est dans un fichier de réglages **client, non versionné**. Vrai : `headroom-ai[mcp]==0.37.0` et `uvx`. Le reste (Serena, Codex, TTL, watchdog) porte sur la configuration **globale du poste**, hors dépôt et invérifiable par un agent — **84 lignes dont ~60 ne décrivent rien que le dépôt contienne**. | Corriger l.76 ; réduire aux faits vérifiables dans le dépôt, ou sortir : ce n'est pas de la doc produit. |
| `disaster-recovery.md` (395 l. / 14 733 o) | **[À ARCHIVER / SUPPRIMER car trompeur]** | **Le document le plus dangereux du dépôt** : il prescrit des **commandes SQL d'incident sur des objets inexistants**. Vérifié par grep sur `apps/*/src`, `packages/*/src`, `supabase/migrations`, `supabase/functions` : `pos_read_only_mode` = **0 fichier**, `auth_email_password_fallback` = **0**, `tablet_orders` = **0**, `verify_journal_entry_balance` = **0**, `requeue_print_job_v1` = **0**, `print-queue-poller` = **0**. Donc : l.66-69 « flip `business_config.pos_read_only_mode` via `SELECT set_setting_v1(...)` » est **inopérant** (clé inexistante, et `set_setting_v1` est supersédée par v13) ; l.144-157 « temporarily enable email/password auth, le POS `/login` affiche alors le formulaire déjà codé derrière le flag » → **aucun formulaire email/mot de passe dans `apps/pos/src`** ; l.292 « Tablet sessions resume from the `tablet_orders` table » → table inexistante ; l.379 checklist `verify_journal_entry_balance` → fonction inexistante. l.77-91 « Recovery (PITR) » → **le PITR est désactivé**. l.222 « Recovery (staging — DEFAULT target) » → le staging est volontairement arrêté. l.369 `complete_order_with_payment_v19` → live v32. Appendices A/B/C renvoient à Sentry POS, PagerDuty, Slack #accounting/#platform : Sentry existe aussi côté POS (`apps/pos/src/lib/sentry.ts`), mais aucune rotation PagerDuty n'est établie. l.298-300 et l.318-320 portent des références de plan « S62 / S65 », interdites par les règles d'écriture. **Seule la §Scénario 1 (l.17-38, révisée 2026-10-08) est saine**, et elle ne fait que renvoyer à `pos-internet-outage.md`. | **Démanteler** (§8, étape 2). `production-v3-cutover.md:254-255` dit déjà de lui-même : « le runbook historique de disaster recovery contient des hypothèses datées ; il n'est pas une preuve suffisante ». |
| `docs/specs/006x-lan-device-security.md` (37 l.) | **[À ARCHIVER / SUPPRIMER car trompeur]** | **Spec morte selon la règle du dépôt.** `AGENTS.md` règle 3 : « Une spec meurt à la livraison du chantier : supprimée ». Le chantier **est livré** : `20260927112730_secure_lan_devices.sql`, `supabase/functions/lan-device-access/index.ts`, `apps/print-bridge/src/config.ts` (`HUB_TLS_CERT`/`KEY`), `server.ts:54`. De plus l.3 la présente comme mettant en œuvre « le **projet** ADR-034 » : **elle propage le faux statut d'ADR-034**. **ZÉRO référence entrante** (vérifié sur tout le dépôt). | **Supprimer.** Note résiduelle éventuelle dans le bilan factuel d'ADR-034. **Le geste de nettoyage le plus propre du lot.** |

---

## 6. Apps, paquets, tests, design-sync, workflows

| chemin | catégorie | preuves | action |
|---|---|---|---|
| `apps/backoffice/DESIGN.md` (1 112 l. / 65 112 o — **le plus gros doc du dépôt**) | **[PARTIELLEMENT OBSOLÈTE]** | Le socle est **exact** : tous les hex du frontmatter = `packages/ui/src/tokens/colors.css:206-342` ; les 6 ombres = `elevation.css:59-77` ; rayons 3/4/4/6/8 ; échelle 12/14/16/19/24/30/34/56 = `typography.css`. Faux : **(a)** l.57-63/385 « Headline 23 px » → `PageHeader.tsx:12` `PAGE_TITLE_CLS = 'text-2xl …'` = **30 px** depuis la PR #520 (2026-09-10, postérieure à la dernière édition du doc) ; par ricochet l.423-436 devient faux ; **(b)** l.393-395 « KPI mono 600 / -0.02em » → `KpiTile.tsx:35` poids **500**, `-0.025em` ; **(c)** l.391/445 `KPI_LABEL` « mono capitales 12 px / 600 » → `KpiTile.tsx:34` `font-body text-sm font-medium normal-case` ; **(d)** l.922 « le seul `<Button>` sans variant vit dans une fixture de test » → faux : `BankImportDialog.tsx:105-106`, `BankReconciliationPage.tsx:34`, `BankWorkspace.tsx:37` ; **(e)** l.928 « il reste quelques dizaines de `font-serif`/`font-display` » → **0 usage** hors commentaires, baseline vide : **cible atteinte** ; **(f)** l.747 « les six autres variants » → 5 ; **(g)** l.1040 « PR #415 ouverte » → chantier livré, garde 5 en CI ; **(h)** archétype Matrix l.617 « lecture seule assumée » → matrice **éditable** depuis ADR-031. | Corriger (a)-(h) ; **extraire le journal** (§7.2). |
| `apps/pos/DESIGN.md` (627 l.) | **[PARTIELLEMENT OBSOLÈTE] (très légèrement)** | Tokens **tous exacts** contre `luxe-dark.css`, `colors.css:46-110`, `elevation.css:26-36`, `motion.css` ; `border-strong #746b5f`, halo focus 40 %, `active:scale-[0.97]`, tuile 4:3 / zoom 1.06 / étiquette −8°, `--:--` : tous vérifiés. **Un seul fait faux** : l.322 « seule l'italique 400 est chargée dans le bundle POS » → `apps/pos/src/main.tsx:12-15` charge 400-italic, 400, 600 **et** 700. | Corriger l.322. **Le meilleur DESIGN des deux.** |
| `apps/backoffice/PRODUCT.md` (187 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.121-125 « **éditer les permissions d'un rôle ne se fait nulle part**, la matrice est en lecture seule » → faux : routes `settings/roles` et `settings/roles/:roleCode`, RPC `set_role_permission_v1`, `create_role_v1`, `delete_role_v1`, `set_user_permission_override_v1` ; ADR-031/032 actés le 2026-08-25. l.151-155 « le produit n'est **pas encore en boutique**, aucun environnement de production dédié » → **faux depuis le 2026-10-29**. Vrais : 7 domaines, palette de commandes, « plus de trente rapports » (40 liens), règle ESLint `breakery-local/no-raw-modal-overlay`. | Corriger les 2 énoncés d'état. |
| `apps/pos/PRODUCT.md` (266 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.166-186 « les portes de vente (ADR-022) sont tranchées mais **rien n'en est livré**, une vente payée au comptoir n'atteint jamais l'écran de cuisine » → **faux depuis le 2026-08-10** : `20260810000001..4_adr022_*.sql`, `useHoldFiredOrder.ts:20` « ADR-022 déc. 4 — c'est désormais la SEULE mise en attente », `useFireToStations.ts:277`. l.88 « `Rp 4,850,000` » → `formatIdr` est `id-ID` : `Rp 4.850.000` (`packages/utils/src/idr.ts:7-17`) — et c'est l'écriture que `apps/backoffice/PRODUCT.md:70-73` déclare inexistante à l'écran. l.228-232 même « pas encore en boutique » faux. l.188-203 « Régime ADR-021 » **dupliqué à l'identique** du BO. Routes `/pos`, `/tablet`, `/kds`, `/display`, `/pos/stock`, `/pos/debts`, `/pos/outstanding` vérifiées vraies. | Réécrire le bloc ADR-022 en « livré » ; corriger l'état de production et le format monétaire. |
| `apps/print-bridge/README.md` (103 l.) | **[À ARCHIVER / RÉÉCRIRE — trompeur sur la sécurité]** | l.31 et l.36 « **`HUB_TOKEN`**, saisi dans POS → Settings → Devices → Hub token ; sans `HUB_TOKEN`, le bus accepte les appareils du LAN » → `grep HUB_TOKEN` sur `apps/print-bridge/src`, `apps/pos/src`, `supabase/functions` = **0 résultat** ; `config.ts` ne lit pas cette variable. l.62-63 « Les endpoints HTTP ne constituent pas une API publique authentifiée » → faux depuis ADR-034 : `app.ts:93-140` exige `x-lan-device-code` + `x-lan-secret` et répond 401/403. l.64 « `http://localhost:3001/health` » → `server.ts:55-60` est `https.createServer` TLSv1.2 minimum. **La table des variables l.26-34 omet les 4 variables obligatoires** : `server.ts:21-22` lève une erreur sans elles — **lancer le bridge d'après ce README plante au démarrage**. Ne cite pas `scripts/release/install-shop.ps1`, qui existe. l.3-4 « Procédure à valider par Mamat avant commit » : mention de statut périmée. | **Réécrire en priorité** : 19 références entrantes, c'est la procédure boutique. |
| `packages/supabase/README.md` (289 l.) | **[PARTIELLEMENT OBSOLÈTE — contredit un invariant de sécurité]** | OpenAPI l.154-186 : `LoginRequest.required: [user_id, pin, device_type]` et `ChangePinRequest` avec `current_pin`/`new_pin` **dans le corps JSON** → réalité : en-têtes `x-login-pin` (`auth/pinAuth.ts:98`, `auth-verify-pin/index.ts:55`) et `x-current-pin`/`x-new-pin` (`pinAuth.ts:224-226`, `auth-change-pin/index.ts:32-33`). l.106 « the server is the source of truth … again on each `getSession` probe » → `pinAuth.ts` : « les permissions sont **figées lors de la connexion** » (confirmé par le rapport 01 §4.2). l.79-86 « All four functions » → 5. Non cités : `setSupabaseCloudEnabled`, `setSupabaseKioskAccessToken`, `startSessionActivity`, `issueKioskJwt`, `SETTING_KEYS`, et l'EF `auth-session-activity`. l.117-121 présente `enums.ts` comme « Mirror of Postgres enums » alors que `enums.ts:5-24` **omet** `pending_payment`, `completed`, `b2b_pending`, `b2b` : le README **légitime une violation** de « Enums : source unique = Postgres ». l.74 `http://localhost:54321` alors que le Docker local est retiré. | **Corriger l'OpenAPI en priorité** : c'est le doc le plus susceptible de faire écrire du code non conforme. |
| `tests/e2e/README.md` (95 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.3 « targeting the V3 **staging** environment » → `playwright-e2e.yml:3-5,23-24` : « No hosted staging URLs », apps construites et servies en localhost contre **dev V3**. l.32-34 « runs **nightly at 22:00 UTC** » → le workflow n'a que `on: workflow_dispatch` avec `allow_dev_mutations` obligatoire : **aucune exécution nocturne**. l.36-46 secrets `STAGING_POS_URL`/`STAGING_BO_URL` → le workflow attend `VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`, `V3_DEV_PG_POOLER_URL`. l.26-27 SEED_USER faux. l.50-57 liste 6 specs → **16 existent** ; le projet Playwright `waiter` n'apparaît nulle part. Testid `cart-actions-bar` → `CartActionsBar.tsx` inexistant. | Réécrire CI + table des specs. **Un agent croit à un filet nocturne qui n'existe pas.** |
| `.design-sync/conventions.md` (61 l.) | **[PARTIELLEMENT OBSOLÈTE]** | Référencé par `.design-sync/config.json:6` (`"readmeHeader"`) → **ne pas supprimer sans éditer le config**. Faux : l.26 « `font-display`/`font-serif` (Playfair Display — titres) » → sous `.theme-backoffice` ces classes ne rendent **pas** de serif, et `apps/backoffice/DESIGN.md:370-373` le dit ; l.32 « format `Rp 36,000` » → `idr.ts:17` rend `Rp 36.000`. Exact et utile : « pas d'alpha sur ces tokens, seule la famille `cat-*` accepte `/alpha` ». **Troisième recopie du vocabulaire du preset.** | Corriger polices et format ; réduire au mapping famille → classes, idéalement **généré** depuis `tailwind-preset.ts`. |
| `.design-sync/NOTES.md` (71 l.) | **[À ARCHIVER / SUPPRIMER]** | Journal d'outillage de session daté des vagues de rédaction du 2026-08-17/18, consacré aux pièges d'aperçus d'un outil externe (`[CONFIG_STALE]`, `extraEntries`, chromium-1228, CRLF). **ZÉRO référence entrante.** Aucun rapport avec l'ERP. Son contenu est vrai mais **sans objet** pour quiconque ne refait pas une vague design-sync. | **Supprimer** (ou sortir de l'arbre). Risque nul. |
| `.github/workflows/STAGING_SETUP.md` (57 l.) | **[PARTIELLEMENT OBSOLÈTE]** | Exact et utile sur l'essentiel : `staging-deploy.yml` s'arrête volontairement (l.7-9), table des secrets conforme, hébergement conforme à ADR-030. Mais §« Contrôles réellement disponibles » l.18-30 **prétend énumérer** et **omet** `production-backoffice.yml` (le circuit de publication production réel), `package-shop-release.yml` et `selective-bank-rehearsal.yml`. l.3 mention de statut périmée. | Compléter l'énumération, ou dire explicitement qu'elle est partielle. |
| `docs/product/DESCRIPTION.md` (498 l. / 46 342 o) | **[PARTIELLEMENT OBSOLÈTE]** | Bien construit : en-tête l.7-9 pose explicitement son registre (« capacités et intentions ; les ADR fixent les décisions ; le code établit les faits »), séparation « Aujourd'hui » / « À venir » par module, **aucun nom de RPC ni de table** — conforme à sa propre règle. Incohérence de version : titre « v1.3.2 » + « Révision ciblée 2026-10-08 » alors que l'historique l.13 date v1.3.2 du 2026-07-17. l.22 « deux applications » : acceptable pour un lecteur non technique (print-bridge est de l'infrastructure). l.43 « droits recalculés côté serveur à chaque action » correctement tempéré l.53. **Le reste des modules est intentionnel : ne pas le corriger contre le code.** | Aligner version et historique. **Garder** : seule vue produit non technique, 9 références entrantes. |
| `docs/product/README.md` (15 l.) | **[PARTIELLEMENT OBSOLÈTE]** | l.8 décrit encore `DESCRIPTION.md` comme « la Description **v1.3** = le contenu de `The_Breakery_ERP_Description_v1.2.docx` corrigé par une checklist » : le fichier en place est v1.3.2 et le `.docx` source est déclaré indisponible par `DESCRIPTION.md:16`. **Les 4 règles l.11-15 sont bonnes et toujours valides.** | Fusionner les 4 règles dans l'en-tête de `DESCRIPTION.md`, puis supprimer ce fichier de 15 lignes. |

### 6.1 Combien de `apps/backoffice/DESIGN.md` est encore de la référence vivante

Mesure manuelle (± 40 lignes, pas de script).

| Bloc | Lignes | Référence vivante | Journal / historique |
|---|---|---|---|
| Frontmatter → Do's/Don'ts (l.1-903) | 903 | ≈ 600 | ≈ 300 (valeurs démenties, « arbitré le 2026-08-18 », « fausse jusqu'au 2026-08-22 », comptages 1053/996, 134/148,2 px) |
| **État de propagation + Écarts ouverts + État du corpus (l.904-1112)** | **209** | **≈ 20** | **≈ 190** |
| **Total** | **1 112** | **≈ 620 (56 %)** | **≈ 490 (44 %)** |

Le bloc l.904-1112 est **17 % du fichier** et ne contient quasi rien qu'un agent
doive appliquer : c'est un journal de relevés, dont la partie « Écarts ouverts »
est elle-même périmée (points d, e, g ci-dessus).

**Proposition** : garder les ≈ 620 lignes de référence, déplacer le journal dans
un bilan daté hors DESIGN, ne conserver que les 4-5 écarts réellement ouverts
(défaut de `Button`, `EmptyState` or/italique, `Card` `shadow-sm`).

---

## 7. `docs/audits/` (9) et `.impeccable/critique/` (9)

**Constat central : sur les 8 P0 du lot du 2026-08-31, les 8 sont corrigés par
migration, et les en-têtes de ces migrations citent nommément les rapports. Aucun
rapport de la série `2026-08-31-*` ne porte de statut de résolution.**

| chemin | catégorie | preuves | action |
|---|---|---|---|
| `2026-09-19-audit-waiter-caisse.md` (115 l.) | **[À JOUR] (partiellement)** | **Le seul avec une section de suivi vivante** (« Corrections restantes » WAITER-01…05, critère de clôture explicite). WAITER-01 (double carte KDS au rejeu) probablement corrigé : `20260930000001_resolve_kds_offline_order.sql`, `20260930000002_replay_kds_offline_status.sql`, `apps/pos/src/features/kds/offlineKitchenReplay.ts` ; son point de reprise est donc périmé. WAITER-02..05 non vérifiés. | **Garder** et mettre WAITER-01 à jour. 2 références entrantes. |
| `2026-08-31-audit-lot1-synthese.md` (124 l.) | **[À ARCHIVER / SUPPRIMER car trompeur]** | Le tableau affiche encore **5 P0 « ouvert »** alors que les 8 sont fermés : #4 → `20260901000006` puis `20261030000015:225-228` ; #5 → `20260901000007:260-264` ; #6 → `20260901000010` ; #7/#8 → `20260901000005` + `20260901000013` ; #1/#2/#3 → `20260831000001/02/03`. **ZÉRO référence entrante.** | Supprimer, ou poser un bandeau « 8/8 P0 fermés au 2026-09 ». Valeur résiduelle : la section méthodologique « Ce que les skills ont eu faux ». |
| `2026-08-31-audit-security-fraud-guard.md` (143 l.) | **[PARTIELLEMENT OBSOLÈTE]** | 12 constats, sans statut. Corrigés : #1, #2, #4 (`20260906000002`), #5 (`20260906000004`), #6, #10 (`20260907000002`). **VIVANTS prouvés** : gate fail-open `IF v_uid IS NOT NULL AND NOT has_permission(...)` encore sur `recompute_recipe_cost_v3` ; `has_kiosk_jwt` corps inchangé depuis `20260517000033:28-60`, appelé avec NULL par la policy `orders.auth_read` ; `orders`/`order_items` sans REVOKE INSERT/DELETE (seul `REVOKE UPDATE ON order_items`). | **Conserver jusqu'à reprise des 3 constats vivants au backlog**, puis archiver. 2 références entrantes dont une migration. |
| `2026-08-31-audit-stock-management.md` (166 l.) | **[PARTIELLEMENT OBSOLÈTE]** | F1-F5 corrigés, 8 migrations citant le rapport en en-tête. **VIVANT, mais plus étroit que le rapport ne le dit** — voir §7.1. | **Conserver** jusqu'à reprise de F9. 9 références entrantes dont 8 migrations. |
| `2026-08-31-audit-b2b-credit.md` (160 l.) | **[PARTIELLEMENT OBSOLÈTE]** | P0/P1 soldés (#2 → `20260908000009:45`, #3 → `20260908000010`, #4 → `20260908000011:5-6`, #5 → commit `00c999da`). VIVANTS : #10 `get_b2b_dashboard_counters_v1.pending_orders` compte encore `paid_at IS NULL` ; #8 collision NAME-block `20260818000006_*` ×2 (historique immuable, confirmé par le rapport 01 §5.8). | Archiver après reprise de #10. 4 références entrantes. |
| `2026-08-31-audit-expense-governance.md` (158 l.) | **[PARTIELLEMENT OBSOLÈTE]** | P0/P1 tous soldés (`20260901000005`, `20260831000003` puis `20261025170102:243` `REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON expenses`, `20260909000001/02`). Restent 3 P3 cosmétiques. | **Archiver.** |
| `2026-08-31-audit-pos-flow.md` (466 l.) | **[PARTIELLEMENT OBSOLÈTE — piège de version]** | P0/P1/P2 prouvés corrigés. **Mais les noms de RPC qu'il cite sont tous faux aujourd'hui** : `fire_counter_order_v7` → live v12, `pay_existing_order_v18` → v25, `close_shift_v8` → v13. **Un agent qui copie une version depuis ce document se trompe de RPC.** Seul vivant : `pickup_tablet_order` et `mark_item_served` toujours sans suffixe `_vN` (confirmé en production par le rapport 01 §3.3). | **Archiver.** 10 références entrantes dont 5 migrations et 2 tests POS. |
| `2026-08-22-audit-pos-waiter.md` (761 l. / 40 517 o — **le plus gros audit**) | **[PARTIELLEMENT OBSOLÈTE]** | Seul rapport avec un en-tête de statut (l.12 « Suivi — état au 2026-08-23, après livraison ; lire le corps comme une photo »). Les 6 lots A-F sont livrés et vérifiables. Mais **son propre suivi a vieilli** : le point 7 « message en français de `usePickedUpOrderSync` » est **corrigé** (`:29,32` en anglais) et le corps cite `create_tablet_order_v7` (live v12). **761 lignes de corps périmé derrière un tableau de suivi périmé.** | **Archiver.** Si on garde, mettre le point 7 à jour. 1 référence entrante (`2026-09-19:6`). |
| `2026-08-31-audit-breakery-ui-kit.md` (157 l.) | **[PARTIELLEMENT OBSOLÈTE]** | F2 corrigé (`CloseShiftModal.tsx:386-392`, commentaire « Audit ui-kit finding F2 »). F1 vivant : `ActivityJournal.tsx:237,253` toujours deux `<select>` natifs. Les « dix gardes CI » et baselines chiffrées sont des compteurs datés. Dette de style, valeur faible. | **Archiver.** |
| `.impeccable/critique/` — **les 9** (970 l. / 91 127 o) | **[À ARCHIVER / SUPPRIMER car trompeur]** | **Sorties d'outil, pas de la documentation** : frontmatter machine (`total_score`, `p0_count`, `timestamp`, `slug`), horodatées, sans aucun statut de résolution. Les P0/P1 vérifiés sont corrigés : `2026-08-24` P0 CTA en `no_network` → `TabletOrderPage.tsx:153-159` (commentaire « Critique 2026-08-24 (P0) ») ; `2026-08-28` P1 récap combos → `OrderSummaryPanel.tsx:42-47` ; `2026-08-21` P0-2 « un bon de commande annulé accepte un paiement » → `20260821000002:79-87` ; `2026-09-04` P1 dates ISO → `StockLedgerTable.tsx:212` ; `2026-08-14` P1 copie bilingue → corrigé ; `2026-08-08` P0 « un quart de l'écran en français » → corrigé. **ZÉRO référence entrante sur les 9**, vérifié sur tout le dépôt y compris `scripts/ci/`, `scripts/agents/`, migrations et code. Les commits et commentaires qui s'y réfèrent les citent **par date**, jamais par chemin. **Réserve levée par ce rapport** : `.impeccable/config.json` ne contient que `{hook: {enabled, limits}}` — **il ne lit pas `critique/`**. | **Supprimer les 9. Aucun lien à casser, aucune réserve restante.** |

### 7.1 Les 9 constats encore VIVANTS — la seule valeur résiduelle de ces 18 fichiers

À reprendre au backlog **avant** d'archiver les rapports qui les portent.

| # | Nature | Constat | Statut vérifié ici |
|---|---|---|---|
| 1 | Sécurité | `has_kiosk_jwt(NULL)` retourne TRUE si le claim `scope` est absent — corps inchangé (`20260517000033:28-60`), appelé par la policy `orders.auth_read` | latent, dépend de ce qu'émet `kiosk-issue-jwt` — **à relire en live** |
| 2 | Sécurité | Gate fail-open `IF v_uid IS NOT NULL AND NOT has_permission(...)` sur `recompute_recipe_cost_v3` / `recompute_all` (`20260906000002:39,118`). Le jumeau `retry_sale_journal_entry` a été corrigé, celui-ci non | **vivant** |
| 3 | Sécurité | `orders` / `order_items` : privilèges INSERT/DELETE bruts à `authenticated` probablement toujours là (seul `REVOKE UPDATE ON order_items` trouvé) | **à relever en live** (`has_table_privilege`) |
| 4 | Métier | Fuseau `Asia/Jakarta` (UTC+7) au lieu de `Asia/Makassar` (UTC+8, ADR-019) dans les numéros de document. **31 fichiers de migration** le contiennent | **VÉRIFIÉ EN PRODUCTION, et plus étroit que l'audit ne le disait** — voir ci-dessous |
| 5 | Traçabilité | `update_cost_price_v1` : aucune écriture `audit_logs` trouvée | non prouvé en live |
| 6 | B2B | `get_b2b_dashboard_counters_v1.pending_orders` compte `paid_at IS NULL` au lieu du critère `is_unpaid` canonique | **vivant** |
| 7 | Écart code ↔ ADR | `network_security_config.xml:79` autorise encore le cleartext vers `192.168.1.92`, et `capacitor.config.ts:31` `androidScheme: 'http'` — alors qu'ADR-034 impose HTTPS/WSS. Inchangé depuis `22787b40` (2026-08-22) | **vivant** |
| 8 | Hygiène | `pickup_tablet_order` et `mark_item_served` sans suffixe `_vN` | **confirmé en production** (rapport 01 §3.3) |
| 9 | UX / accessibilité (P3) | `LowStockTab.tsx` sans action de ligne ; `ReorderTab.tsx:107,120` ; `AlertsPage.tsx:61` ; `ActivityJournal.tsx:237,253` `<select>` natifs ; `ApproveDialog.tsx`/`PayDialog.tsx` sans `role="alert"` ; 7 `toFixed(` hors CSV | vivant |

**Correction apportée au constat n°4 par une vérification en base.** L'audit de
stock affirmait que le fuseau `Asia/Jakarta` est « dans la RPC du dernier lot du
2026-11-08 ». C'est vrai **du fichier de migration**, mais pas du **corps live**.
Interrogation de `pg_get_functiondef` sur les 491 fonctions de la production :
**une seule** contient encore `Asia/Jakarta` —
**`receive_purchase_order_v6`**. Les numéros de document de production
(`record_production_v12`, `record_batch_production_v14`) sont propres.

Le constat reste réel mais se reformule : **les numéros de bon de réception de
marchandise sont datés en UTC+7**, pas les numéros de production. Entre 00 h et
01 h heure métier, la date du numéro de GRN est fausse d'un jour.

### 7.2 Deux constats supplémentaires relevés en passant

- **`apps/pos/vercel.json` est suivi par git** (un `rewrites` SPA), alors
  qu'`AGENTS.md` dit « Ne pas publier le POS sur Vercel ». **Vérification faite** :
  le compte Vercel ne porte **aucun projet pour le POS** — seuls
  `the-breakery-backoffice` et deux projets sans rapport avec l'ERP. Le fichier
  est donc une **configuration dormante, pas une violation en effet**. À retirer
  ou à commenter pour lever l'ambiguïté.
- **`20261102000061` fait des `CREATE OR REPLACE` sur des helpers `_v1`
  publiés**, contre la règle « jamais éditer une `_vN` publiée ». Constat
  historique, migration déjà appliquée.

---

## 8. Doublons et chevauchements — fusions précises

### 8.1 Chaîne produit : `docs/product/DESCRIPTION.md` ↔ `apps/*/PRODUCT.md` ↔ `docs/objectifs/*`

Trois couches décrivent le même produit à trois niveaux de détail, avec des
recopies littérales.

- Le paragraphe **« Régime de fin de projet (ADR-021) »** (~15 lignes) est
  **identique** dans `apps/backoffice/PRODUCT.md` et `apps/pos/PRODUCT.md`
  → remplacer par une ligne « voir ADR-021 ».
- Le paragraphe **« pas encore en boutique / aucun environnement de
  production »** (~6 lignes) est dupliqué dans les deux, **et faux dans les
  deux** → une seule phrase, dans un seul fichier, corrigée.
- Le **contexte opérationnel** (IDR, NON-PKP, PB1 10 % incluse,
  `Asia/Makassar`, interface en anglais, cohabitation BO/caisse) est répété dans
  les 2 PRODUCT, dans `docs/objectifs/POS.md:62` et dans ADR-019 → un bloc
  « Vérité produit commune » écrit **une fois**.
- `apps/pos/PRODUCT.md` « 200 commandes par jour », « 5 secondes → quart
  d'heure » et tout son « Positioning » = recopie de `docs/objectifs/POS.md:20-24`
  et des ADR-010/015.
- `DESCRIPTION.md` Module 22 « Charte graphique » recoupe les 2 DESIGN ;
  Module 21 « Réseau local » recoupe `apps/print-bridge/README.md`.
- `docs/product/README.md` (15 l.) ne contient que 4 règles → **à fusionner dans
  l'en-tête de `DESCRIPTION.md`, puis supprimer**.

**Fusion proposée.** `DESCRIPTION.md` reste la seule vue produit non technique ;
chaque `apps/*/PRODUCT.md` ne garde que *Users / Purpose / Principles /
Accessibility* (les sections que le marqueur `impeccable:product-schema` exige,
propres à la surface) ; le détail fonctionnel reste dans `docs/objectifs/`.
**Gain estimé : −120 lignes, et surtout la fin des trois versions divergentes du
même fait.**

### 8.2 Design : les deux DESIGN ↔ `.design-sync/conventions.md` ↔ `tailwind-preset.ts`

Le vocabulaire du preset est recopié **trois fois** (les deux frontmatter DESIGN
+ `conventions.md`), avec des divergences : `conventions.md` dit
« `font-display`/`font-serif` = Playfair, titres » et « `Rp 36,000` », **les deux
faux**. Les règles **partagées** (`cat-*` ≠ séries de graphique, suffixe `-fg` =
sur aplat, deux rouges, neutralisation du disabled, Chip tonal) sont écrites dans
les deux DESIGN.

**Fusion proposée** : un `packages/ui/DESIGN.md` commun pour les règles
partagées, référencé par les deux apps ; chaque `apps/*/DESIGN.md` ne garde que
ses divergences thématiques et ses valeurs de thème ; `conventions.md` se réduit
au mapping famille → classes, **généré** depuis `tailwind-preset.ts` — ce qui tue
la classe de bug à la racine.

### 8.3 Chevauchements internes à `docs/objectifs/`

| Sujet répété | Où | Fusion proposée |
|---|---|---|
| ADR-010 (verrou cuisine + perte obligatoire) recopié **en entier 4 fois** | POS §3.3/§6, ORDERS §3.6/§8.4/§13, KDS §11, TABLET §7.1/§10 | texte complet dans ORDERS ; une phrase + lien ailleurs |
| ADR-022 (envoi cuisine serveur, vendabilité) recopié **3 fois** | POS §3.7, ORDERS §3.7-3.8, KDS §3.6 | idem |
| Sessions de caisse (ouverture, comptage, écart, clôture) **2 fois** | POS §4 + §15, CASH_REGISTER §4-6 + §11 | CASH_REGISTER seule source ; POS renvoie |
| Reprise des commandes tablette **2 fois** | POS §13, TABLET §8 | TABLET_ORDERING |
| PB1 `total × 10/110` **4 fois** | POS, ORDERS, ACCOUNTING §10, CASH_REGISTER §14 | ACCOUNTING |
| Piste d'audit et détections de fraude **3 fois** | AUDIT_TRAIL, USERS §8, REPORTS §10.1-10.2 | AUDIT_TRAIL devient la fiche unique ; REPORTS garde la liste des rapports ; USERS §8 supprimé |
| Hub LAN / appareils **4 fois, avec 2 modèles de sécurité divergents** | SETTINGS §2.2 + §6.C, PRINTING §4, KDS §12, CUSTOMER_DISPLAY §7 | tout dans PRINTING_AND_DEVICES (à renommer `DEVICES_AND_LAN`), aligné sur ADR-034 |
| Aging des créances **4 fois** | B2B §9.2, ACCOUNTING §11, REPORTS §8.2, CUSTOMERS §10 | B2B (métier) + REPORTS (rapport) ; supprimer les 2 autres |
| Triggers comptables **4 fois** | ACCOUNTING §5.1 **et** §15 (deux tableaux du même objet), EXPENSES §7/§9, PURCHASING §4 | un seul tableau dans ACCOUNTING |
| Combos | PRODUCTS, PROMOTIONS §8-9, POS §5.2 | PROMOTIONS = mécanique, PRODUCTS = catalogue |
| Réglages de modules | SETTINGS décrit les réglages KDS, Display, Printing, Payments, Floor plan | SETTINGS = socle `business_config` seul ; chaque module garde ses réglages |

### 8.4 Gouvernance et navigation

- `README.md:74-99` ↔ `docs/context-profiles.md` ↔ `agent-tooling.md:37-60` :
  trois descriptions des profils de contexte → tout dans `agent-tooling.md`,
  `README.md` renvoie, `context-profiles.md` disparaît ou se réduit.
- `docs/README.md` ↔ `AGENTS.md` §« Hiérarchie de vérité » : le même classement,
  formulé deux fois **mais de façon cohérente**. **À garder** : l'un est la loi,
  l'autre l'index.
- `disaster-recovery.md` §Scénario 1 ↔ `pos-internet-outage.md` : le scénario 1
  **ne fait que renvoyer** à l'autre → fusionner.
- `production-v3-cutover.md` ↔ `etat-environnements.md` ↔
  `pos-outstanding-shifts.md` : trois dépôts de bilans datés de la même bascule.
  Pas un doublon (dates et périmètres distincts), mais les points d'entrée se
  citent mutuellement en boucle → `etat-environnements.md` reste **le** point
  d'entrée, comme `docs/README.md:30` l'affirme déjà.

---

## 9. Volume de contexte — ce qui coûte le plus cher à charger pour rien

Classement par **coût inutile** = octets × probabilité d'être chargé ×
probabilité d'induire en erreur.

| Rang | Cible | Octets | Pourquoi c'est du pur coût |
|---|---|---|---|
| 1 | `docs/audits/` (9 fichiers) | **214 309** | 2 250 lignes de constats dont la quasi-totalité des P0/P1 est corrigée, **sans aucun marquage sur 6 des 9 fichiers**. Pire que du volume : les noms de RPC qu'ils citent sont périmés d'une dizaine de versions. `2026-08-22-audit-pos-waiter.md` seul = 40 ko. |
| 2 | `.impeccable/critique/` (9 fichiers) | **91 127** | Sorties d'outil, zéro référence entrante, tous les P0/P1 corrigés, et la réserve sur `config.json` est levée. Charge nette : 970 lignes. |
| 3 | `docs/objectifs/` — la part pourrie | ≈ **90 000** (≈ 1 500 l. sur 5 597) | ~1 000 lignes de gabarit « Bénéfice métier / En une phrase / Héritage V2 » + ~150 lignes d'identifiants de code faux + les compteurs. **Le métier (≈ 4 100 lignes) vaut son poids ; l'habillage non.** Et ces fiches sont les plus souvent chargées de tout le dépôt. |
| 4 | `apps/backoffice/DESIGN.md` l.904-1112 + journal dispersé | ≈ **29 000** (≈ 490 l.) | 44 % du plus gros fichier du dépôt est un journal de campagne, dont la section « Écarts ouverts » est elle-même périmée. |
| 5 | `docs/runbooks/disaster-recovery.md` | **14 733** | Non seulement inutile mais **actionnable à tort** : 5 objets SQL inexistants prescrits dans des procédures d'incident. **Coût potentiel ≫ coût en tokens.** |
| 6 | `docs/runbooks/context-tools.md` | **5 246** | ~60 lignes sur 84 décrivent la configuration locale du poste, hors dépôt, invérifiable, plus une affirmation fausse sur `.mcp.json`. |
| 7 | `.design-sync/NOTES.md` | **7 123** | Journal d'outillage d'une vague d'août, sans rapport avec l'ERP, zéro référence. |
| 8 | `docs/specs/006x-lan-device-security.md` | **4 511** | Spec livrée que la règle du dépôt ordonne de supprimer, et qui propage le faux statut « projet » d'ADR-034. |
| 9 | `docs/product/README.md` | **1 344** | 15 lignes dont 8 décrivent la généalogie d'un `.docx` indisponible. |

**Ce qui n'est PAS du coût inutile, malgré sa taille** : `AGENTS.md` (31 ko —
c'est la loi, et la seule copie de son texte) ; `docs/adr/` (229 ko — décisions
immuables, dont 17 fiches exemplaires) ; `etat-environnements.md` et
`pos-outstanding-shifts.md` (38 ko — les deux seules sources de vérité
opérationnelle datées correctement) ; `DESCRIPTION.md` (46 ko — seule vue produit
non technique, registre explicite).

---

## 10. Plan de nettoyage sans risque

### 10.1 La contrainte technique à respecter absolument

`scripts/ci/relative-links.mjs` (garde CI n°2, job `governance-guards`,
`ci.yml:150`) **vérifie que tout lien relatif de tout `.md` suivi résout.
Supprimer un `.md` cité par un autre `.md` casse la CI.**

Une seule exemption : `docs/adr/**` — un ADR immuable peut pointer vers un
document sorti de l'arbre, résolu via
`git show quarantine/2026-07-27:<chemin>`.

La carte des références entrantes a donc été construite sur **tout** le dépôt
(`.md`, `.mjs`, `.yml`, `.ts`, `.tsx`, `.sql`, `.txt`, `.json`), hors
`node_modules`, `.turbo` et `.design-sync/.cache`.

### 10.2 Étape 1 — Suppressions à risque nul (zéro référence entrante vérifiée)

| Geste | Ce qu'on perd | Référence entrante |
|---|---|---|
| Supprimer `docs/specs/006x-lan-device-security.md` | Rien de vivant : chantier livré, et la règle 3 d'`AGENTS.md` **ordonne** ce geste. Le texte d'exécution reste dans Git. | **0**, vérifié sur tout le dépôt |
| Supprimer les **9** `.impeccable/critique/*.md` | L'historique des scores (31 → 31 → 34 → 32), déjà dans Git. | **0** sur les 9. Les commits et commentaires citent par **date**, jamais par chemin. **`.impeccable/config.json` ne lit pas `critique/` — réserve levée.** |
| Supprimer `.design-sync/NOTES.md` | Les pièges d'une vague design-sync d'août 2026. Reste dans Git. | **0** |
| Supprimer `docs/audits/2026-08-31-audit-lot1-synthese.md` | La section méthodologique « Ce que les skills ont eu faux » (à sauver ailleurs si on la juge utile). Les 8 P0 sont fermés. | **0** |

**Ne pas** toucher `.design-sync/conventions.md` dans cette étape :
`.design-sync/config.json:6` le désigne comme `readmeHeader`.
**Ne pas** supprimer `docs/objectifs/AUDIT_TRAIL.md` ni `EXPENSES.md` malgré
leurs 0 référence : ce sont des fiches métier vivantes, et AUDIT_TRAIL est l'une
des 3 [À JOUR].

### 10.3 Étape 2 — Démanteler `disaster-recovery.md` (le geste le plus urgent)

**Le risque n'est pas le volume.** C'est qu'un agent en incident exécute
`SELECT set_setting_v1('pos_read_only_mode', …)` sur une clé inexistante en
croyant mettre la caisse en lecture seule, ou active un « formulaire
email/mot de passe déjà codé derrière le flag » qui n'existe pas.

1. Reprendre le §Scénario 1 (l.17-38, révisé 2026-10-08) dans
   `pos-internet-outage.md`, qui est déjà sa cible de renvoi.
2. Sortir les scénarios 2-6 et les appendices A/B/C.
3. Reprendre les 2 références entrantes : `docs/README.md:32` → pointer vers
   `production-v3-cutover.md#arrêt-et-retour-arrière` ;
   `pos-internet-outage.md:132` → retirer le renvoi.

**Ce qu'on perd** : les gabarits de post-mortem (réutilisables, ≈ 15 lignes à
conserver ailleurs) et l'intention « avoir un runbook d'incident DB ». **Cette
intention est du backlog, pas une perte documentaire** : le rapport 01 §5.5
montre d'ailleurs qu'un vrai runbook d'incident devrait d'abord acter qu'il n'y a
ni PITR, ni sauvegarde autonome, ni tâche planifiée en production.

### 10.4 Étape 3 — Corrections factuelles prioritaires

Par ordre de nuisance.

1. **`packages/supabase/README.md` OpenAPI l.154-186** : PIN en **en-tête**, pas
   en corps. Un client écrit d'après ce doc viole l'invariant de sécurité
   d'`AGENTS.md` **et** échoue au login.
2. **`apps/print-bridge/README.md`** : retirer `HUB_TOKEN`, ajouter les 4
   variables TLS obligatoires, passer la sonde en `https`, remplacer le modèle
   d'accès par ADR-034, citer `install-shop.ps1`. **Lancer le bridge d'après la
   table actuelle plante au démarrage.**
3. **`README.md`** : pnpm 9 → 11 (risque silencieux sur les overrides),
   `print-bridge` dans l'architecture, inverser la phrase « CLAUDE.md = source de
   vérité », **retirer les PIN seedés**.
4. **`tests/e2e/README.md`** : pas de nocturne, cible dev V3, 4 secrets réels,
   16 specs, projet `waiter` inexistant.
5. **Les 2 `apps/*/PRODUCT.md`** : « pas encore en boutique » → production depuis
   le 2026-10-29 ; POS « ADR-022 rien n'est livré » → livré le 2026-08-10 ;
   RBAC « ne se fait nulle part » → livré (ADR-031/032).
6. **`docs/runbooks/context-tools.md:76`** : Ruflo n'est pas dans `.mcp.json`.
7. **`docs/objectifs/*`** : purger les **codes de permission inexistants**
   (8 fiches) et les **codes comptables faux** (4 fiches). Ce sont les deux
   classes qui font écrire du code faux.

### 10.5 Étape 4 — Marquage des ADR (aucune suppression, aucun corps touché)

1. **ADR-034** : demander l'arbitrage de statut au propriétaire, puis le poser et
   ajouter un bilan factuel daté.
2. Poser les **10 mentions croisées manquantes** du graphe §3.3 (champ de statut
   et bilan uniquement).
3. **ADR-021** : marquer la décision 2 comme expirée par sa propre clause.
4. **ADR-003** : requalifier « remplacé partiellement ».
5. Normaliser le champ `Statut:` et introduire `Remplacé par:`.

### 10.6 Étape 5 — Archiver les audits, après reprise de leurs constats vivants

**Ordre impératif** : d'abord porter au backlog les 9 constats vivants du §7.1,
**ensuite** archiver. Sinon on perd les seuls faits utiles.

Les rapports `2026-08-31-*` et `2026-08-22-*` sont cités en en-tête par
**~15 migrations** (`20260901000005` à `20260908000008`), **immuables**. Supprimer
ces fichiers rompt la traçabilité cause → correctif sans rien casser à
l'exécution (ce sont des commentaires SQL). Deux options :

- **Préférée** : bandeau de statut standard en tête de chaque rapport
  (« constat daté du 2026-08-31, fermé par les migrations X, Y, Z ; ne pas
  charger comme état courant »). Le coût en octets est conservé, le risque
  d'erreur supprimé.
- Alternative : sortie de l'arbre vers un tag daté, comme
  `quarantine/2026-07-27`. **Attention** : il faudrait alors passer
  `scripts/ci/quarantined-paths.mjs`, et sa baseline est un **plafond, jamais un
  plancher** — un chemin nouvellement interdit rendrait ces audits illisibles pour
  les migrations qui les citent. **Option plus coûteuse qu'elle n'y paraît.**

`2026-09-19-audit-waiter-caisse.md` **reste** : c'est le seul suivi vivant. Et il
référence `2026-08-22-audit-pos-waiter.md` (`:6`) : **si on supprime le 22 août,
ce lien casse la garde CI n°2.**

### 10.7 Étape 6 — Fusions

Dans cet ordre, parce que chacune réduit la surface de la suivante.

1. `docs/product/README.md` → en-tête de `DESCRIPTION.md`, puis supprimer
   (1 344 o ; ses 19 « références » sont des faux positifs de basename
   « README.md », **à revérifier sur le chemin exact avant le geste**).
2. `docs/context-profiles.md` → `docs/runbooks/agent-tooling.md` ; reprendre les
   3 références entrantes (`README.md:83`, `docs/README.md:36`,
   `agent-tooling.md:60`).
3. Les 2 paragraphes dupliqués des `apps/*/PRODUCT.md` → une ligne de renvoi.
4. Extraire le journal de `apps/backoffice/DESIGN.md` l.904-1112 (≈ 190 lignes).
5. Règles de design partagées → `packages/ui/DESIGN.md` ; réduire
   `.design-sync/conventions.md` au mapping généré.
6. `docs/objectifs/` : appliquer la table du §8.3.

### 10.8 Ce que je ne recommande pas

- **Ne pas supprimer un seul ADR**, quel que soit son statut.
- **Ne pas « corriger » les fiches `docs/objectifs/` pour les faire coller au
  code** : leurs énoncés intentionnels non implémentés sont du backlog. Seuls les
  identifiants, compteurs et statuts de livraison se corrigent. Les 3 fiches
  [À JOUR] (AUDIT_TRAIL, INVENTORY, TABLET_ORDERING) sont le modèle : courtes,
  intentionnelles, sans nom de code.
- **Ne pas réduire `AGENTS.md`** : c'est la loi, et la seule copie de son texte.
  `CLAUDE.md` n'est qu'un pointeur généré ; une règle écrite dans le miroir
  serait **invisible pour Codex**.
- **Ne pas toucher `etat-environnements.md` ni `pos-outstanding-shifts.md`** :
  les deux seules sources opérationnelles correctement datées et bornées, et le
  second est la référence de forme pour tout bilan futur.
- **Ne pas éditer `.claude/skills/**` à la main** : c'est un miroir généré.
- **Ne pas lancer de `git clean`**, et vérifier `git status` avant chaque geste.

---

## 11. Limites de cet audit

- **Aucun build, test, migration ni requête d'écriture n'a été exécuté.** Les
  lectures de base sont des `SELECT` sur le catalogue système.
- Les versions « live » de RPC citées dans les tableaux viennent d'un index grep
  des `CREATE`/`DROP FUNCTION` de `supabase/migrations/` : **une fonction créée
  dans un bloc `DO` ou en SQL dynamique peut manquer à cet index**. Deux
  vérifications décisives ont été refaites en base et figurent comme telles
  (§7.1 n°4, §7.2) ; le reste est à recontrôler avant action.
- Les constats des audits marqués « non vérifié » au §7 peuvent être vivants :
  **le relevé de 9 constats vivants est un minorant.**
- Les décomptes datés de `apps/backoffice/DESIGN.md` (113/180/87 fichiers,
  1053/996 occurrences, 44 fichiers `TOOLBAR_BTN_`) et son « 6 écrans construits
  sur 15 » n'ont pas été rejoués.
- **La carte des références entrantes est construite par correspondance de
  basename.** Les comptes élevés sur `README.md`, `DESIGN.md` et `PRODUCT.md`
  sont gonflés par des faux positifs. **Les zéros sont fiables**, et c'est sur
  eux que repose l'étape 1 ; avant tout geste de l'étape 6, revérifier par
  chemin exact.
- Les 206 fichiers de skills et les 6 profils d'agent n'ont pas été audités,
  conformément au périmètre.

**Aucun document n'a été créé hors `docs/audit-2026-11/`, modifié ou supprimé. Aucun
commit.**
