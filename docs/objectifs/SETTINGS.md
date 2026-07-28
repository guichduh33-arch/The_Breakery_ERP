# Module Settings — Objectif métier

> **Version** : 2026-07-24 (rév. 6) — **§6.C soldé côté code.** Depuis la rév. 5 :
> hub LAN **lot 5** durcissement (PR #252 : chaos tests, mesure du rattrapage,
> SPA POS servie en LAN — spec 006x §7.5 + §4.1) + nightly pgTAP réparée
> (PR #254, #267) ; vue **Settings History** admin-only (PR #268,
> `/settings/history` — filtre dédié d'`audit_logs`) ; **payment methods
> enrichis** en 3 lots (ordre d'affichage #270 ; e-wallets GoPay/OVO/DANA +
> settlement QRIS #271 — `close_shift`, `retry_sale_je` ; frais
> informatifs par méthode + colonnes e-wallets du rapport Payments #272 —
> `payment_method_fees`, `get_payments_by_method`) ; **floor plan visuel**
> (éditeur drag & drop grille 12×8 BO #273 — `set_table_position` ; rendu positionné POS + tablette #274) ;
> **business hours** + rapport Off-Hours Sales (PR #275 — `get_off_hours_sales`, page `/settings/business-hours`) ;
> **politique PIN configurable** (PR #276 — catégorie
> `security`, EF `auth-verify-pin`, page Security). Socle courant :
> `set_setting` / `get_settings_by_category`. Restent hors-code :
> validation boutique de l'encaissement cash hors-ligne (toggle défaut OFF),
> `RESEND_API_KEY` console, `HUB_TOKEN` prod, runbook hub à commiter.
> Rév. 5 (2026-07-21) : hub LAN lots 1 → 4 (PR #242, #245, #246, #248) —
> hub WS print-bridge + presence, heartbeat batch, KDS/display offline sur le
> bus, outbox durable + cash différé + replay idempotent (A4/A5), catégorie
> `network` ; validation boutique offline/fire/replay OK.
> Rév. 4 (2026-07-18) : sous-menus du hub (PR #237, ADR-006 déc. 8) ;
> « toggles workflow cuisine » (déc. 9) soldé en périmètre réduit : lock des
> items envoyés couvert par ADR-010 (PR #235), copies KOT par station par la
>
> **Révision** : 2026-07-28 · **Statut** : Livré
> **ADR applicables** : ADR-006 (socle unique `business_config`, tables dédiées pour le structuré seul, traçabilité par `audit_logs` sans table `settings_history`, propagation Realtime voulue, hub LAN, `tax_inclusive` global effectif, organisation par feature), ADR-004 (pas de FIFO ni de péremption), ADR-005 (NON-PKP, taxe F&B municipale Lombok/NTB)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche — on cite la
> famille (`close_shift`, `complete_order_with_payment`). La version vivante se
> vérifie dans `supabase/migrations/` et au call-site, jamais ici.
> PR #239 ; l'auto-send tablette est SORTI du chantier.
> Rév. 3 (2026-07-17) : §6.A soldé (lots 1 à 6b, PR #218 → #225) + Realtime
> settings (PR #230). Chaque point revérifié dans le code et sur la base V3 dev.
> Base initiale : audit code V3 du 2026-07-16 (17 routes settings auditées page par
> page, câblage RPC/tables/consommateurs vérifié).
> Remplace le brief V2 archivé (~23 pages en 6 groupes, jamais déployé).
> **Hiérarchie** : le code fait foi sur l'état actuel ; ce document décrit ce qui est
> VOULU. Contraintes actées : [ADR-004](../adr/004-pas-de-peremption-ni-fifo-stock.md)
> (pas de FIFO/péremption), [ADR-005](../adr/005-juridiction-fiscale-lombok-pbjt.md)
> (NON-PKP, taxe F&B municipale Lombok/NTB).

---

## 1. Raison d'être

Le module Settings est la **salle de contrôle** de The Breakery : il transforme une
application générique en outil calibré pour *cette* boulangerie — sa taxe (PB1/PBJT
10 %), ses méthodes de paiement, ses seuils KDS, son plan de salle, ses règles
d'approbation de dépenses.

Le module est **transverse** : les autres modules (POS, KDS, Customer Display,
Expenses, Accounting…) **lisent** ici leur configuration. Un réglage qui n'est lu
par personne est un réglage mort — c'est le critère n°1 de ce document.

---

## 2. État réel (audit code 2026-07-16)

### 2.1 Architecture livrée — saine

- Socle unique : table `business_config` partitionnée en **12 catégories**
  (`business`, `localization`, `tax`, `pos`, `pos_presets`, `inventory`, `payments`,
  `customer_display`, `printing`, `kds`, `network`, `security`), dictionnaire typé
  `packages/supabase/src/settings-keys.ts`.
- Lecture `get_settings_by_category`, écriture `set_setting` (validation par
  clé, **audit-log automatique** dans `audit_logs` : qui/quoi/quand/ancienne/nouvelle
  valeur). Versions antérieures droppées (versioning monotone) — lignée `set_setting` :
  v5→v6 allowlist e-wallets (#271), v7 `payment_method_fees` (#272), v8
  `business_hours` (#275), v9 clés `security` PIN (#276) ; côté lecture, la
  v4→v5/v6/v7 suit les mêmes lots. Historique antérieur : v4→v5 clés `network`
  (PR #248), v3→v4 clés `kot_copies_*` (PR #239), v2→v3 gate de
  bascule `tax_inclusive` (Lot 6b).
- Pages hors-socle avec leurs propres tables/RPCs : floor-plan, notifications,
  templates, security, accounting, expense-thresholds, B2B.
- **Aucun binding mort** : toute RPC/table référencée par l'UI existe en migration.

### 2.2 Ce qui fonctionne de bout en bout (écrit ET consommé)

| Route | Consommateur réel |
|---|---|
| `/settings` (hub) | Navigation en **sous-menus par feature** (PR #237, ADR-006 déc. 8), tuiles gatées par permission ; sidebar BO réorganisée en miroir |
| `/settings/general` (partiel) | `tax_rate` + `tax_inclusive` → formule PB1 (`_pb1_split`, unique porteur — Lots 6a/6b) et surfaces HT/TTC POS (panier, checkout, reçu, customer display, tablette) ; bascule `tax_inclusive` gatée (gate porté par la RPC `set_setting` courante : refus si commandes ouvertes, dialog de confirmation BO) ; `timezone` → rapports ; identité `name`/`fiscal_address`/`npwp`/`phone`/`logo_url` → tickets POS, PDF (`generate-pdf`, `generate-zreport-pdf`, `_shared/pdf-layout`) et emails (`_shared/email-html`) — Lot 2 ; seuils de variance shift → `close_shift` + POS |
| `/settings/inventory` | `allow_negative_stock` → `record_stock_movement`, `complete_order_with_payment`, RPCs production |
| `/settings/templates/receipt` | `receipt_templates` → impression POS — Lot 3 |
| `/settings/templates/email` | `email_templates` → couche HTML (`_shared/email-html`) du chemin d'envoi (`notification-dispatch`) — Lot 4 |
| `/settings/holidays` | `holidays` → bandeau dashboard (`Dashboard.tsx`) + signal du rapport de ventes (`DailySalesPage.tsx`) — Lot 5 |
| `/settings/payment-methods` | `enabled_payment_methods` (ordre d'affichage inclus, lot A #270) + e-wallets individuels GoPay/OVO/DANA avec settlement QRIS agrégé au close shift (`close_shift`, lot B #271) + `payment_method_fees` (% informatif par méthode, lot C #272) → grille POS + rapport Payments by Method (`get_payments_by_method` : colonnes e-wallets + frais) |
| `/settings/business-hours` | `business_hours` (créneau open/close par jour de semaine) → rapport **Off-Hours Sales** (`get_off_hours_sales`, signal fraude vente hors-horaire) — PR #275 |
| `/settings/customer-display` | footer/slogan → écran client |
| `/settings/kds` | seuils warning/urgent/auto-archive → KDS (couleurs, alarme, archivage) |
| `/settings/floor-plan` | CRUD tables + sections (6 RPCs), soft-delete, sections actives/inactives ; **éditeur visuel drag & drop** grille 12×8 (`set_table_position`, lot A #273) → rendu positionné consommé par le POS (sélection de table) et la tablette (`FloorCanvas`, lot B #274) |
| `/settings/printing` | auto-print / auto-drawer → POS ; **copies KOT par station** (`kot_copies_{kitchen,barista,display}`, [0,5], 0 = station paperless — le KDS écran reçoit toujours) → `useFireToStations` imprime N copies séquentielles au fire (PR #239) ; steppers miroir dans l'onglet Printing du POS |
| `/settings/pos` | presets paiement / fond de caisse / remises → POS |
| `/settings/notifications` | templates → `enqueue_notification` → outbox (toggle `is_active` effectif) |
| `/settings/permissions` | matrice read-only (édition dans `/backoffice/users/permissions`) |
| `/settings/security` | timeout de session par rôle → `update_role_session_timeout` ; **politique PIN** (`pin_max_failed`, `pin_lockout_minutes`, catégorie `security`) → lockout login lu par l'EF `auth-verify-pin` (PR #276) |
| `/settings/history` (admin-only) | Vue **Settings History** : filtre dédié d'`audit_logs` sur les changements de settings (PR #268) — aucune table nouvelle |
| `/settings/accounting` | périodes fiscales, clôture période + clôture annuelle |
| `/settings/expense-thresholds` | seuils → chaîne d'approbation `submit_expense` |
| `/b2b/settings` | `get/update_b2b_settings` + table dédiée |
| `/backoffice/lan-devices` (groupe Network de la sidebar, hors hub `/settings`) | Registre `lan_devices` + heartbeat batch via le hub (EF `lan-heartbeat-batch`, PR #245) ; panneau **Hub** (état du bus LAN) ; carte **« Mode hors-ligne »** → `offline_cash_enabled` / `offline_max_hours` (catégorie `network`) → POS : gate cash offline `useOfflineCashGate` (fenêtre A5), grille de paiement cash-only, bannières offline (PR #248) |

### 2.3 Ce qui est livré mais MORT en aval (UI réelle, effet nul)

> Les six surfaces mortes de l'audit du 2026-07-16 (templates de reçu, templates
> email, identité entreprise, holidays, déclencheurs de notifications,
> `tax_inclusive`) sont **toutes branchées** par les lots 2 à 6b — voir §2.2 et
> §6.A. Ne reste ici que `currency` et une réserve d'exploitation.

1. **`currency` — écrit-jamais-lu.** Toujours stocké et éditable dans
   `/settings/general`, consommé par personne (hors périmètre du Lot 6, délibéré :
   la facturation est en IDR uniquement, multi-devise rejeté par ADR-006 déc. 10).
2. **Déclencheurs de notifications — livré, une réserve.** Les 5 producteurs métier
   existent (Lot 4b) : triggers `trg_notify_order_complete_insert/_update`,
   `trg_notify_b2b_payment`, `trg_notify_expense_approved`, `trg_notify_po_received`,
   `trg_notify_low_stock`, tous live et activés, passant par
   `_enqueue_notification_system` (miroir sans le gate `notifications.send`, réservé
   à `service_role`). Reste à vérifier en exploitation que chaque template seedé reçoit
   bien un envoi réel — le câblage est prouvé, le bout-en-bout ne l'est pas encore.

### 2.4 Anomalies mineures constatées

> Les trois anomalies de l'audit du 2026-07-16 sont corrigées par le Lot 1 (#218),
> vérifié le 2026-07-17 : défauts printing alignés (`?? true` des deux côtés),
> gate `settings.security.manage` cohérent entre route, sidebar et hub, page
> renommée « Session Timeouts ». **Aucune anomalie ouverte à ce jour.**

---

## 3. Les invariants du module (constatés tenus, à préserver)

1. **Sauvegarde explicite** — rien ne s'applique sans clic « Save ».
2. **Trace systématique** — chaque `set_setting` écrit dans `audit_logs`
   (ancienne → nouvelle valeur, auteur, horodatage). Pas de table `settings_history`
   séparée : `audit_logs` est LE journal — la vue Settings History (PR #268) n'est
   qu'un filtre dédié dessus.
3. **Permissions réelles** : `settings.read` (lecture), `settings.update` (écriture),
   `settings.security.manage`, `notifications.send` (templates notifications),
   `expenses.thresholds.read/write`, `accounting.period.close` / `accounting.year.close`,
   `tables.update/delete` (floor-plan). Les gates UI correspondent aux RLS.
4. **Defaults sûrs** — tout consommateur POS a un fallback codé si la clé manque
   (à condition de corriger la divergence printing, cf. §2.4).
5. **Propagation temps réel LIVRÉE, refetch en filet** (ADR-006 décision 4,
   PR #230). Un changement de `business_config` ou `receipt_templates` se propage
   en push aux surfaces POS (caisse, KDS, customer display, tablette) via
   postgres_changes + invalidation TanStack (`useSettingsRealtime`, rattrapage
   des événements manqués à la reconnexion). Le refetch (staleTime) + fallbacks
   codés restent le filet de sécurité quand le canal tombe. La mesure réelle du
   < 2 s en exploitation reste à valider à la main.

---

## 4. Ce que le module ne fait pas (par design — inchangé et confirmé par le code)

- **Pas de création d'utilisateurs ni d'édition de rôles** ici — matrice read-only,
  édition dans `/backoffice/users/permissions`.
- **Pas de catalogue** — produits, catégories, types produits vivent dans `/products`.
- **Pas de programme fidélité** — page dédiée `/backoffice/loyalty`.
- **Pas de consultation d'audit** — l'Audit Log vit dans Reports (`/reports/audit`).
- **Pas de mapping comptable** — vit dans `/accounting/mappings`.
- **Pas d'URL d'imprimante centralisée** — le print-server est per-terminal
  (localStorage), choix assumé.

---

## 5. Caduc — ne pas re-proposer

| Sujet du brief V2 | Pourquoi c'est mort |
|---|---|
| Suivi en lots, FIFO, péremption (ex-§6.1) | **ADR-004** : décision propriétaire, définitive. |
| Table `settings_history` + permissions `settings.view`/`settings.network` | N'ont jamais existé en V3 ; remplacées par `audit_logs` + `settings.read`. |
| Comptes « 2143 PB1 payable + 2110 collected » | COA réel : **2110 PB1 Payable** seul. |
| « PEMDA Bali / Perda Bali » | **ADR-005** : Lombok/NTB, PBJT municipale, Bapenda kabupaten/kota. |
| Wizard d'installation | Déjà exclu « par design » par le brief V2 lui-même ; l'exclusion est maintenue. |

---

## 6. Backlog métier — les écarts voulus (à prioriser par Mamat)

### A. Finir ce qui est à moitié livré (UI existante, brancher l'aval)

| Réglage | Ce qui manque | État |
|---|---|---|
| **Templates de reçu** | — | ✅ Livré — Lot 3 (#220) |
| **Identité entreprise sur les documents** | — | ✅ Livré — Lot 2 (#219), npwp/phone/logo_url |
| **Templates email** | — | ✅ Livré — Lot 4 (#221), couche HTML `_shared/email-html` |
| **Holidays** | — | ✅ Livré — Lot 5 (#223), bandeau dashboard + signal rapport ventes |
| **Déclencheurs de notifications** | — | ✅ Livré — Lot 4b (#222), 5 déclencheurs exception-safe |
| **`tax_inclusive` global** | — | ✅ Livré — Lot 6a (#224, socle `_pb1_split`) + Lot 6b (#225 : bascule gatée `set_setting` + dialog BO, surfaces HT/TTC POS via `splitPb1`/`useTaxConfig`, flag produit déprécié UI+RPC, colonne conservée) |

> **Chantier §A soldé le 2026-07-17 (lots 1 → 6b, PR #218 → #225).** Restes actés
> du Lot 6, hors périmètre : (1) reprise des 10 JE historiques avec PB1 fantôme
> sur ventes B2B (81 600 IDR sur-déclarés — sujet comptable séparé, avenir corrigé
> par le Lot 6a) ; (2) un refund/cancel post-bascule sur une commande payée AVANT
> recalcule sous le nouveau mode — le gate ne couvre que les commandes ouvertes
> (limitation actée) ; (3) `currency` reste écrit-jamais-lu (cf. §2.3).

### B. Corriger les anomalies constatées

✅ **Soldé — Lot 1 (#218)** : défauts printing alignés, gates `/settings/security`
réalignés, page renommée « Session Timeouts ». Le volet PIN reste au backlog C.

### C. Nouveaux réglages voulus, absents du code

| Priorité | Réglage | Bénéfice attendu |
|---|---|---|
| ✅ **Livré (PR #230, 2026-07-17)** | **Propagation Realtime des settings** | Push < 2 s aux caisses/KDS/displays (publication `business_config` + `receipt_templates` ; hook `useSettingsRealtime`), refetch en fallback (cf. invariant §3.5). Mesure réelle du < 2 s à valider en exploitation. |
| ✅ **Livré — lots 1-5** (ADR-006 déc. 5, spec `006x-hub-lan.md` actée 2026-07-19 — PR #241) | **LAN Network / hub local — continuité offline** | Lot 1 (PR #242, validé boutique en LAN-http) : hub WS `/ws` dans le print-bridge, presence, ring-buffer, panneau Hub BO. Lot 2 (PR #245) : heartbeat batch via le hub (`update_lan_heartbeat`, EF `lan-heartbeat-batch`). Lot 3 (PR #246, validé boutique) : mode OFFLINE (ping cloud + hub), fire caisse `L-x` sur le bus, KDS/display fusionnent cloud + bus. Lot 4 (PR #248) : outbox durable POS/tablette, **cash différé** gaté (`offline_cash_enabled` défaut false, fenêtre A5 `offline_max_hours` défaut 4 h), replay idempotent avec clés d'origine, A4 tracé par `pay_existing_order` (`p_offline_replay` → `audit_logs`), pgTAP 14/14. Lot 5 (PR #252) : durcissement — chaos tests, mesure du rattrapage, **SPA POS servie en LAN** (règle le mixed-content §4.1) ; nightly pgTAP réparée (PR #254, #267). **Reste (exploitation)** : validation boutique de l'encaissement cash hors-ligne (toggle défaut OFF), `HUB_TOKEN` prod, runbook hub à commiter (Mamat). |
| ✅ **Livré (PR #237, 2026-07-18)** | **Hub réorganisé en sous-menus par feature** | Chaque fonctionnalité a sa catégorie et sa page, groupées en sous-menus + sidebar alignée. Navigation seulement — le stockage reste le socle des décisions 1-2. |
| ✅ **Livré (PR #275, 2026-07-24)** | **Business hours** | Créneau open/close par jour (`business_hours`, page dédiée) + rapport **Off-Hours Sales** (`get_off_hours_sales`) marquant les ventes hors-horaire (signal fraude). |
| ✅ **Livré (PR #276, 2026-07-24)** | **Politique PIN configurable** | `pin_max_failed` / `pin_lockout_minutes` (catégorie `security`, `set_setting`/`get_settings_by_category`) exposés dans la page Security et lus par l'EF `auth-verify-pin` (lockout login). |
| ✅ **Livré (PR #270/#271/#272, 2026-07-23)** | **Payment methods enrichis** | Lot A : ordre d'affichage. Lot B : e-wallets individuels GoPay/OVO/DANA, settlement type QRIS (`close_shift`, `retry_sale_je`). Lot C : frais informatifs par méthode (`payment_method_fees`) + colonnes e-wallets/frais du rapport Payments (`get_payments_by_method`). |
| ✅ **Soldé en périmètre réduit (2026-07-18)** | **Toggles workflow cuisine** | Périmètre arbitré par le propriétaire : (1) lock des items envoyés → couvert par **ADR-010** (PR #235, autorisation manager + perte obligatoire) ; (2) copies KOT papier par station → **PR #239** (`set_setting`, 0 = paperless) ; (3) auto-send KDS tablette → **sorti du chantier**, ne pas re-proposer sans nouvelle décision. |
| ✅ **Livré (PR #268, 2026-07-23)** | **Vue « Settings History »** | `/settings/history`, admin-only — filtre dédié de `audit_logs` sur les changements de settings, aucune table nouvelle. |
| ✅ **Livré (PR #273/#274, 2026-07-24)** | **Floor plan visuel** | Lot A : positions grille 12×8 + éditeur drag & drop BO (`set_table_position`). Lot B : rendu positionné POS (sélection de table) + tablette (`FloorCanvas`). |
| **Rejeté (ADR-006 déc. 10)** | **Affectation serveur → section** | Décision propriétaire — ne pas re-proposer. |
| **Rejeté (ADR-006 déc. 10)** | **Multi-devise** | Décision propriétaire — la facturation reste en IDR uniquement. |
| **Hors périmètre (ADR-006 déc. 10)** | **Happy hour** | **Déjà livré** par le module Promotions & Combos : fenêtres jours/horaires natives (`day_of_week_mask`, `start_hour`/`end_hour`, appliquées par `evaluate_promotions`). Rien à créer côté Settings. |
| **Rejeté (ADR-006 déc. 10)** | **Multi-boutique** | Décision propriétaire — le projet est propre à une localisation, ne pas re-proposer. |
| Reporté | Export/import config | Hors scope actuel. |

---

## 7. En une phrase

Le module Settings V3 est **réel et honnête dans son câblage** — chaque page vivante
est consommée, chaque changement est tracé. Les chantiers **§6.A ET §6.C sont
soldés côté code** (2026-07-24) : Realtime, sous-menus du hub, toggles cuisine
(périmètre réduit), hub LAN lots 1-5 (offline commande + cuisine + impression +
cash différé + durcissement), Settings History, payment methods enrichis
(ordre / e-wallets / frais), floor plan visuel (éditeur + rendu positionné),
business hours + Off-Hours Sales, et politique PIN configurable (lockout login).
Restent des actions d'exploitation, pas de code : validation boutique de
l'encaissement cash hors-ligne (toggle défaut OFF), `RESEND_API_KEY` et
`HUB_TOKEN` en console, runbook hub à commiter (Mamat).
