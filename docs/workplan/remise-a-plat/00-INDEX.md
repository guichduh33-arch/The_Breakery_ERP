# Remise à plat — Index des analyses module par module

> **Date :** 2026-07-04 (révisé après relecture propriétaire) · **Code analysé :** commit `5b0fa92` (2026-07-03) · **Référence produit :** Description v1.2 (2026-07-03, 25 modules)
> **Méthode :** pour chaque module, comparaison indépendante entre le code réellement câblé (UI → hook → RPC/EF vérifiés dans `apps/`, `packages/`, `supabase/`) et les revendications de la Description v1.2. Chaque fiche suit le même gabarit : A. réel vérifié · B. demandé par la doc · C. tableau des écarts · D. plan de correction · E. dépendances.
> **Verdicts :** ✅ conforme · 🟠 partiel · 🔴 la doc surclame (fonction inexistante) · ⚠️ à confirmer en DB live. Le non-câblé (⚫) est recensé dans l'**inventaire dédié §2.3**, pas dans le tableau (le comptage par colonne était incohérent d'une fiche à l'autre).
> Ce dossier détaille et remplace le §4 du plan maître `docs/workplan/plans/2026-07-04-remise-a-plat-master-plan.md` pour tout ce qui est périmètre fonctionnel par module.

## 1. Tableau de bord des modules

