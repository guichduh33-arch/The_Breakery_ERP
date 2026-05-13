# The Breakery — Spec : Purchasing & Suppliers **Complete**

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **Module concerné** : ce spec correspond au module [Purchasing & Suppliers](../../reference/04-modules/07-purchasing-suppliers.md). Pour la spec consolidée actuelle (Partie I fonctionnel + Partie II technique + Partie III backlog + Partie IV design), aller à la référence canonique.

> **Date** : 2026-05-12
> **Auteur** : guichduh33@gmail.com
> **Statut** : Approuvé pour décomposition en sous-phases (executing-plans / subagent-driven-development)
> **Source d'objectifs** : [référence Purchasing & Suppliers](../../reference/04-modules/07-purchasing-suppliers.md) — Partie I (vue fonctionnelle)
> **Couvre** : workflow PO complet (draft → sent → confirmed → partially_received → received), QC par ligne, réception partielle, retours fournisseur, paiements (cash/virement/carte), pièces jointes, écritures comptables auto (réception, paiement, retour), suppliers étendus (NPWP, RIB, catégories, payment terms), imports/exports XLSX, reports (top supplier, PO aging, dépense par catégorie, on-time delivery, prix d'achat trend).
> **Imbrication** : `receive_stock_v1` du spec Inventory complete reçoit en paramètre `p_purchase_order_id` optionnel. La réception PO appelle un wrapper qui orchestre items + supplier + receive_stock pour chaque ligne. Voir §3.6.
> **Backlog opérationnel** : [`../backlog-by-module/07-purchasing-suppliers.md`](../backlog-by-module/07-purchasing-suppliers.md).

---

## 0. Contexte & gap

### 0.1 État actuel V3

- Table `suppliers` minimaliste (session 11 — `20260513000001_init_suppliers.sql`) : `code`, `name`, `contact_phone`, `contact_email`, `address`, `payment_terms_days`, `notes`, `is_active`, soft-delete.
- Permissions seedées : `suppliers.read`, `suppliers.create`, `suppliers.update`, `suppliers.delete`.
- Page CRUD `/backoffice/suppliers` opérationnelle (session 11 phase 01).
- **AUCUNE** notion de Purchase Order, état workflow, QC, retours, paiements, attachments, écritures comptables auto.

### 0.2 État cible V3 (cf. [référence Purchasing & Suppliers](../../reference/04-modules/07-purchasing-suppliers.md))

Workflow complet "from order to cash" :

1. Créer un PO addressé à un supplier, avec items (qty, unit, prix unitaire, TVA, ligne discount).
2. Appliquer discount global + shipping_cost + total auto-calculé.
3. Sauvegarder draft → envoyer (`sent`) → confirmer (`confirmed`).
4. Réceptionner : partielle (qty < commandée → status `partially_received`), totale (`received`), QC par ligne (NULL/TRUE/FALSE), mise à jour stock auto via `stock_movements` purchase + recalcul `cost_price`.
5. Tracer chaque action dans `purchase_order_history` immutable.
6. Gérer retours fournisseur (`purchase_order_returns`).
7. Gérer paiements (`purchase_payments`) : partiel/total, cash/virement/carte.
8. Joindre documents (factures, BL, photos) via Supabase Storage.
9. Émettre JE auto à 3 moments :
   - **Réception** : Dr Inventory + Dr VAT Input / Cr Accounts Payable.
   - **Paiement** : Dr Accounts Payable / Cr Cash ou Bank.
   - **Retour** : Dr Accounts Payable / Cr Inventory.
10. Reports : top supplier, PO aging, dépense par catégorie, on-time delivery rate, prix d'achat trend.

### 0.3 Hors scope V3 (limites assumées — cf. [référence Purchasing](../../reference/04-modules/07-purchasing-suppliers.md))

- Pas d'envoi email automatique au fournisseur.
- Pas de génération PDF du PO (déféré V3 ultérieure).
- Pas de multi-devise (tout en IDR).
- Pas de répartition automatique du landed cost (shipping_cost gonfle le total mais ne réajuste pas `cost_price`).
- Pas d'avoir comptable automatique sur retour après paiement intégral.
- Pas de workflow d'approbation multi-niveaux.

---

## 1. Décisions actées

| # | Décision | Choix |
|---|---|---|
| **C1** | Extension suppliers vs nouvelle table | Extension de la table `suppliers` existante (ALTER) — pas de nouvelle table parallèle. Ajout de colonnes : `npwp`, `bank_name`, `bank_account_number`, `bank_account_holder`, `payment_method` (enum), `category_id` FK vers nouvelle table `supplier_categories`. |
| **C2** | `supplier_categories` | Nouvelle table de catégorisation (alimentation, boissons, packaging, services, autre). Seedée 5 lignes. CRUD ADMIN+. |
| **C3** | `payment_method` enum | `'cash_on_delivery'` / `'net_7'` / `'net_14'` / `'net_30'` / `'net_60'` / `'prepaid'`. Le champ `payment_terms_days` existant est dérivé : `cash_on_delivery=0`, `net_X=X`, `prepaid=NULL`. Migration calcule le mapping rétro. |
| **C4** | Numérotation PO | Format `PO-YYYYMM-XXXX` (ex `PO-202605-0001`) généré server-side via fonction `next_po_number(p_year_month TEXT)` avec lock pour éviter collision. Distinct de `PO-YYYYMMDD-XXXX` du V2 reference (mensuel plus lisible). |
| **C5** | State machine | États : `'draft'`, `'sent'`, `'confirmed'`, `'partially_received'`, `'received'`, `'cancelled'`, `'modified'`. Transitions validées par fonction PostgreSQL `validate_po_transition(old_status, new_status)` + helper TS `getValidTransitions(status)` côté UI. `received` et `cancelled` terminaux. `modified` autorise re-soumission après édition d'un PO déjà sent. |
| **C6** | Atomicité réception | RPC `receive_purchase_order_v1` atomique : pour chaque item dans le payload, UPDATE `quantity_received += qty_received`, calcul nouveau status (full/partial/no-change), update header status + `received_date`, émission `stock_movements` (`purchase`) avec `supplier_id` lié + `unit_cost`. Si toutes les lignes complètes → status `received` → trigger JE Réception. |
| **C7** | QC tri-state | `purchase_order_items.qc_passed` : `NULL` (pending) / `TRUE` (accepté) / `FALSE` (rejeté). Une ligne `FALSE` permet quand même de marquer le PO `partially_received` mais impose la création d'un retour (pour la qty rejetée). UI bloque la transition `received` final si ≥1 ligne `NULL`. |
| **C8** | Retours fournisseur | Nouvelle table `purchase_order_returns` : item_id, quantity, reason (enum), refund_expected, status. RPC `create_purchase_return_v1` atomique : insert return + `quantity_returned += qty` sur l'item + émission `stock_movements` négatif (type `purchase_return` — nouvel enum) + JE retour. |
| **C9** | Mouvement enum extension | Ajout de `'purchase_return'` dans l'enum `movement_type` (signé négatif). Cohérent avec `purchase` positif. |
| **C10** | Paiements | Nouvelle table `purchase_payments` : po_id, amount, payment_method (cash/bank_transfer/card), payment_date, reference, notes. Trigger `update_po_payment_status` recalcule `purchase_orders.payment_status` (`unpaid` / `partially_paid` / `paid`) à chaque insert/update. Trigger `create_purchase_payment_je` émet JE Paiement (Dr AP / Cr Cash ou Bank selon `payment_method`). |
| **C11** | Attachments | Nouvelle table `purchase_order_attachments` (id, po_id, file_path, file_name, mime_type, uploaded_by, uploaded_at). Storage bucket `po-attachments` avec policy RLS qui filtre par path : seuls les utilisateurs avec `purchasing.read` voient les fichiers du PO. |
| **C12** | Activity log | Nouvelle table `purchase_order_history` (append-only — aucune policy UPDATE/DELETE). Trigger `log_po_activity` insère ligne automatiquement à : create, status change, payment, return, attachment add, modification. Colonnes : `po_id`, `action_type`, `actor_profile_id`, `payload JSONB`, `created_at`. |
| **C13** | Couplage comptable auto | 3 triggers : `tr_create_purchase_je` (sur réception), `tr_create_purchase_payment_je` (sur paiement), `tr_create_purchase_return_je` (sur retour). Tous gardent `check_fiscal_period_open()`. Idempotency via `(reference_type, reference_id)` UNIQUE sur `journal_entries`. |
| **C14** | Permissions | Nouvelles permissions : `purchasing.read` (MANAGER+), `purchasing.po.create` (MANAGER+), `purchasing.po.update` (MANAGER+), `purchasing.po.send` (MANAGER+), `purchasing.po.cancel` (MANAGER+), `purchasing.po.receive` (MANAGER+), `purchasing.po.return` (MANAGER+), `purchasing.po.pay` (ADMIN+ — déclenche cash-out), `purchasing.suppliers.categories` (ADMIN+ — gestion catégories). 9 perms. **Note** : on garde les perms existantes `suppliers.{read,create,update,delete}` (session 11) intactes. |
| **C15** | Imports / exports | `poImportService.ts` (XLSX → batch insert PO + items, validation per-line, dry-run preview). `poExportService.ts` (XLSX export filtré par status / dates / supplier). Idem pour suppliers (session 11 export pas encore implémenté → ajouté ici). |
| **C16** | Recalcul `cost_price` | À chaque réception, si `unit_cost` est fourni, RPC met à jour `products.cost_price = unit_cost` (last-cost method). Future évolution V3+ : moving average ou FIFO layers. |
| **C17** | Auto-fill prix négocié | Nouvelle table `supplier_pricing(supplier_id, product_id, unit_price, valid_from, valid_to)` — optionnel. Le combobox produit dans `POFormItems` pré-remplit `unit_price` depuis `supplier_pricing` si actif, sinon depuis `products.cost_price`. |
| **C18** | TVA | Champ `tax_rate DECIMAL(5,2)` au niveau item (default 11% — nouveau taux indonésien) + `tax_amount` calculé. Pas de TVA différenciée par produit en MVP. Settings `purchasing_config.default_tax_rate` lu depuis `core_settings` (nouveau, à créer). |
| **C19** | Réception sans PO | Pour les achats spontanés / cash & carry, redirection vers `/backoffice/inventory/incoming` (cf. spec Inventory complete §6.3). Le module Purchasing ne gère QUE les PO formels. |
| **C20** | Reception staff_id traçabilité | Le `received_by` profile_id est résolu via `auth.uid()` dans la RPC. Pour rigueur opérationnelle (multi-staff sur même session navigateur), prompter PIN au moment de la réception (V3+). MVP : `auth.uid()` suffit. |

---

## 2. Périmètre

### 2.1 Pages & navigation

**Sidebar BO** — nouveau groupe **Purchasing** :

```
Purchasing  (groupe collapsible, perm 'purchasing.read')
  ├─ Suppliers           → /backoffice/purchasing/suppliers          (existant — déplacé)
  ├─ Supplier categories → /backoffice/purchasing/supplier-categories
  ├─ Purchase orders     → /backoffice/purchasing/purchase-orders
  └─ PO drafts           → /backoffice/purchasing/purchase-orders?status=draft (raccourci)
```

> Migration UX : la route session 11 `/backoffice/suppliers` reste fonctionnelle via redirect 301 vers `/backoffice/purchasing/suppliers`. Sidebar retire l'entrée plain "Suppliers" hors du groupe.

### 2.2 Routes

| Route | Composant | PermissionGate |
|---|---|---|
| `/backoffice/purchasing/suppliers` | `<SuppliersPage>` (étendue) | `suppliers.read` |
| `/backoffice/purchasing/suppliers/:id` | `<SupplierDetailPage>` | `suppliers.read` |
| `/backoffice/purchasing/supplier-categories` | `<SupplierCategoriesPage>` | `purchasing.suppliers.categories` |
| `/backoffice/purchasing/purchase-orders` | `<PurchaseOrdersListPage>` | `purchasing.read` |
| `/backoffice/purchasing/purchase-orders/new` | `<PurchaseOrderFormPage mode="create">` | `purchasing.po.create` |
| `/backoffice/purchasing/purchase-orders/:id` | `<PurchaseOrderDetailPage>` | `purchasing.read` |
| `/backoffice/purchasing/purchase-orders/:id/edit` | `<PurchaseOrderFormPage mode="edit">` | `purchasing.po.update` |

---

## 3. Schéma DB — additions

### 3.1 Migrations (≈ 18)

```
# Phase 1 — extension suppliers + categories + pricing
20260517000001_extend_suppliers_purchasing.sql         # ALTER suppliers : +npwp, +bank_*, +payment_method enum, +category_id FK
20260517000002_init_supplier_categories.sql            # CREATE TABLE supplier_categories + 5 seedées + RLS
20260517000003_init_supplier_pricing.sql               # CREATE TABLE supplier_pricing (id, supplier_id, product_id, unit_price, valid_from, valid_to)

# Phase 2 — PO header + items + state machine
20260517000004_init_purchase_orders.sql                # CREATE TABLE purchase_orders + RLS + index status/supplier_id/po_number
20260517000005_init_purchase_order_items.sql           # CREATE TABLE purchase_order_items + RLS
20260517000006_create_next_po_number_fn.sql            # next_po_number(YYYYMM) avec lock pour éviter collision
20260517000007_create_validate_po_transition_fn.sql    # validate_po_transition(old, new) + has_table fiscal period
20260517000008_extend_movement_type_purchase_return.sql # ALTER TYPE movement_type ADD VALUE 'purchase_return'

# Phase 3 — RPCs PO CRUD + workflow
20260517000009_create_create_purchase_order_rpc.sql    # create_purchase_order_v1(p_supplier_id, p_items, p_discount, p_shipping_cost, p_notes)
20260517000010_create_update_purchase_order_rpc.sql    # update_purchase_order_v1 (DRAFT only direct, sinon transition modified)
20260517000011_create_send_purchase_order_rpc.sql      # send_purchase_order_v1 (draft → sent)
20260517000012_create_confirm_purchase_order_rpc.sql   # confirm_purchase_order_v1 (sent → confirmed)
20260517000013_create_cancel_purchase_order_rpc.sql    # cancel_purchase_order_v1 (depuis draft/sent/confirmed/partially_received/modified)

# Phase 4 — Réception + QC + stock
20260517000014_create_receive_purchase_order_rpc.sql   # receive_purchase_order_v1 atomique (items + status + stock_movements + cost_price)

# Phase 5 — Retours
20260517000015_init_purchase_order_returns.sql         # CREATE TABLE purchase_order_returns + RLS
20260517000016_create_create_purchase_return_rpc.sql   # create_purchase_return_v1 atomique (return + qty_returned + stock_movement négatif + JE)

# Phase 6 — Paiements
20260517000017_init_purchase_payments.sql              # CREATE TABLE purchase_payments + RLS
20260517000018_create_record_payment_rpc.sql           # record_purchase_payment_v1
20260517000019_create_update_payment_status_trigger.sql # tr_update_po_payment_status (auto recalcule unpaid/partially/paid)

# Phase 7 — Activity log + attachments
20260517000020_init_purchase_order_history.sql         # CREATE TABLE purchase_order_history (append-only) + triggers
20260517000021_create_log_po_activity_trigger.sql      # log_po_activity (à status change, payment, return, modification)
20260517000022_init_purchase_order_attachments.sql     # CREATE TABLE + storage bucket policy

# Phase 8 — Accounting triggers
20260517000023_create_purchase_je_trigger.sql          # tr_create_purchase_je (sur transition received)
20260517000024_create_purchase_payment_je_trigger.sql  # tr_create_purchase_payment_je
20260517000025_create_purchase_return_je_trigger.sql   # tr_create_purchase_return_je
20260517000026_seed_purchasing_accounts.sql            # comptes Inventory General, VAT Input, Accounts Payable, Cash, Bank (si pas déjà dans accounting)

# Phase 9 — Permissions + perms_v8
20260517000027_seed_purchasing_perms_v1.sql            # 9 perms + role_permissions + has_permission v9 (whitelist MANAGER étendue)

# Phase 10 — Reports views
20260517000028_create_top_suppliers_view.sql           # v_top_suppliers (90j sliding window)
20260517000029_create_po_aging_view.sql                # v_po_aging (unpaid > 30j / 60j / 90j)
20260517000030_create_spend_by_category_view.sql       # v_spend_by_category
20260517000031_create_on_time_delivery_view.sql        # v_supplier_on_time_delivery
20260517000032_create_purchase_price_trend_view.sql    # v_purchase_price_trend (par produit, série temporelle)
```

### 3.2 Schémas clés

#### 3.2.1 `suppliers` (extension)

| Colonne nouvelle | Type | Notes |
|---|---|---|
| `npwp` | TEXT NULL | Identifiant fiscal indonésien — UNIQUE PARTIAL `WHERE npwp IS NOT NULL` |
| `bank_name` | TEXT NULL | |
| `bank_account_number` | TEXT NULL | |
| `bank_account_holder` | TEXT NULL | |
| `payment_method` | TEXT NOT NULL DEFAULT 'net_30' | CHECK IN ('cash_on_delivery','net_7','net_14','net_30','net_60','prepaid') |
| `category_id` | UUID FK supplier_categories NULL ON DELETE SET NULL | |

> **Migration data** : `payment_terms_days` rétro-mappé sur `payment_method` (`0→cash_on_delivery`, `7→net_7`, `14→net_14`, `30→net_30`, `60→net_60`, `>60→net_60`).

#### 3.2.2 `supplier_categories`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `code` | TEXT UNIQUE | 'FOOD', 'BEVERAGE', 'PACKAGING', 'SERVICE', 'OTHER' (seedées) |
| `name` | TEXT NOT NULL | |
| `display_order` | INT DEFAULT 0 | |
| `is_active` | BOOLEAN DEFAULT true | |
| `created_at`, `updated_at`, `deleted_at` | timestamps | |

#### 3.2.3 `supplier_pricing`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `supplier_id` | UUID FK suppliers ON DELETE CASCADE | |
| `product_id` | UUID FK products | |
| `unit_price` | DECIMAL(14,2) NOT NULL CHECK ≥ 0 | |
| `currency` | TEXT NOT NULL DEFAULT 'IDR' | |
| `valid_from` | DATE NOT NULL DEFAULT CURRENT_DATE | |
| `valid_to` | DATE NULL | NULL = open-ended |
| `notes` | TEXT NULL | |
| UNIQUE PARTIAL | `(supplier_id, product_id, valid_to) WHERE valid_to IS NULL` | Une seule ligne ouverte par couple |

#### 3.2.4 `purchase_orders`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `po_number` | TEXT UNIQUE NOT NULL | `PO-YYYYMM-XXXX` |
| `supplier_id` | UUID FK suppliers NOT NULL | |
| `status` | TEXT NOT NULL DEFAULT 'draft' | CHECK IN ('draft','sent','confirmed','partially_received','received','cancelled','modified') |
| `payment_status` | TEXT NOT NULL DEFAULT 'unpaid' | CHECK IN ('unpaid','partially_paid','paid') |
| `subtotal_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Σ items (qty × unit_price post line discount) |
| `discount_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Discount global header |
| `discount_percentage` | DECIMAL(5,2) NULL | Alternative à amount |
| `tax_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Σ items.tax_amount |
| `shipping_cost` | DECIMAL(14,2) NOT NULL DEFAULT 0 | |
| `total_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | subtotal − discount + tax + shipping |
| `paid_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Σ payments.amount |
| `expected_date` | DATE NULL | Date livraison estimée |
| `received_date` | DATE NULL | Date réception effective |
| `notes` | TEXT NULL | |
| `created_by` | UUID FK user_profiles NOT NULL | |
| `confirmed_by`, `received_by`, `cancelled_by` | UUID FK user_profiles NULL | |
| `cancelled_reason` | TEXT NULL | Renseigné si status = cancelled |
| `idempotency_key` | UUID UNIQUE NULL | Sur création depuis low-stock alert |
| `created_at`, `updated_at` | timestamps | |

CHECK : `payment_status='paid' → paid_amount >= total_amount`. CHECK : `received_date IS NULL OR status IN ('partially_received','received')`. CHECK : `cancelled_reason IS NOT NULL OR status != 'cancelled'`.

#### 3.2.5 `purchase_order_items`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `purchase_order_id` | UUID FK purchase_orders ON DELETE CASCADE | |
| `product_id` | UUID FK products NOT NULL | |
| `quantity` | DECIMAL(10,3) NOT NULL CHECK > 0 | Quantité commandée |
| `quantity_received` | DECIMAL(10,3) NOT NULL DEFAULT 0 CHECK ≥ 0 | |
| `quantity_returned` | DECIMAL(10,3) NOT NULL DEFAULT 0 CHECK ≥ 0 | |
| `unit` | TEXT NOT NULL | |
| `unit_price` | DECIMAL(14,2) NOT NULL CHECK ≥ 0 | Prix unitaire IDR |
| `discount_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Ligne discount |
| `tax_rate` | DECIMAL(5,2) NOT NULL DEFAULT 11.00 | % |
| `tax_amount` | DECIMAL(14,2) NOT NULL DEFAULT 0 | Calculé : (qty × unit_price − discount) × tax_rate / 100 |
| `line_total` | DECIMAL(14,2) NOT NULL DEFAULT 0 | (qty × unit_price − discount) + tax_amount |
| `qc_passed` | BOOLEAN NULL | tri-state |
| `qc_notes` | TEXT NULL | |
| `notes` | TEXT NULL | |
| `created_at`, `updated_at` | timestamps | |
| UNIQUE | `(purchase_order_id, product_id)` | Pas de doublon |

CHECK : `quantity_received ≤ quantity + tolerance` (où tolerance = 5% de quantity, à valider).

#### 3.2.6 `purchase_order_returns`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `return_number` | TEXT UNIQUE | `RET-YYYYMM-XXXX` |
| `purchase_order_id` | UUID FK purchase_orders | |
| `purchase_order_item_id` | UUID FK purchase_order_items | |
| `quantity` | DECIMAL(10,3) NOT NULL CHECK > 0 | |
| `unit_price` | DECIMAL(14,2) NOT NULL | Snapshot du prix au moment du retour |
| `refund_amount` | DECIMAL(14,2) NOT NULL | Montant remboursé attendu |
| `reason` | TEXT NOT NULL | CHECK IN ('defective','wrong_item','expired','overstock','other') |
| `notes` | TEXT NULL | |
| `status` | TEXT NOT NULL DEFAULT 'pending' | CHECK IN ('pending','accepted','refunded') |
| `created_by` | UUID FK user_profiles NOT NULL | |
| `created_at`, `updated_at` | timestamps | |

#### 3.2.7 `purchase_payments`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `payment_number` | TEXT UNIQUE | `PAY-YYYYMM-XXXX` |
| `purchase_order_id` | UUID FK purchase_orders | |
| `amount` | DECIMAL(14,2) NOT NULL CHECK > 0 | |
| `payment_method` | TEXT NOT NULL | CHECK IN ('cash','bank_transfer','card') |
| `payment_date` | DATE NOT NULL DEFAULT CURRENT_DATE | |
| `reference` | TEXT NULL | Numéro chèque, virement, etc. |
| `notes` | TEXT NULL | |
| `created_by` | UUID FK user_profiles NOT NULL | |
| `created_at` | timestamptz | |

#### 3.2.8 `purchase_order_attachments`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `purchase_order_id` | UUID FK purchase_orders ON DELETE CASCADE | |
| `file_path` | TEXT NOT NULL | Storage path : `po-attachments/{po_id}/{uuid}-{filename}` |
| `file_name` | TEXT NOT NULL | |
| `file_size` | INT NOT NULL | bytes |
| `mime_type` | TEXT NOT NULL | |
| `uploaded_by` | UUID FK user_profiles NOT NULL | |
| `uploaded_at` | timestamptz | |

#### 3.2.9 `purchase_order_history` (append-only)

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `purchase_order_id` | UUID FK purchase_orders ON DELETE CASCADE | |
| `action_type` | TEXT NOT NULL | 'created' / 'sent' / 'confirmed' / 'partially_received' / 'received' / 'cancelled' / 'modified' / 'payment_recorded' / 'return_created' / 'attachment_uploaded' / 'attachment_deleted' |
| `actor_profile_id` | UUID FK user_profiles NOT NULL | |
| `payload` | JSONB NOT NULL DEFAULT '{}' | Contexte (qty changes, payment.id, return.id, etc.) |
| `created_at` | timestamptz | |

> Aucune policy UPDATE/DELETE — append-only.

### 3.3 Signatures RPC clés

```sql
-- Phase 3 (CRUD + workflow)
create_purchase_order_v1(
  p_supplier_id      UUID,
  p_items            JSONB,         -- [{product_id, quantity, unit, unit_price, tax_rate, discount_amount}]
  p_discount_amount  DECIMAL(14,2)  DEFAULT 0,
  p_discount_percentage DECIMAL(5,2) DEFAULT NULL,
  p_shipping_cost    DECIMAL(14,2)  DEFAULT 0,
  p_expected_date    DATE           DEFAULT NULL,
  p_notes            TEXT           DEFAULT NULL,
  p_idempotency_key  UUID           DEFAULT NULL
) RETURNS JSONB
-- Insert PO header (po_number via next_po_number) + items, calcule subtotal/tax/total,
-- log history 'created', returns {id, po_number, total_amount}.
-- MANAGER+.

update_purchase_order_v1(
  p_id               UUID,
  p_supplier_id      UUID           DEFAULT NULL,
  p_items            JSONB          DEFAULT NULL, -- replace all items
  p_discount_amount  DECIMAL(14,2)  DEFAULT NULL,
  p_shipping_cost    DECIMAL(14,2)  DEFAULT NULL,
  p_notes            TEXT           DEFAULT NULL
) RETURNS JSONB
-- Si status='draft' → édition libre. Si status IN ('sent','confirmed') → status passe à 'modified'.
-- MANAGER+.

send_purchase_order_v1(p_id UUID) RETURNS JSONB
-- draft → sent (validate_po_transition).
-- MANAGER+.

confirm_purchase_order_v1(p_id UUID) RETURNS JSONB
-- sent → confirmed.
-- MANAGER+.

cancel_purchase_order_v1(p_id UUID, p_reason TEXT) RETURNS JSONB
-- Depuis draft/sent/confirmed/partially_received/modified → cancelled.
-- Si partially_received : check qu'aucun stock n'est resté en stock (sinon refus).
-- MANAGER+.

-- Phase 4 (Réception + QC + stock)
receive_purchase_order_v1(
  p_id            UUID,
  p_items         JSONB,           -- [{item_id, quantity_received, qc_passed, qc_notes}]
  p_received_date DATE             DEFAULT CURRENT_DATE,
  p_notes         TEXT             DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL
) RETURNS JSONB
-- Pour chaque item: UPDATE quantity_received += qty, set qc_passed/notes.
-- Calcul nouveau header.status :
--   - somme(qty_received) == 0 → refus (ne change rien)
--   - toutes les lignes complètes (qty_received >= quantity) → 'received'
--   - sinon → 'partially_received'
-- Émet stock_movements 'purchase' pour chaque item (qty_received_delta) avec supplier_id + unit_cost.
-- Met à jour products.cost_price = unit_cost si fourni (last-cost method).
-- Si transition vers 'received' : trigger create_purchase_je → JE auto.
-- Log history.
-- MANAGER+ (purchasing.po.receive).

-- Phase 5 (Retours)
create_purchase_return_v1(
  p_purchase_order_item_id UUID,
  p_quantity              DECIMAL(10,3),
  p_reason                TEXT,
  p_refund_amount         DECIMAL(14,2),
  p_notes                 TEXT DEFAULT NULL
) RETURNS JSONB
-- CHECK : qty <= quantity_received - quantity_returned.
-- Insert return + UPDATE qty_returned += qty + émet stock_movement 'purchase_return' négatif.
-- Trigger create_purchase_return_je.
-- MANAGER+ (purchasing.po.return).

-- Phase 6 (Paiements)
record_purchase_payment_v1(
  p_purchase_order_id UUID,
  p_amount           DECIMAL(14,2),
  p_payment_method   TEXT,        -- 'cash' / 'bank_transfer' / 'card'
  p_payment_date     DATE         DEFAULT CURRENT_DATE,
  p_reference        TEXT         DEFAULT NULL,
  p_notes            TEXT         DEFAULT NULL,
  p_idempotency_key  UUID         DEFAULT NULL
) RETURNS JSONB
-- CHECK : amount > 0, paid_amount + amount <= total_amount + 0.01 tolerance.
-- Insert purchase_payment + UPDATE PO.paid_amount += amount.
-- Trigger update_po_payment_status recalcule payment_status.
-- Trigger create_purchase_payment_je → JE Dr AP / Cr Cash ou Bank.
-- ADMIN+ (purchasing.po.pay — déclenche cash-out).

-- Phase 7 (Historique + attachments)
get_po_history_v1(p_id UUID) RETURNS TABLE (
  action_type, actor_name, actor_role, payload, created_at
)
-- SELECT perm — joined avec user_profiles.

upload_po_attachment_v1(p_po_id UUID, p_file_path TEXT, p_file_name TEXT,
                         p_file_size INT, p_mime_type TEXT) RETURNS JSONB
-- Insert row + log history. Le upload Storage est géré côté client avant cette RPC.

delete_po_attachment_v1(p_attachment_id UUID) RETURNS JSONB
-- Soft delete + log history. Le delete Storage est géré côté client après.
```

### 3.4 Triggers comptables (Phase 8)

```sql
-- Trigger 1 : Réception → Dr Inventory + Dr VAT Input / Cr Accounts Payable
CREATE OR REPLACE FUNCTION create_purchase_je()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subtotal DECIMAL(14,2); v_tax DECIMAL(14,2); v_total DECIMAL(14,2);
BEGIN
  -- Fire only when transitioning to 'received' (not partially_received)
  IF NEW.status != 'received' OR (TG_OP = 'UPDATE' AND OLD.status = 'received') THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.received_date);

  -- Idempotency : skip if JE already exists for (reference_type='purchase', reference_id=NEW.id)
  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'purchase' AND reference_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_subtotal := NEW.subtotal_amount - NEW.discount_amount;
  v_tax      := NEW.tax_amount;
  v_total    := NEW.total_amount;

  PERFORM post_journal_entry(
    p_entry_date := NEW.received_date,
    p_reference_type := 'purchase',
    p_reference_id := NEW.id,
    p_description := 'PO ' || NEW.po_number || ' reception',
    p_lines := jsonb_build_array(
      jsonb_build_object('account_code','1300','debit',v_subtotal,'credit',0),  -- Inventory General
      jsonb_build_object('account_code','1170','debit',v_tax,     'credit',0),  -- VAT Input
      jsonb_build_object('account_code','2110','debit',0,'credit',v_total)      -- Accounts Payable
    )
  );

  RETURN NEW;
END $$;

CREATE TRIGGER tr_create_purchase_je
  AFTER UPDATE OF status ON purchase_orders
  FOR EACH ROW WHEN (NEW.status = 'received')
  EXECUTE FUNCTION create_purchase_je();

-- Trigger 2 : Paiement → Dr AP / Cr Cash ou Bank
-- Trigger 3 : Retour → Dr AP / Cr Inventory
-- (mêmes patterns — voir code Phase 8 plan)
```

### 3.5 State machine — `validate_po_transition`

```sql
CREATE OR REPLACE FUNCTION validate_po_transition(p_old TEXT, p_new TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_old, p_new) IN (
    ('draft','sent'),
    ('draft','cancelled'),
    ('sent','confirmed'),
    ('sent','cancelled'),
    ('sent','modified'),
    ('confirmed','partially_received'),
    ('confirmed','received'),
    ('confirmed','cancelled'),
    ('confirmed','modified'),
    ('partially_received','partially_received'),  -- réception successive
    ('partially_received','received'),
    ('partially_received','cancelled'),
    ('modified','sent'),
    ('modified','confirmed'),
    ('modified','cancelled')
  );
$$;
```

`received` et `cancelled` sont terminaux (aucune transition sortante).

Helper TS jumeau côté UI :

```ts
// packages/domain/src/purchasing/getValidTransitions.ts
export function getValidTransitions(status: POStatus): POTransition[] {
  // returns { canSend, canConfirm, canReceive, canCancel, canModify, canPay, canReturn }
}
```

### 3.6 Imbrication avec Inventory complete

| Cas | RPC appelée | Stock impacté |
|---|---|---|
| Réception PO formelle | `receive_purchase_order_v1` (cf. §3.3) | Émet stock_movements `purchase` avec `to_section_id` (par défaut Main Warehouse) |
| Achat cash & carry sans PO | `record_incoming_stock_v1` (cf. spec Inventory §6.3) | Émet `incoming` |
| Retour fournisseur | `create_purchase_return_v1` | Émet `purchase_return` négatif |
| Création PO depuis low-stock alert | `create_purchase_order_v1` avec items pré-remplis depuis `get_reorder_suggestions_v1` | Aucun stock — PO en draft |

> **Décision** : `receive_stock_v1` (V1 du spec Inventory MVP) est **dépréciée** dans la version complete et remplacée par `receive_purchase_order_v1` (workflow PO). Le RPC `record_incoming_stock_v1` couvre les cas hors PO.

---

## 4. Frontend — additions

### 4.1 Feature folders

```
apps/backoffice/src/features/purchasing/
  components/
    SupplierFormModal.tsx           # étendu : NPWP, RIB, payment_method, category
    SupplierCategoriesPage.tsx      # CRUD ADMIN+
    SupplierImportModal.tsx         # XLSX import
    SupplierExportButton.tsx
    SupplierDetailKPIs.tsx          # total dépensé 90j, dernier PO, top produits
  hooks/
    useSupplierCategories.ts
    useSupplierPricing.ts
    useUpsertSupplierPricing.ts

apps/backoffice/src/features/purchase-orders/
  components/
    PODetailHeader.tsx
    POItemsTable.tsx                # éditable en mode draft / réception
    POSummarySidebar.tsx            # totaux + paiements
    POInfoCard.tsx                  # métadonnées
    POHistoryTimeline.tsx           # purchase_order_history
    POReturnModal.tsx
    POReturnsSection.tsx
    POCancelModal.tsx
    POAttachmentsSection.tsx
    POPaymentModal.tsx
    POReceiveModal.tsx              # qty + qc_passed par item
    POSendButton.tsx
    POConfirmButton.tsx
    POStatusBadge.tsx
    POPaymentStatusBadge.tsx
    POProductCombobox.tsx           # auto-fill prix depuis supplier_pricing
    POFormHeader.tsx
    POFormItems.tsx
    POFormSummary.tsx
    PODiscountModal.tsx
    POAgingBadge.tsx                # rouge si > 30j unpaid
  hooks/
    usePurchaseOrders.ts
    usePurchaseOrderDetail.ts
    useCreatePurchaseOrder.ts
    useUpdatePurchaseOrder.ts
    useSendPurchaseOrder.ts
    useConfirmPurchaseOrder.ts
    useCancelPurchaseOrder.ts
    useReceivePurchaseOrder.ts
    useCreatePurchaseReturn.ts
    useRecordPurchasePayment.ts
    useUploadPOAttachment.ts
    useDeletePOAttachment.ts
    usePOHistory.ts
    usePOValidTransitions.ts        # wrapper getValidTransitions
    usePOImport.ts
    usePOExport.ts
```

### 4.2 Pages

```
apps/backoffice/src/pages/purchasing/
  SuppliersPage.tsx                # étendu — déplacé de /backoffice/suppliers vers /backoffice/purchasing/suppliers
  SupplierDetailPage.tsx
  SupplierCategoriesPage.tsx
  PurchaseOrdersListPage.tsx       # filtres status, payment_status, supplier, dates
  PurchaseOrderFormPage.tsx        # create + edit (modes)
  PurchaseOrderDetailPage.tsx
```

### 4.3 Domain package

```
packages/domain/src/purchasing/
  index.ts
  types.ts                          # POStatus, PaymentStatus, PaymentMethod, Item, Return, Payment, Attachment, History
  getValidTransitions.ts            # state machine helper (mirror SQL)
  computePOTotals.ts                # subtotal, discount, tax, shipping, total
  validatePOForm.ts                 # Zod schema + business rules
  validateReceivePayload.ts         # qty_received <= quantity, qc_passed required pour received
  validatePaymentPayload.ts         # amount > 0, paid + amount <= total
  validateReturnPayload.ts          # qty <= qty_received - qty_returned
  classifyAging.ts                  # (po, today) => 'on_time' | 'overdue_30' | 'overdue_60' | 'overdue_90'
  computeOnTimeRate.ts              # (deliveries[], expected_dates[]) => percentage
  __tests__/                        # ~40 unit tests
```

### 4.4 packages/supabase

- Régénérer `types.generated.ts` après les migrations.
- Étendre `PermissionCode` union avec les **9 nouvelles perms purchasing**.

---

## 5. Tests — matrix

### 5.1 pgTAP (`supabase/tests/purchasing.test.sql`)

| # | Domaine | Tests |
|---|---|---|
| T1-T8 | Suppliers étendus | NPWP unique partial, payment_method enum CHECK, category FK, migration data backfill |
| T9-T15 | Supplier categories | Seed 5, CRUD perms, soft-delete |
| T16-T22 | Supplier pricing | UNIQUE partial, valid_from/to range, RLS |
| T23-T35 | PO CRUD | Create + items batch, update draft libre, update sent → modified, next_po_number unique under concurrent insert |
| T36-T48 | PO state machine | All valid transitions, all invalid transitions raise, cancelled terminal, received terminal |
| T49-T62 | Réception | Partielle update qty + status, totale → received + JE, idempotent replay, qc_passed=FALSE bloque received-final, recalcul cost_price si unit_cost fourni, stock_movement supplier_id correct |
| T63-T70 | Retours | Create return < qty_received, qty_returned += qty, stock_movement purchase_return négatif, JE Dr AP / Cr Inventory |
| T71-T80 | Paiements | Insert payment + update paid_amount + update payment_status (unpaid/partially/paid), idempotent, JE Dr AP / Cr Cash ou Bank selon payment_method |
| T81-T87 | History append-only | Trigger émet ligne à chaque action, RLS append-only (no UPDATE/DELETE policy) |
| T88-T93 | Attachments | Insert row, RLS policy storage filtre par po_id, soft-delete |
| T94-T100 | Couplage comptable | Refus si fiscal period locked, idempotency (reference_type='purchase'), balanced double-entrée, montants corrects |
| T101-T108 | Reports views | v_top_suppliers (90j), v_po_aging (par bucket), v_spend_by_category, v_supplier_on_time_delivery, v_purchase_price_trend |

**Total cible** : ≥100 tests pgTAP.

### 5.2 Vitest domain (`packages/domain/src/purchasing/__tests__/`)

~40 unit tests sur les 9 fichiers de validators / computers / classifiers.

### 5.3 Vitest live RPCs (`supabase/tests/functions/purchasing-*.test.ts`)

| Fichier | Scenarios |
|---|---|
| `purchasing-po-crud.test.ts` | create + items + concurrent po_number unique |
| `purchasing-po-workflow.test.ts` | full happy path : draft → sent → confirmed → partial → received |
| `purchasing-po-receive.test.ts` | partielle, totale, QC FALSE, idempotent, recalcul cost_price |
| `purchasing-po-returns.test.ts` | create + qty cap + JE |
| `purchasing-po-payments.test.ts` | record + update payment_status + JE |
| `purchasing-po-attachments.test.ts` | upload + RLS storage + delete |
| `purchasing-po-cancel.test.ts` | depuis chaque état autorisé + refus depuis received/cancelled |
| `purchasing-supplier-extension.test.ts` | extension + migration backfill |

**Total cible** : ≥35 tests live RPCs.

### 5.4 Vitest backoffice (`apps/backoffice/src/**/__tests__/`)

| Fichier | Scenario |
|---|---|
| `Suppliers.test.tsx` | étendu — formulaire NPWP/RIB/category renderize, sauvegarde |
| `SupplierCategoriesPage.test.tsx` | CRUD ADMIN+ |
| `purchase-orders/__tests__/POForm.test.tsx` | items + auto-fill price from pricing + totals live |
| `purchase-orders/__tests__/POReceive.test.tsx` | partial + QC + total updates |
| `purchase-orders/__tests__/POReturn.test.tsx` | qty cap, raison required |
| `purchase-orders/__tests__/POPayment.test.tsx` | amount cap, payment_method radio |
| `purchase-orders/__tests__/POHistoryTimeline.test.tsx` | timeline rendu correct |
| `purchasing.smoke.test.tsx` | E2E MANAGER : créer supplier étendu → créer PO 3 items → send → confirm → réceptionner partiel → réceptionner final → paiement total → vérifier history + JE |

**Total cible** : ≥40 tests BO.

### 5.5 Cible globale

≥100 pgTAP + ≥40 unit domain + ≥35 live RPCs + ≥40 BO = **≥215 nouveaux tests**.

---

## 6. Critères d'acceptation

### 6.1 Database

- [ ] 32 migrations s'appliquent sans erreur sur `pnpm db:reset`
- [ ] Types regénérés via `pnpm db:types`, fichier committé
- [ ] Migration data : `payment_terms_days` rétro-mappé sur `payment_method` pour les rows session 11
- [ ] RLS lockdown : INSERT/UPDATE/DELETE direct refusés sur `purchase_orders`, `purchase_order_items`, `purchase_order_returns`, `purchase_payments`, `purchase_order_history`
- [ ] `purchase_order_history` réellement append-only (aucune policy UPDATE/DELETE)
- [ ] Numérotation `PO-YYYYMM-XXXX` unique sous concurrence (test pgTAP avec 10 connexions parallèles)

### 6.2 Suppliers étendus

- [ ] Page `/backoffice/purchasing/suppliers` (route déplacée — ancienne `/backoffice/suppliers` redirige 301)
- [ ] Form NPWP, RIB (4 champs), payment_method (dropdown), category (dropdown)
- [ ] Validation NPWP : 15 chiffres ou format `XX.XXX.XXX.X-XXX.XXX`
- [ ] Page `SupplierCategoriesPage` accessible ADMIN+
- [ ] Bouton Import XLSX fonctionne (validation + preview + insert)
- [ ] Bouton Export XLSX télécharge la liste filtrée

### 6.3 Purchase Orders — CRUD

- [ ] Page list paginée + filtres status/payment_status/supplier/dates
- [ ] PurchaseOrderFormPage : ajout supplier + items via `POProductCombobox` qui auto-fill `unit_price` depuis `supplier_pricing`
- [ ] Calcul subtotal/tax/total live côté UI + validation server-side identique
- [ ] Sauvegarde draft → status `draft`
- [ ] Édition draft libre, édition après envoi → status `modified`

### 6.4 Workflow

- [ ] Bouton Send (draft → sent), Confirm (sent → confirmed), Cancel (avec raison)
- [ ] `getValidTransitions` masque les boutons non-autorisés
- [ ] Trigger insert dans `purchase_order_history` à chaque action
- [ ] PO `received` ou `cancelled` : aucun bouton de modification visible

### 6.5 Réception

- [ ] POReceiveModal : pour chaque item, input qty + checkbox qc_passed + textarea qc_notes
- [ ] Bloque submit si ≥1 ligne `qc_passed=NULL` ET intent = receive_final
- [ ] Submit → mise à jour atomique items + status (partial/full) + stock_movements `purchase` avec supplier_id + recalcul cost_price (si unit_cost fourni)
- [ ] Réception successive : status reste `partially_received` jusqu'à completion
- [ ] Transition vers `received` → trigger JE Dr Inventory + Dr VAT Input / Cr AP

### 6.6 Retours

- [ ] POReturnModal : sélection items + qty (capped à `qty_received - qty_returned`) + raison (enum)
- [ ] Submit → return + qty_returned += qty + stock_movement `purchase_return` négatif + JE Dr AP / Cr Inventory

### 6.7 Paiements

- [ ] POPaymentModal (ADMIN+) : amount + payment_method radio (cash/bank_transfer/card) + reference + date
- [ ] Validation amount ≤ total - paid + 0.01 tolerance
- [ ] Submit → insert + auto-update payment_status + JE Dr AP / Cr Cash ou Bank
- [ ] Badge POPaymentStatusBadge : unpaid (gris) / partially_paid (orange) / paid (vert)

### 6.8 Attachments

- [ ] POAttachmentsSection : drop-zone upload + liste fichiers + delete
- [ ] Upload : limite 10 MB, MIME types autorisés (pdf, jpg, png, xlsx, docx)
- [ ] RLS Storage : seuls les utilisateurs avec `purchasing.read` voient les fichiers du PO

### 6.9 Activity log

- [ ] POHistoryTimeline affiche chronologiquement chaque action (created, sent, confirmed, partial, full, payment, return, cancelled, modified, attachment)
- [ ] Chaque ligne montre : actor name + role + payload contextuel (qty changes, payment.amount, return.qty, etc.)

### 6.10 Couplage comptable

- [ ] Trigger `tr_create_purchase_je` génère JE balanced à la transition `received`
- [ ] Trigger `tr_create_purchase_payment_je` génère JE à chaque paiement
- [ ] Trigger `tr_create_purchase_return_je` génère JE à chaque retour
- [ ] Refus opération si fiscal period closed (raise period_locked)
- [ ] Idempotency : double appel `record_purchase_payment_v1` avec même `p_idempotency_key` → 1 seul payment + 1 seul JE
- [ ] Aucun JE émis pour les transitions intermédiaires (sent, confirmed, partially_received)

### 6.11 Imbrication Inventory

- [ ] `receive_purchase_order_v1` émet stock_movements via record_stock_movement_v1 interne (ou directement)
- [ ] `record_incoming_stock_v1` reste utilisé pour les réceptions sans PO
- [ ] Aucune duplication stock entre les deux flux

### 6.12 Reports

- [ ] View `v_top_suppliers` retourne top 20 sur 90 jours par total dépensé
- [ ] View `v_po_aging` regroupe par buckets 0-30 / 30-60 / 60-90 / 90+
- [ ] View `v_spend_by_category` agrège par `supplier_categories.code`
- [ ] View `v_supplier_on_time_delivery` calcule % livraisons à temps (received_date ≤ expected_date) sur 90 jours
- [ ] View `v_purchase_price_trend` retourne série temporelle prix par produit sur 365 jours

### 6.13 Permissions matrix

| Rôle | suppliers.* | purchasing.read | po.create | po.send/confirm/cancel | po.receive | po.return | po.pay | suppliers.categories |
|---|---|---|---|---|---|---|---|---|
| CASHIER | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MANAGER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 6.14 Qualité

- [ ] `pnpm typecheck` 0 erreur
- [ ] `pnpm lint` 0 warning
- [ ] `pnpm test` ≥215 nouveaux tests pass
- [ ] `pnpm build` succès POS + backoffice

### 6.15 Régression

- [ ] Suppliers session 11 fonctionnent toujours (CRUD basique, soft-delete, list)
- [ ] Aucun changement de signature des hooks `useSuppliersList`, `useCreateSupplier`, etc. (extension ascendante compatible)

---

## 7. Risques

| Risque | Mitigation |
|---|---|
| Migration data `payment_method` casse existants | Default `net_30` pour rows existantes ; mapping testé pgTAP |
| Concurrence `next_po_number` génère collision | Lock advisory PostgreSQL via `pg_advisory_lock(po_number_seq_lock_id)` |
| State machine bug → transition invalide accepté | Tests pgTAP exhaustifs (T36-T48) couvrent toutes les paires (old, new) |
| Réception non-atomique → stock incohérent | Tout dans une seule transaction RPC. Idempotency key pour replay safe. |
| QC `NULL` items oubliés → PO marqué `received` à tort | UI bloque + tests |
| Trigger JE bloque réception si fiscal period locked | UI affiche message clair "Fiscal period closed for this date — change date or unlock period" |
| RLS Storage attachments fuit entre POs | Path scheme `po-attachments/{po_id}/{uuid}-{filename}` + policy filtre par split_part(name, '/', 2) |
| Migration extension `payment_method` casse les UI suppliers | Test BO existants (session 11) doivent passer sans modif (default = net_30 absorbé par form) |
| `total_amount` calculé client divergent du server | Trigger BEFORE INSERT/UPDATE sur `purchase_order_items` recalcule `line_total` server-side. Client peut afficher mais source = trigger. |
| `cost_price` recalculé écrase un prix négocié manuellement | Documenter ; future V3+ : moving avg ou option "freeze cost_price" sur le produit |
| Email PO supplier pas envoyé | Documenté §0.3 — bouton "Send" change juste status ; envoi manuel hors-outil |
| Multi-currency manquant | Documenté §0.3 — saisie manuelle dans notes ; future V3+ |
| Volume reports views lent sur 90j × catalogue large | Indexes `(supplier_id, received_date DESC)`, `(payment_status, total_amount)`. Si > 500ms : matérialiser views (refresh nightly). |
| `purchase_return` négatif non géré par triggers `record_stock_movement_je` (Inventory spec) | Le trigger inventory exclut explicitement `purchase_return` ; ce trigger Purchasing s'en charge. Tests T80 vérifient pas de JE doublon. |

---

## 8. Dépendances

| Dépendance | Origine | Usage |
|---|---|---|
| Table `suppliers` | Session 11 | ALTER pour ajouter NPWP, RIB, payment_method, category |
| Permissions `suppliers.*` | Session 11 | Conservées intactes |
| Table `stock_movements` + enum `movement_type` | Session 1 + spec Inventory complete | ALTER : nouveau type `purchase_return` ; émet `purchase` à la réception |
| Tables `journal_entries` + `journal_entry_lines` | Accounting | Cible des triggers JE |
| Function `check_fiscal_period_open` | Accounting | Garde dans triggers JE |
| Function `post_journal_entry` | Accounting | Helper d'insertion JE balanced |
| Function `has_permission()` | Sessions 5-11 (v8 spec Inventory) | Bumpée v9 pour ajouter 9 perms purchasing |
| Storage bucket | Supabase Storage | Nouveau bucket `po-attachments` à créer |

---

## 9. Roadmap post-spec

- **V3.1** : génération PDF du PO (puppeteer ou jsPDF côté Edge Function)
- **V3.2** : envoi automatique email au fournisseur via Edge Function (SMTP/Resend) sur transition `sent`
- **V3.3** : multi-devise (currency lookup table + conversion à la saisie)
- **V3.4** : landed cost auto-réparti pro-rata (shipping_cost réparti sur lignes au prorata du subtotal)
- **V3.5** : avoir comptable automatique sur retour après paiement intégral
- **V3.6** : workflow d'approbation multi-niveaux (PO > seuil → besoin approbation manager + ADMIN)

---

## 10. Glossaire

| Terme | Définition |
|---|---|
| **PO** | Purchase Order — bon de commande fournisseur |
| **GRN** | Goods Received Note — réception de marchandises (intégrée dans `purchase_order_items.quantity_received` + statut header) |
| **QC** | Quality Control — inspection qualité par ligne (tri-state NULL/TRUE/FALSE) |
| **AP** | Accounts Payable — comptes fournisseurs (passif) |
| **VAT Input** | Pajak Pertambahan Nilai déductible — TVA sur achats récupérable |
| **NPWP** | Nomor Pokok Wajib Pajak — identifiant fiscal indonésien |
| **Payment terms** | Délais de paiement (cash on delivery / net X / prepaid) |
| **Aging** | Vieillissement d'une dette non payée (buckets 30/60/90 jours) |
| **Landed cost** | Coût total d'un produit livré (prix + transport + douane + assurance) |
| **State machine** | Machine d'états — transitions valides explicites (ex: draft → sent → confirmed) |

---

**Fin du spec.** Décomposition en 10 sous-phases : [`../plans/2026-05-12-purchasing-complete-INDEX.md`](../plans/2026-05-12-purchasing-complete-INDEX.md).
