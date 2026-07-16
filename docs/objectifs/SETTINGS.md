# Module Settings — Objectif métier

> **Version** : 2026-07-16 — réécrit sur la base de l'audit code V3 (17 routes settings
> auditées page par page, câblage RPC/tables/consommateurs vérifié).
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
- Lecture `get_settings_by_category_v1`, écriture `set_setting_v1` (validation par
  clé, **audit-log automatique** dans `audit_logs` : qui/quoi/quand/ancienne/nouvelle
  valeur).
- Pages hors-socle avec leurs propres tables/RPCs : floor-plan, notifications,
  templates, security, accounting, expense-thresholds, B2B.
- **Aucun binding mort** : toute RPC/table référencée par l'UI existe en migration.

### 2.2 Ce qui fonctionne de bout en bout (écrit ET consommé)

| Route | Consommateur réel |
|---|---|
| `/settings` (hub) | Navigation, tuiles gatées par permission |
| `/settings/general` (partiel) | `tax_rate` → money-path (`current_pb1_rate()`) ; `timezone` → rapports ; seuils de variance shift → `close_shift_v4/v5` + POS |
| `/settings/inventory` | `allow_negative_stock` → `record_stock_movement_v1`, `complete_order_v14`, RPCs production |
| `/settings/payment-methods` | `enabled_payment_methods` → POS |
| `/settings/customer-display` | footer/slogan → écran client |
| `/settings/kds` | seuils warning/urgent/auto-archive → KDS (couleurs, alarme, archivage) |
| `/settings/floor-plan` | CRUD tables + sections (6 RPCs), soft-delete, sections actives/inactives |
| `/settings/printing` | auto-print / auto-drawer → `SuccessModal` POS |
| `/settings/pos` | presets paiement / fond de caisse / remises → POS |
| `/settings/notifications` | templates → `enqueue_notification_v1` → outbox (toggle `is_active` effectif) |
| `/settings/permissions` | matrice read-only (édition dans `/backoffice/users/permissions`) |
| `/settings/security` | timeout de session par rôle → `update_role_session_timeout_v1` |
| `/settings/accounting` | périodes fiscales, clôture période + clôture annuelle |
| `/settings/expense-thresholds` | seuils → chaîne d'approbation `submit_expense_v2` |
| `/b2b/settings` | `get/update_b2b_settings_v1` + table dédiée |

### 2.3 Ce qui est livré mais MORT en aval (UI réelle, effet nul)

1. **`/settings/templates/receipt`** — éditeur complet, mais l'impression POS ne lit
   pas `receipt_templates`.
2. **`/settings/templates/email`** — éditeur complet, mais aucun envoi ne lit
   `email_templates` ; le chemin d'envoi réel (`notification-dispatch`) lit
   `notification_templates`. **Deux systèmes de templates coexistent, un seul vit.**
3. **`/settings/general`** — `name`, `fiscal_address`, `currency` et `tax_inclusive`
   (global) : écrits, jamais rendus nulle part (ni ticket, ni facture, ni calcul).
   Le mode taxe incluse réel est **par produit** (`products.tax_inclusive`).
4. **`/settings/holidays`** — CRUD complet sur `holidays`, mais aucune logique métier
   ne lit la table.
5. **Templates de notifications sans déclencheur** — le mécanisme d'envoi est vivant
   (`enqueue_notification_v1` → outbox → dispatch), mais le seul producteur réel est
   le cron anniversaire client. Les templates `low_stock_alert`, `po_received`,
   `expense_approved`, `order_complete`, `payment_received` sont seedés et éditables
   dans `/settings/notifications` sans qu'aucun événement ne les déclenche jamais.
   Cas notable : les seuils de stock bas par produit (`min_stock_threshold`)
   alimentent bien les écrans d'alerte du BO, mais aucune notification ne part.

### 2.4 Anomalies mineures constatées

- **Printing, défauts divergents** : clés jamais sauvegardées → BO affiche OFF,
  POS applique ON. L'écran BO ment jusqu'à la première sauvegarde.
- **Security, gates désalignés** : route gatée `settings.security.manage`, corps de
  page gaté `settings.read`/`settings.update`.
- **Security, titre trompeur** : « Security & PIN » alors que seul le timeout de
  session est géré.

---

## 3. Les invariants du module (constatés tenus, à préserver)

1. **Sauvegarde explicite** — rien ne s'applique sans clic « Save ».
2. **Trace systématique** — chaque `set_setting_v1` écrit dans `audit_logs`
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

| Réglage | Ce qui manque |
|---|---|
| **Templates de reçu** | Faire lire `receipt_templates` par l'impression POS (header/footer/QR/logo). L'éditeur existe déjà. |
| **Identité entreprise sur les documents** | **Décidé (2026-07-16)** : rendre `name`/`fiscal_address` sur tickets et factures B2B, et **ajouter logo + NPWP** (champs à créer dans la fiche identité). |
| **Templates email** | **Décidé (2026-07-16)** : conserver `email_templates` et les **brancher sur un envoi réel** (pas de fusion avec `/settings/notifications`) ; les templates porteront le **logo et le NPWP**. |
| **Holidays** | Donner un consommateur à la table `holidays` (signal rapport ? bannière POS ?) — ou retirer la page. |
| **Déclencheurs de notifications** | Brancher les producteurs des templates seedés : `low_stock_alert` (les seuils `min_stock_threshold` par produit existent et alimentent déjà les écrans BO — il manque l'enqueue), `po_received`, `expense_approved`, `order_complete`, `payment_received`. Seul l'anniversaire client émet aujourd'hui. |
| **`tax_inclusive` global** | **Décidé (ADR-006 déc. 7)** : rendre le réglage effectif comme défaut boutique. Articulation avec le flag par produit (précédence, création produit, migration) à spécifier — money-path concerné. |

### B. Corriger les anomalies constatées

- Aligner les défauts printing BO ↔ POS (source unique de vérité pour ON/OFF).
- Réaligner les gates de `/settings/security` (route vs corps de page).
- Renommer le titre « Security & PIN » → « Session timeouts » (ou livrer le volet PIN, cf. C).

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
est consommée, chaque changement est tracé — mais il reste **quatre surfaces qui
écrivent dans le vide** (reçus, emails, identité entreprise, jours fériés) : les
brancher vaut plus que d'ajouter de nouvelles pages.
