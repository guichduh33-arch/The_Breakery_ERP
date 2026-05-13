# Purchasing & Suppliers **Complete** — Implementation Plan INDEX

> **Date** : 2026-05-12
> **Statut** : INDEX multi-phases — chaque phase a son propre fichier `2026-05-12-purchasing-XX-<phase>.md` à créer en exécution
> **Spec source** : `docs/superpowers/specs/2026-05-12-purchasing-complete-spec.md`
> **Imbrication** : dépend du spec Inventory complete pour `record_stock_movement_v1` (interne) et l'enum `movement_type` étendu (`purchase_return`)
> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Chaque phase est isolée et peut être déléguée à un subagent dédié.

---

## Goal global

Livrer le module **Purchasing & Suppliers complete** tel que décrit dans `docs/objectif travail/PURCHASING_AND_SUPPLIERS.md` :

- Suppliers étendus (NPWP, RIB, payment_method enum, catégories)
- Workflow PO complet : draft → sent → confirmed → partially_received → received (state machine validée)
- QC tri-state par ligne + retours fournisseur
- Réception partielle avec mise à jour stock + recalcul cost_price
- Paiements multi (cash / virement / carte) avec auto-update payment_status
- Pièces jointes Storage (factures, BL, photos)
- Activity log immutable
- Couplage comptable automatique (réception, paiement, retour)
- Imports/exports XLSX
- Reports (top supplier, PO aging, dépense par catégorie, on-time delivery, prix d'achat trend)
- ≥215 nouveaux tests passants

## Architecture

10 phases séquencées, partiellement parallélisables après Phase 2 (PO core stable).

```
Phase 1 (suppliers extension + categories + pricing)
   │
   ├── Phase 2 (PO header/items + state machine + numérotation)
   │     │
   │     ├── Phase 3 (CRUD + workflow RPCs : create/update/send/confirm/cancel)
   │     │     │
   │     │     ├── Phase 4 (Réception + QC + stock_movements purchase + cost_price)
   │     │     │
   │     │     ├── Phase 5 (Retours fournisseur — table + RPC + JE)
   │     │     │
   │     │     ├── Phase 6 (Paiements — table + RPC + auto-status + JE)
   │     │     │
   │     │     ├── Phase 7 (Activity log + attachments Storage)
   │     │     │
   │     │     └── Phase 8 (Triggers JE : réception, paiement, retour)
   │     │
   │     └── Phase 9 (Permissions + has_permission v9)
   │
   └── Phase 10 (Reports views : top supplier, aging, spend, OTD, price trend)
```

## Tech Stack

PostgreSQL + Supabase RLS + Supabase Storage, React + Vite + Vitest, TanStack Query, Tailwind, react-router-dom, supabase-js, lucide-react, Zod, xlsx (imports/exports).

## Conventions

- Migrations : datées `20260517xxxxxx` (après Inventory complete `20260516`)
- Sous-plans nommés : `docs/superpowers/plans/2026-05-12-purchasing-{NN}-{slug}.md`
- Tests SQL : `supabase/tests/purchasing.test.sql` (pgTAP) + `supabase/tests/functions/purchasing-*.test.ts` (Vitest live)
- Commits conventional : `feat(db|domain|ui|backoffice): purchasing — phase X — <topic>`. Co-author Claude.

## À la fin

- 32 migrations appliquées propres
- 9 nouvelles permissions seedées + `has_permission` v9
- ≥20 RPCs SECURITY DEFINER versionnés `_v1`
- 6 pages backoffice + ≥40 composants UI + ≥25 hooks
- Package `packages/domain/src/purchasing/` complet (9 fichiers + 40+ tests)
- Couplage comptable auto via 3 triggers
- Storage bucket `po-attachments` configuré + RLS
- Suite tests inclut ≥215 tests purchasing
- 0 typecheck errors / 0 lint warnings / build POS+BO succès

---

## Phase 1 — Suppliers extension + categories + pricing

**Sub-plan:** `2026-05-12-purchasing-01-suppliers-extension.md`

**Goal:** Étendre la table `suppliers` (NPWP, RIB 4 champs, payment_method enum, category_id FK), créer `supplier_categories` (5 seedées) + `supplier_pricing`. Migration data : rétro-mapper `payment_terms_days` sur `payment_method`. Étendre la page Suppliers session 11 avec les nouveaux champs + page CRUD `supplier_categories`. Imports XLSX bulk + export.

**Migrations:** 20260517000001-03 (3 migrations)
**Files:**
- MODIFY `apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx` (ajout champs)
- CREATE `apps/backoffice/src/features/suppliers/components/SupplierImportModal.tsx`
- CREATE `apps/backoffice/src/features/suppliers/components/SupplierCategoriesPage.tsx`
- CREATE `apps/backoffice/src/services/purchasing/supplierImportExportService.ts`
- MODIFY route `/backoffice/suppliers` → redirect 301 vers `/backoffice/purchasing/suppliers`

**Tests:** pgTAP T1-T22 (extensions + categories + pricing + migration data) + Vitest live `purchasing-supplier-extension.test.ts` + tests UI form étendu
**Acceptance:**
- Form supplier nouvelle version : NPWP (validation 15 chiffres), RIB (4 champs), payment_method dropdown, category dropdown
- Anciens suppliers session 11 : `payment_method` rétro-renseigné depuis `payment_terms_days`
- SupplierCategoriesPage (ADMIN+) : CRUD 5 catégories seedées
- Import XLSX : preview puis insert 50 rows en batch
- Export XLSX : télécharge la liste filtrée
- Redirect ancienne route `/backoffice/suppliers` fonctionne

**Estimated effort:** ~600 lignes SQL + ~1500 lignes TS/TSX, ~6-8h

---

## Phase 2 — PO header + items + state machine + numérotation

**Sub-plan:** `2026-05-12-purchasing-02-po-foundations.md`

**Goal:** Poser les tables `purchase_orders` + `purchase_order_items` avec contraintes (CHECK status enum, payment_status enum, totals consistency). Fonctions `next_po_number(YYYYMM)` (avec advisory_lock anti-collision) + `validate_po_transition(old, new)`. Étendre l'enum `movement_type` avec `purchase_return`. RLS lockdown (writes via RPC uniquement).

**Migrations:** 20260517000004-08 (5 migrations)
**Files:** 0 UI (foundation pure DB)
**Tests:** pgTAP T23-T48 (CRUD + state machine + numérotation concurrente)
**Acceptance:**
- 10 connexions pgTAP parallèles invoquant `next_po_number('202605')` → 10 numéros uniques séquentiels
- `validate_po_transition('draft','sent')` → true ; `validate_po_transition('received','sent')` → false
- INSERT direct par `authenticated` → RLS denied

**Estimated effort:** ~700 lignes SQL, ~4-5h

---

## Phase 3 — RPCs CRUD + workflow

**Sub-plan:** `2026-05-12-purchasing-03-po-crud-workflow.md`

**Goal:** Livrer les RPCs CRUD + workflow : `create_purchase_order_v1`, `update_purchase_order_v1` (draft libre / sinon → modified), `send_purchase_order_v1`, `confirm_purchase_order_v1`, `cancel_purchase_order_v1` (avec raison). Toutes émettent rows `purchase_order_history` via trigger. Idempotency.

**Migrations:** 20260517000009-13 (5 migrations)
**Files:**
- CREATE `apps/backoffice/src/features/purchase-orders/components/{POFormHeader,POFormItems,POFormSummary,PODiscountModal,POProductCombobox,POSendButton,POConfirmButton,POCancelModal,POStatusBadge}.tsx`
- CREATE `apps/backoffice/src/features/purchase-orders/hooks/{usePurchaseOrders,useCreatePurchaseOrder,useUpdatePurchaseOrder,useSendPurchaseOrder,useConfirmPurchaseOrder,useCancelPurchaseOrder,usePOValidTransitions}.ts`
- CREATE `apps/backoffice/src/pages/purchasing/{PurchaseOrdersListPage,PurchaseOrderFormPage,PurchaseOrderDetailPage}.tsx`
- MODIFY `apps/backoffice/src/routes/index.tsx` (4 nouvelles routes)
- MODIFY `apps/backoffice/src/layouts/BackofficeLayout.tsx` (groupe Purchasing)

**Tests:** pgTAP étendu + Vitest live `purchasing-po-crud.test.ts` + `purchasing-po-workflow.test.ts` + tests UI form
**Acceptance:**
- PurchaseOrdersListPage : pagination + filtres status, supplier, dates
- PurchaseOrderFormPage : `POProductCombobox` auto-fill `unit_price` depuis `supplier_pricing` (si actif)
- Sauvegarde draft → status `draft` ; édition libre
- Bouton Send → status `sent` (visible uniquement si draft)
- Bouton Confirm → `confirmed` (si sent)
- Bouton Cancel : modal raison required → status `cancelled`
- Édition après envoi → status passe à `modified`
- `getValidTransitions()` masque les boutons invalides

**Estimated effort:** ~1200 lignes SQL + ~2500 lignes TS/TSX, ~12-14h

---

## Phase 4 — Réception + QC + stock_movements

**Sub-plan:** `2026-05-12-purchasing-04-receive-qc.md`

**Goal:** Livrer la RPC `receive_purchase_order_v1` atomique : pour chaque item du payload, UPDATE `quantity_received += qty + qc_passed/notes`, calcul nouveau status (full/partial), émission `stock_movements` `purchase` par item avec supplier_id + unit_cost, recalcul `cost_price` (si fourni), trigger JE Réception (si transition vers `received`). UI : POReceiveModal avec qty + checkbox QC + notes par ligne. Bloque submit si QC NULL en intent receive_final.

**Migrations:** 20260517000014 (1 migration)
**Files:**
- CREATE `apps/backoffice/src/features/purchase-orders/components/{POReceiveModal,POItemsTable}.tsx`
- CREATE `apps/backoffice/src/features/purchase-orders/hooks/useReceivePurchaseOrder.ts`

**Tests:** pgTAP T49-T62 + Vitest live `purchasing-po-receive.test.ts` (partial + total + QC FALSE + idempotent + recalcul cost_price) + tests UI
**Acceptance:**
- POReceiveModal : 3 items avec qty + qc_passed + notes
- Submit partial (qty < ordered) → status `partially_received`, items mis à jour, stock_movements émis avec supplier_id
- Réception successive sur le même PO → cumul correct sur `quantity_received`
- Submit final avec toutes lignes complètes ET tous qc_passed=TRUE → status `received` + JE auto Dr Inventory + Dr VAT Input / Cr AP
- Bloque submit final si ≥1 ligne `qc_passed=NULL`
- Item `qc_passed=FALSE` accepté en partial (impose retour fournisseur ensuite)
- Recalcul `products.cost_price` = unit_cost (last-cost method) si fourni

**Estimated effort:** ~600 lignes SQL + ~1200 lignes TS/TSX, ~7-9h

---

## Phase 5 — Retours fournisseur

**Sub-plan:** `2026-05-12-purchasing-05-returns.md`

**Goal:** Livrer la table `purchase_order_returns` + RPC `create_purchase_return_v1` atomique : insert return + UPDATE `qty_returned += qty` sur l'item + émission `stock_movement` `purchase_return` négatif + JE auto Dr AP / Cr Inventory. UI POReturnModal + POReturnsSection.

**Migrations:** 20260517000015-16 (2 migrations)
**Files:**
- CREATE `apps/backoffice/src/features/purchase-orders/components/{POReturnModal,POReturnsSection}.tsx`
- CREATE `apps/backoffice/src/features/purchase-orders/hooks/useCreatePurchaseReturn.ts`

**Tests:** pgTAP T63-T70 + Vitest live `purchasing-po-returns.test.ts`
**Acceptance:**
- POReturnModal : sélection items + qty (capped à `qty_received - qty_returned`) + raison enum (defective/wrong_item/expired/overstock/other) + refund_amount
- Submit → return créé + qty_returned += qty + stock_movement purchase_return négatif émis
- JE Dr AP / Cr Inventory du `qty × unit_price`
- POReturnsSection affiche timeline retours du PO

**Estimated effort:** ~500 lignes SQL + ~800 lignes TS/TSX, ~5-6h

---

## Phase 6 — Paiements

**Sub-plan:** `2026-05-12-purchasing-06-payments.md`

**Goal:** Livrer la table `purchase_payments` + RPC `record_purchase_payment_v1` (ADMIN+ — déclenche cash-out). Trigger `update_po_payment_status` recalcule auto `purchase_orders.payment_status` (unpaid/partially_paid/paid). Trigger `create_purchase_payment_je` émet JE Dr AP / Cr Cash ou Bank selon `payment_method`. UI POPaymentModal + POSummarySidebar avec liste payments.

**Migrations:** 20260517000017-19 (3 migrations)
**Files:**
- CREATE `apps/backoffice/src/features/purchase-orders/components/{POPaymentModal,POPaymentStatusBadge,POSummarySidebar,POAgingBadge}.tsx`
- CREATE `apps/backoffice/src/features/purchase-orders/hooks/useRecordPurchasePayment.ts`

**Tests:** pgTAP T71-T80 + Vitest live `purchasing-po-payments.test.ts`
**Acceptance:**
- POPaymentModal (ADMIN+) : amount + payment_method radio (cash/bank_transfer/card) + reference + date + notes
- Validation amount ≤ total - paid + 0.01 tolerance
- Submit → insert + auto-update payment_status (unpaid → partially_paid → paid)
- JE Dr AP / Cr Cash (si cash) ou Cr Bank (si bank_transfer/card) du montant
- POSummarySidebar affiche totaux + liste payments + bouton "Add payment"
- POAgingBadge rouge si unpaid > 30j

**Estimated effort:** ~500 lignes SQL + ~1000 lignes TS/TSX, ~6-8h

---

## Phase 7 — Activity log + attachments

**Sub-plan:** `2026-05-12-purchasing-07-history-attachments.md`

**Goal:** Livrer la table `purchase_order_history` (append-only) + trigger `log_po_activity` qui insère ligne automatiquement à : create, status change, payment, return, attachment add/delete, modification. RPC `get_po_history_v1` (lecture jointed avec user_profiles). Table `purchase_order_attachments` + Storage bucket `po-attachments` + RLS policy. UI POHistoryTimeline + POAttachmentsSection (drop-zone upload + liste + delete).

**Migrations:** 20260517000020-22 (3 migrations + bucket creation)
**Files:**
- CREATE `apps/backoffice/src/features/purchase-orders/components/{POHistoryTimeline,POAttachmentsSection}.tsx`
- CREATE `apps/backoffice/src/features/purchase-orders/hooks/{usePOHistory,useUploadPOAttachment,useDeletePOAttachment}.ts`

**Tests:** pgTAP T81-T93 + Vitest live `purchasing-po-attachments.test.ts`
**Acceptance:**
- Tout action sur un PO → ligne dans `purchase_order_history` (action_type, actor, payload)
- POHistoryTimeline affiche chronologiquement avec actor name + role + payload contextuel
- Append-only : aucune policy UPDATE/DELETE (test pgTAP)
- POAttachmentsSection : drop-zone upload (max 10MB, MIME pdf/jpg/png/xlsx/docx)
- Storage RLS : seuls users avec `purchasing.read` voient fichiers du PO
- Delete attachment → soft-delete + log history

**Estimated effort:** ~700 lignes SQL + ~1500 lignes TS/TSX, ~7-9h

---

## Phase 8 — Accounting triggers

**Sub-plan:** `2026-05-12-purchasing-08-accounting.md`

**Goal:** Livrer les 3 triggers JE :
- `tr_create_purchase_je` (sur transition `received`) : Dr Inventory + Dr VAT Input / Cr AP
- `tr_create_purchase_payment_je` : Dr AP / Cr Cash ou Bank selon `payment_method`
- `tr_create_purchase_return_je` : Dr AP / Cr Inventory

Tous gardent `check_fiscal_period_open()`. Idempotency via UNIQUE `(reference_type, reference_id)` sur `journal_entries`. Comptes Inventory General (1300), VAT Input (1170), AP (2110), Cash (1110), Bank (1120) seedés (si pas déjà dans accounting).

**Migrations:** 20260517000023-26 (4 migrations)
**Files:** 0 UI
**Tests:** pgTAP T94-T100 (10 tests JE)
**Acceptance:**
- Réception PO → JE balanced Dr Inventory (subtotal − discount) + Dr VAT Input (tax) / Cr AP (total)
- Paiement cash → JE Dr AP / Cr Cash (1110)
- Paiement bank_transfer → JE Dr AP / Cr Bank (1120)
- Retour → JE Dr AP / Cr Inventory du `qty × unit_price`
- Fiscal period closed → raise `period_locked`
- Double appel idempotent → 1 seul JE

**Estimated effort:** ~800 lignes SQL, ~6-8h

---

## Phase 9 — Permissions + has_permission v9

**Sub-plan:** `2026-05-12-purchasing-09-perms.md`

**Goal:** Seed 9 permissions purchasing + `role_permissions` + `has_permission` v9 (whitelist MANAGER étendue + branch ADMIN+ pour `purchasing.po.pay` et `purchasing.suppliers.categories`).

**Migrations:** 20260517000027 (1 migration)
**Files:**
- MODIFY `packages/supabase/src/rls/permissions.ts` (9 codes ajoutés au type union)

**Tests:** pgTAP perm matrix
**Acceptance:**
- `has_permission(MANAGER, 'purchasing.po.create')` → true
- `has_permission(MANAGER, 'purchasing.po.pay')` → false
- `has_permission(ADMIN, 'purchasing.po.pay')` → true
- `has_permission(CASHIER, 'purchasing.read')` → false

**Estimated effort:** ~200 lignes SQL, ~2h

---

## Phase 10 — Reports views

**Sub-plan:** `2026-05-12-purchasing-10-reports.md`

**Goal:** Créer 5 views SQL pour les reports purchasing :
- `v_top_suppliers` (90j sliding window, top 20 par dépense)
- `v_po_aging` (buckets 0-30 / 30-60 / 60-90 / 90+ pour PO unpaid)
- `v_spend_by_category` (agrégat par `supplier_categories.code`)
- `v_supplier_on_time_delivery` (% livraisons à temps `received_date <= expected_date` sur 90j)
- `v_purchase_price_trend` (série temporelle prix par produit sur 365j)

Indexes performance : `(supplier_id, received_date DESC)`, `(payment_status, total_amount)`, `(product_id, received_date DESC)` sur stock_movements pour le price trend.

**Migrations:** 20260517000028-32 (5 migrations)
**Files:** 0 UI directe (les views sont consommées par le module Reports — session 13)
**Tests:** pgTAP T101-T108 (vues retournent données correctes sur dataset seed)
**Acceptance:**
- Vues queryables sans erreur sur dataset seed
- Performance < 500ms sur catalogue 500 produits × 1000 PO sur 90j (si lent → matérialiser nightly)

**Estimated effort:** ~500 lignes SQL, ~3-4h

---

## File Structure (récap)

| Action | Path | Phase |
|---|---|---|
| CREATE 32 migrations | `supabase/migrations/20260517000001-32_*.sql` | 1-10 |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen) | 1+ |
| MODIFY | `packages/supabase/src/rls/permissions.ts` (9 perms) | 9 |
| CREATE | `packages/domain/src/purchasing/` (9 fichiers + tests) | 3-6 (incrémental) |
| MODIFY | `apps/backoffice/src/features/suppliers/` (extension) | 1 |
| CREATE | `apps/backoffice/src/features/purchase-orders/` (~25 composants + ~15 hooks) | 3-7 |
| CREATE | `apps/backoffice/src/services/purchasing/{poImportExportService,supplierImportExportService}.ts` | 1 + 3 |
| CREATE | `apps/backoffice/src/pages/purchasing/*.tsx` (5 pages) | 1 + 3 |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (5 routes + redirect 301) | 1 + 3 |
| MODIFY | `apps/backoffice/src/layouts/BackofficeLayout.tsx` (groupe Purchasing) | 3 |
| CREATE | `supabase/tests/purchasing.test.sql` (≥100 pgTAP) | 1-10 (incrémental) |
| CREATE | `supabase/tests/functions/purchasing-*.test.ts` (8 fichiers) | 1, 3-7 |
| CREATE | Storage bucket `po-attachments` + policy | 7 |