| # | Module (fiche) | Statut doc | ✅ | 🟠 | 🔴 | Verdict global | Correction la plus urgente |
|---|---|---|---|---|---|---|---|
| 01 | [Connexion & droits](01-auth-permissions.md) | Opérationnel | 3 | 2 | 2 | Cœur solide, mais **chaîne d'embauche cassée** | RPC `list_login_users_v1` + remplacer les 2 UserPicker codés en dur ; aligner PIN sur 6 chiffres |
| 02 | [Caisse — panier & commandes](02-pos-cart-orders.md) | Opérationnel | 8 | 1 | 0 | Largement fidèle | Paiement direct de l'ardoise depuis `/pos/debts` |
| 02b | [Page Orders BO](02b-orders-page.md) | *(hors Description v1.2 — source : fiche référence S13)* | 7 | 8 | 5 | L'ancienne fiche surclame (re-print/refund/mark-paid/relink et son KDS inexistants ; permissions `sales.*` périmées) mais sous-vend l'edit-items complet livré depuis | Câbler `x-idempotency-key` sur le void BO (la clé est générée mais jamais envoyée — replay non sûr, parité POS S55 manquante) |
| 03 | [Encaissement & paiements](03-payments-split.md) | Op. (partiel) | 5 | 2 | 0 | Fidèle ; idempotence et split vérifiés | Gate serveur du plafond de crédit sur l'ardoise |
| 04 | [Écran cuisine (KDS)](04-kds-kitchen.md) | Opérationnel | 1 | 4 | 3 | Surclamé ; beaucoup de prêt-mais-débranché (§2.3) — le 🟠 de B1.7 renvoie à la fiche 21 qui fait foi sur le transport local | Câbler undo-bump/recall/prep-timer (D1.3) + alarme sonore + « Tout prêt » |
| 05 | [Catalogue produits](05-products-categories.md) | Op. (partiel) | 4 | 4 | 0 | Fidèle à la vente, partiel en admin | Filtre `visible_on_pos` dans `useProducts` POS (1 ligne) |
| 06 | [Stock & inventaire](06-inventory-stock.md) | Opérationnel | 8 | 1 | 0 | Fidèle ; l'infra lots/péremption découverte ne sera **pas utilisée** (décision 2026-07-04) | ✅ Décommissionnement léger péremption fait (D3.1, S61) ; reste : alertes stock bas automatiques (D2.1) |
| 07 | [Achats & fournisseurs](07-purchasing-suppliers.md) | Opérationnel | 2 | 3 | 2 | **Surclamé** : QC réception et retours inexistants | Spec « QC + retours + note de crédit » ou amender la doc |
| 08 | [Clients & fidélité](08-customers-loyalty.md) | Opérationnel | 4 | 3 | 0 | Points OK ; QR membre inexistant, remises de palier mortes | Trancher les remises de palier (décision 3) |
| 09 | [Clients pros (B2B)](09-b2b-wholesale.md) | Opérationnel | 5 | 0 | 2 | ~~ni facture PDF~~ **facture PDF livrée (S68)** ; restent surclamés : prix négociés, cycle livraison | Amender la doc ; chantiers prix négociés / cycle livraison (Vague 3) |
| 10 | [Comptabilité](10-accounting-double-entry.md) | Opérationnel | 4 | 3 | 2 | Socle conforme ; rapprochement bancaire et notes SAK EMKM inexistants | Quick win drill-down JE → opération d'origine |
| 11 | [Dépenses](11-expenses.md) | Opérationnel | 3 | 1 | 2 | **Sous-vendu** : multi-niveaux + SOD déjà livrés | Mettre la doc à jour ; bouton « Dupliquer » |
| 12 | [Caisse physique & shifts](12-cash-register-shift.md) | Opérationnel | 1 | 5 | 1 | ~~Surclamé~~ → D1 + D2 ①②③ soldés (S60/S66/S67) : clôture 3 volets + PIN gros écart + coupures opt-in | Restent D2.4 (rapport écarts par caissier) et D3 (relais/fermeture auto, dépôt bancaire, rétention 10 ans) |
| 13 | [Promotions & remises](13-promotions-discounts.md) | Opérationnel | 4 | 1 | 1 | Le plus fidèle (S57) ; ticket muet sur les promos | Lignes promo nommées sur ticket + détail BO |
| 14 | [Rapports & analyses](14-reports-analytics.md) | Opérationnel | 5 | 6 | 0 | ~30 pages réelles et gatées ; **Dashboard = stub** | Créer `get_dashboard_overview_v1` (n'existe nulle part) + câbler |
| 15 | [Production & recettes](15-production-recipes.md) | Opérationnel | 5 | 0 | 0 | Fidèle — module exemplaire | Résorber le doublon suggestions orphelin |
| 16 | [Écran côté client](16-display-customer.md) | Partiel | 2 | 2 | 0 | Fidèle ; limite architecturale (même poste) | Ticker branché sur les items réellement `ready` |
| 17 | [Commande tablette](17-tablet-ordering.md) | Opérationnel | 3 | 3 | 0 | Conforme ; notes inexistantes | Note **par commande** (D1.1, quick win) — la note par ligne est un chantier moyen (D2.1) |
| 18 | [Application mobile](18-mobile-shell.md) | À venir | 2 | 0 | 0 | Parfaitement fidèle | Trancher la dépendance PWA morte (décision 5) |
| 19 | [Réglages & configuration](19-settings-configuration.md) | Opérationnel | 3 | 7 | 2 | **Surclamé** : moyens de paiement non configurables, templates sans effet | Clé `enabled_payment_methods` + filtre POS |
| 20 | [Employés & droits (RBAC)](20-users-rbac.md) | Opérationnel | 1 | 1 | 1 | **Revendication phare fausse** : grille sans cases à cocher | Décider l'édition RBAC (décision 1) ; renommer « RBAC Editor » |
| 21 | [Réseau local](21-lan-architecture.md) | Opérationnel | 0 | 1 | 1 | **Le plus surclamé** : mesh LAN mort, file d'impression orpheline (§2.3) | Décision d'architecture (décision 2) ; heartbeats |
| 22 | [Charte graphique](22-design-system.md) | Partiel | 4 | 1 | 0 | Fidèle, voire prudente | Purge des hex codés en dur (15 fichiers) |
| 23 | [Qualité & tests](23-tests.md) | Opérationnel | 2 | 1 | 1 | Chaîne PR fidèle ; **nightly en échec permanent** | Trier les 33/131 suites pgTAP rouges (money-path concernée) |
| 24 | [Mises à jour & exploitation](24-deployment-ops.md) | Opérationnel | 1 | 0 | 2 | **Surclamé sur son cœur** : staging inexistant, pas de prod V3 (+1 ⚠️ Sentry sans DSN, hors colonnes) | `staging-deploy.yml` → `workflow_dispatch` ; spec cible de production |
| 25 | [Sécurité](25-security.md) | Opérationnel | 4 | 1 | 0 | Fidèle — socle vérifié | `auth-change-pin` : PIN en header (hard cutover) |

**Totaux indicatifs : ✅ 83 · 🟠 53 · 🔴 23** sur les 25 modules de la Description (~163 revendications décomposées) ; la fiche 02b, mesurée contre l'ancienne fiche de référence S13 et non contre la Description, s'y ajoute (✅ 7 · 🟠 8 · 🔴 5). (Par ailleurs, les verdicts ⚠️ « à confirmer en DB live » — ex. Sentry fiche 24, grants MANAGER fiche 01 — sont hors colonnes et signalés dans les fiches.) Lecture d'ensemble : **le socle transactionnel (vente, paiement, stock, compta, promos, production, sécurité) est réel et conforme** ; les surclaims se concentrent sur les couches périphériques (réseau local, ops, shifts, achats-QC, B2B-facturation, RBAC-édition) et sur des finitions UI.

## 2. Constats transverses

### 2.1 Les 6 découvertes majeures de cette passe
1. **La chaîne d'embauche est cassée de bout en bout** (module 01) : sélecteur de login codé en dur sur 2 comptes de seed dans les DEUX apps + PIN de création 4-8 vs login exigeant 6. Un employé créé au BO ne peut pas se connecter. C'est la cause racine la plus probable du ressenti « les permissions ont disparu / modules inutilisables ».
2. **Une infra lots/péremption existait déjà aux ¾ à l'insu de la doc** (module 06) : `stock_lots` avec `expires_at`, cron d'expiration, FIFO sur pertes/transferts/production, page `/inventory/expiring`. **Décision propriétaire 2026-07-04 : pas de péremption/expiration ni de FIFO stock** — le chantier P3 « prochain grand chantier » est **abandonné** ; l'infra existante sera décommissionnée légèrement (cron désactivé, page/rapport retirés, table conservée dormante).
3. **Le filet de tests nightly est troué en silence** (module 23) : e2e Playwright jamais vert (secrets/front staging inexistants), 33/131 suites pgTAP rouges au dernier nightly — dont des ancres money-path. Le secret `SUPABASE_SERVICE_ROLE_KEY` existe depuis le 2026-06-27 (dette CLAUDE.md périmée) ; le blocage est ailleurs (réseau/clé).
4. **Un gisement de fonctionnalités « prêtes mais débranchées »** : voir l'**inventaire exhaustif §2.3** — c'est le menu des sessions de câblage pur, à fort rendement.
5. **Le réseau local revendiqué n'existe pas en production** (module 21) : mesh LAN = code mort (zéro call-site), file d'impression DB orpheline ; l'impression réelle est un HTTP best-effort vers un bridge externe non versionné. Décision d'architecture requise avant tout travail.
6. **La doc sous-vend autant qu'elle survend** : dépenses multi-niveaux + SOD déjà livrées, happy hour et cumul de promos actifs, allergènes en base et affichés au POS, révocation immédiate des sessions au changement de rôle, envoi tablette→cuisine immédiat. La v1.3 devra corriger dans les deux sens — checklist complète : [`00-AMENDEMENTS-V13.md`](00-AMENDEMENTS-V13.md).

### 2.2 Modules par fidélité de la doc
- **Fidèles (doc ≈ code)** : 02, 03, 05, 06, 13, 15, 16, 17, 18, 22, 25.
- **Surclamés (🔴 structurants)** : 21 (réseau), 24 (ops), 12 (shifts), 07 (achats), 09 (B2B), 20 (RBAC), 19 (réglages), 04 (KDS).
- **Sous-vendus (bonus non documentés)** : 11 (dépenses), 06 (lots), 13 (cumul/horaires), 12 (comptage aveugle), 20 (révocation sessions), 15 (planning/revert/allergènes), 17 (envoi cuisine immédiat).

### 2.3 Inventaire exhaustif du non-câblé (⚫) — état au commit `5b0fa92`, 2026-07-04
Le « prêt mais débranché » : composants jamais importés, RPCs sans call-site, infra sans producteur/consommateur, réglages sans effet. Chaque entrée = candidat à **câbler ou purger** (critère de sortie §5). Les entrées marquées 🔒 attendent une décision (§3).

| # | Élément | Nature | Fiche | Sort proposé |
|---|---|---|---|---|
| 1 | Undo-bump 60 s KDS (`BumpButton`/`UndoBumpToast` + `kds_bump_item_v1`/`kds_undo_bump_v1`) | Composants + RPCs live | 04 | ✅ **Câblé S59** (T4) |
| 2 | Recall commande servie (`RecallButton` + `kds_recall_order_v1`) | Composant + RPC live | 04 | ✅ **Câblé S59** (T4) |
| 3 | Prep-timer serveur (`PrepTimer` + `kds_start_prep_timer_v1` + `order_items.prep_started_at`) | Composant + RPC + colonne | 04 | ✅ **Câblé S59** (T4) |
| 4 | Chips `StationFilter` hot/cold/bar (prédicat inerte, champ jamais sélectionné) | UI câblée mais no-op | 04 | Câbler ou retirer (D1.4) |
| 5 | Auth kiosque KDS (`features/kds/hooks/useKioskAuth.ts`) | Hook sans consommateur | 04 | Purger ou spécifier (appareils non-staff) |
| 6 | Auth kiosque tablette (`features/tablet/hooks/useKioskAuth.ts`) | Hook sans consommateur | 17 | Idem #5 (trancher ensemble) |
| 7 | Mesh LAN hybride complet (`useLanHub`/`useLanClient`/`MessageDedup`, S13 Phase 5.A) — bug topics suspecté `lan-hub-*` vs `lan-client-*` | Feature entière morte | 21 | ✅ **Purgé S62** (T1 — décision 2 internet-first ; heartbeats S59 conservés) |
| 8 | Heartbeats appareils (`useLanHeartbeat` + `update_lan_heartbeat_v1`) → page BO « LAN Devices » affiche tout « stale » | Hook + RPC orphelins, UI aux données mortes | 21 | ✅ **Câblé S59** (T9 — deviceCode Settings requis par terminal) |
| 9 | File d'impression DB (`print_queue` + 5 RPCs `*_print_job_v1`, migration `20260517000170`) — ni producteur ni consommateur | Infra DB orpheline | 21 | ✅ **Purgée S62** (T2, `_110` — statuée DROPPÉE : table vide, le vrai print POST directement au bridge) |
| 10 | `CustomerDisplayView` (vue riche : photos produits, badges promo/annulé) | Composant jamais importé | 16 | Câbler (enrichit B1.1 gratuitement) |
| 11 | `ProductionSuggestions.tsx` + `useProductionSuggestions` + `get_production_suggestions_v1` (doublon de la page Planning) | Composant + RPC orphelins | 15 | ✅ **Purgé S59** (T7 — RPC gardé, consommé par ProductionAlertsTab) |
| 12 | `reconcile_b2b_balance_v1` (alerte drift cache↔ledger, gate `b2b.read`) | RPC sans call-site UI | 09 | Câbler (panneau admin B2B) |
| 13 | `adjust_b2b_balance_v2` (JE + PIN) | RPC sans call-site UI | 09 | Câbler (action admin B2B) |
| 14 | `RedeemButton.tsx` (le redeem passe par `BottomActionBar`) | Composant orphelin | 08 | Purger (D_nettoyage) |
| 15 | Historique des réglages : tracé avant/après en DB (`set_setting_v1` → `audit_logs`) sans UI (tuile « Settings History (Soon) ») | Données sans écran | 19 | Câbler (D1.3) |
| 16 | Templates e-mails (`email_templates`) : éditeur + aperçu réels, aucune EF n'envoie | Feature sans consommateur | 19 | Câbler (infra notifications) ou re-statuer |
| 17 | Templates tickets (`receipt_templates`) : l'impression POS ne les lit pas | Feature sans consommateur | 19/21 | Câbler côté printService |
| 18 | `pos_presets` (prêts côté serveur, aucune UI) | Tables/RPC sans UI | 19 | Câbler ou purger |
| 19 | Permission `rbac.update` seedée, consommée nulle part | Permission orpheline | 20 | ✅ **Purgée S62** (T3, `_111` — décision 1 lecture seule) |
| 20 | `vite-plugin-pwa@^1.0.0` déclaré, jamais importé (`vite.config.ts`) | Dépendance morte | 18 | ✅ **Purgée S62** (T3 — décision 5, arbre workbox évacué du lockfile) |
| 21 | Toggle `visible_on_pos` (BO) sans effet au POS (`useProducts` filtre `is_active` seulement) | Réglage sans effet | 05 | ✅ **Câblé S59** (T3 — useProducts + variantes) |
| 22 | JE des cash in/out : `record_cash_movement_v2` sait émettre la JE, `CashInOutModal` n'expose pas `reason_code` | Capacité RPC non exposée | 12 | ✅ **Câblé S60** (T2 — select reason_code + montage du modal, qui était de surcroît orphelin) |

### 2.4 Modules par fidélité — rappel de lecture
Le tableau §1 se lit avec le §2.3 : un module « fidèle » peut cacher du non-câblé (15, 16, 17), et un module surclamé peut n'avoir besoin que de câblage (04, 21-heartbeats) plutôt que de développement neuf.

## 3. Plan de correction consolidé (transverse)

> **Règle money-path (garde-fou de séquencement)** : tant que les ancres pgTAP money-path du nightly ne sont pas re-vertes (Vague 0.2), **aucun quick win touchant `orders`/`order_items`/paiements ne part** (paiement direct ardoise 02-D1.1, note d'écart serveur 12-D1.4, lignes promo ticket 13-D1.1, bump en masse KDS 04-D1.2…) — sauf re-passe manuelle préalable des ancres concernées via MCP. Les quick wins purement UI (renommages, tuiles, filtres, heartbeats, affichages) passent toujours.
> **Mise à jour S58 (2026-07-04) : verrou LEVÉ** — toutes les ancres money-path sont re-vertes (combo_sale 12, s44_money_gates 12, canonical_line_price 13, reversal_idempotency, order_discount_gate 10, modifier_ingredient 24, sale_flag_aware 6, discount_auth_nonce 6, combo_server_pricing 5). Les 2 rouges restants (`users`, `expenses`) sont des tripwires documentés hors money-path (findings F-1/F-4, session INDEX S58).

### Vague 0 — Réparer ce qui trompe l'exploitant (P0, 1 session) — ✅ **SOLDÉE (S58, 2026-07-04)**
> Exécutée sur `swarm/session-58` — détail, commits et findings dans [`../plans/2026-07-04-session-58-INDEX.md`](../plans/2026-07-04-session-58-INDEX.md).
1. ✅ **Login employés** : RPC `list_login_users_v1` (anon-callable, migration `_099`) + les 3 UserPicker dynamiques + PIN exactement 6 chiffres partout (`_100`) (fiches 01/20).
2. ✅ **Triage des 33 suites pgTAP rouges** + réparation du job live-RPC (fiche 23) : 28/33 vertes, 3 quarantaines datées (`_quarantine/`), 2 rouges assumées tests intacts (`users` F-1 P0 `delete_user_v1`, `expenses` F-4 P1 `_emit_expense_je`/ADR-003) ; live-RPC = fallback localhost corrigé (`VITE_SUPABASE_URL`), zéro `fetch failed` au run dispatché ; drift types nul + normalisation `--schema public`.
3. ✅ **Stopper les échecs CI automatiques** : `staging-deploy.yml` et `playwright-e2e.yml` sur `workflow_dispatch` seul, commentaires de réactivation (fiche 24).
4. ✅ **Renommer les labels mensongers** : « RBAC Editor » → « Permissions (read-only) », 5 tuiles « Soon » reliées aux pages existantes (fiches 20/19).

### Vague 1 — Quick wins de câblage (2-3 sessions, zéro spec)
**Lot 1 — UI pures + 2 findings S58 : ✅ SOLDÉ (S59, 2026-07-04)** — cf. [`../plans/2026-07-04-session-59-INDEX.md`](../plans/2026-07-04-session-59-INDEX.md). Toutes les UI pures livrées : `visible_on_pos` au POS (05) · KDS undo-bump/recall/prep-timer + alarme sonore (04 D1.1/D1.3) · ticker `ready` réel (16) · note **par commande** tablette (17 D1.1) · drill-down JE → origine (10) · bouton « Dupliquer » dépense (11) · doublon suggestions production (15) · purge hex (22) · `auth-change-pin` en headers (25) · filtres + avant/après dans l'UI du journal d'audit (01) · heartbeats LAN (21 D1.1). **Findings S58 fixés** : F-1 P0 (`delete_user_v1`/`update_user_role_v1` garde `is_active`) et F-4 P1 (`_emit_expense_je` fold VAT NON-PKP) — les tripwires `users`/`expenses` sont re-verts.
**Lot 2 — sous règle money-path : ✅ SOLDÉ (S60, 2026-07-05)** — cf. [`../plans/2026-07-05-session-60-INDEX.md`](../plans/2026-07-05-session-60-INDEX.md). Les 6 items livrés : paiement direct ardoise (02 D1.1, hint B2B → BO) · `reason_code` dans `CashInOutModal` **+ montage du modal orphelin** (12 D1.1) · note d'écart enforced serveur via **`close_shift_v3`** (12 D1.4, migration `_105`, DROP v2) · lignes promo sur ticket (payload — template print-bridge externe à MAJ, action utilisateur) + détail BO (13 D1.1/D1.2) · « All ready » bump en masse via **`kds_bump_order_v1`** (04 D1.2, migration `_106`) · `x-idempotency-key` sur le void BO (02b, parité POS S55). Ancre `s44_money_gates` 12/12 re-passée en closeout — v17/v11/fire_v4 non modifiés.
**Findings S58 : ✅ TOUS SOLDÉS (S61, 2026-07-05)** — cf. [`../plans/2026-07-05-session-61-INDEX.md`](../plans/2026-07-05-session-61-INDEX.md). F-1/F-4 fixés S59 ; **F-2** fixé S61 (`_107` : gardes d'insuffisance de `_record_sale_stock_v1` en P0002 + garde vitrine inconditionnelle — l'EF classe enfin `insufficient_stock` 409 au lieu de `no_open_session`/`check_violation`) ; **F-5** fixé S61 (`_108` : allowlist stations d'`import_catalog_v1` alignée sur la CHECK live, `display` importable) ; F-3 était un attendu de test corrigé dès S58.

### Vague 2 — Chantiers moyens (1 session chacun, plan requis)
- ✅ **Dashboard BO réel — SOLDÉ (S63, 2026-07-06)** : `get_dashboard_overview_v1` créé (`_113`+`_114`, gate `reports.read`, lecture pure) + `Dashboard.tsx` câblé (KPIs réels, 5 panneaux recharts/listes, polling 60 s). pgTAP `dashboard_overview` 14/14. Cf. [`../plans/2026-07-06-session-63-INDEX.md`](../plans/2026-07-06-session-63-INDEX.md).
- ✅ **Moyens de paiement configurables — SOLDÉ (S64, 2026-07-06)** : colonne `business_config.enabled_payment_methods` (`_115`, défaut = les 6, validation whitelist `set_setting_v1` auditée) + page BO Settings « Payment Methods » + hook POS `useEnabledPaymentMethods` (fail-open, effet ≤ 60 s par polling) filtrant les 2 grilles + garde de désélection. Enforcement UI v1 (EF accepte toujours les 6 — dette D-1). **Bonus : fix I-1 S63** (`_116` — voids même-jour exclus du net, dashboard + daily_sales). Cf. [`../plans/2026-07-06-session-64-INDEX.md`](../plans/2026-07-06-session-64-INDEX.md).
- **Clôture de caisse — 3 chantiers distincts** (fiche 12, une session chacun) : ✅ **① PIN manager sur gros écart — SOLDÉ (S66, 2026-07-07)** : `close_shift_v3 → v4` (approbateur désigné `shift.variance.approve` + PIN 6 chiffres via `_verify_pin_with_lockout`, seuils dédiés `business_config.shift_variance_pin_threshold_abs/pct` 200k/2 % éditables BO, trace `variance_approved_by`), pgTAP `close_shift_pin_gate` 11/11, cf. [`../plans/2026-07-07-session-66-INDEX.md`](../plans/2026-07-07-session-66-INDEX.md) ; ✅ **②③ comptage 3 volets + comptage par coupure — SOLDÉS (S67, 2026-07-07)** : `close_shift_v4 → v5` (`_121..124` — volets cash/QRIS/carte avec carte = card+edc fusionnés, gardes note/PIN en OR sur les volets, **zéro JE non-cash** — décision propriétaire, la fiche disait « JE par méthode » ; snapshot Z section `reconciliation` + rendu PDF/BO) + grille de coupures IDR opt-in `shift_denomination_count_enabled` (open client-only + close enforced serveur), pgTAP `close_shift_three_way` 15/15, cf. [`../plans/2026-07-07-session-67-INDEX.md`](../plans/2026-07-07-session-67-INDEX.md). **La clôture de caisse D2 est complète (①②③).**
- ✅ **Plafond de crédit sur l'ardoise retail — SOLDÉ (S62, 2026-07-06)** : `customers.retail_credit_limit` (NULL = illimité) + RPC **`attach_tab_customer_v1`** (« ardoise nommée » : attache client + total provisoire sur une commande fired, gate d'encours live anti-TOCTOU, P0011 miroir B2B, money-path intouchée — v11 recalcule au paiement) + bouton « Ardoise » POS (HeldOrdersModal) + champ BO fiche client retail. Par client, sans défaut `business_config` ni override PIN (v1 minimale). Cf. [`../plans/2026-07-06-session-62-INDEX.md`](../plans/2026-07-06-session-62-INDEX.md).
- ✅ **Facture PDF B2B — SOLDÉ (S68, 2026-07-08)** : série de numérotation dédiée annuelle continue `INV/YYYY/NNNNN` attribuée à la création (`create_b2b_order_v3 → v4`, migrations `_129..134`) + backfill + RPC lecture `get_b2b_invoice_v1` (gate `b2b.read`) + template EF `b2b_invoice` (**aucune ligne PB1** — B2B NON-PKP, décision propriétaire) + bouton « Invoice PDF » dans l'onglet Invoices BO. pgTAP `b2b_invoice` blocs 1-4 (6/6·6/6·4/4·7/7) ; ancres money-path re-vertes (settlement 14/14, s44 12/12). Cf. [`../plans/2026-07-08-session-68-INDEX.md`](../plans/2026-07-08-session-68-INDEX.md). Ferme le surclaim 🔴 B1.4 de la fiche 09.
- **CRUD Customer Categories + UI prix négociés** (08/05, débloque le B2B « prix négocié » 09).
- **E2E réellement nightly** : front staging hébergé + secrets + premier run vert (23/24 — **DÉGELÉ** par décision 7 : le dev actuel est officiellement le staging).
- ✅ **Purges actées 2026-07-06 — SOLDÉES (S62, 2026-07-06)** : mesh LAN mort purgé (heartbeats S59 conservés), remises de palier retirées du domaine (`points_multiplier` intact), `vite-plugin-pwa` + arbre workbox évacués, `rbac.update` supprimée (`_111`, cascade grants) ; **`print_jobs`/`print_queue` statuée : DROPPÉE** (`_110` — table vide, unique écrivain = mesh mort, le vrai print POST directement au bridge externe). Cf. [`../plans/2026-07-06-session-62-INDEX.md`](../plans/2026-07-06-session-62-INDEX.md).
- ✅ **Décommissionnement péremption/FIFO — SOLDÉ (S61, 2026-07-05)** : cron `mark_expired_lots_hourly` désactivé (`_109`, réversible), `/inventory/expiring` + rapport perishable-turnover purgés du BO, `stock_lots` + RPCs conservés dormants — pas de DROP (06 D3.1). Cf. [`../plans/2026-07-05-session-61-INDEX.md`](../plans/2026-07-05-session-61-INDEX.md).

### Vague 3 — Chantiers lourds (spec dédiée AVANT code)
- **Snapshot COGS à la vente (coût figé)** — découplé des lots (abandonnés le 2026-07-04) : figer le WAC ligne à ligne au moment du paiement (10/14/15).
- **QC réception + retours fournisseurs + notes de crédit** (07).
- ~~**Édition RBAC**~~ — **ANNULÉ** (décision 1 actée 2026-07-06 : lecture seule assumée).
- **Print-bridge versionné** : internet-first acté (décision 2, 2026-07-06) — chantier réduit au seul **versionnage du print-bridge dans le repo** (+ MAJ template `promotions[]`, action utilisateur S60) : `print_jobs`/`print_queue` a été **statuée et droppée S62** (`_110`), le mesh purgé S62 (21/04).
- **Mise en prod V3** : décision 7 actée (2026-07-06) — **nouveau projet Supabase prod dédié** (schéma par dump du dev, seed propre, EFs/secrets redéployés), le dev actuel devient le staging officiel ; spec dédiée avant exécution (24).
- **Mode hors-ligne** (02/17) — chantier n°1 annoncé par la doc, inchangé.

### Décisions à trancher par le propriétaire (bloquantes)
**Déjà actée — 2026-07-04 : pas de gestion de péremption/expiration ni de FIFO stock.** Le suivi en quantité globale par produit est le modèle retenu. Conséquences : le chantier P3 « FIFO/lots » (ex-« prochain grand chantier » de la Description) sort du plan, le snapshot COGS est découplé (source = WAC à la vente), l'infra `stock_lots` existante est décommissionnée légèrement (Vague 2). *Le « FIFO » d'allocation des paiements B2B (fiche 09) et l'expiration des points de fidélité (fiche 08) ne sont pas concernés — sujets distincts du stock.*

**✅ TOUTES ACTÉES le 2026-07-06** (session propriétaire, décisions 1→7) — plus aucun chantier gelé par une décision :

| # | Décision | Choix acté (2026-07-06) | Conséquences |
|---|---|---|---|
| 1 | Édition RBAC depuis l'UI ? | **Rester lecture seule** (et l'assumer) | 20-D3.1 (éditeur) **ANNULÉ** ; **purger la permission orpheline `rbac.update`** (quick win, §2.3 #19) ; doc v1.3 : retirer la revendication « RBAC Editor » ; changements de rôles = migration SQL |
| 2 | Architecture réseau : internet-first ou mesh LAN ? | **Internet-first assumé + purge du mesh mort** | **Purger** `useLanHub`/`useLanClient`/`MessageDedup` (§2.3 #7, quick win) ; file d'impression : **consommer `print_jobs` via un print-bridge VERSIONNÉ dans le repo ou la dropper** (§2.3 #9, chantier Vague 3 réduit à « print-bridge versionné ») ; 16-D2.1 (miroir multi-appareils) et 04-D3.2 (mode panne) passent par internet/Realtime ; doc v1.3 : « connexion internet requise » |
| 3 | Remises de palier fidélité : appliquer ou retirer ? | **Retirer du domaine et de la doc** | **Purger le code mort** des remises 5/8/10 % (08-D2.3 devient une purge, quick win) ; les paliers ne servent qu'au multiplicateur de POINTS (vivant, serveur v17) ; besoin futur → promotion ciblée par catégorie client (mécanisme existant) |
| 4 | Ardoise : tender POS dédié + plafond ? | **Oui — plafond de crédit serveur** (Vague 2) | 03-D2.1 **DÉGELÉ** : plafond par client (défaut `business_config` + override), gate serveur à l'ouverture d'ardoise, pattern miroir du credit-limit B2B ; dépassement = refus ou PIN manager (à spécifier dans le plan de session) |
| 5 | PWA : purger `vite-plugin-pwa` ou l'activer ? | **Purger** | Retirer la dépendance morte (§2.3 #20, quick win) ; la voie mobile reste le shell Capacitor (module 18) |
| 6 | Vente à stock zéro (`allow_negative_stock`) | **ON — négatif autorisé** (exploitation) | Déjà effectif en base (`business_config.allow_negative_stock=true`, vérifié 2026-07-06) ; ne concerne QUE le stock BO (matières/finis suivis non-vitrine) — la vitrine bloque toujours à zéro (garde inconditionnelle S61) ; correction du réel à l'opname |
| 7 | Cible de production V3 | **Nouveau projet Supabase prod dédié** | Chantier « mise en prod » (Vague 3, spec dédiée) : schéma par **dump du dev** (`pg_dump --schema-only`, PAS de replay de la lignée jamais rejouée from scratch), seed minimal propre, EFs/secrets redéployés ; **le dev actuel `ikcyvlovptebroadgtvd` devient officiellement le staging** → 23-D3 (E2E nightly, Vague 2) **DÉGELÉ** ; doc v1.3 : aucune revendication « en production » tant que le projet prod n'existe pas |

### Amendements Description v1.2 → v1.3
La checklist consolidée, générée depuis les 25 sections D4 et étiquetée **DOC** / **DOC⇄CODE** / **DOC+**, vit dans [`00-AMENDEMENTS-V13.md`](00-AMENDEMENTS-V13.md) — ~70 items couvrant les 25 modules (y compris 01, 05, 07, 16, 17, 23, 24 et la nuance légale « 10 ans » du module 12).

## 4. Comment travailler avec ce dossier
- **Une session de correction = un module** (ou un lot de quick wins transverses de la Vague 1) : ouvrir la fiche, exécuter son §D, cocher, re-valider fonctionnellement avec l'utilisateur avant de fermer.
- **Respecter la règle money-path** (encadré §3) pour tout quick win touchant commandes/paiements.
- Les fiches sont datées au commit `5b0fa92` : toute fiche touchée par une session ultérieure doit être re-vérifiée avant réutilisation (ajouter une note de mise à jour en tête).
- Les ⚠️ « à confirmer en DB live » se vérifient via MCP (`execute_sql`) en début de session concernée.

## 5. Critères de sortie de la remise à plat
La remise à plat est **terminée** quand les cinq conditions sont réunies :
1. **Nightly pgTAP vert** (ou liste d'exclusions datée et motivée, revue à chaque session).
2. **Zéro tuile/label mensonger** dans les deux apps (RBAC Editor, tuiles « Soon » pointant vers de l'existant, chips no-op, page LAN Devices aux données mortes).
3. **Description v1.3 publiée** avec les ~70 amendements de `00-AMENDEMENTS-V13.md` intégrés (dans les deux sens : surclaims retirés, sous-ventes ajoutées).
4. ✅ **Les 7 décisions actées** — fait : péremption/FIFO le 2026-07-04, les 6 restantes le 2026-07-06 (tableau §3).
5. **Inventaire ⚫ (§2.3) soldé** : chaque entrée câblée ou purgée — plus aucun code mort ambigu.
