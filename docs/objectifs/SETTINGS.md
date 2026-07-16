# Module Settings — Objectif métier

> **Version** : 2026-07-17 — mise à jour après les lots 1 à 5 (PR #218 → #223) et
> le Lot 6a (PR #224, socle `tax_inclusive`), chaque point revérifié dans le code
> et sur la base V3 dev.
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

- Socle unique : table `business_config` partitionnée en **10 catégories**
  (`business`, `localization`, `tax`, `pos`, `pos_presets`, `inventory`, `payments`,
  `customer_display`, `printing`, `kds`), dictionnaire typé
  `packages/supabase/src/settings-keys.ts`.
- Lecture `get_settings_by_category_v2`, écriture `set_setting_v2` (validation par
  clé, **audit-log automatique** dans `audit_logs` : qui/quoi/quand/ancienne/nouvelle
  valeur).
- Pages hors-socle avec leurs propres tables/RPCs : floor-plan, notifications,
  templates, security, accounting, expense-thresholds, B2B.
- **Aucun binding mort** : toute RPC/table référencée par l'UI existe en migration.

### 2.2 Ce qui fonctionne de bout en bout (écrit ET consommé)

| Route | Consommateur réel |
|---|---|
| `/settings` (hub) | Navigation, tuiles gatées par permission |
| `/settings/general` (partiel) | `tax_rate` → money-path (`current_pb1_rate()`) ; `timezone` → rapports ; identité `name`/`fiscal_address`/`npwp`/`phone`/`logo_url` → tickets POS (`SuccessModal`), PDF (`generate-pdf`, `generate-zreport-pdf`, `_shared/pdf-layout`) et emails (`_shared/email-html`) — Lot 2 ; seuils de variance shift → `close_shift_v4/v5` + POS |
| `/settings/inventory` | `allow_negative_stock` → `record_stock_movement_v1`, `complete_order_with_payment_v18`, RPCs production |
| `/settings/templates/receipt` | `receipt_templates` → impression POS (`SuccessModal`) — Lot 3 |
| `/settings/templates/email` | `email_templates` → couche HTML (`_shared/email-html`) du chemin d'envoi (`notification-dispatch`) — Lot 4 |
| `/settings/holidays` | `holidays` → bandeau dashboard (`Dashboard.tsx`) + signal du rapport de ventes (`DailySalesPage.tsx`) — Lot 5 |
| `/settings/payment-methods` | `enabled_payment_methods` → POS |
| `/settings/customer-display` | footer/slogan → écran client |
| `/settings/kds` | seuils warning/urgent/auto-archive → KDS (couleurs, alarme, archivage) |
| `/settings/floor-plan` | CRUD tables + sections (6 RPCs), soft-delete, sections actives/inactives |
| `/settings/printing` | auto-print / auto-drawer → `SuccessModal` POS |
| `/settings/pos` | presets paiement / fond de caisse / remises → POS |
| `/settings/notifications` | templates → `enqueue_notification_v2` → outbox (toggle `is_active` effectif) |
| `/settings/permissions` | matrice read-only (édition dans `/backoffice/users/permissions`) |
| `/settings/security` | timeout de session par rôle → `update_role_session_timeout_v1` |
| `/settings/accounting` | périodes fiscales, clôture période + clôture annuelle |
| `/settings/expense-thresholds` | seuils → chaîne d'approbation `submit_expense_v2` |
| `/b2b/settings` | `get/update_b2b_settings_v1` + table dédiée |

### 2.3 Ce qui est livré mais MORT en aval (UI réelle, effet nul)

> Les quatre autres surfaces mortes de l'audit du 2026-07-16 (templates de reçu,
> templates email, holidays, déclencheurs de notifications) ont été branchées par les
> lots 3, 4, 4b et 5 — voir §2.2. **`tax_inclusive` était la dernière — son socle
> est livré par le Lot 6a (PR #224).**

1. **`tax_inclusive` (global) — socle livré, bascule restante.** L'audit du
   2026-07-16 avait constaté un réglage écrit-jamais-lu ; l'instruction du Lot 6
   (2026-07-17) a révélé pire : le flag par produit `products.tax_inclusive` était
   mort lui aussi (sélectionné, typé, éditable — jamais consommé ; 441/441 produits
   à `true`), et le mode effectif était **codé en dur, inclusif, recopié dans
   7 fonctions**. Le Lot 6a (PR #224, migrations `_171`→`_178`) a réduit la formule
   à un seul porteur : `_pb1_split_v1`, qui lit `business_config`
   (`tax_rate` + `tax_inclusive`). Appellent le helper :
   `complete_order_with_payment_v18`, `pay_existing_order_v12`,
   `cancel_order_item_rpc_v4`, `refund_order_rpc_v5`, `attach_tab_customer_v2`,
   `_recalc_order_totals` (et par ricochet `add/remove/update_order_item_v1`,
   `hold_order_v1`) ; `create_sale_journal_entry` lit `orders.tax_amount`.
   **Le réglage est désormais lu — effectif par construction.** Reste le Lot 6b :
   avertissement UI avant bascule, refus si commandes ouvertes (`set_setting_v3`),
   affichage HT/TTC, dépréciation UI+RPC du flag produit (arbitrages actés :
   aucune conversion auto des prix, colonne conservée). `currency` reste
   écrit-jamais-lu (hors périmètre du Lot 6).
   Au passage, le Lot 6a a corrigé un défaut fiscal : le trigger JE fabriquait du
   PB1 sur les ventes B2B (`tax_amount = 0`, hors champ PBJT) — 81 600 IDR
   sur-déclarés. Avenir corrigé ; la reprise des 10 JE historiques est un sujet
   comptable séparé, non traité.
2. **Déclencheurs de notifications — livré, une réserve.** Les 5 producteurs métier
   existent (Lot 4b) : triggers `trg_notify_order_complete_insert/_update`,
   `trg_notify_b2b_payment`, `trg_notify_expense_approved`, `trg_notify_po_received`,
   `trg_notify_low_stock`, tous live et activés, passant par
   `_enqueue_notification_system_v1` (miroir sans le gate `notifications.send`, réservé
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
2. **Trace systématique** — chaque `set_setting_v2` écrit dans `audit_logs`
   (ancienne → nouvelle valeur, auteur, horodatage). Pas de table `settings_history`
   séparée : `audit_logs` est LE journal.
3. **Permissions réelles** : `settings.read` (lecture), `settings.update` (écriture),
   `settings.security.manage`, `notifications.send` (templates notifications),
   `expenses.thresholds.read/write`, `accounting.period.close` / `accounting.year.close`,
   `tables.update/delete` (floor-plan). Les gates UI correspondent aux RLS.
4. **Defaults sûrs** — tout consommateur POS a un fallback codé si la clé manque
   (à condition de corriger la divergence printing, cf. §2.4).
5. **Propagation : temps réel voulu, refetch en attendant** (ADR-006 décision 4).
   Cible : un changement de réglage se propage en push < 2 s aux appareils
   connectés. État actuel : refetch TanStack Query — écart à résorber. Le refetch
   + fallbacks codés reste le filet de sécurité du canal temps réel.

---

## 4. Ce que le module ne fait pas (par design — inchangé et confirmé par le code)

- **Pas de création d'utilisateurs ni d'édition de rôles** ici — matrice read-only,
  édition dans `/backoffice/users/permissions`.
- **Pas de catalogue** — produits, catégories, types produits vivent dans `/products`.
- **Pas de programme fidélité** — page dédiée `/backoffice/loyalty`.
- **Pas de consultation d'audit** — l'Audit Log vit dans Reports (`AuditPage`).
- **Pas de mapping comptable** — vit dans `/accounting` (MappingsPage).
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
| **`tax_inclusive` global** | **Décidé (ADR-006 déc. 7)** : rendre le réglage effectif comme défaut boutique. Arbitrages du 2026-07-17 : le global devient l'unique vérité, `products.tax_inclusive` est déprécié (441/441 à `true`, jamais consommé) ; aucune conversion automatique des prix (le réglage change l'interprétation de `retail_price`) ; bascule refusée s'il reste des commandes ouvertes ; B2B et imports historiques restent hors champ PB1 (délibéré). **Lot 6a livré (PR #224)** : `_pb1_split_v1` unique porteur de la formule, réglage lu par construction, comportement constant prouvé (pgTAP + s44 12/12). **Reste Lot 6b** : bascule effective (`set_setting_v3` + avertissement UI), affichage HT/TTC, dépréciation UI+RPC du flag produit. | 🔶 6a livré (PR #224) — 6b restant |

### B. Corriger les anomalies constatées

✅ **Soldé — Lot 1 (#218)** : défauts printing alignés, gates `/settings/security`
réalignés, page renommée « Session Timeouts ». Le volet PIN reste au backlog C.

### C. Nouveaux réglages voulus, absents du code

| Priorité | Réglage | Bénéfice attendu |
|---|---|---|
| **Décidé (ADR-006 déc. 4)** | **Propagation Realtime des settings** | Un changement de réglage se propage en push < 2 s aux caisses/KDS/displays, refetch en fallback. |
| **Décidé (ADR-006 déc. 5)** | **LAN Network / Network Devices + hub local** | Enregistrement et heartbeat de chaque appareil, système hub + communication locale garantissant la **continuité des échanges entre appareils en cas de coupure internet**. Chantier d'architecture transverse (POS/KDS/displays) — spec dédiée requise avant dev. |
| **Décidé (ADR-006 déc. 8)** | **Hub réorganisé en sous-menus par feature** | Chaque fonctionnalité a sa catégorie de réglages et sa page, groupées en sous-menus (esprit des groupes V2 appliqué à la surface réelle V3). Navigation seulement — le stockage reste le socle des décisions 1-2. |
| **Décidé (ADR-006 déc. 9)** | **Business hours** | Marquer les ventes hors-horaire dans les rapports d'audit (signal fraude). |
| **Décidé (ADR-006 déc. 9)** | **Politique PIN configurable** | Exposer dans Settings le lockout/expiration déjà implémentés côté edge functions. |
| **Décidé (ADR-006 déc. 9)** | **Payment methods enrichis** | Ordre d'affichage, e-wallets individuels (GoPay/OVO/DANA), frais par méthode. |
| **Décidé (ADR-006 déc. 9)** | **Toggles workflow cuisine** | Auto-send KDS, print kitchen ticket, lock des items envoyés. |
| **Décidé (ADR-006 déc. 9)** | **Vue « Settings History »** | Filtre dédié de `audit_logs` sur les changements de settings (la donnée existe déjà). |
| **Décidé (ADR-006 déc. 9)** | **Floor plan visuel** | Drag & drop + positions ; le CRUD listes couvre déjà le besoin fonctionnel de base. |
| **Rejeté (ADR-006 déc. 10)** | **Affectation serveur → section** | Décision propriétaire — ne pas re-proposer. |
| **Rejeté (ADR-006 déc. 10)** | **Multi-devise** | Décision propriétaire — la facturation reste en IDR uniquement. |
| **Hors périmètre (ADR-006 déc. 10)** | **Happy hour** | **Déjà livré** par le module Promotions & Combos : fenêtres jours/horaires natives (`day_of_week_mask`, `start_hour`/`end_hour`, appliquées par `evaluate_promotions_v2`). Rien à créer côté Settings. |
| **Rejeté (ADR-006 déc. 10)** | **Multi-boutique** | Décision propriétaire — le projet est propre à une localisation, ne pas re-proposer. |
| Reporté | Export/import config | Hors scope actuel. |

---

## 7. En une phrase

Le module Settings V3 est **réel et honnête dans son câblage** — chaque page vivante
est consommée, chaque changement est tracé. Des six surfaces qui écrivaient dans le
vide au 2026-07-16 (reçus, emails, identité entreprise, jours fériés, déclencheurs de
notifications, `tax_inclusive`), **cinq ont été branchées par les lots 2 à 5**, et la
dernière — `tax_inclusive`, dont le Lot 6 a révélé qu'elle était morte des deux côtés
à la fois, le mode taxe étant codé en dur dans 7 fonctions — a reçu son socle au
Lot 6a (PR #224) : la formule n'a plus qu'un porteur, `_pb1_split_v1`, et le réglage
est lu par construction. Reste le Lot 6b pour rendre la bascule utilisable
(avertissement, refus si commandes ouvertes, affichage HT/TTC, dépréciation du flag
produit).