---

## Verification commands (one-shot)

```bash
pnpm db:reset && pnpm db:types
pnpm typecheck && pnpm lint && pnpm test --concurrency=1 && pnpm build

# pgTAP only
pnpm test:pgtap

# Targeted RPC tests
pnpm --filter @breakery/supabase test purchasing

# BO smoke
pnpm --filter @breakery/backoffice test purchasing.smoke
```

Expected at the end :
- 32 migrations applied
- `types.generated.ts` updated and committed
- 0 typecheck errors, 0 lint warnings
- ≥215 new tests passing
- POS + BO builds successful
- All acceptance criteria in spec §6 ticked

---

## Out of scope (déféré V3+)

| Feature | Session prévue |
|---|---|
| Génération PDF du PO | V3.1 |
| Envoi email automatique au fournisseur (Edge Function SMTP/Resend) | V3.2 |
| Multi-devise (currency lookup table + conversion) | V3.3 |
| Landed cost auto-réparti pro-rata | V3.4 |
| Avoir comptable automatique sur retour après paiement intégral | V3.5 |
| Workflow d'approbation multi-niveaux (PO > seuil) | V3.6 |
| Reports module UI (consomme les views v_*) | Session 13 |

---

## Dépendances

| Dépendance | Origine | Notes |
|---|---|---|
| Table `suppliers` + perms | Session 11 | Étendue Phase 1 |
| Table `stock_movements` + enum `movement_type` | Session 1 + Inventory complete | Enum étendu Phase 2 (`purchase_return`) |
| Function `record_stock_movement_v1` | Inventory complete Phase 2 | Appelée par `receive_purchase_order_v1` (Phase 4) et `create_purchase_return_v1` (Phase 5) |
| Tables accounting (journal_entries, accounts) + helpers | Module accounting | Cible des triggers Phase 8 |
| Function `check_fiscal_period_open` | Module accounting | Garde dans triggers Phase 8 |
| Storage Supabase | Plateforme | Bucket `po-attachments` créé Phase 7 |

---

**Fin de l'INDEX.** Pour exécuter une phase, créer le sous-plan correspondant puis lancer un subagent ciblé.
