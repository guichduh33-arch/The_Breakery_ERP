# Module Settings — Objectif métier

> **Version** : 2026-07-17 (rév. 2) — mise à jour après les lots 1 à 6b
> (PR #218 → #225) : le chantier §6.A « brancher l'existant + fixes » est soldé,
> chaque point revérifié dans le code et sur la base V3 dev.
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
- Lecture `get_settings_by_category_v2`, écriture `set_setting_v3` (validation par
  clé, **audit-log automatique** dans `audit_logs` : qui/quoi/quand/ancienne/nouvelle
  valeur ; v2 droppée — la v3 ajoute le gate de bascule `tax_inclusive`, Lot 6b).
- Pages hors-socle avec leurs propres tables/RPCs : floor-plan, notifications,
  templates, security, accounting, expense-thresholds, B2B.
- **Aucun binding mort** : toute RPC/table référencée par l'UI existe en migration.

### 2.2 Ce qui fonctionne de bout en bout (écrit ET consommé)

| Route | Consommateur réel |
|---|---|
| `/settings` (hub) | Navigation, tuiles gatées par permission |
| `/settings/general` (partiel) | `tax_rate` + `tax_inclusive` → formule PB1 (`_pb1_split_v1`, unique porteur — Lots 6a/6b) et surfaces HT/TTC POS (panier, checkout, reçu, customer display, tablette) ; bascule `tax_inclusive` gatée (`set_setting_v3` : refus si commandes ouvertes, dialog de confirmation BO) ; `timezone` → rapports ; identité `name`/`fiscal_address`/`npwp`/`phone`/`logo_url` → tickets POS (`SuccessModal`), PDF (`generate-pdf`, `generate-zreport-pdf`, `_shared/pdf-layout`) et emails (`_shared/email-html`) — Lot 2 ; seuils de variance shift → `close_shift_v4/v5` + POS |
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
2. **Trace systématique** — chaque `set_setting_v3` écrit dans `audit_logs`
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
| **`tax_inclusive` global** | — | ✅ Livré — Lot 6a (#224, socle `_pb1_split_v1`) + Lot 6b (#225 : bascule gatée `set_setting_v3` + dialog BO, surfaces HT/TTC POS via `splitPb1`/`useTaxConfig`, flag produit déprécié UI+RPC, colonne conservée) |

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
est consommée, chaque changement est tracé. Les six surfaces qui écrivaient dans le
vide au 2026-07-16 (reçus, emails, identité entreprise, jours fériés, déclencheurs de
notifications, `tax_inclusive`) sont **toutes branchées** : lots 2 à 5 pour les cinq
premières, lots 6a + 6b (PR #224/#225) pour `tax_inclusive` — la formule PB1 n'a plus
qu'un porteur (`_pb1_split_v1`), la bascule est gatée (`set_setting_v3`, refus si
commandes ouvertes) et les surfaces POS affichent HT/TTC selon le mode. Le chantier
§6.A est soldé ; la suite du module vit au backlog §6.C (Realtime, hub LAN,
sous-menus, business hours…).
